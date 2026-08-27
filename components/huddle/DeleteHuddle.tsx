"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

/**
 * Deleting a huddle throws away a recording that already happened and can't be
 * re-recorded, so it is never one click: the icon opens a sheet that names the
 * huddle and says what goes with it.
 *
 * `icon` for the huddle list, `button` for the detail screen.
 */
export function DeleteHuddle({
  meetingId,
  title,
  dayLabel,
  variant = "icon",
  /** Detail screen: leave the page after deleting, there's nothing left. */
  redirectHome = false,
}: {
  meetingId: string;
  title: string;
  dayLabel: string;
  variant?: "icon" | "button";
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
      {variant === "icon" ? (
        <IconButton
          label={`Delete ${title}, ${dayLabel}`}
          onClick={() => setOpen(true)}
          className="hover:text-live"
        >
          <TrashGlyph />
        </IconButton>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen(true)}
          className="-ml-3 hover:text-live"
        >
          Delete this huddle
        </Button>
      )}

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

function TrashGlyph() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="size-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
      <path d="M5.5 5.5 6 16a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1l.5-10.5" />
      <path d="M8.5 8.5v5M11.5 8.5v5" />
    </svg>
  );
}
