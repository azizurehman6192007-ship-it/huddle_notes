import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUDIO_BUCKET, PDF_BUCKET, createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Deletes one huddle and everything it owns. Irreversible, so the UI puts a
 * confirm sheet in front of it — this route does not second-guess a caller
 * that has already passed that gate.
 *
 * Row deletion cascades (`on delete cascade` covers attendees, segments,
 * action items, email log and chunks). Storage does not cascade, so the audio
 * and the PDF are swept here or they leak.
 */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await context.params;

  // The caller's own session, so RLS decides. `meetings_delete` is lead-only,
  // and the select is what turns "not on this team" into a clean 404.
  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, status, audio_path, pdf_path")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) {
    return NextResponse.json({ error: "Huddle not found." }, { status: 404 });
  }

  // Mid-flight the worker still holds this row and would write to a deleted
  // meeting. Say so rather than racing it.
  if (meeting.status === "uploading" || meeting.status === "processing") {
    return NextResponse.json(
      {
        error:
          "This huddle is still being written up. Wait for it to finish, then delete it.",
      },
      { status: 409 },
    );
  }

  const { error: deleteError } = await supabase
    .from("meetings")
    .delete()
    .eq("id", meetingId);

  if (deleteError) {
    console.error("meeting delete failed", { meetingId, deleteError });
    return NextResponse.json(
      {
        error:
          "Couldn't delete that huddle. Only the team lead can delete huddles.",
      },
      { status: 403 },
    );
  }

  // Best effort from here: the row is gone, so the huddle is gone as far as
  // anyone can see. An orphaned object costs storage, not correctness, and
  // failing the request now would wrongly suggest nothing was deleted.
  await removeStorage(meetingId, meeting.audio_path, meeting.pdf_path);

  return NextResponse.json({ ok: true });
}

async function removeStorage(
  meetingId: string,
  audioPath: string | null,
  pdfPath: string | null,
) {
  const admin = createAdminClient();

  try {
    const audioObjects: string[] = [];
    if (audioPath) audioObjects.push(audioPath);

    // Chunks are separate objects under {id}/chunks/ and outlive a huddle that
    // never finalized, so list rather than assuming audio_path covers them.
    const { data: chunks } = await admin.storage
      .from(AUDIO_BUCKET)
      .list(`${meetingId}/chunks`, { limit: 1000 });

    for (const chunk of chunks ?? []) {
      audioObjects.push(`${meetingId}/chunks/${chunk.name}`);
    }

    if (audioObjects.length > 0) {
      await admin.storage.from(AUDIO_BUCKET).remove(audioObjects);
    }

    if (pdfPath) {
      await admin.storage.from(PDF_BUCKET).remove([pdfPath]);
    }
  } catch (caught) {
    console.error("storage cleanup after delete failed", { meetingId, caught });
  }
}
