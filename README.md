# Huddle

Record your standup, get notes you can send.

`CLAUDE.md` is the product and design spec. This file is just how to run it.

## Status: Phases 1-3, on one screen

The whole loop lives at `/`. Tap to record, tap to stop, it processes in place, notes
appear inline and editable, and Send emails them with the PDF attached. `/?h=<id>` pins
an earlier huddle into the same screen.

Working: magic-link auth, team + members CRUD, chunked recording, Groq transcription,
Qwen notes (Zod-validated), owner matching, inline editing, watermarked PDF, Resend
delivery with per-recipient logging and a delivery webhook.

Not built, by design (`CLAUDE.md` §12, Phase 4): tap-to-tag speaker segments, retry on
failure, audio retention cron, carrying action items into the next huddle, search.

## Setup

### 1. Supabase

Create a project, then enable the `pgmq` extension (Database → Extensions).

Apply the migrations **in order** — paste `supabase/migrations/0001_init.sql` then
`0002_notes_delivery.sql` into the SQL editor, or link the CLI and push:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

0001 creates the tables, the RLS policies, the `meeting-audio` bucket and the
`process_meeting` queue. 0002 adds the `meeting-pdfs` bucket and the send bookkeeping.

### 2. Environment

```bash
cp .env.example .env.local
```

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same page |
| `SUPABASE_SERVICE_ROLE_KEY` | same page. Server only — never expose it |
| `GROQ_API_KEY` | console.groq.com |
| `APP_URL` | `http://localhost:3000` in dev |
| `WORKER_SECRET` | any long random string, e.g. `openssl rand -hex 32` |
| `RESEND_API_KEY` | resend.com → API keys |
| `EMAIL_FROM` | a verified sender on your Resend domain, e.g. `Huddle <notes@yourdomain.com>` |
| `RESEND_WEBHOOK_SECRET` | another random string; guards the delivery webhook |

Without `RESEND_API_KEY` and `EMAIL_FROM` everything still works except Send, which
the notes screen disables and explains rather than failing at the last step.

To get delivery and bounce status, add a webhook in Resend pointing at
`{APP_URL}/api/webhooks/resend?key={RESEND_WEBHOOK_SECRET}`.

### 3. Auth redirect

In Supabase → Authentication → URL Configuration, add
`http://localhost:3000/auth/callback` to the redirect allow-list.

### 4. Run

```bash
npm install
npm run dev
```

Sign in, create a team, add the people who join the standup, then start a huddle.

## The worker

Transcription runs outside the request — a 15 minute file takes 40–60s.
`/api/meetings/[id]/finalize` enqueues the job and nudges `/api/worker/process`, which
authenticates with `WORKER_SECRET` (header `x-worker-secret`, or a bearer token).

In production, also run it on a schedule so a missed nudge doesn't strand a meeting:

```bash
curl -X POST https://your-app/api/worker/process -H "x-worker-secret: $WORKER_SECRET"
```

Host it somewhere background-capable (Railway, or a Vercel function with a raised
`maxDuration`) — not a Supabase Edge Function, which will time out.

## Checks

```bash
npm run check      # tsc --noEmit && eslint
npm run build
```

## Layout

```
app/(app)/         signed-in screens: huddles, record, meeting, team
app/(auth)/        login
app/api/           meetings, chunk, finalize, worker
components/        ledger, recorder, ui primitives
lib/               supabase clients, audio, ai, format helpers
supabase/migrations/
```
