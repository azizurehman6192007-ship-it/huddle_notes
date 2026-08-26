-- Phase 2 + 3: rendered PDFs, and the delivery bookkeeping the send flow needs.

-- Rendered notes. Private, like the audio: served only through a signed URL
-- minted by a route that has already checked team membership.
insert into storage.buckets (id, name, public)
values ('meeting-pdfs', 'meeting-pdfs', false)
on conflict (id) do nothing;

-- Resend's webhook reports per-message state, so we look rows up by it.
create index if not exists email_log_provider_idx
  on email_log (provider_id)
  where provider_id is not null;

-- Who a huddle actually went to, so "sent to 6 people" can be shown after the
-- fact without re-deriving it from the roster (which may have changed since).
alter table meetings
  add column if not exists sent_at timestamptz,
  add column if not exists sent_count int;
