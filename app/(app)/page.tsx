import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/ui/AppHeader";
import { HuddleConsole } from "@/components/huddle/HuddleConsole";
import { LiveRefresh } from "@/components/huddle/LiveRefresh";
import {
  HuddleBrowser,
  type ListedMeeting,
} from "@/components/huddle/HuddleBrowser";
import type { MeetingStatus } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Huddle" };
export const dynamic = "force-dynamic";

/** Still moving through the pipeline, so the list needs to keep refreshing. */
const IN_FLIGHT: MeetingStatus[] = ["recording", "uploading", "processing"];

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

      {/* Search sits directly under the console; the list filters in place. */}
      <HuddleBrowser rows={rows} canDelete={member.role === "lead"} />
    </div>
  );
}
