"use client";

import type { ReactNode } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";

/**
 * The one gate in front of anything destructive. Built on Sheet so it inherits
 * the focus trap, Escape and scroll lock rather than growing a second set.
 *
 * §7 copy rules: the confirm button names the outcome ("Delete huddle"), never
 * "OK", so the last thing you read before pressing is what will happen.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  confirmLabel,
  busyLabel,
  busy,
  destructive = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  destructive?: boolean;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="text-ink-2">{children}</div>

      <div className="mt-5 flex gap-3">
        {/* Cancel first, and it takes focus when the sheet opens — the safe
            option should be the one an accidental Enter lands on. */}
        <Button
          variant="secondary"
          onClick={onClose}
          disabled={busy}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          variant={destructive ? "danger" : "primary"}
          onClick={onConfirm}
          busy={busy}
          className="flex-1"
        >
          {busy ? (busyLabel ?? "Deleting…") : confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
