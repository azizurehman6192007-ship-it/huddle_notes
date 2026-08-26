"use client";

import { cx } from "@/lib/util/cx";

/**
 * Material's large FAB, doing §7's motion moment 1: the circle morphs to a
 * rounded square over 220ms. One button, two states — never two buttons that
 * swap places, so the target never moves under your thumb.
 */
export function RecordButton({
  recording,
  busy,
  onClick,
  className,
}: {
  recording: boolean;
  busy?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={recording}
      aria-label={recording ? "Stop recording" : "Start recording"}
      className={cx(
        "state-layer relative grid size-20 place-items-center rounded-full",
        "bg-paper-raised shadow-e3",
        "transition-transform duration-150 ease-[var(--ease)]",
        "active:scale-95 disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    >
      {/* A quiet ring while live, so the control reads as armed at a glance. */}
      <span
        aria-hidden
        className={cx(
          "absolute inset-0 rounded-full ring-2 transition-colors duration-200",
          recording ? "ring-live/25" : "ring-transparent",
        )}
      />
      <span
        aria-hidden
        className={cx(
          "block bg-live transition-all duration-[220ms] ease-[var(--ease)]",
          recording ? "size-7 rounded-[7px]" : "size-12 rounded-full",
        )}
      />
    </button>
  );
}
