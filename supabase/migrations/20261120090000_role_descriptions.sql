-- Target Roles: what each role is about, refreshed once a month.
--
--   role_descriptions   one row per role per month: two or three sentences on what the role
--                       is, written by the Mentor's model from the Analyst's posting facts
--                       and a Firecrawl web search (result snippets only), with the 1 to 3
--                       sources it used (title, https link, site). Written by the Mentor
--                       (service role). You may only read it. Display-only.
--
-- Owner-only on a two-step session, like every table. Nothing here is sent anywhere.

create table public.role_descriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role text not null check (char_length(role) between 2 and 80),
  for_month text not null check (for_month ~ '^\d{4}-\d{2}$'),
  description text not null check (char_length(description) between 120 and 700),
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 3 and pg_column_size(sources) < 4096),
  postings integer not null default 0 check (postings >= 0),
  searched_on date not null,
  created_at timestamptz not null default now(),
  unique (owner_id, role, for_month)
);
create index role_descriptions_owner_month on public.role_descriptions (owner_id, for_month desc);

alter table public.role_descriptions enable row level security;
create policy owner_read on public.role_descriptions for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.role_descriptions from authenticated, anon;
grant select on public.role_descriptions to authenticated;

-- Retention: descriptions older than 400 days go with the rest. The function is restated whole.
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
  delete from public.role_descriptions where created_at < now() - interval '400 days';
  select set_config('atlas.retention', '', true);
$$;
revoke execute on function private.prune() from public, anon, authenticated;
