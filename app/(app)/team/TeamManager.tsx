"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Card, CardLabel, CardList } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { LedgerRow } from "@/components/ledger/LedgerRow";
import type { MemberRow, TeamRow, TranscribeLanguage } from "@/lib/supabase/types";

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

  const supabase = createClient();

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function addMember(event: React.FormEvent) {
    event.preventDefault();
    setAddError(null);

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanName) return setAddError("A name is needed — it appears in the notes.");
    if (!cleanEmail.includes("@")) return setAddError("That doesn't look like an email address.");
    if (members.some((m) => m.email.toLowerCase() === cleanEmail)) {
      return setAddError(`${cleanEmail} is already on the team.`);
    }

    setAdding(true);
    const { error } = await supabase
      .from("members")
      .insert({ team_id: team.id, name: cleanName, email: cleanEmail });
    setAdding(false);

    if (error) {
      setAddError("Couldn't add them. Try again in a moment.");
      return;
    }

    setName("");
    setEmail("");
    toast.show(`${cleanName} added`, "ok");
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

  async function removeMember(target: MemberRow) {
    const { error } = await supabase
      .from("members")
      .update({ active: false })
      .eq("id", target.id);

    if (error) {
      toast.show("Couldn't remove them. Try again.", "error");
      return;
    }
    toast.show(`${target.name} removed`, "ok");
    refresh();
  }

  async function updateTeam(patch: Partial<TeamRow>) {
    const { error } = await supabase.from("teams").update(patch).eq("id", team.id);
    if (error) {
      toast.show("Couldn't save that. Try again.", "error");
      return;
    }
    toast.show("Saved", "ok");
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
                <LedgerRow name={member.name}>
                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span className="font-mono text-xs text-ink-3">
                      {member.email}
                      {member.role === "lead" ? " · lead" : ""}
                    </span>

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

                        {member.email.toLowerCase() !== signedInEmail && (
                          <button
                            type="button"
                            onClick={() => void removeMember(member)}
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
          <CardLabel>Settings</CardLabel>
          <Card padding="loose" className="flex flex-col gap-5">
            <Select
              label="Spoken language"
              defaultValue={team.transcribe_language}
              onChange={(event) =>
                void updateTeam({
                  transcribe_language: event.target.value as TranscribeLanguage,
                })
              }
              hint="Telling the transcriber the language up front makes it noticeably more accurate."
            >
              <option value="en">English</option>
              <option value="ur">Urdu</option>
              <option value="auto">Detect automatically</option>
            </Select>

            <Input
              label="Watermark text"
              defaultValue={team.watermark_text ?? "Confidential"}
              maxLength={40}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (value !== (team.watermark_text ?? "")) {
                  void updateTeam({ watermark_text: value });
                }
              }}
              hint="Printed across every page of the PDF."
            />
          </Card>
        </section>
      )}
    </div>
  );
}
