# Huddle — AI Scribe for Daily Standups

> This file is the source of truth for Claude Code. Read it fully before writing code.
> If something here conflicts with a request in chat, say so instead of silently choosing.

---

## 1. What we're building

A web app that records a team's daily standup, transcribes it, turns it into structured
notes, and emails a watermarked PDF to the team.

The whole product is one loop:

```
tap mic  →  huddle happens  →  tap stop  →  notes appear  →  lead reviews  →  send
```

**Primary user:** the team lead who runs the standup. They open the app on a phone or
laptop, tap once, talk for 12 minutes, and want notes they can send without rewriting.

**Success = the lead sends the notes without editing them.** Every technical decision in
this file exists to make that outcome more likely. If a feature doesn't move that number,
it's not V1.

### Non-negotiables

1. **Nothing is emailed automatically.** Notes land in `draft`. A human presses Send.
   An AI that misattributes one action item and mails it to the whole team destroys trust
   permanently. This is a product rule, not a preference — do not "improve" it away.
2. **Recording must survive a crash.** Audio uploads in chunks during the meeting, not in
   one blob at the end. Losing a standup that already happened is unrecoverable.
3. **Every AI output is schema-validated JSON.** Never free text. If parsing fails, retry
   once, then mark the meeting `failed` with a readable reason — never render half-notes.
4. **RLS on from day one.** Every table scoped by `team_id`. Retrofitting this is painful.

### Explicitly out of scope for V1

Calendar sync, live transcription during the meeting, video, multi-language switching
mid-sentence, Slack integration, mobile native apps, speaker diarization ML.

---

## 2. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router), TypeScript | PWA, installable. No native app in V1. |
| DB / Auth / Storage | Supabase | Postgres + RLS + Storage + Auth (magic link) |
| Queue | `pgmq` on Supabase | Meeting processing is async, never in a request |
| Transcription | Groq `whisper-large-v3` | 25 MB request cap — chunk anything larger |
| Notes LLM | Groq `qwen-3-32b` (or current Qwen on Groq) | JSON mode, temp 0.2 |
| PDF | `pdf-lib` | Runs in Node and Deno, handles watermark |
| Email | Resend | Attachments + delivery webhooks |
| Styling | Tailwind + CSS variables from §7 | No component library. Build the primitives. |
| State | Server Components + `useState`. No Redux/Zustand. |

**Worker runtime:** a Next.js route handler on a background-capable host (Railway or
Vercel background function). Do **not** put transcription inside a Supabase Edge Function —
a 15-minute audio file can take 40–60s to transcribe and you will hit timeouts.

---

## 3. The one non-obvious product decision: tap-to-tag

Whisper returns text. It does **not** return who was speaking. Without speaker names,
action items have no owner and the notes are worthless.

We solve this without ML: **during the meeting, the lead taps whoever is currently
speaking.** The attendee list is on screen as large tap targets. Each tap writes a
`{member_id, start_ms}` segment. Tapping a different person closes the previous segment.

This gives us ground-truth speaker labels for free, and it makes the recording screen
active instead of a dead timer.

It must degrade gracefully:

- **Tags present** → feed exact speaker-segmented transcript to the LLM. Best quality.
- **No tags** → feed flat transcript + attendee name list, let the LLM infer from
  self-introductions ("Ali here, yesterday I…"). Mark inferred owners with
  `"owner_confidence": "low"` and show them differently in the UI.

Never block Stop on tagging. Tagging is an assist, never a requirement.

---

## 4. Data model

```sql
create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  watermark_text text default 'Confidential',
  logo_url text,
  created_at timestamptz default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  name text not null,
  email text not null,
  role text default 'member',          -- 'lead' | 'member'
  receives_notes boolean default true,
  active boolean default true,
  created_at timestamptz default now(),
  unique (team_id, email)
);

create type meeting_status as enum
  ('recording','uploading','processing','draft','sent','failed');

create table meetings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  title text not null,
  meeting_date date not null default current_date,
  started_at timestamptz,
  ended_at timestamptz,
  duration_sec int,
  status meeting_status not null default 'recording',
  failure_reason text,
  audio_path text,
  audio_deleted_at timestamptz,
  transcript text,
  notes_json jsonb,
  notes_edited boolean default false,   -- did a human touch it? track this metric.
  pdf_path text,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create table meeting_attendees (
  meeting_id uuid references meetings(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  present boolean default true,
  primary key (meeting_id, member_id)
);

-- from tap-to-tag
create table speaker_segments (
  id bigserial primary key,
  meeting_id uuid references meetings(id) on delete cascade,
  member_id uuid references members(id),
  start_ms int not null,
  end_ms int
);

create table action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade,
  owner_member_id uuid references members(id),
  owner_name_raw text,                 -- what the AI said, before matching
  owner_confidence text default 'high',-- 'high' | 'low'
  task text not null,
  due_date date,
  status text default 'open'
);

create table email_log (
  id bigserial primary key,
  meeting_id uuid references meetings(id) on delete cascade,
  email text not null,
  provider_id text,
  status text,                          -- queued|sent|delivered|bounced
  sent_at timestamptz default now()
);
```

