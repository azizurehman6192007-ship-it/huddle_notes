import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Link expired · Huddle" };

export default function AuthErrorPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-5 py-12">
      <h1 className="font-display text-2xl text-ink">That link didn&apos;t work</h1>
      <p className="text-ink-2">
        Sign-in links work once and expire after an hour. Ask for a fresh one and
        open it on this device.
      </p>
      <Link
        href="/login"
        className="inline-flex h-11 w-fit items-center rounded-[var(--radius)] bg-ink px-4 font-medium text-paper-raised"
      >
        Back to sign in
      </Link>
    </main>
  );
}
