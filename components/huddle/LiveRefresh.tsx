"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 4_000;

/**
 * Re-fetches the server component while any huddle is still moving through
 * the pipeline, so a row goes Processing → Transcribed on its own rather than
 * sitting stale until the page is reloaded by hand.
 *
 * Renders nothing. It stops polling as soon as nothing is in flight.
 */
export function LiveRefresh({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;

    const timer = window.setInterval(() => {
      // Pointless work while the tab is hidden, and it keeps mobile awake.
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);

    return () => window.clearInterval(timer);
  }, [active, router]);

  return null;
}