**RLS:** every table readable/writable only where the row's `team_id` matches a team the
current user is a member of. Write the policies in the same migration as the tables.

**Retention:** a daily cron deletes audio files older than 30 days and sets
`audio_deleted_at`. Transcript and notes are kept forever — they're tiny.

---

## 5. Pipeline

```
Client                          Server / Worker
──────                          ───────────────
tap Record
  MediaRecorder start
  (opus, mono, 16kHz)
  every 5s → chunk ───────────► POST /api/meetings/:id/chunk
                                  append to Storage
  tap speaker ────────────────► POST /api/meetings/:id/segment
tap Stop
  flush final chunk ──────────► status = 'uploading'
                                  concat chunks → meetings/{id}/audio.webm
                                  status = 'processing'
                                  pgmq.send('process_meeting', {id})

                                WORKER
                                 1. if size > 20MB → split on silence
                                 2. Groq whisper-large-v3 (verbose_json, word ts)
                                 3. merge transcript + speaker_segments
                                 4. Groq Qwen → notes JSON (§6)
                                 5. validate with Zod → retry once on fail
                                 6. render PDF + watermark (§8)
                                 7. status = 'draft'
                                 8. notify lead (email + in-app)

lead reviews → edits → Send ───► send email + attachment, log each recipient
                                  status = 'sent'
```

Every stage writes status before and after. A meeting stuck in `processing` for >10 min
gets swept to `failed` by cron with a retry action available in the UI.

---

## 6. AI layer

### Transcription

- `response_format: verbose_json`, `timestamp_granularities: ["segment"]`
- `language`: from team setting (`en` / `ur` / `auto`). Default `en`.
- `prompt`: pass team member names + product nouns as a hint string. This measurably
  improves proper-noun accuracy. Example: `"Standup. Speakers: Ali, Sara, Bilal. Terms: Supabase, Groq, PR, staging."`

### Notes generation

System prompt (keep in `lib/ai/prompts.ts`, not inline):

```
You are a meeting scribe for a software team's daily standup.
You receive a transcript with speaker labels and a list of attendees.

Rules:
- Use ONLY what is in the transcript. Never invent tasks, dates, or names.
- Attribute every point to a speaker. If unsure, set owner_confidence to "low".
- Keep each point to one sentence, in the speaker's own meaning, not their filler words.
- If the transcript is too short or unintelligible, return the schema with empty
  arrays and set "usable": false. Do not guess.
- Output ONLY valid JSON matching the schema. No markdown, no preamble.
```

### Output schema (Zod-validated)

```ts
{
  usable: boolean,
  summary: string,                    // 2 sentences max
  attendees_present: string[],
  updates: [{ person: string, yesterday: string[], today: string[] }],
  blockers: [{ person: string, issue: string, needs: string | null }],
  decisions: string[],
  action_items: [{
    owner: string,
    owner_confidence: "high" | "low",
    task: string,
    due: string | null              // ISO date or null. Never guess a date.
  }],
  open_questions: string[]
}
```

Then fuzzy-match `owner` against `members.name` to get `owner_member_id`. No match →
keep `owner_name_raw`, flag it in the UI for the lead to assign.

---

## 7. Design system

The product is a **morning ritual**: short, repeated, low-ceremony. The interface should
feel like an instrument you pick up, not a dashboard you inspect.

Direction: **cool paper, warm signal.** The surface is a cool blue-grey — quiet, early,
screen-native. The single warm accent (amber) is reserved for the live and the actionable:
the record state, the active speaker, an unassigned owner. Warmth means "this is happening
now, or it needs you." Nothing else gets to be warm.

### Tokens

