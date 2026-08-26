import { z } from "zod";

/**
 * §6 output schema. Every AI output is validated against this — never free
 * text, never a partial render. If it fails twice the meeting goes to `failed`
 * with a readable reason.
 *
 * Arrays default to empty rather than being required: a model that omits
 * `decisions: []` on a quiet standup is right about the meeting and wrong
 * about the envelope, and that should not burn the one retry we get.
 */

/** ISO date or nothing. Never let a guessed date through. */
const isoDate = z
  .string()
  .nullable()
  .optional()
  .transform((value) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null,
  );

const nonEmpty = z.string().trim().min(1);

export const NotesSchema = z.object({
  usable: z.boolean(),
  summary: z.string().trim().default(""),
  attendees_present: z.array(nonEmpty).default([]),
  updates: z
    .array(
      z.object({
        person: nonEmpty,
        yesterday: z.array(nonEmpty).default([]),
        today: z.array(nonEmpty).default([]),
      }),
    )
    .default([]),
  blockers: z
    .array(
      z.object({
        person: nonEmpty,
        issue: nonEmpty,
        needs: z.string().trim().nullable().default(null),
      }),
    )
    .default([]),
  decisions: z.array(nonEmpty).default([]),
  action_items: z
    .array(
      z.object({
        owner: z.string().trim().default(""),
        owner_confidence: z.enum(["high", "low"]).default("low"),
        task: nonEmpty,
        due: isoDate,
      }),
    )
    .default([]),
  open_questions: z.array(nonEmpty).default([]),
});

export type Notes = z.infer<typeof NotesSchema>;
export type NotesUpdate = Notes["updates"][number];
export type NotesBlocker = Notes["blockers"][number];
export type NotesActionItem = Notes["action_items"][number];

/** True when there is genuinely nothing worth showing the lead. */
export function isEmptyNotes(notes: Notes): boolean {
  return (
    !notes.usable ||
    (notes.updates.length === 0 &&
      notes.blockers.length === 0 &&
      notes.action_items.length === 0 &&
      notes.decisions.length === 0 &&
      notes.open_questions.length === 0 &&
      notes.summary.trim() === "")
  );
}
