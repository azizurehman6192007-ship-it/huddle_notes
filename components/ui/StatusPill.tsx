import { cx } from "@/lib/util/cx";
import type { MeetingStatus } from "@/lib/supabase/types";

/**
 * Material assist chip. Amber means "this is happening now, or it needs you",
 * so `draft` is the only status that gets a tonal fill — everything else is
 * quiet by design.
 */
const LOOK: Record<
  MeetingStatus,
  { label: string; dot: string; chip: string }
> = {
  recording: {
    label: "Recording",
    dot: "bg-live live-dot",
    chip: "text-ink-2 border-hairline",
  },
  uploading: {
    label: "Uploading",
    dot: "bg-ink-3",
    chip: "text-ink-2 border-hairline",
  },
  processing: {
    label: "Processing",
    dot: "bg-ink-3 live-dot",
    chip: "text-ink-2 border-hairline",
  },
  draft: {
    // "Transcribed" says what happened to the recording. Whether the notes
    // have been sent is a separate idea, and it lives on the huddle's own
    // page as "Draft — not sent yet".
    label: "Transcribed",
    dot: "bg-amber",
    chip: "text-amber border-transparent bg-amber-soft",
  },
  sent: { label: "Sent", dot: "bg-ok", chip: "text-ink-3 border-hairline" },
  empty: {
    label: "Empty",
    dot: "bg-ink-3",
    chip: "text-ink-3 border-hairline",
  },
  failed: {
    label: "Failed",
    dot: "bg-live",
    chip: "text-live border-live/30",
  },
};

export function StatusPill({
  status,
  className,
}: {
  status: MeetingStatus;
  className?: string;
}) {
  const look = LOOK[status];

  return (
    <span
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5",
        "text-xs font-medium whitespace-nowrap",
        look.chip,
        className,
      )}
    >
      <span
        aria-hidden
        className={cx("size-1.5 shrink-0 rounded-full", look.dot)}
      />
      {look.label}
    </span>
  );
}
