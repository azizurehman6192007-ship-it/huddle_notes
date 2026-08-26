import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUDIO_BUCKET, createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

/** 5s of 24kbps opus is ~15KB. This is a sanity ceiling, not a target. */
const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Receives one timeslice mid-meeting and parks it as its own object. Finalize
 * stitches them back into a single container. Nothing is buffered in memory
 * across requests, so a crash costs at most the last 5 seconds.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await context.params;
  const url = new URL(request.url);
  const seq = Number(url.searchParams.get("seq"));
  const mime = url.searchParams.get("mime") || "audio/webm";

  if (!Number.isInteger(seq) || seq < 0) {
    return NextResponse.json({ error: "Bad chunk sequence." }, { status: 400 });
  }

  // Authorise against RLS with the caller's own session before touching
  // anything with the service role.
  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, status")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) {
    return NextResponse.json({ error: "Huddle not found." }, { status: 404 });
  }
  if (meeting.status !== "recording") {
    return NextResponse.json(
      { error: "This huddle is no longer recording." },
      { status: 409 },
    );
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength === 0) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  if (body.byteLength > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: "Chunk too large." }, { status: 413 });
  }

  const admin = createAdminClient();
  const path = `${meetingId}/chunks/${String(seq).padStart(6, "0")}`;

  const { error: uploadError } = await admin.storage
    .from(AUDIO_BUCKET)
    .upload(path, body, { contentType: mime, upsert: true });

  if (uploadError) {
    console.error("chunk upload failed", { meetingId, seq, uploadError });
    return NextResponse.json({ error: "Chunk upload failed." }, { status: 500 });
  }

  const { error: manifestError } = await admin
    .from("meeting_chunks")
    .upsert(
      { meeting_id: meetingId, seq, path, bytes: body.byteLength },
      { onConflict: "meeting_id,seq" },
    );

  if (manifestError) {
    console.error("chunk manifest failed", { meetingId, seq, manifestError });
    return NextResponse.json({ error: "Chunk upload failed." }, { status: 500 });
  }

  // First chunk carries the container header — record the real mime type.
  if (seq === 0) {
    await admin.from("meetings").update({ audio_mime: mime }).eq("id", meetingId);
  }

  return NextResponse.json({ ok: true, seq });
}