```css
:root {
  /* surface — cool, not cream */
  --paper:       #EFF1F5;
  --paper-raised:#FFFFFF;
  --paper-sunk:  #E4E7EE;

  /* ink */
  --ink:         #171A2E;   /* headings, primary text */
  --ink-2:       #5B6178;   /* secondary */
  --ink-3:       #8B90A3;   /* tertiary, timestamps */
  --hairline:    #D6DAE4;

  /* signal — reserved, never decorative */
  --amber:       #C87A16;
  --amber-soft:  #FBEED8;
  --live:        #D93B3B;   /* record dot only. convention beats branding here. */

  /* status */
  --ok:          #1F7A5C;
  --ok-soft:     #E1F2EB;

  --radius:      10px;
  --radius-lg:   16px;
  --shadow:      0 1px 2px rgb(23 26 46 / .06), 0 8px 24px rgb(23 26 46 / .06);
}
```

Dark mode: invert to `--ink` as surface for the **recording screen only** — the room lights
are usually off and the mic screen is the one you stare at. The rest of the app stays light.

### Type

| Role | Face | Use |
|---|---|---|
| Display | **Bricolage Grotesque** 600 | Screen titles, the timer, section heads. Used sparingly. |
| Body | **Inter Tight** 400/500 | Everything readable |
| Utility | **IBM Plex Mono** 400 | Timestamps, durations, speaker tags, dates |

Scale: `12 / 14 / 16 / 20 / 28 / 44`. The timer is the only thing that gets 44 — and it's
mono, tabular-nums, so it doesn't jitter as digits change.

### Signature element — the Ledger

The attendee list is not a sidebar. It is the same object in three states, and the
continuity between them is what makes the product feel coherent:

- **Before:** rows of attendees, tap to mark present/absent.
- **During:** the same rows become tap targets. The person you tap gets an amber left
  edge and a mono timer counting their airtime. Everyone else dims.
- **After:** the same rows expand into their notes — yesterday / today / blockers under
  each name. The thing you tapped becomes the thing you read.

Build this as one component, `<Ledger mode="setup" | "live" | "notes">`.

### Motion

Restrained. Three moments only:

1. Record button → recording: the circle morphs to a rounded square, 220ms, `cubic-bezier(.2,.8,.2,1)`.
2. Speaker tap: amber edge slides in over 120ms. Instant feedback matters more than grace.
3. Processing → draft: the ledger rows stagger in at 40ms intervals. This is the payoff
   moment of the whole product — let it land.

Respect `prefers-reduced-motion`: cut all three to opacity fades.

### Copy rules

- Sentence case everywhere. No title case, no exclamation marks.
- Buttons name their outcome: "Send notes", not "Submit". The toast then says "Notes sent".
- Errors say what happened and the next move: "Couldn't hear enough to write notes. The
  recording was 14 seconds. Try again with a longer huddle." Never "An error occurred."
- Empty states are invitations: "No huddles yet. Tap the mic to record your first one."

---

## 8. Screens

### A. Home / Huddles

```
┌────────────────────────────────────────────┐
│  Huddle                        ⚙  ● Team   │
│                                            │
│  ┌──────────────────────────────────────┐  │
│  │            ●  Start huddle           │  │  ← primary, always reachable
│  │        Daily standup · 6 present     │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  TODAY                                     │
│  ┌──────────────────────────────────────┐  │
│  │ Daily standup      12:04  ● Draft    │  │  ← amber dot = needs you
│  │ 3 action items · 1 blocker           │  │
│  └──────────────────────────────────────┘  │
│                                            │
│  EARLIER THIS WEEK                         │
│  Tue 25 Aug   Daily standup   11:58  Sent  │
│  Mon 24 Aug   Daily standup   13:20  Sent  │
└────────────────────────────────────────────┘
```

Date-grouped list, newest first. **Not a calendar in V1** — a calendar shows empty
squares, which is a worse answer to "what happened in standups" than a list. Add a month
view in Phase 4 as a *filter*, not the default.

### B. Recording (dark)

```
┌────────────────────────────────────────────┐
│  ● REC                            12:04    │  ← mono, tabular
│                                            │
│         ▁▃▅▇▅▃▁▃▅▇▅▃▁▃▅▇▅               │  ← live waveform, real amplitude
│                                            │
│  WHO'S TALKING                             │
│  ▎ Ali            2:14                     │  ← amber edge = active
│    Sara           3:02                     │
│    Bilal          1:47                     │
│    Hina           0:00                     │
│                                            │
│              ┌──────────┐                  │
│              │  ■  Stop │                  │
│              └──────────┘                  │
│         Saved automatically                │
└────────────────────────────────────────────┘
```

