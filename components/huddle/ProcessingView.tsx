"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import type { ProcessingStage } from "@/lib/supabase/types";

const STAGE_COPY: Record<ProcessingStage, string> = {
  transcribing: "Transcribing…",
  writing_notes: "Writing notes…",
  making_pdf: "Making the PDF…",
};

const POLL_MS = 3_000;
const SLOW_AFTER_MS = 90_000;

/**
 * One honest line, no fake progress bar. There is nothing to measure — the
 * only truthful thing we can show is which stage the worker is in.
 */
export function ProcessingView({
  meetingId,
  stage,
}: {
  meetingId: string;
  stage: ProcessingStage | null;
}) {
  const router = useRouter();
  const [currentStage, setCurrentStage] = useState<ProcessingStage | null>(stage);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => window.clearTimeout(slowTimer);
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const poll = async () => {
      const { data } = await supabase
        .from("meetings")
        .select("status, processing_stage")
        .eq("id", meetingId)
        .maybeSingle();

      if (cancelled || !data) return;

      if (data.status === "processing" || data.status === "uploading") {
        setCurrentStage(data.processing_stage);
        return;
      }

      window.clearInterval(timer);
      router.refresh();
    };

    const timer = window.setInterval(poll, POLL_MS);
    void poll();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [meetingId, router]);

  return (
    <Card padding="loose">
      <p aria-live="polite" className="flex items-center gap-3 text-ink">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-full bg-paper-sunk"
        >
          <span className="live-dot block size-2 rounded-full bg-ink-3" />
        </span>
        {currentStage ? STAGE_COPY[currentStage] : "Getting the audio ready…"}
      </p>
      {slow && (
        <p className="mt-2 text-sm text-ink-3">
          Longer huddles take a bit more time.
        </p>
      )}
      <p className="mt-4 text-sm text-ink-2">
        You can close this — the notes will be here when it&apos;s done.
      </p>
    </Card>
  );
}
