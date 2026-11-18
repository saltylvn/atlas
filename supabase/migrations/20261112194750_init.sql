-- Atlas Flow: single-owner personal operations database.
--
-- Security model (see docs/SECURITY.md and docs/NIST-CSF.md):
--   * Exactly one human account can exist. A trigger on auth.users refuses every
--     sign-up except the configured owner email.
--   * Every table has Row Level Security. A row is visible only to its owner, and only
--     when the session's JWT carries aal = 'aal2' (password/OAuth + TOTP). MFA is
--     enforced here, in the database, not only in the app.
--   * The audit trail is append-only: no update or delete policy, and those privileges
--     are revoked outright.
--   * Machine ingest (job-hunt snapshots) uses the service role and writes one table.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Owner configuration

create table private.config (
  key text primary key,
  value text not null
);

-- Set this once, before the first sign-in:
--   insert into private.config (key, value) values ('owner_email', 'you@example.com');

create table private.owner (
  user_id uuid primary key references auth.users (id) on delete cascade,
  enrolled_at timestamptz not null default now()
);

create or replace function private.guard_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed text;
begin
  select value into allowed from private.config where key = 'owner_email';
  if allowed is null or lower(new.email) is distinct from lower(allowed) then
    raise exception 'sign-ups are closed' using errcode = '42501';
  end if;
  if exists (select 1 from private.owner) then
    raise exception 'owner already enrolled' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_signup
  before insert on auth.users
  for each row execute function private.guard_signup();

create or replace function private.enroll_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.owner (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

create trigger enroll_owner
  after insert on auth.users
  for each row execute function private.enroll_owner();

-- True only for the enrolled owner on an MFA-verified (aal2) session.
create or replace function public.is_owner_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
     and exists (select 1 from private.owner o where o.user_id = (select auth.uid()));
$$;

revoke all on function public.is_owner_aal2() from public, anon;
grant execute on function public.is_owner_aal2() to authenticated;

-- ---------------------------------------------------------------------------
-- Tables

create table public.settings (
  owner_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 32768),
  updated_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  status text not null default 'todo' check (status in ('todo', 'doing', 'stuck', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  area text not null default 'work' check (area in ('work', 'career', 'family', 'health', 'home', 'finance', 'personal')),
  day date,
  start_time text check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  estimate_min integer not null default 30 check (estimate_min between 5 and 600),
  energy text not null default 'shallow' check (energy in ('deep', 'shallow')),
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekdays', 'weekly')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index tasks_owner_day on public.tasks (owner_id, day);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  week_of date not null,
  title text not null check (char_length(title) between 1 and 200),
  area text not null check (area in ('work', 'career', 'family', 'health', 'home', 'finance', 'personal')),
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  circle text not null check (circle in ('team', 'family', 'friends', 'network')),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or phone ~ '^\+?[0-9 ()-]{7,20}$'),
  cadence_days integer not null default 0 check (cadence_days between 0 and 365),
  last_contact_at timestamptz,
  birthday text check (birthday is null or birthday ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  subject text not null default '' check (char_length(subject) <= 200),
  body text not null check (char_length(body) between 1 and 5000),
  status text not null default 'draft' check (status in ('draft', 'handed_off', 'cancelled')),
  drafted_by text not null check (drafted_by in ('ai', 'template', 'you')),
  created_at timestamptz not null default now(),
  handed_off_at timestamptz
);

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  slot text not null check (slot in ('morning', 'evening', 'weekly-review')),
  minutes integer not null default 5 check (minutes between 1 and 240),
  position integer not null default 0,
  last_done_on date,
  created_at timestamptz not null default now()
);

create table public.job_watches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company text not null check (char_length(company) between 1 and 80),
  board text not null check (board in ('greenhouse', 'lever', 'ashby')),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  created_at timestamptz not null default now(),
  unique (owner_id, board, slug)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  actor text not null check (actor in ('owner', 'system', 'job-hunt', 'ai')),
  action text not null check (char_length(action) <= 80),
  target text not null default '' check (char_length(target) <= 200),
  detail text not null default '' check (char_length(detail) <= 300),
  outcome text not null check (outcome in ('success', 'denied', 'error'))
);
create index audit_owner_at on public.audit_events (owner_id, at desc);

create table public.time_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  agent text not null check (agent in ('chief-of-staff', 'planner', 'comms', 'researcher', 'career-scout', 'guardian')),
  activity text not null check (char_length(activity) <= 200),
  minutes_saved integer not null check (minutes_saved between 0 and 240)
);

create table public.job_hunt_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  received_at timestamptz not null default now(),
  payload jsonb not null check (pg_column_size(payload) < 524288)
);
create index job_hunt_owner_received on public.job_hunt_snapshots (owner_id, received_at desc);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  at timestamptz not null default now(),
  purpose text not null check (char_length(purpose) <= 40)
);
create index ai_usage_owner_at on public.ai_usage (owner_id, at);

-- ---------------------------------------------------------------------------
-- Row Level Security

alter table public.settings enable row level security;
alter table public.tasks enable row level security;
alter table public.goals enable row level security;
alter table public.contacts enable row level security;
alter table public.messages enable row level security;
alter table public.routines enable row level security;
alter table public.job_watches enable row level security;
alter table public.audit_events enable row level security;
alter table public.time_ledger enable row level security;
alter table public.job_hunt_snapshots enable row level security;
alter table public.ai_usage enable row level security;

-- Full read/write for the owner on an aal2 session.
do $$
declare
  t text;
begin
  foreach t in array array['settings', 'tasks', 'goals', 'contacts', 'messages', 'routines', 'job_watches']
  loop
    execute format(
      'create policy owner_all on public.%I for all to authenticated
         using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
         with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))',
      t);
  end loop;
end;
$$;

-- Append-only tables: read and insert, never update or delete.
do $$
declare
  t text;
begin
  foreach t in array array['audit_events', 'time_ledger', 'ai_usage']
  loop
    execute format(
      'create policy owner_read on public.%I for select to authenticated
         using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))', t);
    execute format(
      'create policy owner_insert on public.%I for insert to authenticated
         with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))', t);
    execute format('revoke update, delete, truncate on public.%I from authenticated, anon', t);
  end loop;
end;
$$;

-- Snapshots are written by the service role (ingest) and only read by the owner.
create policy owner_read on public.job_hunt_snapshots for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke insert, update, delete, truncate on public.job_hunt_snapshots from authenticated, anon;

-- The anonymous role gets nothing.
revoke all on all tables in schema public from anon;

-- Keep 90 days of snapshots and a year of audit events (run from a scheduled job, or by hand).
create or replace function private.prune()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.job_hunt_snapshots where received_at < now() - interval '90 days';
  delete from public.audit_events where at < now() - interval '365 days';
$$;