The waveform must be driven by real `AnalyserNode` data. A fake animation is a lie about
whether the mic is working, and "was it recording?" is the user's biggest anxiety.

Also: keep the screen awake (`navigator.wakeLock`), and warn on tab close via
`beforeunload` while recording.

### C. Processing

One line, honest about stages: `Transcribing…` → `Writing notes…` → `Making the PDF…`
No fake progress bar. If it exceeds 90s, add: "Longer huddles take a bit more time."

### D. Notes (draft) — the screen that decides everything

```
┌────────────────────────────────────────────┐
│  ← Daily standup · Wed 26 Aug · 12:04      │
│  Draft — not sent yet                      │
│                                            │
│  SUMMARY                          [edit]   │
│  Team is on track for the Friday release.  │
│  Payments integration is blocked on keys.  │
│                                            │
│  ▎ALI                                      │
│    Yesterday  Finished the login flow.     │
│    Today      Starting payment webhooks.   │
│                                            │
│  ▎SARA                                     │
│    Blocker    Waiting on staging keys      │
│               Needs: access from Bilal     │
│                                            │
│  ACTION ITEMS                              │
│  ☐ Ali    Ship webhook handler   Fri 28    │
│  ☐ ?      Send staging keys      —         │  ← amber ?, tap to assign
│                                            │
│  ┌─────────────┐  ┌──────────────────────┐ │
│  │ View PDF    │  │  Send to 6 people    │ │
│  └─────────────┘  └──────────────────────┘ │
└────────────────────────────────────────────┘
```

Every field inline-editable — click the text, it becomes an input, blur saves. No modals,
no separate edit mode. Set `notes_edited = true` on any change and track it: **the % of
meetings sent unedited is your core quality metric.**

"Send to 6 people" opens a confirm sheet listing the actual recipients. Nobody should ever
be surprised by who got the email.

### E. Team

Members list, add by name + email, toggle `receives_notes`. Watermark text and logo live
here too. Keep it boring — it's visited twice ever.

---

## 9. PDF

`pdf-lib`. A4, 44pt margins.

- Header: team logo (if set) left, meeting title + date right, hairline under.
- Body: same section order as screen D. Speaker names in the display face, content in body.
- Action items as a bordered table: owner / task / due.
- Watermark: `teams.watermark_text`, 55pt, rotated 45°, centered, `rgb(0.85,0.86,0.89)`,
  drawn **before** content so text stays readable. Every page.
- Footer: `Generated by Huddle · {date}` + page number, mono, 8pt, `--ink-3`.

Filename: `huddle-2026-08-26.pdf`.

---

## 10. Email

Resend. Subject: `Standup notes — Wed 26 Aug`.

