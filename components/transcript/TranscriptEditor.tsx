"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

/**
 * The transcript is the ground truth every downstream artefact is built from,
 * and Whisper reliably mangles proper nouns — "Bilal" comes back as "Billall"
 * often enough that the lead needs to be able to fix it.
 *
 * Unlike the notes fields (§8D: click, blur saves), this is an explicit
 * edit/save/cancel. A blur-saves textarea holding twelve minutes of speech
 * turns a mis-click into silent data loss, and there's no undo behind it.
 *
 * Regenerating notes from a corrected transcript is the existing "regenerate"
 * action — this only persists the text.
 */
export function TranscriptEditor({
  meetingId,
  transcript,
  /** Nothing to correct until the worker has produced one. */
  editable,
  placeholder,
}: {
  meetingId: string;
  transcript: string | null;
  editable: boolean;
  placeholder: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [saved, setSaved] = useState(transcript ?? "");
  const [draft, setDraft] = useState(transcript ?? "");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // A refresh after the worker finishes must not be overwritten by stale
  // local state — but never clobber an edit in progress.
  useEffect(() => {
    if (editing) return;
    setSaved(transcript ?? "");
    setDraft(transcript ?? "");
  }, [transcript, editing]);

  useEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editing]);

  const wordCount = saved.trim() ? saved.trim().split(/\s+/).length : 0;
  const dirty = draft.trim() !== saved.trim();

  async function save() {
    const next = draft.trim();

    if (!next) {
      toast.show("A transcript can't be empty. Cancel instead.", "error");
      return;
    }
    if (!dirty) {
      setEditing(false);
      return;
    }

    setBusy(true);
    const { error } = await supabase
      .from("meetings")
      .update({ transcript: next })
      .eq("id", meetingId);
    setBusy(false);

    if (error) {
      toast.show("Couldn't save the transcript. Try again.", "error");
      return;
    }

    setSaved(next);
    setEditing(false);
    toast.show("Transcript saved", "ok");
    router.refresh();
  }

  function cancel() {
    setDraft(saved);
    setEditing(false);
  }

  return (
    <section>
      <CardLabel
        trailing={
          <span className="flex items-center gap-3">
            {wordCount > 0 && (
              <span className="font-mono text-xs text-ink-3">
                {wordCount} words
              </span>
            )}
            {editable && !editing && (
              <Button
                variant="ghost"
                size="sm"
                className="-mr-3"
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            )}
          </span>
        }
      >
        Transcript
      </CardLabel>

      <Card padding="loose">
        {editing ? (
          <div className="flex flex-col gap-4">
            <textarea
              ref={fieldRef}
              aria-label="Transcript"
              value={draft}
              rows={14}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancel();
              }}
              className="w-full resize-y rounded-[var(--radius)] border border-hairline bg-paper-sunk p-3 leading-relaxed text-ink outline-none focus:border-amber focus:ring-1 focus:ring-amber"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" busy={busy} onClick={() => void save()}>
                {busy ? "Saving…" : "Save transcript"}
              </Button>
              <Button variant="secondary" disabled={busy} onClick={cancel}>
                Cancel
              </Button>
              <p className="text-sm text-ink-3">
                Fixing a name here won&apos;t rewrite the notes above — use
                &ldquo;generate notes from this transcript&rdquo; for that.
              </p>
            </div>
          </div>
        ) : saved.trim() ? (
          <p className="whitespace-pre-wrap text-ink">{saved}</p>
        ) : (
          <p className="text-ink-2">{placeholder}</p>
        )}
      </Card>
    </section>
  );
}
