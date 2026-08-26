"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Ledger } from "@/components/ledger/Ledger";
import { EditableText } from "@/components/notes/EditableText";
import { SendSheet, type Recipient } from "@/components/notes/SendSheet";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel, CardList } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { createClient } from "@/lib/supabase/client";
import { cx } from "@/lib/util/cx";
import { formatDayLabel, parseDateOnly } from "@/lib/util/format";
import type { Notes } from "@/lib/ai/schema";
import type { ActionItemRow, MeetingStatus } from "@/lib/supabase/types";

export interface ActionItemView {
  id: string;
  task: string;
  dueDate: string | null;
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

    if (error) toast.show("Couldn't save that edit. Try again.", "error");
  }

  async function patchItem(id: string, patch: Partial<ActionItemView>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );

    const payload: Partial<ActionItemRow> = {};
    if (patch.task !== undefined) payload.task = patch.task;
    if (patch.dueDate !== undefined) payload.due_date = patch.dueDate;
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

    await supabase
      .from("meetings")
      .update({ notes_edited: true })
      .eq("id", props.meetingId);
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
        error?: string;
      };

      if (!response.ok) throw new Error(payload.error ?? "Couldn't send the notes.");

      setSheetOpen(false);

      if (payload.failed?.length) {
        toast.show(
          `Notes sent, but ${payload.failed.join(", ")} didn't go through.`,
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

  const people = useMemo(() => buildPeople(notes), [notes]);
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

      {/* ---------------------------------------------------------- summary */}
      <section>
        <CardLabel>Summary</CardLabel>
        <Card padding="base">
          <EditableText
            value={notes.summary}
            ariaLabel="Summary"
            multiline
            placeholder="Add a summary"
            className="text-base leading-relaxed"
            onSave={(summary) => persistNotes({ ...notes, summary })}
          />
        </Card>
      </section>

      {/* ----------------------------------------------- the ledger, mode 3 */}
      <section>
        <CardLabel>What everyone said</CardLabel>
        <Ledger
          mode="notes"
          people={people.map((person) => ({ key: person.key, name: person.name }))}
          renderPerson={(key) => {
            const person = people.find((candidate) => candidate.key === key);
            if (!person) return null;

            return (
              <dl className="flex flex-col gap-1">
                {person.rows.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-col gap-0.5 sm:flex-row sm:gap-2"
                  >
                    <dt
                      className={cx(
                        "shrink-0 font-mono text-xs sm:w-[76px] sm:pt-1.5",
                        row.emphasis ? "text-amber" : "text-ink-3",
                      )}
                    >
                      {row.label}
                    </dt>
                    <dd className="min-w-0 flex-1 text-sm">
                      <EditableText
                        value={row.text}
                        ariaLabel={`${person.name}, ${row.label}`}
                        multiline
                        onSave={(text) =>
                          persistNotes(applyRowEdit(notes, row.path, text))
                        }
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            );
          }}
        />
      </section>

      {/* ----------------------------------------------------- action items */}
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
          Action items
        </CardLabel>

        {items.length === 0 ? (
          <Card padding="base">
            <p className="text-sm text-ink-2">
              No action items came out of this huddle.
            </p>
          </Card>
        ) : (
          <CardList as="ul">
            {items.map((item, index) => (
              <li
                key={item.id}
                style={{ "--i": index } as React.CSSProperties}
                className="stagger-in border-b border-hairline p-4 last:border-b-0 sm:px-5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label={`Owner for: ${item.task}`}
                    value={item.ownerMemberId ?? ""}
                    onChange={(event) =>
                      void patchItem(item.id, {
                        ownerMemberId: event.target.value || null,
                      })
                    }
                    className={cx(
                      "h-8 rounded-[var(--radius)] border px-2 text-sm",
                      item.ownerMemberId
                        ? "border-hairline bg-paper-raised text-ink"
                        : "border-amber bg-amber-soft text-amber",
                    )}
                  >
                    <option value="">
                      {item.ownerNameRaw
                        ? `? ${item.ownerNameRaw}`
                        : "? Unassigned"}
                    </option>
                    {props.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>

                  <input
                    type="date"
                    aria-label={`Due date for: ${item.task}`}
                    value={item.dueDate ?? ""}
                    onChange={(event) =>
                      void patchItem(item.id, {
                        dueDate: event.target.value || null,
                      })
                    }
                    className="h-8 rounded-[var(--radius)] border border-hairline bg-paper-raised px-2 font-mono text-xs text-ink-2"
                  />

                  {item.dueDate && (
                    <span className="font-mono text-xs text-ink-3">
                      {formatDayLabel(parseDateOnly(item.dueDate))}
                    </span>
                  )}
                </div>

                <EditableText
                  value={item.task}
                  ariaLabel="Task"
                  multiline
                  className="mt-1 text-sm"
                  onSave={(task) => void patchItem(item.id, { task })}
                />
              </li>
            ))}
          </CardList>
        )}
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
                      return persistNotes({ ...notes, [key]: list });
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
          onClick={() => window.open(`/api/meetings/${props.meetingId}/pdf`, "_blank")}
          className="sm:flex-1"
        >
          View PDF
        </Button>
        <Button
          variant="primary"
          size="lg"
          disabled={!props.emailConfigured}
          onClick={() => setSheetOpen(true)}
          className="sm:flex-[2]"
        >
          {sent
            ? "Send again"
            : `Send to ${props.recipients.length} ${props.recipients.length === 1 ? "person" : "people"}`}
        </Button>
      </div>

      {!props.emailConfigured && (
        <p className="-mt-4 text-sm text-ink-3">
          Sending is off until RESEND_API_KEY and EMAIL_FROM are set. The PDF
          works either way.
        </p>
      )}

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

interface PersonRow {
  id: string;
  label: string;
  text: string;
  emphasis?: boolean;
  path: RowPath;
}

type RowPath =
  | { kind: "update"; person: string; field: "yesterday" | "today" }
  | { kind: "blocker"; person: string; field: "issue" | "needs" };

/** Collapses updates and blockers into one row list per person. */
function buildPeople(notes: Notes) {
  const order: string[] = [];
  const rows = new Map<string, PersonRow[]>();

  const push = (person: string, row: PersonRow) => {
    if (!rows.has(person)) {
      rows.set(person, []);
      order.push(person);
    }
    rows.get(person)!.push(row);
  };

  for (const update of notes.updates) {
    if (update.yesterday.length) {
      push(update.person, {
        id: `${update.person}-yesterday`,
        label: "Yesterday",
        text: update.yesterday.join(" "),
        path: { kind: "update", person: update.person, field: "yesterday" },
      });
    }
    if (update.today.length) {
      push(update.person, {
        id: `${update.person}-today`,
        label: "Today",
        text: update.today.join(" "),
        path: { kind: "update", person: update.person, field: "today" },
      });
    }
  }

  for (const blocker of notes.blockers) {
    push(blocker.person, {
      id: `${blocker.person}-blocker`,
      label: "Blocker",
      text: blocker.issue,
      emphasis: true,
      path: { kind: "blocker", person: blocker.person, field: "issue" },
    });
    if (blocker.needs) {
      push(blocker.person, {
        id: `${blocker.person}-needs`,
        label: "Needs",
        text: blocker.needs,
        emphasis: true,
        path: { kind: "blocker", person: blocker.person, field: "needs" },
      });
    }
  }

  return order.map((person) => ({
    key: person,
    name: person,
    rows: rows.get(person) ?? [],
  }));
}

/** Writes an edited row back into notes_json without mutating the original. */
function applyRowEdit(notes: Notes, path: RowPath, text: string): Notes {
  if (path.kind === "update") {
    return {
      ...notes,
      updates: notes.updates.map((update) =>
        update.person === path.person
          ? { ...update, [path.field]: text ? [text] : [] }
          : update,
      ),
    };
  }

  return {
    ...notes,
    blockers: notes.blockers.map((blocker) =>
      blocker.person === path.person
        ? {
            ...blocker,
            ...(path.field === "issue"
              ? { issue: text }
              : { needs: text || null }),
          }
        : blocker,
    ),
  };
}
