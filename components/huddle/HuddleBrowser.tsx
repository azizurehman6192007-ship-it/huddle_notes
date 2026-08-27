"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import { CardLabel, CardList } from "@/components/ui/Card";
import {
  formatDayLabel,
  formatDuration,
  formatLongDate,
  groupLabelFor,
  parseDateOnly,
} from "@/lib/util/format";
import type { MeetingRow } from "@/lib/supabase/types";

export type ListedMeeting = Pick<
  MeetingRow,
  "id" | "title" | "meeting_date" | "status" | "duration_sec" | "created_at"
>;

/**
 * The huddle history, with a filter over it. Everything is already in memory —
 * the page loads the last 60 huddles in one query — so this filters the list
 * that is on screen rather than going back to the server for each keystroke.
 */
export function HuddleBrowser({ rows }: { rows: ListedMeeting[] }) {
  const [query, setQuery] = useState("");

  // Each row gets one lowercase haystack covering every way someone might
  // reach for it: the title, the date as it is shown ("Wed 26 Aug"), the long
  // form ("26 August 2026"), the raw ISO date, and the status word.
  const indexed = useMemo(
    () =>
      rows.map((row) => {
        const date = parseDateOnly(row.meeting_date);
        return {
          row,
          haystack: [
            row.title,
            formatDayLabel(date),
            formatLongDate(date),
            row.meeting_date,
            row.status,
          ]
            .join(" ")
            .toLowerCase(),
        };
      }),
    [rows],
  );

  const trimmed = query.trim().toLowerCase();

  // Every whitespace-separated token has to match, so "aug draft" narrows
  // rather than widening the way a single substring match would.
  const matches = useMemo(() => {
    if (!trimmed) return rows;
    const tokens = trimmed.split(/\s+/).map(tokenMatcher);
    return indexed
      .filter((entry) => tokens.every((test) => test(entry.haystack)))
      .map((entry) => entry.row);
  }, [indexed, rows, trimmed]);

  if (rows.length === 0) {
    return (
      <p className="mt-10 text-center text-ink-2">
        No huddles yet. Tap the mic to record your first one.
      </p>
    );
  }

  return (
    <div className="mt-8">
      <Input
        label="Search huddles"
        hideLabel
        type="search"
        value={query}
        placeholder="Search by date or title"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setQuery("");
        }}
      />

      {trimmed && (
        <p aria-live="polite" className="mt-2 px-1 font-mono text-xs text-ink-3">
          {matches.length === 0
            ? "No matches"
            : `${matches.length} of ${rows.length}`}
        </p>
      )}

      {matches.length === 0 ? (
        <div className="mt-8 text-center">
          <p className="text-ink-2">
            No huddles match &ldquo;{query.trim()}&rdquo;. Try a date like 26
            Aug, or part of a title.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => setQuery("")}
          >
            Clear search
          </Button>
        </div>
      ) : (
        <HuddleGroups rows={matches} />
      )}
    </div>
  );
}

/**
 * A token has to land on a word start, not just anywhere in the string.
 * Plain `includes` looked right until a date was typed: "26 aug" matched every
 * 2026 huddle, because "26" sits inside the year. Anchoring to a boundary
 * keeps it a prefix search — "aug" still finds "August" — without matching
 * the middle of a number.
 */
function tokenMatcher(token: string): (haystack: string) => boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|[^a-z0-9])${escaped}`);
  return (haystack) => pattern.test(haystack);
}

function HuddleGroups({ rows }: { rows: ListedMeeting[] }) {
  const now = new Date();
  const groups: { label: string; meetings: ListedMeeting[] }[] = [];

  for (const meeting of rows) {
    const label = groupLabelFor(parseDateOnly(meeting.meeting_date), now);
    const last = groups.at(-1);
    if (last?.label === label) last.meetings.push(meeting);
    else groups.push({ label, meetings: [meeting] });
  }

  return (
    <div className="mt-8 flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.label}>
          <CardLabel>{group.label}</CardLabel>
          <CardList as="ul">
            {group.meetings.map((meeting) => (
              <li
                key={meeting.id}
                className="border-b border-hairline last:border-b-0"
              >
                {/* The whole row is the link again. Deleting lives on the
                    huddle's own page — a destructive control one stray tap
                    away from a list of recordings is not worth the shortcut. */}
                <Link
                  href={`/meetings/${meeting.id}`}
                  className="state-layer flex min-h-16 items-center justify-between gap-3 px-4 py-3.5 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ink">
                      {meeting.title}
                    </span>
                    <span className="mt-0.5 block font-mono text-xs text-ink-3">
                      {formatDayLabel(parseDateOnly(meeting.meeting_date))}
                      {meeting.duration_sec
                        ? ` · ${formatDuration(meeting.duration_sec)}`
                        : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusPill status={meeting.status} />
                    <span aria-hidden className="text-ink-3">
                      ›
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </CardList>
        </section>
      ))}
    </div>
  );
}
