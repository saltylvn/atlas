-- Agent orchestration, step 1: the Chief of Staff and Mission Control.
--
--   agent_runs   the activity log. Every agent writes a row when it starts, finishes,
--                fails or is skipped (agent, task, status, time, model, tokens, cost).
--                Append-only, like the audit trail. Mission Control reads it.
--   agent_state  per-agent pause switch. The scheduler checks it before each run.
--   briefs       brief history: every 9:00 AM, 2:00 PM and Saturday brief, kept and
--                searchable. One row per day and slot; a re-run replaces that slot.
--
-- The roster becomes the six agents of the plan. Old ledger rows are mapped across.

-- ---------------------------------------------------------------------------
-- Six-agent roster for the time-saved ledger

alter table public.time_ledger drop constraint if exists time_ledger_agent_check;
update public.time_ledger set agent = case agent
  when 'planner' then 'chief-of-staff'
  when 'guardian' then 'chief-of-staff'
  when 'comms' then 'email'
  when 'researcher' then 'news'
  when 'career-scout' then 'career'
  else agent end;
alter table public.time_ledger
  add constraint time_ledger_agent_check check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career'));

-- ---------------------------------------------------------------------------
-- Activity log

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  run_id uuid not null,
  agent text not null check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career')),
  task text not null check (char_length(task) between 1 and 200),
  status text not null check (status in ('started', 'succeeded', 'failed', 'skipped')),
  trigger text not null default 'schedule' check (trigger in ('schedule', 'run-now', 'owner')),
  detail text not null default '' check (char_length(detail) <= 500),
  model text not null default '' check (char_length(model) <= 60),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  at timestamptz not null default now()
);
create index agent_runs_owner_at on public.agent_runs (owner_id, at desc);
create index agent_runs_owner_agent_at on public.agent_runs (owner_id, agent, at desc);

alter table public.agent_runs enable row level security;
create policy owner_read on public.agent_runs for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
create policy owner_insert on public.agent_runs for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.agent_runs from anon;
revoke update, delete, truncate on public.agent_runs from authenticated;

-- ---------------------------------------------------------------------------
-- Pause switches

create table public.agent_state (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  agent text not null check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career')),
  paused boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, agent)
);

alter table public.agent_state enable row level security;
create policy owner_all on public.agent_state for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.agent_state from anon;

-- ---------------------------------------------------------------------------
-- Brief history

create table public.briefs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  for_date date not null,
  slot text not null check (slot in ('morning', 'afternoon', 'saturday')),
  headline text not null check (char_length(headline) between 1 and 300),
  report jsonb not null check (pg_column_size(report) < 262144),
  -- Plain text of the brief (headline, summary, hot list, story titles) for search.
  search text not null default '' check (char_length(search) <= 20000),
  created_at timestamptz not null default now(),
  unique (owner_id, for_date, slot)
);
create index briefs_owner_date on public.briefs (owner_id, for_date desc);

alter table public.briefs enable row level security;
create policy owner_read on public.briefs for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
create policy owner_write on public.briefs for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
create policy owner_rewrite on public.briefs for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
-- History is kept: briefs can be regenerated for their slot, never deleted from the app.
revoke all on public.briefs from anon;
revoke delete, truncate on public.briefs from authenticated;

-- ---------------------------------------------------------------------------
-- Retention: the activity log keeps 180 days.

create or replace function private.prune()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.job_hunt_snapshots where received_at < now() - interval '90 days';
  delete from public.audit_events where at < now() - interval '365 days';
  delete from public.inbox_items where received_at < now() - interval '30 days';
  delete from public.agent_runs where at < now() - interval '180 days';
$$;
