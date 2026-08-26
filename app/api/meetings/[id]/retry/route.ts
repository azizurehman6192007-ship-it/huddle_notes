import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * §5: the retry action behind a swept or failed huddle.
 *
 * The worker resumes from whatever it already has, so a huddle that failed
 * after transcription does not pay to transcribe again.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await context.params;

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, status, audio_path, transcript, notes_json")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) {
    return NextResponse.json({ error: "Huddle not found." }, { status: 404 });
  }

  // A failed huddle is the obvious case. A finished one that never got notes
  // — recorded before notes existed, or whose notes could not be read — can
  // also be re-run, and the worker resumes from its transcript.
  const missingNotes =
    (meeting.status === "draft" || meeting.status === "empty") &&
    !meeting.notes_json;

  if (meeting.status !== "failed" && !missingNotes) {
    return NextResponse.json(
      { error: "There's nothing to re-run on this huddle." },
      { status: 409 },
    );
  }

  // Either input is enough: the transcript alone lets the worker skip
  // straight to writing notes.
  if (!meeting.audio_path && !meeting.transcript?.trim()) {
    return NextResponse.json(
      {
        error:
          "There's no audio or transcript saved for this huddle, so there's nothing to re-run. Record it again.",
      },
      { status: 409 },
    );
  }

  const admin = createAdminClient();

  await admin
    .from("meetings")
    .update({
      status: "processing",
      processing_stage: "transcribing",
      failure_reason: null,
      // ended_at anchors the stuck sweep, so restart its clock.
      ended_at: new Date().toISOString(),
    })
    .eq("id", meetingId);

  const { error: queueError } = await admin.rpc("enqueue_meeting", {
    p_meeting_id: meetingId,
  });

  if (queueError) {
    console.error("retry enqueue failed", { meetingId, queueError });
    await admin
      .from("meetings")
      .update({
        status: "failed",
        failure_reason: "Couldn't queue this huddle for processing. Try again.",
        processing_stage: null,
      })
      .eq("id", meetingId);

    return NextResponse.json(
      { error: "Couldn't queue this huddle. Try again." },
      { status: 500 },
    );
  }

  void wakeWorker();

  return NextResponse.json({ ok: true, status: "processing" });
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
    // Not fatal — the sweep and any scheduled run will still pick this up —
    // but a silently unreachable worker is worth seeing in the logs.
    console.warn("worker nudge failed; check APP_URL", caught);
  }
}
