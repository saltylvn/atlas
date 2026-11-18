-- The Mentor's view of your target roles.
--
--   portfolio_repos   your GitHub projects as the Scout last described them: stack and
--                     skills. Written by the Scout, read by the Analyst and the Growth page.
--   role_proposals    the Mentor's proposed order for your target roles. Written by the
--                     Mentor; you may only decide one (approve, dismiss). A row with the
--                     status 'declined' records that the Mentor itself judged no change.
--
-- Both are owner-only on a two-step session, like every table. The agents write with the
-- service role. Approving a proposal is what writes the order to Notion; that happens in
-- the app, never here.

create table public.portfolio_repos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  repo text not null check (char_length(repo) between 1 and 140),
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '' check (char_length(description) <= 300),
  url text not null default '' check (url = '' or (char_length(url) <= 300 and url ~ '^https://github\.com/')),
  is_private boolean not null default false,
  languages text[] not null default '{}' check (cardinality(languages) <= 6),
  topics text[] not null default '{}' check (cardinality(topics) <= 24),
  stack text[] not null default '{}' check (cardinality(stack) <= 20),
  skills text[] not null default '{}' check (cardinality(skills) <= 30),
  pushed_at timestamptz,
  checked_on date not null default current_date,
  created_at timestamptz not null default now(),
  unique (owner_id, repo)
);

alter table public.portfolio_repos enable row level security;
create policy owner_read on public.portfolio_repos for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.portfolio_repos from authenticated, anon;
grant select on public.portfolio_repos to authenticated;

create table public.role_proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  for_date date not null,
  base text[] not null check (cardinality(base) between 1 and 16),
  proposed text[] not null check (cardinality(proposed) between 1 and 16),
  added text[] not null default '{}' check (cardinality(added) <= 2),
  focus text[] not null default '{}' check (cardinality(focus) <= 3),
  headline text not null check (char_length(headline) between 1 and 200),
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array' and pg_column_size(reasons) < 8192),
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array' and pg_column_size(facts) < 16384),
  writer text not null check (writer in ('model', 'rules')),
  status text not null default 'new' check (status in ('new', 'approved', 'dismissed', 'stale', 'declined')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index role_proposals_owner_at on public.role_proposals (owner_id, created_at desc);

alter table public.role_proposals enable row level security;
create policy owner_read on public.role_proposals for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
create policy owner_decide on public.role_proposals for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.role_proposals from authenticated, anon;
grant select on public.role_proposals to authenticated;
grant update (status, decided_at) on public.role_proposals to authenticated;

-- Retention: proposals older than a year go with the rest.
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
$$;
revoke execute on function private.prune() from public, anon, authenticated;