Body is the summary + action items **inline as HTML** (most people read on a phone and
won't open the attachment), with the PDF attached for the record. Plain-text fallback
required.

Log one `email_log` row per recipient. Wire the Resend webhook to update
`status` → delivered/bounced so a bad address is visible, not silent.

---

## 11. File structure

```
app/
  (app)/
    page.tsx                    # huddles list
    record/[id]/page.tsx
    meetings/[id]/page.tsx      # notes draft/sent
    team/page.tsx
  api/
    meetings/route.ts           # create
    meetings/[id]/chunk/route.ts
    meetings/[id]/segment/route.ts
    meetings/[id]/finalize/route.ts
    meetings/[id]/send/route.ts
    worker/process/route.ts     # pgmq consumer
    webhooks/resend/route.ts
components/
  ledger/                       # Ledger + LedgerRow (3 modes)
  recorder/                     # RecordButton, Waveform, Timer
  notes/                        # EditableText, ActionItemRow, SendSheet
  ui/                           # Button, Sheet, Toast — hand-built primitives
lib/
  supabase/                     # client, server, admin
  audio/                        # recorder.ts, chunker.ts
  ai/                           # groq.ts, prompts.ts, schema.ts
  pdf/                          # render.ts, watermark.ts
  email/                        # resend.ts, templates/
supabase/migrations/
```

---

## 12. Build order

Ship each phase working end-to-end before starting the next. Do not build ahead.

**Phase 1 — Prove the audio (this is the risky part, do it first)**
Auth, team + members CRUD, record → chunked upload → Groq transcription → show the raw
transcript on screen. Nothing else. Record three real standups. If the transcript is
inaccurate, stop and fix language/mic setup before building anything downstream — notes,
PDF, and email are all worthless on top of a bad transcript.

**Phase 2 — Notes**
Speaker segments (tap-to-tag), notes JSON + Zod validation, the Ledger in `notes` mode,
inline editing, draft status.

**Phase 3 — Deliver**
PDF + watermark, recipient management, send flow with confirm sheet, email log, webhooks.

**Phase 4 — Live with it**
Retry on failure, audio retention cron, action items carried into the next huddle's
context, search across transcripts, month filter.

---

## 13. Environment

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # worker only, never client
GROQ_API_KEY=
RESEND_API_KEY=
EMAIL_FROM=
APP_URL=
```

---

## 14. Rules for Claude Code

- **Ask before inventing scope.** If this file doesn't cover it, ask — don't add a feature
  and don't add a dependency without saying why.
- **No component libraries.** Build the ~8 primitives we need. shadcn/MUI will fight the
  design system in §7 and everything will drift back to default-looking.
- **Colors and type come from tokens only.** No hardcoded hex in components.
- **Service role key never reaches the client.** Worker routes only.
- **Migrations are files**, applied in order, never ad-hoc SQL in the dashboard.
- **Handle the sad path in the same commit as the happy path.** Empty, loading, error, and
  offline states are part of "done", not polish.
- **Type everything.** `any` needs a comment explaining why.

### Definition of done for any screen

Keyboard navigable with visible focus · works at 360px · reduced-motion respected ·
empty/loading/error states real · copy follows §7 rules · no layout shift on data load.

---

## 15. Implementation notes (added during Phase 1)

Decisions made while building that §1–§14 did not specify. Keep this section honest.

- **Membership is resolved by email.** `members` has no `auth.users` FK in §4, so a signed-in
  user is matched to `members.email`. The RLS predicates (`is_team_member`, `is_team_lead`)
  use the same join.
- **`public.create_team()` bootstraps a new user.** A user on no team cannot satisfy any
  insert policy, so team + lead row are created together in one SECURITY DEFINER function.
  `teams` deliberately has no insert policy.
- **Child tables scope through `meetings.team_id`.** `speaker_segments`, `action_items` and
  `email_log` have no `team_id` column in §4, so `can_access_meeting(meeting_id)` is the
  predicate.
- **Chunks are separate objects.** Supabase Storage cannot append, so each timeslice lands
  at `{meeting_id}/chunks/{seq}` with a row in `meeting_chunks`, and finalize concatenates
  them. MediaRecorder timeslices are one continuous byte stream, so appending in `seq`
  order rebuilds a valid container.
- **`pgmq` is reached through `public` shims.** PostgREST cannot see the `pgmq` schema, so
  `enqueue_meeting` / `read_meeting_jobs` / `ack_meeting_job` / `archive_meeting_job` wrap
  it, granted to `service_role` only.
- **Extra columns beyond §4**: `meetings.audio_mime`, `meetings.transcript_json`,
  `meetings.processing_stage`, `teams.transcribe_language`, plus the `meeting_chunks` table.
- **Deferred, on purpose**: §5 step 1 (split audio over 20MB on silence) fails with a
  readable message for now — it is Phase 4 work alongside retry.

### Added during Phases 2-3

- **One screen, not four.** The whole loop lives at `/`: record, process, notes, send.
  `/?h=<id>` pins an earlier huddle into the same screen. `/record/[id]` and
  `/meetings/[id]` are 302s kept alive so emailed links still land.
- **Notes model.** §2 names `qwen-3-32b`, which Groq has retired. The default is now
  `qwen/qwen3.8-27b`, overridable with `GROQ_NOTES_MODEL`.
- **Tap-to-tag is still not built.** Notes run the §3 degraded path: flat transcript plus
  the attendee roster, owners inferred from self-introductions, anything uncertain marked
  `owner_confidence: "low"` and flagged amber for the lead to assign.
- **PDF type.** §9 asks for the §7 faces; the renderer uses pdf-lib's standard fonts
  instead, to avoid shipping ~400KB of TTF and wiring fontkit into the worker. The
  hierarchy is preserved. Revisit if the PDF has to feel branded.
- **Resend webhook auth** is a shared secret in the query string
  (`RESEND_WEBHOOK_SECRET`), not a Svix signature, to avoid the `svix` dependency. It
  fails closed: no secret set means every request is rejected.
- **Send is partial-success tolerant.** One bad address does not block the rest; the
  meeting still flips to `sent` and the failures come back to the UI by name.
- **Extra columns beyond §4**: `meetings.sent_at`, `meetings.sent_count`.
