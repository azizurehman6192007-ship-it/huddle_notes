"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { parseRoster, nameFromEmail, type RosterEntry } from "@/lib/team/roster";
import { Card, CardLabel, CardList } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EditableText } from "@/components/notes/EditableText";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/lib/util/cx";
import { LedgerRow } from "@/components/ledger/LedgerRow";
import type { MemberRow, TeamRow } from "@/lib/supabase/types";

/**
 * Deliberately boring — it is visited twice ever. The only thing that has to
 * be right is that the roster matches the room, because notes need names.
 */
export function TeamManager({
  team,
  members,
  isLead,
  signedInEmail,
}: {
  team: TeamRow;
  members: MemberRow[];
  isLead: boolean;
  signedInEmail: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Parsed as you type, so the button can say how many will actually land.
  const parsedBulk = useMemo(() => parseRoster(bulkText), [bulkText]);
  /** The member awaiting confirmation, so the sheet can name them. */
  const [pendingRemove, setPendingRemove] = useState<MemberRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const supabase = createClient();

  function refresh() {
    startTransition(() => router.refresh());
  }

  interface CommitResult {
    added: number;
    restored: number;
    /** Already on the team and active — not an error, just nothing to do. */
    skipped: string[];
  }

  /**
   * The one path into `members`, shared by the single form and the bulk field,
   * so both behave identically about duplicates and previously-removed people.
   *
   * Removal is a soft delete (`active = false`), so re-adding that address
   * would collide with `unique (team_id, email)`. Reactivating instead is what
   * the remove confirmation already promises ("adding them again later
   * restores them"), and it keeps their past action items attached.
   */
  async function commitMembers(entries: RosterEntry[]): Promise<CommitResult | null> {
    const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m]));

    const fresh: RosterEntry[] = [];
    const restore: string[] = [];
    const skipped: string[] = [];

    for (const entry of entries) {
      const existing = byEmail.get(entry.email);
      if (!existing) fresh.push(entry);
      else if (existing.active) skipped.push(entry.email);
      // Keep the name they already had — it is what past huddles attribute to.
      else restore.push(existing.id);
    }

    if (restore.length > 0) {
      const { error } = await supabase
        .from("members")
        .update({ active: true })
        .in("id", restore);
      if (error) return null;
    }

    if (fresh.length > 0) {
      const { error } = await supabase.from("members").insert(
        fresh.map((entry) => ({
          team_id: team.id,
          name: entry.name,
          email: entry.email,
        })),
      );
      if (error) return null;
    }

    return { added: fresh.length, restored: restore.length, skipped };
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    setAddError(null);

    const cleanEmail = email.trim().toLowerCase();
    // Name is optional here now: the bulk field derives one, and it would be
    // odd for the single form to be stricter than pasting the same address.
    const cleanName = name.trim() || nameFromEmail(cleanEmail);

    if (!cleanEmail.includes("@")) {
      return setAddError("That doesn't look like an email address.");
    }
    if (members.some((m) => m.active && m.email.toLowerCase() === cleanEmail)) {
      return setAddError(`${cleanEmail} is already on the team.`);
    }

    setAdding(true);
    const result = await commitMembers([{ name: cleanName, email: cleanEmail }]);
    setAdding(false);

    if (!result) {
      setAddError("Couldn't add them. Try again in a moment.");
      return;
    }

    setName("");
    setEmail("");
    toast.show(
      result.restored > 0 ? `${cleanName} is back on the team` : `${cleanName} added`,
      "ok",
    );
    refresh();
  }

  async function addBulk(event: React.FormEvent) {
    event.preventDefault();
    setBulkError(null);

    const { entries, invalid } = parseRoster(bulkText);

    if (entries.length === 0) {
      setBulkError(
        invalid.length > 0
          ? `Nothing there looked like an email address. Check: ${invalid.slice(0, 3).join(", ")}`
          : "Paste the email addresses, one per line or separated by commas.",
      );
      return;
    }

    setBulkBusy(true);
    const result = await commitMembers(entries);
    setBulkBusy(false);

    if (!result) {
      setBulkError("Couldn't add them. Try again in a moment.");
      return;
    }

    setBulkText("");

    // Say exactly what happened to every address that was pasted — a silent
    // partial success is how someone ends up missing from the notes.
    const done = result.added + result.restored;
    const parts: string[] = [];
    if (done > 0) parts.push(`${done} ${done === 1 ? "person" : "people"} added`);
    if (result.skipped.length > 0) {
      parts.push(`${result.skipped.length} already on the team`);
    }
    if (invalid.length > 0) {
      parts.push(`${invalid.length} not an email address`);
    }

    toast.show(parts.join(" · ") || "Nothing to add", done > 0 ? "ok" : "neutral");

    if (invalid.length > 0) {
      setBulkError(`Skipped, not an email address: ${invalid.join(", ")}`);
      setBulkText(invalid.join("\n"));
    }

    refresh();
  }

  async function toggleReceivesNotes(target: MemberRow) {
    const { error } = await supabase
      .from("members")
      .update({ receives_notes: !target.receives_notes })
      .eq("id", target.id);

    if (error) {
      toast.show("Couldn't save that. Try again.", "error");
      return;
    }
    refresh();
  }

  /**
   * Name and email are both editable after setup — a typo in an address means
   * that person silently never gets the notes, and a wrong name is what the
   * owner matcher tries to match action items against.
   */
  async function editMember(target: MemberRow, patch: Partial<MemberRow>) {
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) {
        toast.show("A name is needed — it appears in the notes.", "error");
        return;
      }
      patch = { ...patch, name };
    }

    if (patch.email !== undefined) {
      const email = patch.email.trim().toLowerCase();
      if (!email.includes("@")) {
        toast.show("That doesn't look like an email address.", "error");
        return;
      }
      if (
        members.some(
          (m) => m.id !== target.id && m.email.toLowerCase() === email,
        )
      ) {
        toast.show(`${email} is already on the team.`, "error");
        return;
      }
      patch = { ...patch, email };
    }

    const { error } = await supabase
      .from("members")
      .update(patch)
      .eq("id", target.id);

    if (error) {
      toast.show("Couldn't save that. Try again.", "error");
      return;
    }

    toast.show("Saved", "ok");
    refresh();
  }

  /**
   * Deactivated, not deleted: action items and speaker segments point at this
   * row, and hard-deleting would orphan the history of every past huddle.
   */
  async function removeMember(target: MemberRow) {
    setRemoving(true);
    const { error } = await supabase
      .from("members")
      .update({ active: false })
      .eq("id", target.id);
    setRemoving(false);

    if (error) {
      toast.show("Couldn't remove them. Try again.", "error");
      return;
    }

    setPendingRemove(null);
    toast.show(`${target.name} removed`, "ok");
    refresh();
  }

  const activeMembers = members.filter((member) => member.active);

  return (
    <div className="mt-8 flex flex-col gap-10">
      <section>
        <CardLabel>People</CardLabel>

        {activeMembers.length === 0 ? (
          <Card padding="loose">
            <p className="text-ink-2">
              No one here yet. Add the people who join the huddle.
            </p>
          </Card>
        ) : (
          <CardList as="ul">
            {activeMembers.map((member) => (
              <li key={member.id}>
                {/* The lead edits in place, as on the notes screen: click the
                    text, blur saves. Everyone else reads the same rows. */}
                <LedgerRow
                  name={
                    isLead ? (
                      <span className="-ml-2 block">
                        <EditableText
                          value={member.name}
                          ariaLabel={`Name for ${member.name}`}
                          placeholder="Add a name"
                          className="font-display text-base"
                          onSave={(name) => void editMember(member, { name })}
                        />
                      </span>
                    ) : (
                      member.name
                    )
                  }
                >
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                    {isLead ? (
                      <span className="-ml-2 min-w-0 flex-1 basis-48">
                        <EditableText
                          value={member.email}
                          ariaLabel={`Email for ${member.name}`}
                          placeholder="Add an email"
                          className="font-mono text-xs text-ink-3"
                          onSave={(email) => void editMember(member, { email })}
                        />
                      </span>
                    ) : (
                      <span className="font-mono text-xs text-ink-3">
                        {member.email}
                      </span>
                    )}

                    {member.role === "lead" && (
                      <span className="font-mono text-xs text-ink-3">lead</span>
                    )}

                    {isLead && (
                      <span className="ml-auto flex items-center gap-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={member.receives_notes}
                          onClick={() => void toggleReceivesNotes(member)}
                          disabled={pending}
                          className={
                            member.receives_notes
                              ? "state-layer h-7 rounded-full border border-transparent bg-ok-soft px-2.5 text-xs font-medium text-ok"
                              : "state-layer h-7 rounded-full border border-hairline px-2.5 text-xs font-medium text-ink-3"
                          }
                        >
                          {member.receives_notes ? "Gets notes" : "No notes"}
                        </button>

                        {/* Never offer to remove yourself — you'd lock
                            yourself out of the team you are looking at. */}
                        {member.email.toLowerCase() !== signedInEmail && (
                          <button
                            type="button"
                            onClick={() => setPendingRemove(member)}
                            disabled={pending}
                            className="state-layer h-7 rounded-full px-2.5 text-xs font-medium text-ink-3 hover:text-live"
                          >
                            Remove
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                </LedgerRow>
              </li>
            ))}
          </CardList>
        )}
      </section>

      {isLead && (
        <section>
          <CardLabel>Add someone</CardLabel>
          <Card as="form" onSubmit={addMember} noValidate padding="loose" className="flex flex-col gap-4">
            <Input
              label="Name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              hint="Optional — we'll use the email address if you leave it blank."
            />
            <Input
              label="Email"
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              error={addError ?? undefined}
            />
            <Button type="submit" variant="primary" busy={adding} className="self-start">
              Add to team
            </Button>
          </Card>
        </section>
      )}

      {isLead && (
        <section>
          <CardLabel>Add several at once</CardLabel>
          <Card
            as="form"
            onSubmit={addBulk}
            noValidate
            padding="loose"
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="bulk-roster"
                className="text-sm font-medium text-ink-2"
              >
                Email addresses
              </label>
              <textarea
                id="bulk-roster"
                value={bulkText}
                rows={4}
                spellCheck={false}
                placeholder={"ali@company.com, sara@company.com\nBilal Khan <bilal@company.com>"}
                onChange={(event) => setBulkText(event.target.value)}
                aria-describedby={bulkError ? "bulk-error" : "bulk-hint"}
                aria-invalid={bulkError ? true : undefined}
                className={cx(
                  "w-full resize-y rounded-[var(--radius)] border bg-paper-raised p-3",
                  "text-ink placeholder:text-ink-3",
                  "transition-[border-color,box-shadow] duration-150 ease-[var(--ease)]",
                  "hover:border-ink-3 focus:outline-none focus:ring-1",
                  bulkError
                    ? "border-live focus:border-live focus:ring-live"
                    : "border-hairline focus:border-amber focus:ring-amber",
                )}
              />
              {bulkError ? (
                <p id="bulk-error" role="alert" className="pl-0.5 text-sm text-live">
                  {bulkError}
                </p>
              ) : (
                <p id="bulk-hint" className="pl-0.5 text-sm text-ink-3">
                  One per line, or separated by commas. Paste straight from your
                  mail client — names in angle brackets are kept.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                busy={bulkBusy}
                disabled={parsedBulk.entries.length === 0}
                className="self-start"
              >
                {parsedBulk.entries.length > 1
                  ? `Add ${parsedBulk.entries.length} people`
                  : "Add to team"}
              </Button>
              {parsedBulk.invalid.length > 0 && (
                <p className="text-sm text-ink-3">
                  {parsedBulk.invalid.length} line
                  {parsedBulk.invalid.length === 1 ? "" : "s"} won&apos;t be
                  added — not an email address.
                </p>
              )}
            </div>
          </Card>
        </section>
      )}


      <ConfirmDialog
        open={pendingRemove !== null}
        onClose={() => setPendingRemove(null)}
        onConfirm={() => pendingRemove && void removeMember(pendingRemove)}
        title="Remove from the team?"
        confirmLabel="Remove"
        busyLabel="Removing…"
        busy={removing}
      >
        <p>
          <span className="text-ink">{pendingRemove?.name}</span> stops
          appearing in huddles and stops receiving notes.
        </p>
        <p className="mt-2 text-sm text-ink-3">
          Past huddles keep their name and their action items — nothing already
          recorded changes. Adding them again later restores them.
        </p>
      </ConfirmDialog>
    </div>
  );
}
