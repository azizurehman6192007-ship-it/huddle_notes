import "server-only";

import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { Notes } from "@/lib/ai/schema";
import { formatDayLabel, formatLongDate, parseDateOnly } from "@/lib/util/format";

/**
 * §9. A4, 44pt margins, watermark on every page drawn before the content.
 *
 * Type note: pdf-lib's standard fonts are used rather than the §7 faces.
 * Embedding Bricolage/Inter means shipping ~400KB of TTF and wiring fontkit
 * into the worker; Helvetica keeps the PDF small and the worker simple. The
 * hierarchy (bold display / regular body / mono utility) is preserved.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 44;
const CONTENT_WIDTH = A4.width - MARGIN * 2;

const INK = rgb(0.09, 0.1, 0.18);
const INK_2 = rgb(0.36, 0.38, 0.47);
const INK_3 = rgb(0.55, 0.56, 0.64);
const HAIRLINE = rgb(0.84, 0.85, 0.89);
const WATERMARK = rgb(0.85, 0.86, 0.89);
const AMBER = rgb(0.78, 0.48, 0.09);

export interface PdfInput {
  teamName: string;
  watermarkText: string | null;
  title: string;
  meetingDate: string;
  durationLabel: string | null;
  notes: Notes;
  /** Resolved owners, so the PDF matches what the lead approved on screen. */
  actionItems: {
    task: string;
    ownerName: string | null;
    due: string | null;
    unassigned: boolean;
  }[];
}

interface Fonts {
  body: PDFFont;
  bold: PDFFont;
  mono: PDFFont;
}

