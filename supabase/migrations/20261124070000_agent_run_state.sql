-- Agent run state in its own table.
--
-- 20261124030000_agent_runtime meant to create public.agent_state for each run's typed state,
-- but that name already belonged to the per-bot pause switches (20261113075745_agents), so
-- `create table if not exists` skipped it. Every agent run (Tailor, Researcher, Coach,
-- Planner, Nudger) then failed on its first state save or load (42703, column missing).
-- That migration also revoked write access on the pause table from signed-in sessions, so
-- the pause switches stopped saving.
--
-- This migration gives run state its own table, agent_run_state, and restores the pause
-- table's grants. Additive and safe to re-run.

create table if not exists public.agent_run_state (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  run_id text not null check (char_length(run_id) between 1 and 80),
  agent text not null check (char_length(agent) between 1 and 40),
  status text not null check (status in ('running', 'done', 'stopped', 'failed')),
  state jsonb not null check (jsonb_typeof(state) = 'object' and pg_column_size(state) < 65536),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (owner_id, run_id)
);
create index if not exists agent_run_state_owner_agent on public.agent_run_state (owner_id, agent, updated_at desc);

-- You read it; only the server (the agents, with the service role) writes it.
alter table public.agent_run_state enable row level security;
drop policy if exists owner_read on public.agent_run_state;
create policy owner_read on public.agent_run_state for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.agent_run_state from authenticated, anon;
grant select on public.agent_run_state to authenticated;

-- The pause switches: back to what 20261113075745_agents set up (owner_all covers reads too).
drop policy if exists owner_read on public.agent_state;
grant select, insert, update, delete on public.agent_state to authenticated;
