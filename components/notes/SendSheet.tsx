"use client";

import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";

export interface Recipient {
  id: string;
  name: string;
  email: string;
}

/**
 * §8D: the confirm sheet lists the actual recipients. Nobody should ever be
 * surprised by who got the email, so this shows addresses, not a count.
 */
export function SendSheet({
  open,
  onClose,
  onConfirm,
  recipients,
  busy,
  alreadySent,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  recipients: Recipient[];
  busy: boolean;
  alreadySent: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Send these notes">
      {recipients.length === 0 ? (
        <>
          <p className="text-ink-2">
            Nobody on the team is set to receive notes yet. Turn that on for at
            least one person on the team screen.
          </p>
          <Button variant="secondary" onClick={onClose} className="mt-4 w-full">
            Close
          </Button>
        </>
      ) : (
        <>
          <p className="text-ink-2">
            {alreadySent
              ? "These notes have already gone out once. Sending again will deliver a fresh copy to everyone below."
              : `The notes and a PDF go to ${recipients.length} ${recipients.length === 1 ? "person" : "people"}:`}
          </p>

          <ul className="mt-4 max-h-56 overflow-y-auto rounded-[var(--radius)] border border-hairline">
            {recipients.map((recipient) => (
              <li
                key={recipient.id}
                className="flex items-baseline justify-between gap-3 border-b border-hairline px-3.5 py-2.5 last:border-b-0"
              >
                <span className="truncate text-ink">{recipient.name}</span>
                <span className="shrink-0 truncate font-mono text-xs text-ink-3">
                  {recipient.email}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-4 flex gap-3">
            <Button variant="secondary" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onConfirm}
              busy={busy}
              className="flex-1"
            >
              {busy ? "Sending…" : "Send notes"}
            </Button>
          </div>
        </>
      )}
    </Sheet>
  );
}