export async function renderNotesPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.title} — ${input.meetingDate}`);
  doc.setCreator("Huddle");

  const fonts: Fonts = {
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.Courier),
  };

  const watermark = (input.watermarkText ?? "").trim();
  const pages: PDFPage[] = [];
  let page = newPage(doc, pages, watermark, fonts);
  let y = A4.height - MARGIN;

  /** Moves to a fresh page when the next block would not fit. */
  const ensure = (needed: number) => {
    if (y - needed >= MARGIN + 28) return;
    page = newPage(doc, pages, watermark, fonts);
    y = A4.height - MARGIN;
  };

  // ---------------------------------------------------------------- header
  page.drawText(input.teamName, {
    x: MARGIN,
    y: y - 12,
    size: 12,
    font: fonts.bold,
    color: INK,
  });

  const dateLabel = formatLongDate(parseDateOnly(input.meetingDate));
  const headerRight = input.durationLabel
    ? `${input.title} · ${dateLabel} · ${input.durationLabel}`
    : `${input.title} · ${dateLabel}`;
  const headerRightWidth = fonts.body.widthOfTextAtSize(headerRight, 9);

  page.drawText(headerRight, {
    x: A4.width - MARGIN - headerRightWidth,
    y: y - 11,
    size: 9,
    font: fonts.body,
    color: INK_2,
  });

  y -= 24;
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: A4.width - MARGIN, y },
    thickness: 0.75,
    color: HAIRLINE,
  });
  y -= 26;

  // --------------------------------------------------------------- summary
  if (input.notes.summary.trim()) {
    y = section(page, fonts, "SUMMARY", y);
    const lines = wrap(input.notes.summary.trim(), fonts.body, 11, CONTENT_WIDTH);
    ensure(lines.length * 15 + 10);
    for (const line of lines) {
      page.drawText(line, { x: MARGIN, y, size: 11, font: fonts.body, color: INK });
      y -= 15;
    }
    y -= 12;
  }

  // ---------------------------------------------------- per-person updates
  const people = personSections(input.notes);

  if (people.length > 0) {
    for (const person of people) {
      ensure(60);
      page.drawText(person.name.toUpperCase(), {
        x: MARGIN,
        y,
        size: 11,
        font: fonts.bold,
        color: INK,
      });
      y -= 16;

      for (const row of person.rows) {
        const lines = wrap(row.text, fonts.body, 10, CONTENT_WIDTH - 74);
        ensure(lines.length * 14 + 6);

        page.drawText(row.label, {
          x: MARGIN,
          y,
          size: 8,
          font: fonts.mono,
          color: row.emphasis ? AMBER : INK_3,
        });

        lines.forEach((line, index) => {
          page.drawText(line, {
            x: MARGIN + 74,
            y: y - index * 14,
            size: 10,
            font: fonts.body,
            color: INK,
          });
        });

        y -= Math.max(14, lines.length * 14) + 2;
      }
      y -= 12;
    }
  }

  // ---------------------------------------------------------- action items
  if (input.actionItems.length > 0) {
    ensure(70);
    y = section(page, fonts, "ACTION ITEMS", y);
    y = actionTable(page, fonts, input.actionItems, y, ensure, () => page);
    y -= 10;
  }

  // ------------------------------------------------- decisions / questions
  for (const block of [
    { heading: "DECISIONS", items: input.notes.decisions },
    { heading: "OPEN QUESTIONS", items: input.notes.open_questions },
  ]) {
    if (block.items.length === 0) continue;
    ensure(50);
    y = section(page, fonts, block.heading, y);

    for (const item of block.items) {
      const lines = wrap(item, fonts.body, 10, CONTENT_WIDTH - 14);
      ensure(lines.length * 14 + 4);
      page.drawText("·", { x: MARGIN, y, size: 10, font: fonts.body, color: INK_3 });
      lines.forEach((line, index) => {
        page.drawText(line, {
          x: MARGIN + 14,
          y: y - index * 14,
          size: 10,
          font: fonts.body,
          color: INK,
        });
      });
      y -= lines.length * 14 + 2;
    }
    y -= 12;
  }

  stampFooters(pages, fonts);

  return doc.save();
}

function newPage(
  doc: PDFDocument,
  pages: PDFPage[],
  watermark: string,
  fonts: Fonts,
): PDFPage {
  const page = doc.addPage([A4.width, A4.height]);
  pages.push(page);

  // Drawn first, so every bit of content sits on top of it and stays readable.
  if (watermark) {
    const size = 55;
    const width = fonts.bold.widthOfTextAtSize(watermark, size);
    page.drawText(watermark, {
      x: A4.width / 2 - (width / 2) * Math.cos(Math.PI / 4),
      y: A4.height / 2 - (width / 2) * Math.sin(Math.PI / 4),
      size,
      font: fonts.bold,
      color: WATERMARK,
      rotate: degrees(45),
    });
  }

  return page;
}

function section(page: PDFPage, fonts: Fonts, heading: string, y: number): number {
  page.drawText(heading, {
    x: MARGIN,
    y,
    size: 8,
    font: fonts.mono,
    color: INK_3,
  });
  return y - 16;
}

function personSections(notes: Notes) {
  const byPerson = new Map<
    string,
    { label: string; text: string; emphasis?: boolean }[]
  >();

  for (const update of notes.updates) {
    const rows = byPerson.get(update.person) ?? [];
    if (update.yesterday.length) {
      rows.push({ label: "Yesterday", text: update.yesterday.join(" ") });
    }
    if (update.today.length) {
      rows.push({ label: "Today", text: update.today.join(" ") });
    }
    byPerson.set(update.person, rows);
  }

  for (const blocker of notes.blockers) {
    const rows = byPerson.get(blocker.person) ?? [];
    rows.push({ label: "Blocker", text: blocker.issue, emphasis: true });
    if (blocker.needs) {
      rows.push({ label: "Needs", text: blocker.needs, emphasis: true });
    }
    byPerson.set(blocker.person, rows);
  }

  return Array.from(byPerson, ([name, rows]) => ({ name, rows })).filter(
    (person) => person.rows.length > 0,
  );
}

function actionTable(
  page: PDFPage,
  fonts: Fonts,
  items: PdfInput["actionItems"],
  startY: number,
  ensure: (needed: number) => void,
  currentPage: () => PDFPage,
): number {
  const ownerWidth = 96;
  const dueWidth = 74;
  const taskWidth = CONTENT_WIDTH - ownerWidth - dueWidth - 20;
  let y = startY;

  for (const item of items) {
    const lines = wrap(item.task, fonts.body, 10, taskWidth);
    const rowHeight = Math.max(20, lines.length * 13 + 8);
    ensure(rowHeight + 6);
    const target = currentPage();

    target.drawRectangle({
      x: MARGIN,
      y: y - rowHeight + 12,
      width: CONTENT_WIDTH,
      height: rowHeight,
      borderColor: HAIRLINE,
      borderWidth: 0.75,
    });

    target.drawText(item.ownerName ?? "Unassigned", {
      x: MARGIN + 8,
      y: y + 1,
      size: 9,
      font: item.unassigned ? fonts.bold : fonts.body,
      color: item.unassigned ? AMBER : INK,
    });

    lines.forEach((line, index) => {
      target.drawText(line, {
        x: MARGIN + ownerWidth + 8,
        y: y + 1 - index * 13,
        size: 10,
        font: fonts.body,
        color: INK,
      });
    });

    const due = item.due ? formatDayLabel(parseDateOnly(item.due)) : "—";
    target.drawText(due, {
      x: A4.width - MARGIN - dueWidth,
      y: y + 1,
      size: 9,
      font: fonts.mono,
      color: INK_2,
    });

    y -= rowHeight + 4;
  }

  return y;
}

/** `Generated by Huddle · {date}` plus page numbers, mono 8pt. */
function stampFooters(pages: PDFPage[], fonts: Fonts): void {
  const generated = `Generated by Huddle · ${formatLongDate(new Date())}`;

  pages.forEach((page, index) => {
    page.drawText(generated, {
      x: MARGIN,
      y: MARGIN - 16,
      size: 8,
      font: fonts.mono,
      color: INK_3,
    });

    const label = `${index + 1} / ${pages.length}`;
    const width = fonts.mono.widthOfTextAtSize(label, 8);
    page.drawText(label, {
      x: A4.width - MARGIN - width,
      y: MARGIN - 16,
      size: 8,
      font: fonts.mono,
      color: INK_3,
    });
  });
}

/**
 * pdf-lib has no text layout, and WinAnsi cannot encode every character a
 * transcript may contain, so unsupported glyphs are dropped rather than
 * throwing mid-render.
 */
function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const safe = text.replace(/[^\x20-\xFF]/g, "");
  const words = safe.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);

  return lines;
}
