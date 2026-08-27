"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

/**
 * Deleting a huddle throws away a recording that already happened and can't be
 * re-recorded, so it is never one click: the button opens a sheet that names
 * the huddle and says what goes with it.
 *
 * Only ever rendered on a huddle's own page. It used to also sit as an icon on
 * every row of the huddles list, which put a destructive control one stray tap
 * from the whole history — that variant is gone.
 */
export function DeleteHuddle({
  meetingId,
  title,
  dayLabel,
  /** Detail screen: leave the page after deleting, there's nothing left. */
  redirectHome = false,
}: {
  meetingId: string;
  title: string;
  dayLabel: string;
  redirectHome?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch(`/api/meetings/${meetingId}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Couldn't delete that huddle.");
      }

      setOpen(false);
      toast.show(`${title} deleted`, "ok");

      if (redirectHome) router.replace("/");
      router.refresh();
    } catch (caught) {
      toast.show(
        caught instanceof Error ? caught.message : "Couldn't delete that huddle.",
        "error",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="-ml-3 hover:text-live"
      >
        Delete this huddle
      </Button>

      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={() => void remove()}
        title="Delete this huddle?"
        confirmLabel="Delete huddle"
        busy={busy}
      >
        <p>
          <span className="text-ink">{title}</span> from {dayLabel} goes for
          good — the recording, the transcript, the notes and the PDF. This
          can&apos;t be undone.
        </p>
        <p className="mt-2 text-sm text-ink-3">
          Notes already emailed to the team stay in their inboxes.
        </p>
      </ConfirmDialog>
    </>
  );
}
