/** Quiet skeleton — no spinner, no layout shift when the data lands. */
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl px-5 pb-16">
      <div className="flex h-16 items-center gap-2.5">
        <span aria-hidden className="size-8 rounded-[10px] bg-paper-sunk" />
        <span className="h-4 w-16 rounded bg-paper-sunk" />
      </div>
      <div className="mt-2 h-[212px] animate-pulse rounded-[var(--radius-lg)] bg-paper-sunk" />
      <div className="mt-12 flex flex-col gap-3">
        <div className="h-3 w-24 animate-pulse rounded bg-paper-sunk" />
        <div className="h-40 animate-pulse rounded-[var(--radius-lg)] bg-paper-sunk" />
      </div>
    </div>
  );
}
