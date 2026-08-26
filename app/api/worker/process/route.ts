import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { AUDIO_BUCKET, PDF_BUCKET, createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import {
  generateNotes,
  transcribe,
  EmptyRecordingError,
  NotesError,
  TranscriptionError,
  MIN_TRANSCRIPT_CHARS,
} from "@/lib/ai/groq";
import { transcriptionHint } from "@/lib/ai/prompts";
import type { Notes } from "@/lib/ai/schema";
import { matchOwner } from "@/lib/notes/match";
import { renderNotesPdf } from "@/lib/pdf/render";
import { formatDuration } from "@/lib/util/format";
import type { ActionItemInsert, TranscribeLanguage } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * These three are load-bearing together, so change them as a set:
 *
 *   VISIBILITY_SEC x MAX_ATTEMPTS  <  STUCK_AFTER_MS
 *
 * A job is hidden for VISIBILITY_SEC after each read, so its automatic
 * retries play out over VISIBILITY_SEC x MAX_ATTEMPTS. If the stuck sweep
 * fires before that window closes it marks the huddle failed while a valid
 * retry is still pending, which silently disables retrying altogether.
 *
 * A full run is ~60-90s, so 4 minutes is comfortable headroom for one attempt
 * without letting a crashed worker sit on the job.
 */
const VISIBILITY_SEC = 240;
const JOBS_PER_RUN = 3;
const MAX_ATTEMPTS = 3;

/**
 * §5 says 10 minutes; this is 15 so it sits just past the retry window above
 * (4 min x 3 = 12). A meeting stuck longer than this gets swept to failed so
 * a retry is possible — without it, a job whose worker was killed mid-run, or
 * whose queue message was lost, sits in `processing` forever because nothing
 * else in the system is watching.
 */
const STUCK_AFTER_MS = 15 * 60_000;
/** Fallback for rows that never recorded an ended_at. */
const STALE_AFTER_MS = 6 * 60 * 60_000;

interface JobRow {
  msg_id: number;
  read_ct: number;
  message: { meeting_id?: string } | null;
}

export async function POST(request: Request) {
  return run(request);
}

/** Vercel Cron and most schedulers issue GET. */
export async function GET(request: Request) {
  return run(request);
}

async function run(request: Request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const admin = createAdminClient();

  // Runs before the queue is drained, so every invocation — cron or nudge —
  // rescues anything the previous run abandoned.
  const swept = await sweepStuck();

  const { data: jobs, error } = await admin.rpc("read_meeting_jobs", {
    p_qty: JOBS_PER_RUN,
    p_visibility_sec: VISIBILITY_SEC,
  });

  if (error) {
    console.error("queue read failed", error);
    return NextResponse.json({ error: "Queue read failed." }, { status: 500 });
  }

  const rows = (jobs ?? []) as unknown as JobRow[];
  const results: { meetingId: string; ok: boolean; reason?: string }[] = [];

  for (const job of rows) {
    const meetingId = job.message?.meeting_id;

    if (!meetingId) {
      await admin.rpc("archive_meeting_job", { p_msg_id: job.msg_id });
      continue;
    }

    try {
      await processMeeting(meetingId);
      await admin.rpc("ack_meeting_job", { p_msg_id: job.msg_id });
      results.push({ meetingId, ok: true });
    } catch (caught) {
      const reason = readableReason(caught);
      // An empty huddle is not a failure — it is a finished job with nothing
      // in it, so it is acked and parked in `empty`, never `failed`.
      if (caught instanceof EmptyRecordingError) {
        await markEmpty(meetingId, caught.message);
        await admin.rpc("ack_meeting_job", { p_msg_id: job.msg_id });
        results.push({ meetingId, ok: true, reason: caught.message });
        continue;
      }

      // A bad recording or unusable notes will not get better on retry;
      // only transient faults are worth leaving on the queue.
      const exhausted =
        job.read_ct >= MAX_ATTEMPTS ||
        caught instanceof TranscriptionError ||
        caught instanceof NotesError;

      console.error("process_meeting failed", {
        meetingId,
        readCount: job.read_ct,
        exhausted,
        caught,
      });

      if (exhausted) {
        await markFailed(meetingId, reason);
        await admin.rpc("archive_meeting_job", { p_msg_id: job.msg_id });
      }
      // Otherwise leave it on the queue — visibility expires and it retries.

      results.push({ meetingId, ok: false, reason });
    }
  }

  return NextResponse.json({ processed: results.length, swept, results });
}

/**
 * Marks huddles that stopped partway through as failed, so they surface a
 * retry instead of spinning forever. A genuine long transcription finishes in
 * well under a minute, so the threshold is generous.
 */
async function sweepStuck(): Promise<number> {
  const admin = createAdminClient();
  const reason =
    "This huddle stopped partway through and didn't finish. Retry it.";

  const stuck = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const stale = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data: byEnded } = await admin
    .from("meetings")
    .update({ status: "failed", failure_reason: reason, processing_stage: null })
    .in("status", ["uploading", "processing"])
    .not("ended_at", "is", null)
    .lt("ended_at", stuck)
    .select("id");

  // Rows that never got an ended_at cannot be timed from the finalize call,
  // so they are only swept once they are old enough to be unambiguous.
  const { data: byCreated } = await admin
    .from("meetings")
    .update({ status: "failed", failure_reason: reason, processing_stage: null })
    .in("status", ["recording", "uploading", "processing"])
    .is("ended_at", null)
    .lt("created_at", stale)
    .select("id");

  const count = (byEnded?.length ?? 0) + (byCreated?.length ?? 0);
  if (count > 0) console.warn("swept stuck meetings", { count });
  return count;
}

