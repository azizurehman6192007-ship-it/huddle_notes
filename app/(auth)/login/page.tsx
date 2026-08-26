import { Suspense } from "react";
import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Sign in · Huddle" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-5 py-12">
      <header>
        <h1 className="font-display text-2xl text-ink">Huddle</h1>
        <p className="mt-2 text-ink-2">
          Record your standup, get notes you can send.
        </p>
      </header>

      <Suspense
        fallback={<div className="h-40 rounded-[var(--radius-lg)] bg-paper-sunk" />}
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
