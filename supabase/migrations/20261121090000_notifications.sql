-- The Pipeline, phase 1 "Heard back" (docs/design-pipeline.md, 5.7 and 5.10): the outbox.
--
--   notifications   one row per answer from a company: an email on an application's
--                   timeline that is a reply, a request, an invite, an assessment, an offer
--                   or a rejection. The same rows are the phone pings waiting to be sent
--                   (tier 'push', sent_at null) and the Heard back feed on Applications
--                   (seen_at null = unread).
--
-- One row per timeline event (event_id is unique), so a sync that runs twice never adds a
-- second row and never pings twice. The sender marks sent_at in one conditional update
-- before it pushes, so two runs cannot both send one.
--
-- The server writes (the Applications Agent, with the service role). You may read your rows
-- and set seen_at, and nothing else. title and body are the company, the kind and the role:
-- what the lock screen shows. No email text, subject or sender is stored here.
--
-- Additive and safe to run again: it creates one table and touches no existing row.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- The timeline event it is about. Unique: one notification per event.
  event_id uuid not null unique references public.application_events (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  -- Copied from the event (events never change): the feed's badge, and the order of a bundle.
  kind text not null check (kind in ('saved', 'applied', 'confirmation', 'reply', 'info_request', 'scheduling', 'screen', 'assessment', 'interview', 'offer', 'rejection', 'withdrawn', 'follow_up', 'stage_set')),
  occurred_at timestamptz not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 200),
  -- Where it opens: that application's page, and nowhere else.
  url text not null check (url ~ '^/applications/[A-Za-z0-9-]{1,64}$'),
  -- 'push' pings your phone; 'brief' waits for the next brief; 'quiet' is only in the feed.
  tier text not null check (tier in ('push', 'brief', 'quiet')),
  sent_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_feed on public.notifications (owner_id, occurred_at desc);
create index if not exists notifications_unsent on public.notifications (owner_id, tier, occurred_at) where sent_at is null;

alter table public.notifications enable row level security;
drop policy if exists owner_read on public.notifications;
create policy owner_read on public.notifications for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
-- Marking a row read is the one change a session may make (the column grant below).
drop policy if exists owner_seen on public.notifications;
create policy owner_seen on public.notifications for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.notifications from authenticated, anon;
grant select on public.notifications to authenticated;
grant update (seen_at) on public.notifications to authenticated;
