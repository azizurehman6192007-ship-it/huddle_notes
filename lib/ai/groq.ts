import "server-only";

import Groq from "groq-sdk";
import { serverEnv } from "@/lib/env";
import { NOTES_SYSTEM_PROMPT, notesUserMessage } from "@/lib/ai/prompts";
import { NotesSchema, type Notes } from "@/lib/ai/schema";
import type { TranscribeLanguage, TranscriptJson } from "@/lib/supabase/types";

/** Groq rejects requests over 25 MB; we refuse earlier and say so clearly. */
export const MAX_TRANSCRIBE_BYTES = 20 * 1024 * 1024;

export const TRANSCRIBE_MODEL = "whisper-large-v3";

/**
 * §2 names `qwen-3-32b`, which Groq has since retired. This is the current
 * Qwen on Groq, which §2 explicitly allows. Override with GROQ_NOTES_MODEL.
 */
export const NOTES_MODEL = process.env.GROQ_NOTES_MODEL || "qwen/qwen3.8-27b";

let client: Groq | null = null;

function groq(): Groq {
  client ??= new Groq({ apiKey: serverEnv.groqApiKey() });
  return client;
}

/**
 * A genuine pipeline fault: the API rejected us, the audio could not be read,
 * the service was down. These are the only things that deserve `failed`.
 */
export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TranscriptionError";
  }
}

/**
 * Not a fault at all — the recording simply had nothing in it. Kept separate
 * from TranscriptionError so a silent huddle never pollutes the failed signal.
 */
export class EmptyRecordingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyRecordingError";
  }
}

export interface TranscribeInput {
  audio: Uint8Array;
  filename: string;
  mimeType: string;
  language: TranscribeLanguage;
  /** Speaker names and product nouns — see prompts.transcriptionHint. */
  hint?: string;
}

export async function transcribe(
  input: TranscribeInput,
): Promise<TranscriptJson> {
  if (input.audio.byteLength === 0) {
    throw new EmptyRecordingError("Nothing was recorded.");
  }

  if (input.audio.byteLength > MAX_TRANSCRIBE_BYTES) {
    // §5 step 1 (split on silence) is Phase 4 work. Until then, fail honestly
    // rather than sending a request we know Groq will reject.
    throw new TranscriptionError(
      "This huddle is too long to transcribe in one piece. Record it in shorter sessions for now.",
    );
  }

  const file = new File([new Uint8Array(input.audio)], input.filename, {
    type: input.mimeType,
  });

  let response: unknown;
  try {
    response = await groq().audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      response_format: "verbose_json",
      timestamp_granularities: ["segment"],
      ...(input.language === "auto" ? {} : { language: input.language }),
      ...(input.hint ? { prompt: input.hint } : {}),
    });
  } catch (error) {
    throw new TranscriptionError(describeGroqFailure(error));
  }

  const parsed = response as Partial<TranscriptJson>;
  const text = (parsed.text ?? "").trim();

  if (!text) {
    throw new EmptyRecordingError("No speech was picked up in this recording.");
  }

  return {
    text,
    duration: parsed.duration,
    language: parsed.language,
    segments: parsed.segments ?? [],
  };
}

function describeGroqFailure(error: unknown): string {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status: unknown }).status)
      : undefined;

  if (status === 401 || status === 403) {
    return "Transcription is not configured correctly. Check GROQ_API_KEY.";
  }
  if (status === 413) {
    return "The recording was too large to transcribe. Record shorter huddles for now.";
  }
  if (status === 429) {
    return "Transcription is rate limited right now. Retry this huddle in a few minutes.";
  }
  if (status !== undefined && status >= 500) {
    return "The transcription service is having trouble. Retry this huddle in a few minutes.";
  }

  const detail = error instanceof Error ? error.message : "";
  return detail
    ? `Couldn't transcribe the recording. ${detail}`
    : "Couldn't transcribe the recording. Retry this huddle.";
}

/** Raised when notes cannot be produced. Message is safe to show the lead. */
export class NotesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotesError";
  }
}

/** Below this there is not enough speech to write anything honest about. */
export const MIN_TRANSCRIPT_CHARS = 120;

export interface NotesInput {
  transcript: string;
  attendees: string[];
  meetingDate: string;
  durationSec: number | null;
}

/**
 * §5 steps 4-5: generate, validate, retry once, then give up. Never render
 * half-notes — a meeting with unparseable output goes to `failed` with a
 * reason the lead can act on.
 */
export async function generateNotes(input: NotesInput): Promise<Notes> {
  const transcript = input.transcript.trim();

  if (transcript.length < MIN_TRANSCRIPT_CHARS) {
    const seconds = input.durationSec ? Math.round(input.durationSec) : null;
    throw new NotesError(
      seconds !== null
        ? `Couldn't hear enough to write notes. The recording was ${seconds} seconds. Try again with a longer huddle.`
        : "Couldn't hear enough to write notes. Try again with a longer huddle.",
    );
  }

  const userMessage = notesUserMessage({
    attendees: input.attendees,
    meetingDate: input.meetingDate,
    transcript,
  });

  let lastProblem = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw: string;
    try {
      const completion = await groq().chat.completions.create({
        model: NOTES_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: NOTES_SYSTEM_PROMPT },
          {
            role: "user",
            content:
              attempt === 1
                ? userMessage
                : `${userMessage}\n\nYour previous reply was not valid against the schema (${lastProblem}). Return ONLY the JSON object.`,
          },
        ],
      });
      raw = completion.choices[0]?.message?.content ?? "";
    } catch (error) {
      throw new NotesError(describeGroqFailure(error));
    }

    const parsed = safeParseJson(raw);
    if (!parsed.ok) {
      lastProblem = parsed.problem;
      continue;
    }

    const validated = NotesSchema.safeParse(parsed.value);
    if (validated.success) return validated.data;

    lastProblem = validated.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  }

  throw new NotesError(
    "The notes came back in a shape we couldn't read, twice. Retry this huddle.",
  );
}

/**
 * Some models still wrap JSON in a fence or add a preamble despite json_object
 * mode, so recover the object rather than spending the retry on formatting.
 */
function safeParseJson(
  raw: string,
): { ok: true; value: unknown } | { ok: false; problem: string } {
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const candidate = text.startsWith("{")
    ? text
    : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);

  if (!candidate) return { ok: false, problem: "no JSON object in the reply" };

  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    return { ok: false, problem: "the reply was not parseable JSON" };
  }
}
