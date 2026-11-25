-- Five target roles, owned by Atlas (19 Nov 2026), and a daily log of the skills each asks for.
--
--   role_skill_stats   one row per role per day: how many postings the role had in the
--                      Analyst's 30-day window and how many of them asked for each skill
--                      (top 30). Written by the Analyst (service role) with each market
--                      report; you may only read it. Averaged over weeks on Target Roles.
--                      Kept two years, so the history outlives the postings (120 days).
--
-- The role list went from seven to five. Old role names in stored rows are renamed to the
-- role they folded into, so a role's history stays whole:
--   AI + Automation Engineer, AI Workflow Engineer, GTM Engineer  ->  AI Automation Engineer
--   Implementation Engineer, Customer Success Engineer            ->  Solutions Engineer
--   Developer Advocate                                            ->  Software Engineer
--   AI Consultant                                                 ->  AI Engineer
-- Weekly profiles of retired names are removed; the Mentor writes the new role's next Monday.
-- Owner-only on a two-step session, like every table. Nothing here is sent anywhere.

create table public.role_skill_stats (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  for_date date not null,
  role text not null check (char_length(role) between 2 and 80),
  postings integer not null default 0 check (postings >= 0),
  skills jsonb not null default '[]'::jsonb check (jsonb_typeof(skills) = 'array' and jsonb_array_length(skills) <= 30 and pg_column_size(skills) < 8192),
  window_days integer not null default 30 check (window_days between 1 and 120),
  created_at timestamptz not null default now(),
  unique (owner_id, role, for_date)
);
create index role_skill_stats_owner_date on public.role_skill_stats (owner_id, for_date);

alter table public.role_skill_stats enable row level security;
create policy owner_read on public.role_skill_stats for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.role_skill_stats from authenticated, anon;
grant select on public.role_skill_stats to authenticated;

-- Old role names, renamed in place. Idempotent: a second run finds nothing to change.
create temporary table retired_roles (old text primary key, new text not null) on commit drop;
insert into retired_roles values
  ('AI + Automation Engineer', 'AI Automation Engineer'),
  ('AI Workflow Engineer', 'AI Automation Engineer'),
  ('GTM Engineer', 'AI Automation Engineer'),
  ('Implementation Engineer', 'Solutions Engineer'),
  ('Customer Success Engineer', 'Solutions Engineer'),
  ('Developer Advocate', 'Software Engineer'),
  ('AI Consultant', 'AI Engineer');

update public.market_postings m set role = r.new from retired_roles r where m.role = r.old;
update public.job_matches j set role = r.new from retired_roles r where j.role = r.old;
update public.applications a set target_role = r.new from retired_roles r where a.target_role = r.old;
delete from public.role_profiles p using retired_roles r where p.role = r.old;

-- Retention: snapshots older than two years go with the rest. The function is restated whole.
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
  delete from public.role_skill_stats where for_date < current_date - 730;
  select set_config('atlas.retention', '', true);
$$;
revoke execute on function private.prune() from public, anon, authenticated;
