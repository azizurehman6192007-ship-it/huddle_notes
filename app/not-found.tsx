import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-5 py-12">
      <h1 className="font-display text-2xl text-ink">Nothing here</h1>
      <p className="text-ink-2">
        That huddle doesn&apos;t exist, or it belongs to another team.
      </p>
      <Link
        href="/"
        className="inline-flex h-11 w-fit items-center rounded-[var(--radius)] bg-ink px-4 font-medium text-paper-raised"
      >
        Back to huddles
      </Link>
    </main>
  );
}
