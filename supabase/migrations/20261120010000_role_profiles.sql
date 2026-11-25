-- Target Roles: what each of your top roles is, written weekly.
--
--   role_profiles   one row per role per week: what the role does, its tempo, a project to
--                   build and the gap to close first, as worded by the Mentor's model from
--                   the Analyst's facts, with those facts kept beside it. Written by the
--                   Mentor (service role). You may only read it.
--
-- Owner-only on a two-step session, like every table. Nothing here is sent anywhere, and
-- nothing here changes your roles: the four roles come from the Priority column in Notion.

create table public.role_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (char_length(role) between 2 and 80),
  for_week date not null,
  does text not null check (char_length(does) between 40 and 700),
  tempo text not null check (char_length(tempo) between 30 and 500),
  project text not null check (char_length(project) between 30 and 500),
  close_skill text not null default '' check (char_length(close_skill) <= 60),
  close_why text not null default '' check (char_length(close_why) <= 400),
  postings integer not null default 0 check (postings >= 0),
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array' and pg_column_size(facts) < 8192),
  writer text not null default 'model' check (writer = 'model'),
  created_at timestamptz not null default now(),
  unique (owner_id, role, for_week)
);
create index role_profiles_owner_week on public.role_profiles (owner_id, for_week desc);

alter table public.role_profiles enable row level security;
create policy owner_read on public.role_profiles for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.role_profiles from authenticated, anon;
grant select on public.role_profiles to authenticated;

-- Retention: profiles older than 60 days go with the rest. The function is restated whole.
create or replace function private.prune()
returns void
language sql
security definer
set search_path = ''
as $$
  select set_config('atlas.retention', 'on', true);
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
  delete from public.role_profiles where for_week < current_date - 60;
  select set_config('atlas.retention', '', true);
$$;
revoke execute on function private.prune() from public, anon, authenticated;
