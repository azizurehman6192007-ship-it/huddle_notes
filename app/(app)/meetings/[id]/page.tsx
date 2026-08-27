import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/ui/AppHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import { Card } from "@/components/ui/Card";
import { ProcessingView } from "@/components/huddle/ProcessingView";
import { MeetingActions } from "@/components/huddle/MeetingActions";
import { DeleteHuddle } from "@/components/huddle/DeleteHuddle";
import { TranscriptEditor } from "@/components/transcript/TranscriptEditor";
import { NotesView } from "@/components/notes/NotesView";
import { NotesSchema } from "@/lib/ai/schema";
import { emailConfigStatus } from "@/lib/email/resend";
import {
  formatDayLabel,
  formatDuration,
  parseDateOnly,
} from "@/lib/util/format";

export const metadata: Metadata = { title: "Huddle" };
export const dynamic = "force-dynamic";

/**
 * Everything about one huddle: its notes (editable), its transcript, and the
 * actions that apply to whatever state it is in. Always reachable from home,
 * and always has a way back there.
 */
export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const emailConfig = emailConfigStatus();
  const { id } = await params;
  const { team, member } = await requireMembership();

  const supabase = await createClient();
  const { data: meeting } = await supabase
    .from("meetings")
    .select(
      "id, title, meeting_date, status, duration_sec, transcript, notes_json, failure_reason, processing_stage, sent_count",
    )
    .eq("id", id)
    .maybeSingle();

  if (!meeting) notFound();

  const subtitle = [
    formatDayLabel(parseDateOnly(meeting.meeting_date)),
    meeting.duration_sec ? formatDuration(meeting.duration_sec) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const inFlight =
    meeting.status === "uploading" || meeting.status === "processing";
  const readable = meeting.status === "draft" || meeting.status === "sent";

  const parsedNotes = readable ? NotesSchema.safeParse(meeting.notes_json) : null;

  const [{ data: roster }, { data: items }] = await Promise.all([
    supabase
      .from("members")
      .select("id, name, email, receives_notes")
      .eq("team_id", team.id)
      .eq("active", true)
      .order("name", { ascending: true }),
    parsedNotes?.success
      ? supabase
          .from("action_items")
          .select("id, task")
          .eq("meeting_id", id)
          .order("id", { ascending: true })
      : Promise.resolve({ data: null }),
  ]);

  const members = roster ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16">
      <AppHeader back={{ href: "/", label: "All huddles" }} />

      <div className="flex items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          <h1 className="font-display text-2xl text-ink">{meeting.title}</h1>
          <p className="mt-1 font-mono text-xs text-ink-3">{subtitle}</p>
        </div>
        <StatusPill status={meeting.status} className="mt-1.5" />
      </div>

      <div className="mt-8 flex flex-col gap-8">
        {meeting.status === "recording" && (
          <Card padding="loose">
            <h2 className="font-display text-lg text-ink">
              This huddle is still open
            </h2>
            <p className="mt-2 text-ink-2">
              The page reloaded while it was recording, so the mic let go.
              Whatever was already uploaded is safe — wrap it up to transcribe
              that.
            </p>
            <MeetingActions meetingId={meeting.id} action="wrap" />
          </Card>
        )}

        {inFlight && (
          <ProcessingView
            meetingId={meeting.id}
            stage={meeting.processing_stage}
          />
        )}

        {meeting.status === "empty" && (
          <Card padding="loose">
            <h2 className="font-display text-lg text-ink">Nothing to write up</h2>
            <p className="mt-2 text-ink-2">
              {meeting.failure_reason ??
                "There wasn't enough speech in this huddle to make notes from."}
            </p>
            <p className="mt-2 text-sm text-ink-3">
              This isn&apos;t an error — the recording just came back quiet.
            </p>
          </Card>
        )}

        {meeting.status === "failed" && (
          <Card padding="loose" role="alert">
            <h2 className="font-display text-lg text-ink">
              This huddle didn&apos;t finish
            </h2>
            <p className="mt-2 text-ink-2">
              {meeting.failure_reason ??
                "Something went wrong while processing this huddle."}
            </p>
            <MeetingActions meetingId={meeting.id} action="retry" />
          </Card>
        )}

        {parsedNotes?.success && (
          <NotesView
            meetingId={meeting.id}
            status={meeting.status}
            notes={parsedNotes.data}
            actionItems={(items ?? []).map((item) => ({
              id: item.id,
              task: item.task,
            }))}
            recipients={members
              .filter((member) => member.receives_notes)
              .map((member) => ({
                id: member.id,
                name: member.name,
                email: member.email,
              }))}
            emailConfigured={emailConfig.configured}
            emailProblems={emailConfig.problems}
            sentCount={meeting.sent_count}
          />
        )}

        {readable && !parsedNotes?.success && (
          <Card padding="loose">
            <h2 className="font-display text-lg text-ink">No notes on this one</h2>
            <p className="mt-2 text-ink-2">
              This huddle was transcribed before notes existed, or the notes
              couldn&apos;t be read. The transcript is below.
            </p>
            <MeetingActions meetingId={meeting.id} action="regenerate" />
          </Card>
        )}

        <TranscriptEditor
          meetingId={meeting.id}
          transcript={meeting.transcript}
          // Nothing to correct while the worker still owns the row, and an
          // edit saved mid-pipeline would be overwritten by transcription.
          editable={!inFlight && Boolean(meeting.transcript?.trim())}
          placeholder={
            inFlight
              ? "Not transcribed yet."
              : "No transcript was saved for this huddle."
          }
        />

        {member.role === "lead" && (
          <section className="border-t border-hairline pt-6">
            <DeleteHuddle
              meetingId={meeting.id}
              title={meeting.title}
              dayLabel={formatDayLabel(parseDateOnly(meeting.meeting_date))}
              redirectHome
            />
          </section>
        )}
      </div>
    </div>
  );
}