/**
 * §5 steps 2-7: transcribe, write notes, validate, render the PDF, then draft.
 * Nothing is ever emailed from here — notes land in `draft` and a human
 * presses Send.
 */
async function processMeeting(meetingId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: meeting, error } = await admin
    .from("meetings")
    .select(
      "id, team_id, title, meeting_date, duration_sec, status, audio_path, audio_mime, transcript, transcript_json",
    )
    .eq("id", meetingId)
    .maybeSingle();

  if (error) throw new Error(`Couldn't load the huddle: ${error.message}`);
  if (!meeting) throw new TranscriptionError("This huddle no longer exists.");

  // Someone already finished it, or it was swept to failed. Nothing to do.
  if (meeting.status !== "processing") return;

  if (!meeting.audio_path) {
    throw new EmptyRecordingError("No audio was saved for this huddle.");
  }

  const { language, speakers } = await meetingContext(meetingId, meeting.team_id);

  // Resume rather than restart. A retry after a later stage failed should not
  // pay for transcription again — it is the slowest and costliest step, and
  // the transcript we already have is exactly what we would recompute.
  let transcriptText = meeting.transcript?.trim() ?? "";

  if (!transcriptText) {
    await admin
      .from("meetings")
      .update({ processing_stage: "transcribing" })
      .eq("id", meetingId);

    const { data: audioBlob, error: downloadError } = await admin.storage
      .from(AUDIO_BUCKET)
      .download(meeting.audio_path);

    if (downloadError || !audioBlob) {
      throw new Error(
        `Couldn't read the audio: ${downloadError?.message ?? "missing"}`,
      );
    }

    const result = await transcribe({
      audio: new Uint8Array(await audioBlob.arrayBuffer()),
      filename: meeting.audio_path.split("/").pop() ?? "audio.webm",
      mimeType: meeting.audio_mime ?? "audio/webm",
      language,
      hint: transcriptionHint({ speakers }),
    });

    transcriptText = result.text;

    const { error: saveError } = await admin
      .from("meetings")
      .update({
        transcript: result.text,
        transcript_json: result,
        processing_stage: "writing_notes",
        failure_reason: null,
      })
      .eq("id", meetingId);

    if (saveError) {
      throw new Error(`Couldn't save the transcript: ${saveError.message}`);
    }
  } else {
    await admin
      .from("meetings")
      .update({ processing_stage: "writing_notes", failure_reason: null })
      .eq("id", meetingId);
  }

  // Too little speech to write anything honest about. Checked here rather
  // than inside generateNotes so the notes layer is left exactly as it is.
  if (transcriptText.trim().length < MIN_TRANSCRIPT_CHARS) {
    const seconds = meeting.duration_sec ? Math.round(meeting.duration_sec) : null;
    throw new EmptyRecordingError(
      seconds !== null
        ? `Barely any speech in this one — the recording was ${seconds} seconds.`
        : "Barely any speech in this one.",
    );
  }

  // ------------------------------------------------ §5 step 4-5: the notes
  const notes = await generateNotes({
    transcript: transcriptText,
    attendees: speakers,
    meetingDate: meeting.meeting_date,
    durationSec: meeting.duration_sec,
  });

  if (!notes.usable) {
    throw new EmptyRecordingError(
      "There wasn't enough in this huddle to write notes from.",
    );
  }

  const actionItems = await persistNotes(meetingId, meeting.team_id, notes);

  // -------------------------------------------------- §5 step 6: the PDF
  await admin
    .from("meetings")
    .update({ processing_stage: "making_pdf" })
    .eq("id", meetingId);

  const { data: team } = await admin
    .from("teams")
    .select("name, watermark_text")
    .eq("id", meeting.team_id)
    .maybeSingle();

  const pdf = await renderNotesPdf({
    teamName: team?.name ?? "Team",
    watermarkText: team?.watermark_text ?? "Confidential",
    title: meeting.title,
    meetingDate: meeting.meeting_date,
    durationLabel: meeting.duration_sec
      ? formatDuration(meeting.duration_sec)
      : null,
    notes,
    actionItems,
  });

  const pdfPath = `${meetingId}/huddle-${meeting.meeting_date}.pdf`;
  const { error: pdfError } = await admin.storage
    .from(PDF_BUCKET)
    .upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });

  if (pdfError) throw new Error(`Couldn't save the PDF: ${pdfError.message}`);

  // ------------------------------------------------- §5 step 7: it's ready
  const { error: draftError } = await admin
    .from("meetings")
    .update({
      notes_json: notes,
      pdf_path: pdfPath,
      status: "draft",
      processing_stage: null,
      failure_reason: null,
    })
    .eq("id", meetingId);

  if (draftError) throw new Error(`Couldn't save the notes: ${draftError.message}`);
}

