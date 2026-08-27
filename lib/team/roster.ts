/**
 * Parsing for the bulk "add several at once" field on the team screen.
 *
 * People paste rosters out of wherever they already keep them — a mail client,
 * a spreadsheet column, a Slack message — so the separators are whatever those
 * produce: newlines, commas, semicolons, tabs, or a mix.
 */

export interface RosterEntry {
  name: string;
  email: string;
}

export interface ParsedRoster {
  entries: RosterEntry[];
  /** Fragments that were not an email address, kept verbatim to show back. */
  invalid: string[];
}

/** Deliberately loose — Postgres, not this, is the source of truth. */
const EMAIL = /^[^@\s<>,;]+@[^@\s<>,;.]+\.[^@\s<>,;]+$/;

/** `Alice Smith <alice@x.com>` — what copying out of a mail client gives you. */
const ANGLE_FORM = /^\s*(.*?)\s*<\s*([^<>]+?)\s*>\s*$/;

/**
 * Turns pasted text into entries, in the order given, with duplicates removed
 * (first mention wins). Anything unparseable comes back in `invalid` rather
 * than being silently dropped — a swallowed row is a person who never gets
 * the notes and nobody notices for a week.
 */
export function parseRoster(text: string): ParsedRoster {
  const entries: RosterEntry[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const fragment of text.split(/[\n,;\t]+/)) {
    const piece = fragment.trim();
    if (!piece) continue;

    let name = "";
    let email = piece;

    const angled = ANGLE_FORM.exec(piece);
    if (angled) {
      name = stripQuotes(angled[1] ?? "");
      email = angled[2] ?? "";
    }

    email = email.trim().toLowerCase();

    if (!EMAIL.test(email)) {
      invalid.push(piece);
      continue;
    }
    if (seen.has(email)) continue;

    seen.add(email);
    entries.push({ name: name || nameFromEmail(email), email });
  }

  return { entries, invalid };
}

/**
 * `ali.raza@x.com` → `Ali Raza`.
 *
 * `members.name` is NOT NULL, and the name is what the notes attribute updates
 * to and what the owner matcher fuzzy-matches action items against — a blank
 * one would quietly break attribution. So a name is always derived rather than
 * left empty, and the lead can correct it in place afterwards.
 *
 * `public.create_team()` already does the same thing for the founding lead
 * (`split_part(email, '@', 1)`), so this is the established behaviour.
 */
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";

  const words = local
    .split(/[._\-+]+/)
    .map((word) => word.trim())
    .filter(Boolean)
    // Only the first letter: `mcdonald` should not become `McDonald`, and
    // guessing harder than this gets names wrong more often than right.
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));

  return words.join(" ") || local || "Teammate";
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "").trim();
}
