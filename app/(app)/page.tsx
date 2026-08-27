import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/ui/AppHeader";
import { StatusPill } from "@/components/ui/StatusPill";
import { CardLabel, CardList } from "@/components/ui/Card";
import { HuddleConsole } from "@/components/huddle/HuddleConsole";
import { DeleteHuddle } from "@/components/huddle/DeleteHuddle";
import { LiveRefresh } from "@/components/huddle/LiveRefresh";
import {
  formatDayLabel,
  formatDuration,
  groupLabelFor,
  parseDateOnly,
} from "@/lib/util/format";
import type { MeetingRow, MeetingStatus } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Huddle" };
export const dynamic = "force-dynamic";

/** Still moving through the pipeline, so the list needs to keep refreshing. */
const IN_FLIGHT: MeetingStatus[] = ["recording", "uploading", "processing"];

type ListedMeeting = Pick<
  MeetingRow,
  "id" | "title" | "meeting_date" | "status" | "duration_sec" | "created_at"
>;

/**
 * Home is always home: the start button, and every huddle you have recorded.
 * It never turns into a huddle's detail view — that lives at /meetings/[id],
 * which has a back button to get here.
 */
export default async function HuddlePage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string }>;
}) {
  // Older links (and already-sent emails) used ?h= to focus a huddle here.
  const { h: legacyId } = await searchParams;
  if (legacyId) redirect(`/meetings/${legacyId}`);

  const { team, member } = await requireMembership();
  const supabase = await createClient();

  const [{ data: members }, { data: meetings }] = await Promise.all([
    supabase
      .from("members")
      .select("id, name")
      .eq("team_id", team.id)
      .eq("active", true)
      .order("name", { ascending: true }),
    supabase
      .from("meetings")
      .select("id, title, meeting_date, status, duration_sec, created_at")
      .eq("team_id", team.id)
      .order("meeting_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  const roster = members ?? [];
  const rows = (meetings ?? []) as ListedMeeting[];
  const anyInFlight = rows.some((row) => IN_FLIGHT.includes(row.status));

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16">
      <AppHeader teamName={team.name} />

      <div className="mt-2">
        <HuddleConsole members={roster} memberCount={roster.length} />
      </div>

      {/* Keeps the status chips honest while the worker is still going. */}
      <LiveRefresh active={anyInFlight} />

      <HuddleList rows={rows} canDelete={member.role === "lead"} />
    </div>
  );
}

function HuddleList({
  rows,
  canDelete,
}: {
  rows: ListedMeeting[];
  /** Deleting is lead-only in RLS, so don't offer it to anyone else. */
  canDelete: boolean;
}) {
  if (rows.length === 0) {
    return (
      <p className="mt-10 text-center text-ink-2">
        No huddles yet. Tap the mic to record your first one.
      </p>
    );
  }

  const now = new Date();
  const groups: { label: string; meetings: ListedMeeting[] }[] = [];

  for (const meeting of rows) {
    const label = groupLabelFor(parseDateOnly(meeting.meeting_date), now);
    const last = groups.at(-1);
    if (last?.label === label) last.meetings.push(meeting);
    else groups.push({ label, meetings: [meeting] });
  }

  return (
    <div className="mt-12 flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.label}>
          <CardLabel>{group.label}</CardLabel>
          <CardList as="ul">
            {group.meetings.map((meeting) => (
              <li
                key={meeting.id}
                className="flex items-center border-b border-hairline last:border-b-0"
              >
                {/* Delete sits beside the link, not inside it: a button nested
                    in an anchor is invalid, and a stray tap must never both
                    navigate and open a destructive sheet. */}
                <Link
                  href={`/meetings/${meeting.id}`}
                  className="state-layer flex min-h-16 min-w-0 flex-1 items-center justify-between gap-3 py-3.5 pl-4 pr-3 sm:pl-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">
                      {meeting.title}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs text-ink-3">
                      {formatDayLabel(parseDateOnly(meeting.meeting_date))}
                      {meeting.duration_sec
                        ? ` · ${formatDuration(meeting.duration_sec)}`
                        : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusPill status={meeting.status} />
                    <span aria-hidden className="text-ink-3">
                      ›
                    </span>
                  </span>
                </Link>

                {canDelete && (
                  <span className="shrink-0 pr-2 sm:pr-3">
                    <DeleteHuddle
                      meetingId={meeting.id}
                      title={meeting.title}
                      dayLabel={formatDayLabel(
                        parseDateOnly(meeting.meeting_date),
                      )}
                    />
                  </span>
                )}
              </li>
            ))}
          </CardList>
        </section>
      ))}
    </div>
  );
}
