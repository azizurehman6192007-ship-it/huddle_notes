"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

type Action = "wrap" | "retry" | "regenerate";

const COPY: Record<Action, { idle: string; busy: string; endpoint: string }> = {
  // Salvage a huddle whose recording screen was reloaded away.
  wrap: { idle: "Wrap it up", busy: "Wrapping up…", endpoint: "finalize" },
  retry: { idle: "Retry this huddle", busy: "Retrying…", endpoint: "retry" },
  // An older huddle that has a transcript but never got notes. The worker
  // resumes from the transcript, so this costs no transcription.
  regenerate: {
    idle: "Generate notes from this transcript",
    busy: "Generating…",
    endpoint: "retry",
  },
};

export function MeetingActions({
  meetingId,
  action,
}: {
  meetingId: string;
  action: Action;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const copy = COPY[action];

  async function run() {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/meetings/${meetingId}/${copy.endpoint}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        discarded?: boolean;
        reason?: string;
      };

      if (!response.ok) throw new Error(payload.error ?? "That didn't work.");

      if (payload.discarded) {
        toast.show(
          payload.reason ?? "Nothing was recorded, so that huddle wasn't saved.",
        );
        router.replace("/");
      }

      router.refresh();
    } catch (caught) {
      toast.show(
        caught instanceof Error ? caught.message : "That didn't work.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant="primary"
      busy={busy}
      onClick={() => void run()}
      className="mt-5"
    >
      {busy ? copy.busy : copy.idle}
    </Button>
  );
}
