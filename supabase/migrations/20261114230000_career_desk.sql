-- The Career desk: the Career Agent's work split across four agents.
--
--   scout      reads the public job feeds and records what the market looks like
--   analyst    turns those rows into a daily market report: demand, pay, fit, gaps
--   career     the Applications Agent (its id is unchanged, so its history is unbroken)
--   mentor     reviews the whole job hunt three times a day and offers one or two insights
--
-- They never call each other. Each writes its own table and the next one reads it:
--   market_postings   written by the Scout, read by the Analyst
--   market_reports    written by the Analyst, read by the Mentor and the Growth page
--   mentor_insights   written by the Mentor; you may only mark one done or dismissed
--
-- All three are owner-only on a two-step session, like every table. The agents write with
-- the service role (scheduled jobs have no browser session); your own session can read,
-- and can change exactly one thing: an insight's status.

-- ---------------------------------------------------------------------------
-- 1. The roster: nine agents.
alter table public.agent_runs drop constraint agent_runs_agent_check;
alter table public.agent_runs add constraint agent_runs_agent_check
  check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career', 'scout', 'analyst', 'mentor'));
alter table public.agent_state drop constraint agent_state_agent_check;
alter table public.agent_state add constraint agent_state_agent_check
  check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career', 'scout', 'analyst', 'mentor'));
alter table public.time_ledger drop constraint time_ledger_agent_check;
alter table public.time_ledger add constraint time_ledger_agent_check
  check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career', 'scout', 'analyst', 'mentor'));

-- ---------------------------------------------------------------------------
-- 2. The Scout's observations. One row per posting that is one of your roles, kept even
-- when it pays under your floor or is in the wrong place: that is still the market.
create table public.market_postings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 600),
  title text not null check (char_length(title) between 1 and 200),
  company text not null check (char_length(company) between 1 and 160),
  source text not null check (char_length(source) between 1 and 80),
  url text not null check (char_length(url) <= 600 and url ~ '^https://'),
  location text not null default '' check (char_length(location) <= 200),
  role text not null check (char_length(role) between 1 and 80),
  type text not null check (type in ('full-time', 'gig')),
  place text not null check (place in ('remote', 'salt-lake', 'other')),
  pay_min integer check (pay_min is null or pay_min >= 0),
  pay_max integer check (pay_max is null or pay_max >= 0),
  pay_unit text not null default '' check (pay_unit in ('year', 'hour', '')),
  skills text[] not null default '{}' check (cardinality(skills) <= 30),
  posted_at timestamptz,
  -- first_seen is never sent by the app: it is set once, when the row is created.
  first_seen date not null default current_date,
  last_seen date not null default current_date,
  created_at timestamptz not null default now(),
  unique (owner_id, key)
);
create index market_postings_owner_seen on public.market_postings (owner_id, last_seen desc);

alter table public.market_postings enable row level security;
create policy owner_read on public.market_postings for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.market_postings from authenticated, anon;
grant select on public.market_postings to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The Analyst's report: one a day. The numbers and how they were worded.
create table public.market_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  for_date date not null,
  report jsonb not null check (jsonb_typeof(report) = 'object' and pg_column_size(report) < 32768),
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) < 8192),
  created_at timestamptz not null default now(),
  unique (owner_id, for_date)
);

alter table public.market_reports enable row level security;
create policy owner_read on public.market_reports for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.market_reports from authenticated, anon;
grant select on public.market_reports to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The Mentor's insights. Each keeps the facts it rests on, so you can check it.
create table public.mentor_insights (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  for_date date not null,
  slot text not null check (slot in ('morning', 'midday', 'evening')),
  key text not null check (char_length(key) between 1 and 200),
  area text not null check (area in ('activity', 'queue', 'results', 'targeting', 'skills', 'resume', 'profile', 'gigs', 'win')),
  title text not null check (char_length(title) between 1 and 160),
  body text not null check (char_length(body) between 1 and 600),
  action text not null check (char_length(action) between 1 and 400),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array' and pg_column_size(evidence) < 4096),
  metric text not null default '' check (char_length(metric) <= 300),
  writer text not null check (writer in ('model', 'rules')),
  status text not null default 'new' check (status in ('new', 'done', 'dismissed')),
  created_at timestamptz not null default now()
);
create index mentor_insights_owner_at on public.mentor_insights (owner_id, created_at desc);

alter table public.mentor_insights enable row level security;
create policy owner_read on public.mentor_insights for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
create policy owner_status on public.mentor_insights for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.mentor_insights from authenticated, anon;
grant select on public.mentor_insights to authenticated;
grant update (status) on public.mentor_insights to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Retention: a posting the Scout has not seen for 120 days, and reports and insights
-- older than 180, are deleted with the rest.
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
$$;
revoke execute on function private.prune() from public, anon, authenticated;
