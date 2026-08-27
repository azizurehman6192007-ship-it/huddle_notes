import type { Metadata } from "next";
import { requireMembership } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/ui/AppHeader";
import { TeamManager } from "./TeamManager";
import { SignOutButton } from "./SignOutButton";
import type { MemberRow } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Team · Huddle" };
export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const { team, member } = await requireMembership();
  const supabase = await createClient();

  const { data: members } = await supabase
    .from("members")
    .select("*")
    .eq("team_id", team.id)
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16">
      <AppHeader back={{ href: "/", label: "Huddles" }} />

      <h1 className="mt-2 px-1 font-display text-2xl text-ink">{team.name}</h1>
      <p className="mt-1 px-1 text-ink-2">
        The people who join the huddle, and how the notes go out.
      </p>

      <TeamManager
        team={team}
        members={(members ?? []) as MemberRow[]}
        isLead={member.role === "lead"}
        signedInEmail={member.email}
      />

      {/* Until verification comes back, switching identity is how you test as
          someone else — so there has to be a way out. */}
      <section className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-6">
        <p className="text-sm text-ink-3">
          Signed in as{" "}
          <span className="font-mono text-xs text-ink-2">{member.email}</span>
        </p>
        <form action="/api/auth/signout" method="post">
          <SignOutButton />
        </form>
      </section>
    </div>
  );
}
