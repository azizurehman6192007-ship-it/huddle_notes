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

/**
 * §6 notes system prompt. Kept here, never inline, so it can be diffed.
 *
 * Written for what the reader actually sees. Only `summary`, `action_items`,
 * `decisions` and `open_questions` are rendered anywhere — on screen, in the
 * PDF, or in the email. `updates` and `blockers` are still in the schema and
 * still stored, but nothing displays them, so the prompt has to push their
 * content into the visible fields or it is silently lost. The previous version
 * opened with "attribute every point to a speaker", which optimised for
 * exactly the two fields nobody can read.
 *
 * The other change that matters: owners are left empty unless the transcript
 * names them. The old prompt filled every owner at "low" confidence, and since
 * the owner picker was removed from the notes screen, a guessed name now goes
 * out in the PDF and the email with no way to correct it.
 */
export const NOTES_SYSTEM_PROMPT = `You are writing up a software team's daily standup. Write the way a competent project manager would: plain, specific, short. Someone who missed the meeting should read your output in thirty seconds and know exactly where things stand.

TONE
- Plain professional English. No jargon inflation, no cheerleading, no filler.
- Never write a sentence that carries no information. "The team discussed progress" and "Good progress was made across the board" are worthless — cut them.
- Do not copy the transcript verbatim, and drop filler words and false starts.

ACCURACY — this matters more than completeness
- Use only what the transcript actually says. Never invent a task, a name, a date, or a decision.
- If something is ambiguous, reflect the ambiguity in plain words ("someone will follow up with marketing") instead of inventing a confident detail.
- A decision is something the group settled on together. One person stating their own plan for the day is not a decision.
- Set "owner" to a name only when the transcript makes clear who it is. Otherwise use "" with "owner_confidence": "low".
- "due" is an ISO date (YYYY-MM-DD) or null, and is almost always null. Set it only when the transcript states an actual deadline ("by Friday", "end of the sprint", a date). "Today" and "this week" are not deadlines — leave those null.

WHAT TO CAPTURE
Cover every substantive point raised: progress, blockers, decisions, questions. Length follows the meeting — a short standup gets short notes. Never pad to fill a field.

"summary"
  Two sentences maximum. Say where the work stands and what is blocked or at risk. Most people read only this, so anything holding the team up must appear here.

"action_items"
  One entry per thing somebody is going to do next. Include all three of:
    - what each person said they would work on today or next,
    - anything a person committed to doing for someone else,
    - every blocker that needs another person to clear it.
  A standup with four people usually produces four to six of these. If you have
  only one, you have missed people — reread the transcript.
  Each task must stand on its own without the transcript: "Follow up with
  marketing on the final brand guidelines", not "follow up on that". Start with
  a verb.

"decisions"
  Only choices the group actually settled. If nothing was decided, return [].

"open_questions"
  Questions raised and left unanswered. Not tasks, not blockers.

"updates" and "blockers"
  Fill these from what each person reported. Nothing in these two fields is ever
  shown to a reader — they are stored only. So before you finish, check every
  entry you put in "blockers": each one must also appear in "summary" or in
  "action_items", or that problem disappears and nobody sees it. A dependency
  someone mentioned in passing ("I'll need X when it's ready") belongs in
  "action_items" too.

NOTHING TO WRITE
If the transcript is too short, silent, or unintelligible, return the schema with empty arrays, "summary": "", and "usable": false. Do not guess.

OUTPUT
Only the JSON object below. No markdown, no code fence, no preamble.

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
}`;

/**
 * The user turn. Without tap-to-tag there are no speaker labels, so we hand
 * the model the attendee roster and let it infer owners from how people
 * introduce themselves — the §3 degraded path.
 *
 * The last line is load-bearing: with a roster in hand the model will happily
 * deal names out in speaking order, which reads as confident attribution and
 * is wrong about half the time.
 */
export function notesUserMessage(input: {
  attendees: string[];
  meetingDate: string;
  transcript: string;
}): string {
  const roster =
    input.attendees.length > 0
      ? input.attendees.join(", ")
      : "(roster unknown — name someone only where the transcript names them)";

  return [
    `Meeting date: ${input.meetingDate}`,
    `Attendees: ${roster}`,
    "",
    "This transcript has no speaker labels. Attribute a point to a named person",
    'only where the transcript makes it clear (someone naming themselves: "Ali',
    'here, yesterday I..."), or where the roster leaves no doubt. Where it is not',
    "clear, still record the point but leave the owner empty and set",
    '"owner_confidence": "low". Do not assign a name by guessing whose turn it was.',
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
