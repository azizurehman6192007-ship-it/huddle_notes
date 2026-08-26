"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

type State =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "error"; message: string };

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const address = email.trim().toLowerCase();
    if (!address) {
      setState({ kind: "error", message: "Enter the email you use for work." });
      return;
    }

    setState({ kind: "sending" });

    const next = searchParams.get("next") ?? "/";
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setState({
        kind: "error",
        message:
          "Couldn't send the link. Check the address and your connection, then try again.",
      });
      return;
    }

    setState({ kind: "sent", email: address });
  }

  if (state.kind === "sent") {
    return (
      <Card elevation={2} padding="loose">
        <span
          aria-hidden
          className="mb-3 grid size-11 place-items-center rounded-full bg-ok-soft text-lg text-ok"
        >
          ✓
        </span>
        <h2 className="font-display text-lg text-ink">Check your email</h2>
        <p className="mt-2 text-ink-2">
          We sent a sign-in link to{" "}
          <span className="font-mono text-sm text-ink">{state.email}</span>. It
          works once and expires in an hour.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 -ml-3"
          onClick={() => setState({ kind: "idle" })}
        >
          Use a different address
        </Button>
      </Card>
    );
  }

  return (
    <Card as="form" onSubmit={handleSubmit} noValidate elevation={2} padding="loose" className="flex flex-col gap-5">
      <Input
        label="Work email"
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        autoFocus
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={state.kind === "error" ? state.message : undefined}
        hint="We'll email you a link. No password to remember."
      />
      <Button type="submit" variant="primary" size="lg" busy={state.kind === "sending"}>
        {state.kind === "sending" ? "Sending link…" : "Email me a link"}
      </Button>
    </Card>
  );
}
