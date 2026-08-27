# Huddle

Record your standup, get notes you can send.

`CLAUDE.md` is the product and design spec. This file is just how to run it.

## Status: Phases 1-3, on one screen

The whole loop lives at `/`. Tap to record, tap to stop, it processes in place, notes
appear inline and editable, and Send emails them with the PDF attached. `/?h=<id>` pins
an earlier huddle into the same screen.

Working: sign-in (**verification currently disabled — see below**), team + members CRUD, chunked recording, Groq transcription,
Qwen notes (Zod-validated), owner matching, inline editing, watermarked PDF, Resend
delivery with per-recipient logging and a delivery webhook.

Editing and deleting: notes and action items are inline-editable, action items can be
added and removed, the transcript is editable with an explicit save, huddles can be
deleted (lead only, with a confirm sheet, and Storage is swept too), and team members
can be added, edited and removed. Every delete goes through a confirmation sheet.

Not built, by design (`CLAUDE.md` §12, Phase 4): tap-to-tag speaker segments, retry on
failure, audio retention cron, carrying action items into the next huddle, search.

---

## ⚠️ Auth is switched off

**Sign-in does not verify anything.** Type any email address, press Continue, and you
are that person — no magic link, no OTP, no password, no OAuth. Typing a colleague's
address logs you in as them and shows you their team's huddles, transcripts and notes.

This was done deliberately so internal testing doesn't round-trip through email while
the product is being built. `/api/auth/dev-signin` mints a genuine Supabase session with
the admin API (`createUser` → `generateLink` → `verifyOtp`) without sending mail, so RLS,
`auth.uid()` and `create_team()` all still behave exactly as they do under real auth.

**Before this is used with real external users, or with anything confidential:**

1. Delete `app/api/auth/dev-signin/route.ts`.
2. Restore verification in `app/(auth)/login/LoginForm.tsx` — either
   `supabase.auth.signInWithOtp({ email })` (the magic-link/OTP flow this replaced;
   `app/auth/callback/route.ts` and `app/(auth)/login/authError.ts` are still in the
   tree and still work), or `supabase.auth.signInWithOAuth({ provider: "google" })`.
3. Leave `PUBLIC_PATHS` in `middleware.ts` as it is — `/api/auth` still needs to be
   public for `/api/auth/signout`.

As a backstop, the bypass **fails closed in production**: with `NODE_ENV=production` it
returns 403 unless `ALLOW_UNVERIFIED_SIGNIN=true` is set explicitly. An accidental
deploy will not silently ship an open login.

There is no data migration to undo — `members.email` is the join in both flows.

---

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
| `ALLOW_UNVERIFIED_SIGNIN` | only read when `NODE_ENV=production`. See the auth warning above |

Without `RESEND_API_KEY` and `EMAIL_FROM` everything still works except Send, which
the notes screen disables and explains rather than failing at the last step.

To get delivery and bounce status, add a webhook in Resend pointing at
`{APP_URL}/api/webhooks/resend?key={RESEND_WEBHOOK_SECRET}`.

### 3. Auth redirect

Not needed while unverified sign-in is on — nothing is emailed. When verification is
restored, add `http://localhost:3000/auth/callback` to Supabase → Authentication →
URL Configuration → Redirect URLs.

### 4. Run

```bash
npm install
npm run dev
```

Enter any email, create a team, add the people who join the standup, then start a
huddle. Sign out from the team screen to test as someone else.

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
