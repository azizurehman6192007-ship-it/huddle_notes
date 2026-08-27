"use client";

import { LedgerRow } from "@/components/ledger/LedgerRow";
import { Card, CardList } from "@/components/ui/Card";
import { cx } from "@/lib/util/cx";

export interface LedgerMember {
  id: string;
  name: string;
}

/**
 * The attendee list is not a sidebar. It is the same object in two states,
 * and the continuity between them is what makes the product feel coherent.
 *
 * setup — rows of attendees, tap to mark present or absent.
 * live  — the same rows, alongside the recording.
 *
 * §7 describes a third state, `notes`, where the rows expanded into what each
 * person said. That section was cut from the notes screen after testing, so
 * the mode is gone with it rather than left as an unreachable branch.
 *
 * Both render as one card with hairline-separated rows, so the group reads as
 * a single object rather than a stack of tiles.
 */
type LedgerProps =
  | {
      mode: "setup";
      members: LedgerMember[];
      presentIds: Set<string>;
      onToggle: (memberId: string) => void;
      className?: string;
    }
  | {
      mode: "live";
      members: LedgerMember[];
      presentIds: Set<string>;
      /**
       * Presence stays adjustable while the huddle runs — someone always joins
       * late. This is a trailing control rather than a whole-row tap on
       * purpose: the row gesture belongs to tap-to-tag in Phase 2.
       */
      onToggle?: (memberId: string) => void;
      className?: string;
    };

function Empty({
  title,
  body,
  className,
}: {
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <Card padding="loose" className={cx("text-center", className)}>
      <p className="text-ink-2">{title}</p>
      <p className="mt-1 text-sm text-ink-3">{body}</p>
    </Card>
  );
}

export function Ledger(props: LedgerProps) {
  const { className } = props;

  const members = props.members;

  if (members.length === 0) {
    return (
      <Empty
        title="No one on the team yet."
        body="Add the people who join the huddle from the team screen."
        className={className}
      />
    );
  }

  return (
    <CardList className={className}>
      {members.map((member, index) => {
        const present = props.presentIds.has(member.id);

        if (props.mode === "setup") {
          const onToggle = props.onToggle;
          return (
            <LedgerRow
              key={member.id}
              name={member.name}
              dimmed={!present}
              pressed={present}
              onClick={() => onToggle(member.id)}
              trailing={present ? "Present" : "Away"}
            />
          );
        }

        const onToggle = props.onToggle;

        return (
          <LedgerRow
            key={member.id}
            index={index}
            name={member.name}
            dimmed={!present}
            trailing={
              onToggle ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={present}
                  aria-label={`${member.name} is ${present ? "here" : "away"}`}
                  onClick={() => onToggle(member.id)}
                  className={cx(
                    "state-layer -my-1 rounded-full border px-3 py-1.5",
                    present
                      ? "border-hairline text-ink-2"
                      : "border-transparent bg-paper-sunk text-ink-3",
                  )}
                >
                  {present ? "Here" : "Away"}
                </button>
              ) : present ? (
                "In the room"
              ) : (
                "Away"
              )
            }
          />
        );
      })}
    </CardList>
  );
}
