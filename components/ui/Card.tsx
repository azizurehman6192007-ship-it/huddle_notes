import type { ElementType, ReactNode } from "react";
import { cx } from "@/lib/util/cx";

type Elevation = 0 | 1 | 2 | 3;

const ELEVATION: Record<Elevation, string> = {
  0: "shadow-none",
  1: "shadow-e1",
  2: "shadow-e2",
  3: "shadow-e3",
};

/**
 * Surface tier. Material expresses depth with tone as well as shadow, which
 * is what keeps nested cards legible on the dark recording screen where a
 * shadow would just read as dirt.
 */
const TIER = {
  flat: "bg-paper",
  low: "bg-surface-1",
  base: "bg-paper-raised",
  high: "bg-surface-3",
} as const;

const PADDING = {
  none: "",
  tight: "p-3",
  base: "p-4 sm:p-5",
  loose: "p-5 sm:p-6",
} as const;

export interface CardProps {
  children: ReactNode;
  elevation?: Elevation;
  tier?: keyof typeof TIER;
  padding?: keyof typeof PADDING;
  /** Adds the hover/press state layer. Only for cards that do something. */
  interactive?: boolean;
  /** Outlined instead of elevated — Material's other card flavour. */
  outlined?: boolean;
  as?: ElementType;
  className?: string;
}

export function Card({
  children,
  elevation = 1,
  tier = "base",
  padding = "base",
  interactive,
  outlined,
  as,
  className,
  ...rest
}: CardProps & Record<string, unknown>) {
  const Component = as ?? "div";

  return (
    <Component
      {...rest}
      className={cx(
        "rounded-[var(--radius-lg)]",
        TIER[tier],
        PADDING[padding],
        outlined ? "border border-hairline shadow-none" : ELEVATION[elevation],
        // A card that is not outlined still needs a hairline in dark mode,
        // where there is no shadow to separate it from the surface behind.
        !outlined && "border border-transparent [[data-surface=dark]_&]:border-hairline",
        interactive &&
          "state-layer cursor-pointer text-left transition-[box-shadow,transform] duration-150 ease-[var(--ease)] hover:shadow-e2 active:scale-[0.995]",
        className,
      )}
    >
      {children}
    </Component>
  );
}

/**
 * A group of rows rendered as one card — the Ledger, the action item list,
 * the huddle history. Rows separate with hairlines rather than gaps so the
 * group reads as a single object.
 */
export function CardList({
  children,
  className,
  elevation = 1,
  as,
}: {
  children: ReactNode;
  className?: string;
  elevation?: Elevation;
  /** `ul` when the rows are a list, so the markup matches the meaning. */
  as?: ElementType;
}) {
  return (
    <Card
      as={as}
      elevation={elevation}
      padding="none"
      className={cx("overflow-hidden", className)}
    >
      {children}
    </Card>
  );
}

/** Mono eyebrow above a card or card group. */
export function CardLabel({
  children,
  trailing,
  className,
}: {
  children: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mb-2 flex items-baseline justify-between gap-3", className)}>
      <h2 className="eyebrow">{children}</h2>
      {trailing}
    </div>
  );
}
