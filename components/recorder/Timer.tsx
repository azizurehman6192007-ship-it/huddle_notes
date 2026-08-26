"use client";

import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/util/format";
import { cx } from "@/lib/util/cx";

/**
 * The only thing in the product that gets 44px — and it is mono with
 * tabular-nums so it does not jitter as the digits change.
 */
export function Timer({
  startedAt,
  running,
  className,
}: {
  startedAt: number | null;
  running: boolean;
  className?: string;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running || startedAt === null) return;

    const tick = () => setElapsed((Date.now() - startedAt) / 1000);
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [running, startedAt]);

  return (
    <span
      role="timer"
      aria-label={`Recording time ${formatDuration(elapsed)}`}
      className={cx("font-mono tabular", className)}
    >
      {formatDuration(elapsed)}
    </span>
  );
}
