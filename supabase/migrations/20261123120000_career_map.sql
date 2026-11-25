-- The Career Map (lib/domain/careerMap.ts, lib/agents/careerMap.ts):
--   1. tech_postings gains the years of experience and the certifications a posting's description
--      asks for (lib/domain/requirements.ts). Additive; existing rows fill in at the next sync that
--      reads them with a description.
--   2. career_maps keeps one snapshot of the map per week: paths, pay, skills and the Mentor's steps.
--      Owner-only, like every table. Safe to run more than once.

alter table public.tech_postings add column if not exists years_min integer check (years_min is null or years_min between 1 and 20);
alter table public.tech_postings add column if not exists certs text[] not null default '{}';

create table if not exists public.career_maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week date not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique (owner_id, week)
);

alter table public.career_maps enable row level security;
-- You read your maps; only the server (the Mentor, with the service role) writes them.
drop policy if exists owner_read on public.career_maps;
create policy owner_read on public.career_maps for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.career_maps from authenticated, anon;
grant select on public.career_maps to authenticated;
