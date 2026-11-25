-- The apply brief's research (lib/agents/briefResearch.ts): for each job in the Apply Queue, the
-- company's recent news headlines, links to its own pages, and the Gemini angle with its cited
-- facts. One row per apply kit. Owner-only, like every table; only the server writes.
-- Additive and safe to run more than once.

create table if not exists public.apply_briefs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  approval_id uuid not null,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 32768),
  researched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, approval_id)
);

alter table public.apply_briefs enable row level security;
-- You read your briefs; only the server (the Applications Agent, with the service role) writes them.
drop policy if exists owner_read on public.apply_briefs;
create policy owner_read on public.apply_briefs for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.apply_briefs from authenticated, anon;
grant select on public.apply_briefs to authenticated;
