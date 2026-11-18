-- The QA Agent: a tenth agent that reviews Atlas itself once a week, from the records the
-- other agents already write. It writes one table, its own reports, with the service role;
-- your own session can only read them.

-- 1. The roster: ten agents.
alter table public.agent_runs drop constraint agent_runs_agent_check;
alter table public.agent_runs add constraint agent_runs_agent_check
  check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career', 'scout', 'analyst', 'mentor', 'qa'));
alter table public.agent_state drop constraint agent_state_agent_check;
alter table public.agent_state add constraint agent_state_agent_check
  check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career', 'scout', 'analyst', 'mentor', 'qa'));
alter table public.time_ledger drop constraint time_ledger_agent_check;
alter table public.time_ledger add constraint time_ledger_agent_check
  check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career', 'scout', 'analyst', 'mentor', 'qa'));

-- 2. Its reports: one per day it ran for. Findings hold counts, task names and times, never
-- the content of an email or a brief.
create table public.qa_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  for_date date not null,
  report jsonb not null check (jsonb_typeof(report) = 'object' and pg_column_size(report) < 65536),
  created_at timestamptz not null default now(),
  unique (owner_id, for_date)
);

alter table public.qa_reports enable row level security;
create policy owner_read on public.qa_reports for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.qa_reports from authenticated, anon;
grant select on public.qa_reports to authenticated;

-- 3. Retention: a year of weekly reviews.
create or replace function private.prune()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.audit_events where at < now() - interval '365 days';
  delete from public.inbox_items where received_at < now() - interval '30 days';
  delete from public.agent_runs where at < now() - interval '180 days';
  delete from public.job_matches where shown_on < current_date - 120 and status in ('new', 'dismissed') and rating = 0;
  delete from public.ai_usage where at < now() - interval '90 days';
  delete from public.market_postings where last_seen < current_date - 120;
  delete from public.market_reports where for_date < current_date - 180;
  delete from public.mentor_insights where created_at < now() - interval '180 days';
  delete from public.role_proposals where created_at < now() - interval '365 days';
  delete from public.qa_reports where for_date < current_date - 365;
$$;
revoke execute on function private.prune() from public, anon, authenticated;
