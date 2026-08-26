-- Huddle — initial schema, RLS, storage and queue.
-- Every table is scoped by team_id (directly, or through meetings.team_id).

create extension if not exists pgcrypto;
create extension if not exists pgmq;

-- ---------------------------------------------------------------- tables

create table teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  watermark_text text default 'Confidential',
  logo_url text,
  transcribe_language text not null default 'en',   -- 'en' | 'ur' | 'auto'
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
  audio_mime text,
  audio_deleted_at timestamptz,
  transcript text,
  transcript_json jsonb,                -- verbose_json segments, for the §5 merge step
  notes_json jsonb,
  notes_edited boolean default false,   -- did a human touch it? track this metric.
  pdf_path text,
  processing_stage text,                -- 'transcribing' | 'writing_notes' | 'making_pdf'
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

-- Audio arrives in 5s chunks as individual objects, concatenated on finalize.
-- This table is the manifest so finalize knows what to stitch and in what order.
create table meeting_chunks (
  meeting_id uuid references meetings(id) on delete cascade,
  seq int not null,
  path text not null,
  bytes int not null,
  created_at timestamptz default now(),
  primary key (meeting_id, seq)
);

create index members_team_idx         on members (team_id) where active;
create index meetings_team_date_idx   on meetings (team_id, meeting_date desc, created_at desc);
create index meetings_status_idx      on meetings (status, created_at);
create index segments_meeting_idx     on speaker_segments (meeting_id, start_ms);
create index action_items_meeting_idx on action_items (meeting_id);
create index email_log_meeting_idx    on email_log (meeting_id);

-- ------------------------------------------------- membership predicates
-- security definer so policies on members do not recurse into themselves.

create or replace function public.current_user_email()
returns text language sql stable as $fn$
  select lower(coalesce(nullif(auth.jwt() ->> 'email', ''), ''));
$fn$;

create or replace function public.is_team_member(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.current_user_email() <> '' and exists (
    select 1 from public.members m
    where m.team_id = p_team_id
      and m.active
      and lower(m.email) = public.current_user_email()
  );
$fn$;

create or replace function public.is_team_lead(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.current_user_email() <> '' and exists (
    select 1 from public.members m
    where m.team_id = p_team_id
      and m.active
      and m.role = 'lead'
      and lower(m.email) = public.current_user_email()
  );
$fn$;

create or replace function public.can_access_meeting(p_meeting_id uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select exists (
    select 1 from public.meetings mt
    where mt.id = p_meeting_id and public.is_team_member(mt.team_id)
  );
$fn$;

-- Bootstrapping: a brand-new user belongs to no team, so they cannot satisfy
-- any insert policy yet. This creates the team and their lead row atomically.
create or replace function public.create_team(p_team_name text, p_lead_name text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_team_id uuid;
  v_email   text := public.current_user_email();
begin
  if v_email = '' then
    raise exception 'Not signed in.';
  end if;
  if coalesce(trim(p_team_name), '') = '' then
    raise exception 'Team name is required.';
  end if;

  insert into public.teams (name) values (trim(p_team_name)) returning id into v_team_id;
  insert into public.members (team_id, name, email, role)
  values (
    v_team_id,
    coalesce(nullif(trim(p_lead_name), ''), split_part(v_email, '@', 1)),
    v_email,
    'lead'
  );
  return v_team_id;
end;
$fn$;

revoke all on function public.create_team(text, text) from public;
grant execute on function public.create_team(text, text) to authenticated;

-- --------------------------------------------------------------- policies

alter table teams             enable row level security;
alter table members           enable row level security;
alter table meetings          enable row level security;
alter table meeting_attendees enable row level security;
alter table speaker_segments  enable row level security;
alter table action_items      enable row level security;
alter table email_log         enable row level security;
alter table meeting_chunks    enable row level security;

-- teams: created only through create_team(); there is deliberately no insert policy.
create policy teams_select on teams for select to authenticated
  using (public.is_team_member(id));
create policy teams_update on teams for update to authenticated
  using (public.is_team_lead(id)) with check (public.is_team_lead(id));

create policy members_select on members for select to authenticated
  using (public.is_team_member(team_id));
create policy members_insert on members for insert to authenticated
  with check (public.is_team_lead(team_id));
create policy members_update on members for update to authenticated
  using (public.is_team_lead(team_id)) with check (public.is_team_lead(team_id));
create policy members_delete on members for delete to authenticated
  using (public.is_team_lead(team_id));

create policy meetings_select on meetings for select to authenticated
  using (public.is_team_member(team_id));
create policy meetings_insert on meetings for insert to authenticated
  with check (public.is_team_member(team_id));
create policy meetings_update on meetings for update to authenticated
  using (public.is_team_member(team_id)) with check (public.is_team_member(team_id));
create policy meetings_delete on meetings for delete to authenticated
  using (public.is_team_lead(team_id));

create policy attendees_all on meeting_attendees for all to authenticated
  using (public.can_access_meeting(meeting_id))
  with check (public.can_access_meeting(meeting_id));

create policy segments_all on speaker_segments for all to authenticated
  using (public.can_access_meeting(meeting_id))
  with check (public.can_access_meeting(meeting_id));

create policy action_items_all on action_items for all to authenticated
  using (public.can_access_meeting(meeting_id))
  with check (public.can_access_meeting(meeting_id));

create policy email_log_select on email_log for select to authenticated
  using (public.can_access_meeting(meeting_id));

create policy chunks_select on meeting_chunks for select to authenticated
  using (public.can_access_meeting(meeting_id));

-- ----------------------------------------------------- storage and queue

insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;
-- No storage policies: audio is written and read only by the service role
-- (chunk / finalize / worker routes). The browser never touches the bucket.

select pgmq.create('process_meeting');

-- ------------------------------------------------------- queue accessors
-- PostgREST cannot see the pgmq schema, so the worker talks to it through
-- these. service_role only: nothing here is reachable from the browser.

create or replace function public.enqueue_meeting(p_meeting_id uuid)
returns bigint language sql security definer set search_path = public as $fn$
  select pgmq.send('process_meeting', jsonb_build_object('meeting_id', p_meeting_id));
$fn$;

create or replace function public.read_meeting_jobs(p_qty int, p_visibility_sec int)
returns table (msg_id bigint, read_ct int, message jsonb)
language sql security definer set search_path = public as $fn$
  select r.msg_id, r.read_ct, r.message
  from pgmq.read('process_meeting', p_visibility_sec, p_qty) as r;
$fn$;

create or replace function public.ack_meeting_job(p_msg_id bigint)
returns boolean language sql security definer set search_path = public as $fn$
  select pgmq.delete('process_meeting', p_msg_id);
$fn$;

create or replace function public.archive_meeting_job(p_msg_id bigint)
returns boolean language sql security definer set search_path = public as $fn$
  select pgmq.archive('process_meeting', p_msg_id);
$fn$;

revoke all on function public.enqueue_meeting(uuid)          from public, anon, authenticated;
revoke all on function public.read_meeting_jobs(int, int)    from public, anon, authenticated;
revoke all on function public.ack_meeting_job(bigint)        from public, anon, authenticated;
revoke all on function public.archive_meeting_job(bigint)    from public, anon, authenticated;

grant execute on function public.enqueue_meeting(uuid)       to service_role;
grant execute on function public.read_meeting_jobs(int, int) to service_role;
grant execute on function public.ack_meeting_job(bigint)     to service_role;
grant execute on function public.archive_meeting_job(bigint) to service_role;
