"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

export function CreateTeamForm() {
  const router = useRouter();
  const [teamName, setTeamName] = useState("");
  const [yourName, setYourName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!teamName.trim()) {
      setError("Give the team a name — the one people would recognise.");
      return;
    }

    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("create_team", {
      p_team_name: teamName.trim(),
      p_lead_name: yourName.trim(),
    });

    if (rpcError) {
      setBusy(false);
      setError("Couldn't create the team. Try again in a moment.");
      return;
    }

    router.replace("/team");
    router.refresh();
  }

  return (
    <Card as="form" onSubmit={handleSubmit} noValidate elevation={2} padding="loose" className="flex flex-col gap-5">
      <Input
        label="Team name"
        value={teamName}
        autoFocus
        maxLength={80}
        onChange={(event) => setTeamName(event.target.value)}
        error={error ?? undefined}
      />
      <Input
        label="Your name"
        value={yourName}
        maxLength={80}
        onChange={(event) => setYourName(event.target.value)}
        hint="This is how you'll appear in the notes."
      />
      <Button type="submit" variant="primary" size="lg" busy={busy}>
        {busy ? "Creating…" : "Create team"}
      </Button>
    </Card>
  );
}
