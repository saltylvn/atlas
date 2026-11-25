-- The agent runtime (docs/AGENT-ARCHITECTURE.md, 23 Nov 2026).
--
--   agent_state   each agent run's typed state: the goal, what it found, the steps it took and
--                 what remains. Saved after every step, so a run cut off by the function's time
--                 limit resumes at the next sync instead of starting over; it is also the trace
--                 of the run's trajectory.
--   agent_memory  short dated lessons an agent keeps between runs. A lesson expires unless
--                 outcomes confirm it.
--
-- You read both; only the server (the agents, with the service role) writes them.

create table if not exists public.agent_state (
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
create index if not exists agent_state_owner_agent on public.agent_state (owner_id, agent, updated_at desc);

create table if not exists public.agent_memory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  agent text not null check (char_length(agent) between 1 and 40),
  lesson text not null check (char_length(lesson) between 1 and 300),
  evidence text not null default '' check (char_length(evidence) <= 300),
  confirmed integer not null default 0 check (confirmed >= 0),
  expires_on date not null,
  created_at timestamptz not null default now()
);
create index if not exists agent_memory_owner_agent on public.agent_memory (owner_id, agent, expires_on desc);

alter table public.agent_state enable row level security;
alter table public.agent_memory enable row level security;
drop policy if exists owner_read on public.agent_state;
create policy owner_read on public.agent_state for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
drop policy if exists owner_read on public.agent_memory;
create policy owner_read on public.agent_memory for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.agent_state from authenticated, anon;
revoke all on public.agent_memory from authenticated, anon;
grant select on public.agent_state to authenticated;
grant select on public.agent_memory to authenticated;
