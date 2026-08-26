import Link from "next/link";
import { cx } from "@/lib/util/cx";

/**
 * Material top app bar. Sticky, and it only grows a hairline once the page
 * has scrolled under it — at rest it should feel like part of the paper.
 */
export function AppHeader({
  teamName,
  back,
  className,
}: {
  teamName?: string;
  /** Renders a back affordance instead of the wordmark. */
  back?: { href: string; label: string };
  className?: string;
}) {
  return (
    <header
      className={cx(
        "sticky top-0 z-20 -mx-5 mb-2 flex h-16 items-center justify-between gap-3 px-5",
        "bg-paper/85 backdrop-blur-md",
        className,
      )}
    >
      {back ? (
        <Link
          href={back.href}
          className="state-layer -ml-2 inline-flex h-10 items-center gap-2 rounded-full px-3 text-ink-2 hover:text-ink"
        >
          <span aria-hidden className="text-lg leading-none">
            ←
          </span>
          <span className="truncate text-sm font-medium">{back.label}</span>
        </Link>
      ) : (
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-[10px] bg-ink"
          >
            <span className="block size-2.5 rounded-full bg-live" />
          </span>
          <span className="font-display text-lg text-ink">Huddle</span>
        </span>
      )}

      {teamName && (
        <Link
          href="/team"
          className="state-layer inline-flex h-10 max-w-[12rem] items-center gap-2 rounded-full border border-hairline bg-paper-raised px-3.5 text-sm text-ink-2 hover:text-ink"
        >
          <span className="truncate">{teamName}</span>
          <span aria-hidden className="text-ink-3">
            ⚙
          </span>
        </Link>
      )}
    </header>
  );
}
