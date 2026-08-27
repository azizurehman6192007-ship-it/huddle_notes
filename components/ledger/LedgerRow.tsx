import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/lib/util/cx";

export interface LedgerRowProps {
  /**
   * Usually the person's name. Accepts a node so the team screen can make it
   * editable in place without a second row geometry — the layout is the point
   * of this component, and it stays identical either way.
   */
  name: ReactNode;
  /** Mono content on the right: a duration, a count, a state word. */
  trailing?: ReactNode;
  /** Amber left edge — reserved for the live and the actionable. */
  active?: boolean;
  /** Everyone who is not the active speaker recedes. */
  dimmed?: boolean;
  /** Slots under the name. Notes mode fills this. */
  children?: ReactNode;
  /** Stagger index for the processing → draft reveal. */
  index?: number;
  className?: string;
  /**
   * Renders the row itself as a button rather than wrapping one — a row is
   * phrasing content only, so a nested <div> inside <button> is invalid HTML.
   * When set, `children` must not contain interactive elements.
   */
  onClick?: () => void;
  pressed?: boolean;
}

/**
 * One row of the Ledger. The same object across setup, live and notes — the
 * geometry here is deliberately identical in every mode, which is what makes
 * the thing you tapped become the thing you read.
 */
export function LedgerRow({
  name,
  trailing,
  active,
  dimmed,
  children,
  index,
  className,
  onClick,
  pressed,
}: LedgerRowProps) {
  const interactive = Boolean(onClick);

  const content = (
    <>
      {/* 120ms slide-in. Instant feedback matters more than grace. */}
      <span
        aria-hidden
        className={cx(
          "absolute top-2 bottom-2 left-0 w-[3px] origin-left rounded-r-full bg-amber",
          "transition-transform duration-[120ms] ease-[var(--ease)]",
          active ? "scale-x-100" : "scale-x-0",
        )}
      />
      <span className="flex items-center justify-between gap-3">
        <span
          className={cx(
            // Only clamp real text — an element in this slot brings its own
            // box, and clipping it would cut off a focus ring.
            typeof name === "string" ? "truncate" : "min-w-0 flex-1",
            active ? "font-display text-base tracking-wide uppercase" : "text-base",
          )}
        >
          {name}
        </span>
        {trailing !== undefined && (
          <span className="tabular shrink-0 font-mono text-sm text-ink-3">
            {trailing}
          </span>
        )}
      </span>
      {children}
    </>
  );

  const classes = cx(
    "relative block w-full min-h-16 px-4 py-3.5 text-left text-ink sm:px-5",
    "border-b border-hairline last:border-b-0",
    "transition-opacity duration-150",
    dimmed && "opacity-45",
    index === undefined ? undefined : "stagger-in",
    interactive && "state-layer cursor-pointer",
    className,
  );

  const style =
    index === undefined ? undefined : ({ "--i": index } as CSSProperties);

  if (interactive) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={pressed}
        onClick={onClick}
        style={style}
        className={classes}
      >
        {content}
      </button>
    );
  }

  return (
    <div style={style} className={classes}>
      {content}
    </div>
  );
}
