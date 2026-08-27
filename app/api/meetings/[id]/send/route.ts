import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { PDF_BUCKET, createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { NotesSchema } from "@/lib/ai/schema";
import { buildNotesEmail } from "@/lib/email/templates";
import { isEmailConfigured, sendNotes } from "@/lib/email/resend";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * The only path by which a huddle is ever emailed. It exists because a human
 * pressed Send — nothing in the worker may call it. §1, non-negotiable 1.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id: meetingId } = await context.params;

  if (!isEmailConfigured()) {
    return NextResponse.json(
      {
        error:
          "Email isn't set up yet. Add RESEND_API_KEY and EMAIL_FROM, then try again.",
      },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select("id, team_id, title, meeting_date, status, notes_json, pdf_path")
    .eq("id", meetingId)
    .maybeSingle();

  if (!meeting) {
    return NextResponse.json({ error: "Huddle not found." }, { status: 404 });
  }

  if (meeting.status !== "draft" && meeting.status !== "sent") {
    return NextResponse.json(
      { error: "These notes aren't ready to send yet." },
      { status: 409 },
    );
  }

  const parsedNotes = NotesSchema.safeParse(meeting.notes_json);
  if (!parsedNotes.success) {
    return NextResponse.json(
      { error: "These notes can't be read. Retry the huddle." },
      { status: 409 },
    );
  }

  const [{ data: team }, { data: recipients }, { data: items }] =
    await Promise.all([
      supabase.from("teams").select("name").eq("id", meeting.team_id).maybeSingle(),
      supabase
        .from("members")
        .select("id, name, email")
        .eq("team_id", meeting.team_id)
        .eq("active", true)
        .eq("receives_notes", true),
      supabase
        .from("action_items")
        .select("task, owner_member_id, owner_name_raw, members(name)")
        .eq("meeting_id", meetingId),
    ]);

  if (!recipients || recipients.length === 0) {
    return NextResponse.json(
      {
        error:
          "Nobody on the team is set to receive notes. Turn that on for at least one person first.",
      },
      { status: 409 },
    );
  }

  const admin = createAdminClient();

  if (!meeting.pdf_path) {
    return NextResponse.json(
      { error: "The PDF is missing for this huddle. Retry it." },
      { status: 409 },
    );
  }

  const { data: pdfBlob, error: pdfError } = await admin.storage
    .from(PDF_BUCKET)
    .download(meeting.pdf_path);

  if (pdfError || !pdfBlob) {
    return NextResponse.json(
      { error: "Couldn't read the PDF for this huddle. Retry it." },
      { status: 500 },
    );
  }

  const actionRows = (items ?? []) as unknown as {
    task: string;
    owner_member_id: string | null;
    owner_name_raw: string | null;
    members: { name: string } | null;
  }[];

  const content = buildNotesEmail({
    teamName: team?.name ?? "Team",
    title: meeting.title,
    meetingDate: meeting.meeting_date,
    notes: parsedNotes.data,
    actionItems: actionRows.map((row) => ({
      task: row.task,
      ownerName: row.members?.name ?? row.owner_name_raw,
      unassigned: !row.owner_member_id,
    })),
    url: `${serverEnv.appUrl()}/meetings/${meetingId}`,
  });

  const results = await sendNotes({
    to: recipients.map((recipient) => recipient.email),
    content,
    attachment: {
      filename: `huddle-${meeting.meeting_date}.pdf`,
      content: new Uint8Array(await pdfBlob.arrayBuffer()),
    },
  });

  // One row per recipient, so a bad address is visible rather than silent.
  await admin.from("email_log").insert(
    results.map((result) => ({
      meeting_id: meetingId,
      email: result.email,
      provider_id: result.providerId,
      status: result.status,
    })),
  );

  const delivered = results.filter((result) => result.status === "queued");
  const failed = results.filter((result) => result.status === "failed");

  // Partial success still counts as sent — the notes are out. The failures are
  // reported back so the lead can see exactly who missed out.
  if (delivered.length > 0) {
    await admin
      .from("meetings")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
        sent_count: delivered.length,
      })
      .eq("id", meetingId);
  }

  // The provider's own words go back to the UI. Without this, a rejection
  // ("you can only send testing emails to your own address") reached the lead
  // as a bare address with no reason, and the only way to find out why was to
  // replay the request by hand against Resend.
  return NextResponse.json({
    sent: delivered.length,
    failed: failed.map((result) => result.email),
    reason: failed.find((result) => result.error)?.error ?? null,
  });
}
