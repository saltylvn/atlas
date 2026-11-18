-- Connections, inbox triage, projects and push notifications.
--
-- Same rules as the first migration: every row belongs to the owner and is visible only
-- on an MFA-verified (aal2) session. Two extra guards here:
--   * OAuth refresh tokens are stored encrypted by the app (AES-256-GCM, key in the
--     ATLAS_VAULT_KEY env var), and the owner's own session cannot even read the
--     ciphertext column. Only server code with the secret key touches it.
--   * Inbox rows hold headers and a short snippet, never message bodies, and are pruned
--     after 30 days.

-- ---------------------------------------------------------------------------
-- Connections (one row per provider)

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google')),
  account_email text not null default '' check (char_length(account_email) <= 200),
  scopes text not null default '' check (char_length(scopes) <= 1000),
  secret text check (char_length(secret) <= 4000),
  status text not null default 'active' check (status in ('active', 'error')),
  last_sync_at timestamptz,
  last_error text not null default '' check (char_length(last_error) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

alter table public.connections enable row level security;
create policy owner_read on public.connections for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
-- Writes happen only in server code with the secret key. The owner's session may read
-- every column except the encrypted token.
revoke all on public.connections from authenticated, anon;
grant select (id, owner_id, provider, account_email, scopes, status, last_sync_at, last_error, created_at, updated_at)
  on public.connections to authenticated;

-- ---------------------------------------------------------------------------
-- Inbox triage (written by the Gmail sync, read and checked off by the owner)

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  message_id text not null check (message_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  thread_id text not null check (thread_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  from_name text not null default '' check (char_length(from_name) <= 120),
  from_email text not null default '' check (char_length(from_email) <= 200),
  subject text not null default '' check (char_length(subject) <= 300),
  snippet text not null default '' check (char_length(snippet) <= 300),
  received_at timestamptz not null,
  category text not null check (category in ('reply', 'fyi', 'noise')),
  reason text not null default '' check (char_length(reason) <= 120),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, message_id)
);
create index inbox_owner_received on public.inbox_items (owner_id, received_at desc);

alter table public.inbox_items enable row level security;
create policy owner_read on public.inbox_items for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
create policy owner_check_off on public.inbox_items for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
-- The owner can only flip "done"; everything else is written by the sync.
revoke all on public.inbox_items from authenticated, anon;
grant select on public.inbox_items to authenticated;
grant update (done) on public.inbox_items to authenticated;

-- ---------------------------------------------------------------------------
-- Projects and ideas worth keeping in mind

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  kind text not null check (kind in ('idea', 'side-project', 'career', 'learning', 'home', 'other')),
  status text not null default 'idea' check (status in ('idea', 'exploring', 'active', 'parked', 'done')),
  why text not null default '' check (char_length(why) <= 1000),
  next_step text not null default '' check (char_length(next_step) <= 300),
  link text check (link is null or (link ~ '^https://' and char_length(link) <= 500)),
  review_on date,
  created_at timestamptz not null default now()
);

alter table public.projects enable row level security;
create policy owner_all on public.projects for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));

-- ---------------------------------------------------------------------------
-- Web push subscriptions (one per installed device)

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) <= 200),
  auth text not null check (char_length(auth) <= 100),
  device text not null default '' check (char_length(device) <= 80),
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
create policy owner_all on public.push_subscriptions for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke update on public.push_subscriptions from authenticated;

revoke all on public.connections, public.inbox_items, public.projects, public.push_subscriptions from anon;

-- ---------------------------------------------------------------------------
-- Retention: inbox rows live 30 days.

create or replace function private.prune()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.job_hunt_snapshots where received_at < now() - interval '90 days';
  delete from public.audit_events where at < now() - interval '365 days';
  delete from public.inbox_items where received_at < now() - interval '30 days';
$$;
