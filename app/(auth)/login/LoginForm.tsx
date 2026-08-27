"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";

/**
 * ⚠️  No verification happens here — see app/api/auth/dev-signin/route.ts.
 * Typing an address is enough to become that person. Internal testing only.
 */
export function LoginForm({ signedInAs }: { signedInAs?: string | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const next = searchParams.get("next") ?? "/";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const address = email.trim().toLowerCase();
    if (!address) {
      setError("Enter the email you use for work.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/dev-signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: address }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) throw new Error(payload.error ?? "Couldn't sign in.");

      // replace, not push: Back should not land on the sign-in screen.
      // refresh first so the server components re-read the new session
      // rather than serving the previous user's cached render.
      router.replace(next);
      router.refresh();
    } catch (caught) {
      setBusy(false);
      setError(
        caught instanceof Error
          ? caught.message
          : "Couldn't reach the sign-in service. Check your connection and try again.",
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {signedInAs && (
        <Card outlined padding="base" className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">
            Already signed in as{" "}
            <span className="font-mono text-xs text-ink">{signedInAs}</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="tonal"
              size="sm"
              onClick={() => {
                router.replace(next);
                router.refresh();
              }}
            >
              Continue as {signedInAs}
            </Button>
            <form action="/api/auth/signout" method="post">
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </Card>
      )}

      <Card
        as="form"
        onSubmit={handleSubmit}
        noValidate
        elevation={2}
        padding="loose"
        className="flex flex-col gap-5"
      >
        <Input
          label="Work email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={error ?? undefined}
          hint={
            signedInAs
              ? "Entering a different address switches to that person."
              : "No password, no link to click — you go straight in."
          }
        />
        <Button type="submit" variant="primary" size="lg" busy={busy}>
          {busy ? "Signing in…" : "Continue"}
        </Button>
      </Card>

      <p className="px-1 text-xs text-ink-3">
        Verification is switched off for internal testing. Anyone who knows an
        address can sign in as its owner — don&apos;t put real or confidential
        huddles in here yet.
      </p>
    </div>
  );
}
