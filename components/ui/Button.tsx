import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/util/cx";

/**
 * Material's button hierarchy — filled / tonal / outlined / text — in §7's
 * palette. Interaction is a state layer rather than a swapped background, so
 * hover, focus and press read consistently across every variant.
 *
 * `primary` and `secondary` are kept as the names of the top two so call
 * sites read by intent rather than by appearance.
 */
type Variant = "primary" | "tonal" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper-raised shadow-e1 hover:shadow-e2",
  tonal: "bg-paper-sunk text-ink",
  secondary: "bg-paper-raised text-ink border border-hairline",
  ghost: "text-ink-2 hover:text-ink",
  danger: "bg-live text-white shadow-e1 hover:shadow-e2",
};

/** Material's pill buttons, at touch-target heights. */
const SIZE: Record<Size, string> = {
  sm: "h-9 px-4 text-sm gap-1.5",
  md: "h-11 px-5 text-base gap-2",
  lg: "h-14 px-7 text-base gap-2.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Renders a quiet inline state and blocks repeat presses. */
  busy?: boolean;
  /** Leading glyph or dot. */
  icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      busy,
      icon,
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        {...props}
        disabled={props.disabled || busy}
        aria-busy={busy || undefined}
        className={cx(
          "state-layer inline-flex items-center justify-center rounded-full",
          "font-medium whitespace-nowrap select-none",
          "transition-[box-shadow,opacity] duration-150 ease-[var(--ease)]",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
          VARIANT[variant],
          SIZE[size],
          className,
        )}
      >
        {busy ? <Spinner /> : icon}
        {children}
      </button>
    );
  },
);

/** Only shown on a busy button, so it never competes with §7's three moments. */
function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  );
}

/**
 * Material's icon button: a circular target for single-glyph actions where a
 * label would be noise.
 */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string }
>(function IconButton({ label, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      {...props}
      aria-label={label}
      title={label}
      className={cx(
        "state-layer grid size-10 shrink-0 place-items-center rounded-full",
        "text-ink-2 transition-colors duration-150 hover:text-ink",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
});
