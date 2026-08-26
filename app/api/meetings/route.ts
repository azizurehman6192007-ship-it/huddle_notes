import { NextResponse } from "next/server";
import { getMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

interface CreateBody {
  title?: string;
  attendeeIds?: string[];
}

/** Creates the meeting row up front so chunks have somewhere to land. */
export async function POST(request: Request) {
  const membership = await getMembership();
  if (!membership) {
    return NextResponse.json({ error: "Not on a team." }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    body = {};
  }

  const supabase = await createClient();

  const { data: meeting, error } = await supabase
    .from("meetings")
    .insert({
      team_id: membership.team.id,
      title: body.title?.trim() || "Daily standup",
      started_at: new Date().toISOString(),
      status: "recording",
      created_by: membership.userId,
    })
    .select("id")
    .single();

  if (error || !meeting) {
    return NextResponse.json(
      { error: "Couldn't start the huddle. Try again." },
      { status: 500 },
    );
  }

  const attendeeIds = body.attendeeIds ?? [];
  if (attendeeIds.length > 0) {
    const { error: attendeeError } = await supabase
      .from("meeting_attendees")
      .insert(
        attendeeIds.map((memberId) => ({
          meeting_id: meeting.id,
          member_id: memberId,
          present: true,
        })),
      );

    // Attendance is an assist, never a requirement — don't fail the huddle.
    if (attendeeError) {
      console.error("meeting_attendees insert failed", attendeeError);
    }
  }

  return NextResponse.json({ id: meeting.id }, { status: 201 });
}
