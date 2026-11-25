-- The Apply Agent (docs/design.md, approved 19 Nov 2026): the one agent that submits a job
-- application, on Greenhouse or Lever only, after the owner approves that application's
-- exact packet. This migration adds its agent id, the "auto" tier on applications, its own
-- table, and a private bucket for the resume PDFs it sends.

-- 1. The roster: eleven agents.
alter table public.agent_runs drop constraint agent_runs_agent_check;
alter table public.agent_runs add constraint agent_runs_agent_check
  check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career', 'scout', 'analyst', 'mentor', 'qa', 'apply'));
alter table public.agent_state drop constraint agent_state_agent_check;
alter table public.agent_state add constraint agent_state_agent_check
  check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career', 'scout', 'analyst', 'mentor', 'qa', 'apply'));
alter table public.time_ledger drop constraint time_ledger_agent_check;
alter table public.time_ledger add constraint time_ledger_agent_check
  check (agent in ('chief-of-staff', 'email', 'calendar', 'news', 'finance', 'career', 'scout', 'analyst', 'mentor', 'qa', 'apply'));

-- 2. Who submitted an application: "semi", the owner; "auto", the Apply Agent.
alter table public.applications drop constraint applications_tier_check;
alter table public.applications add constraint applications_tier_check check (tier in ('semi', 'auto'));

-- 3. One row per application in the auto lane. posting_key is unique per owner, so a posting
-- can never be applied to twice, whatever retries or tabs do.
create table public.apply_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  posting_key text not null check (char_length(posting_key) between 1 and 600),
  url text not null check (url ~ '^https://' and char_length(url) <= 600),
  company text not null default '' check (char_length(company) <= 160),
  title text not null default '' check (char_length(title) <= 300),
  role text not null default '' check (char_length(role) <= 80),
  site text not null check (site in ('greenhouse', 'lever')),
  approval_id uuid references public.approvals (id) on delete set null,
  state text not null default 'prepared' check (state in ('prepared', 'approved', 'submitting', 'submitted', 'unconfirmed', 'stopped')),
  packet jsonb not null default '[]' check (jsonb_typeof(packet) = 'array' and pg_column_size(packet) < 65536),
  why text not null default '' check (char_length(why) <= 1000),
  confirmation text not null default '' check (char_length(confirmation) <= 500),
  approved_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, posting_key)
);
create index apply_runs_owner_state on public.apply_runs (owner_id, state, created_at desc);

alter table public.apply_runs enable row level security;
create policy owner_read on public.apply_runs for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
create policy owner_update on public.apply_runs for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
-- The owner may read the lane and edit or approve a packet. Rows are created and moved
-- through submission by the server (service role), and never deleted from a session.
revoke all on public.apply_runs from authenticated, anon;
grant select on public.apply_runs to authenticated;
grant update (packet, state, approved_at) on public.apply_runs to authenticated;

-- 4. The resume PDF sent with each application: exported from Figma when the packet is
-- prepared, kept so the file the owner approved is the file that is sent. Private: the
-- owner may read; only the server writes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;
create policy resumes_owner_read on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.is_owner_aal2()));
