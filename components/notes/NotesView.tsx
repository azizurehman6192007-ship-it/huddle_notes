"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EditableText } from "@/components/notes/EditableText";
import { SendSheet, type Recipient } from "@/components/notes/SendSheet";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, CardLabel, CardList } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { cx } from "@/lib/util/cx";
import { matchOwner } from "@/lib/notes/match";
import type { Notes } from "@/lib/ai/schema";
import type { ActionItemRow, MeetingStatus } from "@/lib/supabase/types";

export interface ActionItemView {
  id: string;
  task: string;
  ownerMemberId: string | null;
  ownerNameRaw: string | null;
}

export interface NotesViewProps {
  meetingId: string;
  status: MeetingStatus;
  notes: Notes;
  actionItems: ActionItemView[];
  members: { id: string; name: string }[];
  recipients: Recipient[];
  emailConfigured: boolean;
  /** Names only, never values — safe to render. */
  emailProblems: string[];
  sentCount: number | null;
}

export function NotesView(props: NotesViewProps) {
  const router = useRouter();
  const toast = useToast();
  const supabase = useMemo(() => createClient(), []);

  const [notes, setNotes] = useState<Notes>(props.notes);
  const [items, setItems] = useState<ActionItemView[]>(props.actionItems);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sending, setSending] = useState(false);
  /** The item awaiting confirmation, so the sheet can name it. */
  const [pendingDelete, setPendingDelete] = useState<ActionItemView | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);

  const sent = props.status === "sent";

  /**
   * Any edit sets notes_edited. The share of huddles sent unedited is the
   * core quality metric, so this flag must never be set by anything but a
   * human touching the text.
   */
  async function persistNotes(next: Notes) {
    setNotes(next);
    const { error } = await supabase
      .from("meetings")
      .update({ notes_json: next, notes_edited: true })
      .eq("id", props.meetingId);

    if (error) {
      toast.show("Couldn't save that edit. Try again.", "error");
      return false;
    }
    return true;
  }

  async function patchItem(id: string, patch: Partial<ActionItemView>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );

    const payload: Partial<ActionItemRow> = {};
    if (patch.task !== undefined) payload.task = patch.task;
    if (patch.ownerMemberId !== undefined) {
      payload.owner_member_id = patch.ownerMemberId;
      // A human assigned it, so it is no longer a guess.
      payload.owner_confidence = patch.ownerMemberId ? "high" : "low";
    }

    const { error } = await supabase
      .from("action_items")
      .update(payload)
      .eq("id", id);

    if (error) {
      toast.show("Couldn't save that. Try again.", "error");
      return;
    }

    await markEdited();
  }

  /** Marks the huddle as touched by a human. See persistNotes. */
  async function markEdited() {
    await supabase
      .from("meetings")
      .update({ notes_edited: true })
      .eq("id", props.meetingId);
  }

  async function deleteItem(target: ActionItemView) {
    setDeletingItem(true);
    const { error } = await supabase
      .from("action_items")
      .delete()
      .eq("id", target.id);
    setDeletingItem(false);

    if (error) {
      toast.show("Couldn't remove that item. Try again.", "error");
      return;
    }

    setItems((current) => current.filter((item) => item.id !== target.id));
    setPendingDelete(null);
    toast.show("Action item removed", "ok");
    await markEdited();
  }

  async function send() {
    setSending(true);
    try {
      const response = await fetch(`/api/meetings/${props.meetingId}/send`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        sent?: number;
        failed?: string[];
        reason?: string | null;
        error?: string;
      };

      if (!response.ok) throw new Error(payload.error ?? "Couldn't send the notes.");

      // Nothing got through. This used to say "Notes sent" with a footnote,
      // which read as success — the huddle stays a draft, so it is not.
      if (!payload.sent) {
        throw new Error(
          payload.reason
            ? `Couldn't send the notes: ${payload.reason}`
            : "Couldn't send the notes to anyone. Check the recipient addresses.",
        );
      }

      setSheetOpen(false);

      if (payload.failed?.length) {
        toast.show(
          `Sent to ${payload.sent}, but ${payload.failed.join(", ")} didn't go through.`,
          "error",
        );
      } else {
        toast.show("Notes sent", "ok");
      }

      router.refresh();
    } catch (caught) {
      toast.show(
        caught instanceof Error ? caught.message : "Couldn't send the notes.",
        "error",
      );
    } finally {
      setSending(false);
    }
  }

  const unassignedCount = items.filter((item) => !item.ownerMemberId).length;

  return (
    <div className="flex flex-col gap-8">
      <span
        className={cx(
          "inline-flex h-7 w-fit items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
          sent
            ? "border-hairline text-ink-3"
            : "border-transparent bg-amber-soft text-amber",
        )}
      >
        <span
          aria-hidden
          className={cx("size-1.5 rounded-full", sent ? "bg-ok" : "bg-amber")}
        />
        {sent
          ? `Sent to ${props.sentCount ?? props.recipients.length} ${(props.sentCount ?? props.recipients.length) === 1 ? "person" : "people"}`
          : "Draft — not sent yet"}
      </span>

      {/* ------------------------------------ summary + action items, one box */}
      <section>
        <CardLabel
          trailing={
            unassignedCount > 0 ? (
              <span className="inline-flex h-6 items-center rounded-full bg-amber-soft px-2 text-xs font-medium text-amber">
                {unassignedCount} need{unassignedCount === 1 ? "s" : ""} an owner
              </span>
            ) : undefined
          }
        >
          Notes
        </CardLabel>

        <Card padding="loose" className="flex flex-col gap-6">
          <SummaryBlock
            value={notes.summary}
            onSave={(summary) => persistNotes({ ...notes, summary })}
          />

          <div className="border-t border-hairline" />

          <div>
            <h3 className="eyebrow mb-3">Action items</h3>

            {items.length === 0 ? (
              <p className="text-sm text-ink-2">
                No action items came out of this huddle.
              </p>
            ) : (
              <ul className="-mx-1">
                {items.map((item, index) => (
                  <li
                    key={item.id}
                    style={{ "--i": index } as React.CSSProperties}
                    className="stagger-in border-b border-hairline px-1 py-3 first:pt-0 last:border-b-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Unassigned reads as a normal dropdown with an amber
                          edge — it needs attention, it is not an error. The
                          old "? samra" put the model's raw guess inside the
                          control, which looked like corrupted data. */}
                      <select
                        aria-label={`Owner for: ${item.task}`}
                        value={item.ownerMemberId ?? ""}
                        onChange={(event) =>
                          void patchItem(item.id, {
                            ownerMemberId: event.target.value || null,
                          })
                        }
                        className={cx(
                          "h-8 rounded-[var(--radius)] border bg-paper-raised px-2 text-sm text-ink",
                          item.ownerMemberId
                            ? "border-hairline"
                            : "border-amber ring-1 ring-amber/30",
                        )}
                      >
                        <option value="">Unassigned</option>
                        {props.members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                      </select>

                      <OwnerHint
                        item={item}
                        members={props.members}
                        onAssign={(memberId) =>
                          void patchItem(item.id, { ownerMemberId: memberId })
                        }
                      />
                    </div>

                    <div className="mt-1 flex items-start gap-1">
                      <div className="min-w-0 flex-1">
                        <EditableText
                          value={item.task}
                          ariaLabel="Task"
                          multiline
                          className="text-sm"
                          onSave={(task) => void patchItem(item.id, { task })}
                        />
                      </div>
                      <IconButton
                        label={`Remove action item: ${item.task}`}
                        onClick={() => setPendingDelete(item)}
                        className="-mr-1 size-8 hover:text-live"
                      >
                        <span aria-hidden className="text-lg leading-none">
                          ×
                        </span>
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}

          </div>
        </Card>
      </section>

      {/* ------------------------------------------ decisions and questions */}
      {(["decisions", "open_questions"] as const).map((key) =>
        notes[key].length === 0 ? null : (
          <section key={key}>
            <CardLabel>
              {key === "decisions" ? "Decisions" : "Open questions"}
            </CardLabel>
            <CardList as="ul">
              {notes[key].map((entry, index) => (
                <li
                  key={`${key}-${index}`}
                  className="border-b border-hairline p-3 text-sm last:border-b-0 sm:px-4"
                >
                  <EditableText
                    value={entry}
                    ariaLabel={key === "decisions" ? "Decision" : "Open question"}
                    multiline
                    onSave={(next) => {
                      const list = [...notes[key]];
                      if (next) list[index] = next;
                      else list.splice(index, 1);
                      void persistNotes({ ...notes, [key]: list });
                    }}
                  />
                </li>
              ))}
            </CardList>
          </section>
        ),
      )}

      {/* ------------------------------------------------------------ send */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => {
            // The route replies with `content-disposition: attachment`, so the
            // browser saves the file and stays on this page.
            window.location.assign(`/api/meetings/${props.meetingId}/pdf`);
          }}
          className="sm:flex-1"
        >
          Download PDF
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={!props.emailConfigured}
          onClick={() => setSheetOpen(true)}
          className="sm:flex-[2]"
        >
          Send
        </Button>
      </div>

      {props.emailProblems.length > 0 && (
        <div className="-mt-4 text-sm text-ink-3">
          <p>
            {props.emailConfigured
              ? "Sending is on, but something looks off:"
              : "Sending is off. On this deployment:"}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {props.emailProblems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
          {!props.emailConfigured && (
            <p className="mt-1">
              Set them for this environment and redeploy. The PDF works either
              way.
            </p>
          )}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => pendingDelete && void deleteItem(pendingDelete)}
        title="Remove this action item?"
        confirmLabel="Remove item"
        busyLabel="Removing…"
        busy={deletingItem}
      >
        <p>
          <span className="text-ink">{pendingDelete?.task}</span> comes off
          these notes and won&apos;t be in the email.
        </p>
      </ConfirmDialog>

      <SendSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onConfirm={() => void send()}
        recipients={props.recipients}
        busy={sending}
        alreadySent={sent}
      />
    </div>
  );
}

/**
 * What the transcript said, when nobody is assigned yet.
 *
 * The roster can grow after a huddle is processed, so the match is re-run
 * against the current members rather than trusting the one made at write time
 * — a person added this morning becomes a one-tap assign instead of staying
 * stuck as a raw string forever.
 */
function OwnerHint({
  item,
  members,
  onAssign,
}: {
  item: ActionItemView;
  members: { id: string; name: string }[];
  onAssign: (memberId: string) => void;
}) {
  if (item.ownerMemberId) return null;

  const raw = item.ownerNameRaw?.trim();
  if (!raw) {
    return <span className="text-xs text-amber">Needs an owner</span>;
  }

  const suggestedId = matchOwner(raw, members).memberId;
  const suggested = members.find((member) => member.id === suggestedId);

  if (suggested) {
    return (
      <Button
        variant="tonal"
        size="sm"
        className="h-8"
        onClick={() => onAssign(suggested.id)}
      >
        Assign to {suggested.name}
      </Button>
    );
  }

  return (
    <span className="text-xs text-ink-3">
      Transcript said &ldquo;{raw}&rdquo;
    </span>
  );
}

/**
 * The summary, on the transcript editor's pattern: an explicit Edit → Save /
 * Cancel rather than the click-and-blur used for the short fields around it.
 * The summary is the first thing in the email and the PDF, so a mis-click
 * losing it silently is worse here than one extra tap.
 */
function SummaryBlock({
  value,
  onSave,
}: {
  value: string;
  onSave: (next: string) => Promise<boolean>;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  // A refresh must not overwrite an edit in progress.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    const field = fieldRef.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [editing]);

  async function commit() {
    const next = draft.trim();
    if (next === value.trim()) {
      setEditing(false);
      return;
    }

    setBusy(true);
    const ok = await onSave(next);
    setBusy(false);
    if (ok) {
      setEditing(false);
      toast.show("Summary saved", "ok");
    }
  }

  async function clear() {
    setBusy(true);
    const ok = await onSave("");
    setBusy(false);
    if (ok) {
      setConfirmClear(false);
      setEditing(false);
      toast.show("Summary deleted", "ok");
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="eyebrow">Summary</h3>
        {!editing && (
          <span className="-mr-2 flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              {value.trim() ? "Edit" : "Add"}
            </Button>
            {value.trim() && (
              <Button
                variant="ghost"
                size="sm"
                className="hover:text-live"
                onClick={() => setConfirmClear(true)}
              >
                Delete
              </Button>
            )}
          </span>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3">
          <textarea
            ref={fieldRef}
            aria-label="Summary"
            value={draft}
            rows={4}
            placeholder="Two sentences on where the team is."
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setDraft(value);
                setEditing(false);
              }
            }}
            className="w-full resize-y rounded-[var(--radius)] border border-hairline bg-paper-sunk p-3 leading-relaxed text-ink outline-none focus:border-amber focus:ring-1 focus:ring-amber"
          />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" busy={busy} onClick={() => void commit()}>
              {busy ? "Saving…" : "Save summary"}
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : value.trim() ? (
        <p className="whitespace-pre-wrap leading-relaxed text-ink">{value}</p>
      ) : (
        <p className="text-ink-3 italic">No summary on this huddle.</p>
      )}

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={() => void clear()}
        title="Delete the summary?"
        confirmLabel="Delete summary"
        busy={busy}
      >
        <p>
          The summary is the first thing people read in the email and the PDF.
          Deleting it leaves those starting at the action items.
        </p>
        <p className="mt-2 text-sm text-ink-3">
          The transcript is untouched — you can write a new one any time.
        </p>
      </ConfirmDialog>
    </div>
  );
}
