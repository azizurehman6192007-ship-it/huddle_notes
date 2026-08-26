import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUDIO_BUCKET, createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

interface FinalizeBody {
  durationSec?: number;
  mime?: string;
}

/**
 * Below these there is no recording at all — a tap-tap on the button, or a
 * mic that never opened. A container header alone is around 1KB, and 24kbps
 * opus produces roughly 3KB a second, so anything under this floor holds no
 * audio. These huddles are discarded outright rather than kept as failures.
 */
const MIN_AUDIO_BYTES = 2_048;
const MIN_DURATION_SEC = 2;

/**
 * Stop was tapped. Concatenate the chunks into one object, hand the meeting to
 * the queue, and get out of the request. Nothing about transcription happens
 * here — a 15 minute file takes 40-60s and this is a user-facing request.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await context.params;

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, status, audio_mime")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) {
    return NextResponse.json({ error: "Huddle not found." }, { status: 404 });
  }

  // Finalize is safe to call twice — the client retries it on a flaky network.
  if (meeting.status !== "recording") {
    return NextResponse.json({ ok: true, status: meeting.status });
  }

  let body: FinalizeBody;
  try {
    body = (await request.json()) as FinalizeBody;
  } catch {
    body = {};
  }

  const admin = createAdminClient();
  await admin
    .from("meetings")
    .update({
      status: "uploading",
      ended_at: new Date().toISOString(),
      duration_sec: body.durationSec ? Math.round(body.durationSec) : null,
    })
    .eq("id", meetingId);

  const { data: chunks, error: chunksError } = await admin
    .from("meeting_chunks")
    .select("seq, path, bytes")
    .eq("meeting_id", meetingId)
    .order("seq", { ascending: true });

  if (chunksError) {
    return await fail(meetingId, "Couldn't read the uploaded audio. Retry this huddle.");
  }

  // Nothing was captured. Not a failure — there is simply no huddle here, so
  // the row is removed rather than left behind as a misleading red flag.
  const capturedBytes = (chunks ?? []).reduce((sum, chunk) => sum + chunk.bytes, 0);
  const tooShort =
    body.durationSec !== undefined && body.durationSec < MIN_DURATION_SEC;

  if (!chunks || chunks.length === 0 || capturedBytes < MIN_AUDIO_BYTES || tooShort) {
    await discard(meetingId);
    return NextResponse.json({
      ok: true,
      discarded: true,
      reason: "Nothing was recorded, so that huddle wasn't saved.",
    });
  }

  // MediaRecorder timeslices are one continuous byte stream cut at arbitrary
  // points, so appending them in order rebuilds a valid container.
  const parts: Uint8Array[] = [];
  for (const chunk of chunks) {
    const { data, error } = await admin.storage
      .from(AUDIO_BUCKET)
      .download(chunk.path);

    if (error || !data) {
      console.error("chunk download failed", { meetingId, chunk, error });
      return await fail(
        meetingId,
        "Part of the recording is missing. Retry this huddle.",
      );
    }
    parts.push(new Uint8Array(await data.arrayBuffer()));
  }

  const totalBytes = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const audio = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of parts) {
    audio.set(part, offset);
    offset += part.byteLength;
  }

  const mime = body.mime || meeting.audio_mime || "audio/webm";
  const extension = mime.includes("mp4") ? "m4a" : "webm";
  const audioPath = `${meetingId}/audio.${extension}`;

  const { error: uploadError } = await admin.storage
    .from(AUDIO_BUCKET)
    .upload(audioPath, audio, { contentType: mime, upsert: true });

  if (uploadError) {
    console.error("audio concat upload failed", { meetingId, uploadError });
    return await fail(meetingId, "Couldn't save the recording. Retry this huddle.");
  }

  await admin
    .from("meetings")
    .update({
      status: "processing",
      processing_stage: "transcribing",
      audio_path: audioPath,
      audio_mime: mime,
      failure_reason: null,
    })
    .eq("id", meetingId);

  const { error: queueError } = await admin.rpc("enqueue_meeting", {
    p_meeting_id: meetingId,
  });

  if (queueError) {
    console.error("enqueue failed", { meetingId, queueError });
    return await fail(
      meetingId,
      "Couldn't queue this huddle for processing. Retry it.",
    );
  }

  // Nudge the worker so a dev machine doesn't wait for the next cron tick.
  void wakeWorker();

  return NextResponse.json({ ok: true, status: "processing" });
}

/**
 * Removes a huddle that captured nothing, along with its uploaded chunks.
 * Rows cascade from meetings, so only the storage objects need sweeping.
 */
async function discard(meetingId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: chunks } = await admin
    .from("meeting_chunks")
    .select("path")
    .eq("meeting_id", meetingId);

  if (chunks && chunks.length > 0) {
    await admin.storage
      .from(AUDIO_BUCKET)
      .remove(chunks.map((chunk) => chunk.path));
  }

  await admin.from("meetings").delete().eq("id", meetingId);
}

async function fail(meetingId: string, reason: string) {
  const admin = createAdminClient();
  await admin
    .from("meetings")
    .update({ status: "failed", failure_reason: reason, processing_stage: null })
    .eq("id", meetingId);

  return NextResponse.json({ error: reason }, { status: 500 });
}

async function wakeWorker(): Promise<void> {
  try {
    const response = await fetch(`${serverEnv.appUrl()}/api/worker/process`, {
      method: "POST",
      headers: { "x-worker-secret": serverEnv.workerSecret() },
    });
    if (!response.ok) {
      console.warn("worker nudge rejected", { status: response.status });
    }
  } catch (caught) {
    // The queue is the source of truth, so this is not fatal. It is logged
    // because a wrong APP_URL makes every huddle look like it hangs.
    console.warn("worker nudge failed; check APP_URL", caught);
  }
}
