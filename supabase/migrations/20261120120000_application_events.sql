-- The Pipeline, phase 0 (docs/design-pipeline.md, approved 20 Nov 2026): every application
-- gets a timeline.
--
--   application_events   one row per thing that happened to an application: you applied,
--                        a company's email arrived, you followed up, you moved it by hand.
--                        Rows are only ever added. Where an application stands is worked
--                        out from them (lib/domain/pipeline.ts).
--   applications.stage   the finer stage behind the six-value status (a screen, an
--                        assessment and an interview all read as status 'interview').
--                        Null means "the same as the status": every reader checks it
--                        against the status and falls back to the status when they differ.
--   applications.last_heard_at   when the company last wrote, not counting the automatic
--                        "we received your application".
--
-- Nothing that reads status changes. No email text is stored here: summary holds a kind
-- label, a subject, or the one cleaned sentence the reader already keeps on the inbox row.

alter table public.applications
  add column if not exists stage text
    check (stage is null or stage in ('saved', 'applied', 'in_review', 'screen', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn')),
  add column if not exists last_heard_at timestamptz;

create table public.application_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  application_id uuid not null references public.applications (id) on delete cascade,
  kind text not null check (kind in ('saved', 'applied', 'confirmation', 'reply', 'info_request', 'scheduling', 'screen', 'assessment', 'interview', 'offer', 'rejection', 'withdrawn', 'follow_up', 'stage_set')),
  occurred_at timestamptz not null,
  source text not null check (source in ('email', 'calendar', 'you', 'apply-agent', 'atlas')),
  -- What it came from ("email:<message id>", "you:<uuid>"), so nothing is logged twice.
  source_ref text not null check (char_length(source_ref) between 1 and 600),
  thread_id text not null default '' check (char_length(thread_id) <= 200),
  -- Who decided what it means. A 'model' row is a suggestion and never moves a stage.
  decided_by text not null default 'rules' check (decided_by in ('rules', 'model', 'you')),
  -- Only for kind 'stage_set': the stage it was set to.
  stage text check (stage is null or stage in ('saved', 'applied', 'in_review', 'screen', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn')),
  summary text not null default '' check (char_length(summary) <= 300),
  created_at timestamptz not null default now(),
  check ((kind = 'stage_set') = (stage is not null)),
  unique (owner_id, source_ref, kind)
);
create index application_events_app on public.application_events (owner_id, application_id, occurred_at);
create index application_events_thread on public.application_events (owner_id, thread_id) where thread_id <> '';

alter table public.application_events enable row level security;
create policy owner_read on public.application_events for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
-- The owner's own clicks add events (a status picked on the board, a follow-up marked sent),
-- and only for an application that is theirs.
create policy owner_insert on public.application_events for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select public.is_owner_aal2())
    and exists (select 1 from public.applications a where a.id = application_id and a.owner_id = (select auth.uid()))
  );
-- Append-only by privilege: a session can read and add, never change or delete. (Not the
-- audit tables' trigger: deleting an application must still be able to take its timeline
-- with it.)
revoke all on public.application_events from authenticated, anon;
grant select, insert on public.application_events to authenticated;

-- The timeline starts with what is already known. One "applied" event on the day you
-- applied, and, for an application that has moved since, where it stood when the timeline
-- began. Safe to run again: the unique key skips rows already there.
insert into public.application_events (owner_id, application_id, kind, occurred_at, source, source_ref, decided_by, summary)
select owner_id, id, 'applied', least((applied_on + time '12:00') at time zone 'UTC', status_at), 'atlas', 'backfill:' || id, 'rules',
       case when tier = 'auto' then 'Applied by Atlas' else 'Applied' end
from public.applications
where applied_on is not null and status <> 'saved'
on conflict do nothing;

insert into public.application_events (owner_id, application_id, kind, occurred_at, source, source_ref, decided_by, stage, summary)
select owner_id, id, 'stage_set', status_at, 'atlas', 'backfill:' || id, 'rules',
       case status when 'replied' then 'in_review' else status end,
       'Where it stood when the timeline began'
from public.applications
where status <> 'applied' or applied_on is null
on conflict do nothing;
