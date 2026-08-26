import "server-only";

/**
 * Prompts live here, never inline at the call site, so they can be diffed and
 * reviewed on their own.
 */

/**
 * Whisper takes a `prompt` as a decoding hint. Feeding it the attendee names
 * and the team's product nouns measurably improves proper-noun accuracy —
 * "Bilal" instead of "Billa", "Supabase" instead of "sofa base".
 */
export function transcriptionHint(input: {
  speakers: string[];
  terms?: string[];
}): string {
  const parts = ["Standup."];

  if (input.speakers.length > 0) {
    parts.push(`Speakers: ${input.speakers.join(", ")}.`);
  }

  const terms = [
    ...DEFAULT_TERMS,
    ...(input.terms ?? []),
  ];
  parts.push(`Terms: ${Array.from(new Set(terms)).join(", ")}.`);

  // Whisper ignores prompts past ~224 tokens, so keep it short.
  return parts.join(" ").slice(0, 850);
}

/** §6 notes system prompt. Kept here, never inline, so it can be diffed. */
export const NOTES_SYSTEM_PROMPT = `You are a meeting scribe for a software team's daily standup.
You receive a transcript with speaker labels and a list of attendees.

Rules:
- Use ONLY what is in the transcript. Never invent tasks, dates, or names.
- Attribute every point to a speaker. If unsure, set owner_confidence to "low".
- Keep each point to one sentence, in the speaker's own meaning, not their filler words.
- If the transcript is too short or unintelligible, return the schema with empty
  arrays and set "usable": false. Do not guess.
- Output ONLY valid JSON matching the schema. No markdown, no preamble.

Schema:
{
  "usable": boolean,
  "summary": string,
  "attendees_present": string[],
  "updates": [{ "person": string, "yesterday": string[], "today": string[] }],
  "blockers": [{ "person": string, "issue": string, "needs": string | null }],
  "decisions": string[],
  "action_items": [{
    "owner": string,
    "owner_confidence": "high" | "low",
    "task": string,
    "due": string | null
  }],
  "open_questions": string[]
}

"summary" is at most two sentences.
"due" is an ISO date (YYYY-MM-DD) or null. Never guess a date.`;

/**
 * The user turn. Without tap-to-tag there are no speaker labels, so we hand
 * the model the attendee roster and let it infer owners from how people
 * introduce themselves — the §3 degraded path. Owners it infers that way come
 * back as "low" confidence and are flagged for the lead.
 */
export function notesUserMessage(input: {
  attendees: string[];
  meetingDate: string;
  transcript: string;
}): string {
  const roster =
    input.attendees.length > 0
      ? input.attendees.join(", ")
      : "(roster unknown — attribute only where the transcript names someone)";

  return [
    `Meeting date: ${input.meetingDate}`,
    `Attendees: ${roster}`,
    "",
    "The transcript has no speaker labels. Attribute each point to an attendee",
    "only where the transcript makes it clear (for example someone naming",
    'themselves: "Ali here, yesterday I..."). Where it is not clear, still record',
    'the point but set owner_confidence to "low".',
    "",
    "Transcript:",
    input.transcript,
  ].join("\n");
}

const DEFAULT_TERMS = [
  "standup",
  "PR",
  "staging",
  "deploy",
  "blocker",
  "API",
  "QA",
  "sprint",
];
