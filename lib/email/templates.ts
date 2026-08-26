import "server-only";

import type { Notes } from "@/lib/ai/schema";
import { formatDayLabel, parseDateOnly } from "@/lib/util/format";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface EmailInput {
  teamName: string;
  title: string;
  meetingDate: string;
  notes: Notes;
  actionItems: {
    task: string;
    ownerName: string | null;
    due: string | null;
    unassigned: boolean;
  }[];
  /** Link back to the huddle in the app. */
  url: string;
}

/**
 * §10. The summary and action items are inline, because most people read this
 * on a phone and will never open the attachment. The PDF is for the record.
 */
export function buildNotesEmail(input: EmailInput): EmailContent {
  const dayLabel = formatDayLabel(parseDateOnly(input.meetingDate));

  return {
    subject: `Standup notes — ${dayLabel}`,
    html: renderHtml(input, dayLabel),
    text: renderText(input, dayLabel),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHtml(input: EmailInput, dayLabel: string): string {
  const { notes } = input;

  const actionRows = input.actionItems
    .map((item) => {
      const owner = item.unassigned
        ? '<span style="color:#C87A16;font-weight:600">Unassigned</span>'
        : escapeHtml(item.ownerName ?? "");
      const due = item.due
        ? escapeHtml(formatDayLabel(parseDateOnly(item.due)))
        : "—";
      return `<tr>
        <td style="padding:8px 12px;border-top:1px solid #D6DAE4;font-size:14px;color:#171A2E;white-space:nowrap">${owner}</td>
        <td style="padding:8px 12px;border-top:1px solid #D6DAE4;font-size:14px;color:#171A2E">${escapeHtml(item.task)}</td>
        <td style="padding:8px 12px;border-top:1px solid #D6DAE4;font-size:13px;color:#5B6178;white-space:nowrap">${due}</td>
      </tr>`;
    })
    .join("");

  const blockerBlock = notes.blockers
    .map(
      (blocker) => `<p style="margin:0 0 8px;font-size:14px;color:#171A2E">
        <strong>${escapeHtml(blocker.person)}</strong> — ${escapeHtml(blocker.issue)}
        ${blocker.needs ? `<br><span style="color:#5B6178">Needs: ${escapeHtml(blocker.needs)}</span>` : ""}
      </p>`,
    )
    .join("");

  const section = (heading: string, body: string) =>
    body
      ? `<h2 style="margin:28px 0 10px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8B90A3;font-weight:600">${heading}</h2>${body}`
      : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#EFF1F5">
<div style="max-width:600px;margin:0 auto;padding:28px 20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <div style="background:#FFFFFF;border:1px solid #D6DAE4;border-radius:16px;padding:24px">
    <p style="margin:0;font-size:13px;color:#8B90A3">${escapeHtml(input.teamName)}</p>
    <h1 style="margin:4px 0 0;font-size:20px;color:#171A2E">${escapeHtml(input.title)} · ${escapeHtml(dayLabel)}</h1>

    ${
      notes.summary.trim()
        ? `<p style="margin:18px 0 0;font-size:15px;line-height:1.55;color:#171A2E">${escapeHtml(notes.summary)}</p>`
        : ""
    }

    ${section(
      "Action items",
      actionRows
        ? `<table style="width:100%;border-collapse:collapse">${actionRows}</table>`
        : "",
    )}

    ${section("Blockers", blockerBlock)}

    ${section(
      "Decisions",
      notes.decisions.length
        ? `<ul style="margin:0;padding-left:18px;font-size:14px;color:#171A2E">${notes.decisions
            .map((d) => `<li style="margin-bottom:6px">${escapeHtml(d)}</li>`)
            .join("")}</ul>`
        : "",
    )}

    <p style="margin:28px 0 0;font-size:13px;color:#5B6178">
      Full notes are attached as a PDF, or
      <a href="${escapeHtml(input.url)}" style="color:#C87A16">open the huddle</a>.
    </p>
  </div>
  <p style="margin:16px 0 0;text-align:center;font-size:12px;color:#8B90A3">Sent by Huddle</p>
</div>
</body></html>`;
}

/** Required fallback — some clients and most filters want it. */
function renderText(input: EmailInput, dayLabel: string): string {
  const { notes } = input;
  const lines = [`${input.title} · ${dayLabel}`, input.teamName, ""];

  if (notes.summary.trim()) lines.push(notes.summary.trim(), "");

  if (input.actionItems.length) {
    lines.push("ACTION ITEMS");
    for (const item of input.actionItems) {
      const owner = item.unassigned ? "Unassigned" : (item.ownerName ?? "");
      const due = item.due ? ` (due ${formatDayLabel(parseDateOnly(item.due))})` : "";
      lines.push(`- ${owner}: ${item.task}${due}`);
    }
    lines.push("");
  }

  if (notes.blockers.length) {
    lines.push("BLOCKERS");
    for (const blocker of notes.blockers) {
      lines.push(
        `- ${blocker.person}: ${blocker.issue}${blocker.needs ? ` (needs: ${blocker.needs})` : ""}`,
      );
    }
    lines.push("");
  }

  if (notes.decisions.length) {
    lines.push("DECISIONS");
    for (const decision of notes.decisions) lines.push(`- ${decision}`);
    lines.push("");
  }

  lines.push(`Full notes attached as a PDF. Open the huddle: ${input.url}`);

  return lines.join("\n");
}
