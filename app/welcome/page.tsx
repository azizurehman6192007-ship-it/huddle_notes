import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getMembership } from "@/lib/auth";
import { CreateTeamForm } from "./CreateTeamForm";

export const metadata: Metadata = { title: "Create your team · Huddle" };

/**
 * Sits outside the (app) group on purpose: this is the one signed-in screen a
 * user can reach before they belong to a team.
 */
export default async function WelcomePage() {
  const membership = await getMembership();
  if (membership) redirect("/");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-5 py-12">
      <header>
        <h1 className="font-display text-2xl text-ink">Set up your team</h1>
        <p className="mt-2 text-ink-2">
          One team per standup. You can add the rest of the people next.
        </p>
      </header>

      <CreateTeamForm />
    </main>
  );
}
