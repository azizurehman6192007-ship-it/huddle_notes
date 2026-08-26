import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MemberRow, TeamRow } from "@/lib/supabase/types";

export interface Membership {
  userId: string;
  email: string;
  team: TeamRow;
  member: MemberRow;
}

/**
 * Membership is resolved by email: `members.email` matched against the signed-in
 * user's address. The schema in §4 has no auth.users column on members, so this
 * is the join, and it is also what the RLS predicates use.
 *
 * Returns null when the user is signed in but not on a team yet.
 */
export async function getMembership(): Promise<Membership | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) return null;

  const { data: member } = await supabase
    .from("members")
    .select("*")
    // ilike, not eq: the RLS predicates compare with lower(), so a row saved
    // with any capitalisation is visible but would miss a case-sensitive
    // match here — and the symptom is being sent to /welcome forever.
    .ilike("email", user.email)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!member) return null;

  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("id", member.team_id)
    .single();

  if (!team) return null;

  return { userId: user.id, email: user.email.toLowerCase(), team, member };
}

/** For pages inside (app): sends a teamless user to onboarding. */
export async function requireMembership(): Promise<Membership> {
  const membership = await getMembership();
  if (!membership) redirect("/welcome");
  return membership;
}