/**
 * Writes notes_json's action items into their own rows, resolving each owner
 * against the roster. An owner we cannot resolve keeps its raw name and stays
 * unassigned — the UI flags those in amber for the lead rather than guessing.
 */
async function persistNotes(
  meetingId: string,
  teamId: string,
  notes: Notes,
): Promise<ResolvedActionItem[]> {
  const admin = createAdminClient();

  const { data: members } = await admin
    .from("members")
    .select("id, name")
    .eq("team_id", teamId)
    .eq("active", true);

  const roster = members ?? [];
  const byId = new Map(roster.map((member) => [member.id, member.name]));

  // Reprocessing a meeting must not double the list.
  await admin.from("action_items").delete().eq("meeting_id", meetingId);

  const rows: ActionItemInsert[] = notes.action_items.map((item) => {
    const match = matchOwner(item.owner, roster, item.owner_confidence);
    return {
      meeting_id: meetingId,
      owner_member_id: match.memberId,
      owner_name_raw: item.owner || null,
      owner_confidence: match.memberId ? match.confidence : "low",
      task: item.task,
      due_date: item.due,
    };
  });

  if (rows.length > 0) {
    const { error } = await admin.from("action_items").insert(rows);
    if (error) throw new Error(`Couldn't save the action items: ${error.message}`);
  }

  return rows.map((row) => ({
    task: row.task,
    ownerName: row.owner_member_id
      ? (byId.get(row.owner_member_id) ?? row.owner_name_raw)
      : row.owner_name_raw,
    due: row.due_date,
    unassigned: !row.owner_member_id,
  }));
}

interface ResolvedActionItem {
  task: string;
  ownerName: string | null;
  due: string | null;
  unassigned: boolean;
}

/** Team language setting plus the names Whisper should expect to hear. */
async function meetingContext(
  meetingId: string,
  teamId: string,
): Promise<{ language: TranscribeLanguage; speakers: string[] }> {
  const admin = createAdminClient();

  const [{ data: team }, { data: attendees }] = await Promise.all([
    admin.from("teams").select("transcribe_language").eq("id", teamId).maybeSingle(),
    admin
      .from("meeting_attendees")
      .select("present, members(name)")
      .eq("meeting_id", meetingId)
      .eq("present", true),
  ]);

  const attendeeRows = (attendees ?? []) as unknown as {
    members: { name: string } | null;
  }[];

  let speakers = attendeeRows
    .map((row) => row.members?.name)
    .filter((name): name is string => Boolean(name));

  // Nobody marked present — fall back to the whole roster.
  if (speakers.length === 0) {
    const { data: members } = await admin
      .from("members")
      .select("name")
      .eq("team_id", teamId)
      .eq("active", true);
    speakers = (members ?? []).map((member) => member.name);
  }

  return {
    language: (team?.transcribe_language as TranscribeLanguage) ?? "en",
    speakers,
  };
}

/** Finished, with nothing in it. The transcript is kept either way. */
async function markEmpty(meetingId: string, reason: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("meetings")
    .update({ status: "empty", failure_reason: reason, processing_stage: null })
    .eq("id", meetingId);
}

async function markFailed(meetingId: string, reason: string): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("meetings")
    .update({ status: "failed", failure_reason: reason, processing_stage: null })
    .eq("id", meetingId);
}

function readableReason(caught: unknown): string {
  if (
    caught instanceof TranscriptionError ||
    caught instanceof NotesError ||
    caught instanceof EmptyRecordingError
  ) {
    return caught.message;
  }

  // Generic faults used to collapse to "something went wrong", which hid the
  // one detail that makes them debuggable. Surface it.
  const detail = caught instanceof Error ? caught.message.trim() : "";
  return detail
    ? `${detail.replace(/\.$/, "")}. Retry this huddle.`
    : "Something went wrong while processing this huddle. Retry it.";
}

function isAuthorised(request: Request): boolean {
  const presented =
    request.headers.get("x-worker-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  let expected: string;
  try {
    expected = serverEnv.workerSecret();
  } catch {
    return false;
  }

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
