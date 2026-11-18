-- Career Agent, part 5a: job matches, the application tracker and the Approval Queue.
--
--   job_matches   every posting a brief showed (so no match is ever shown twice), with
--                 your thumbs up/down and whether you pursued it. Written by the
--                 Career Agent's scheduled run; you rate and pursue from the app.
--   applications  the application tracker behind the Applications board. Atlas is the
--                 tracker; job-hunt applications can be imported once (origin 'job-hunt').
--   approvals     the Approval Queue: anything waiting on you (applications now;
--                 gig proposals, follow-ups and outreach in later parts).

create table public.job_matches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (char_length(key) between 1 and 600),
  type text not null check (type in ('full-time', 'gig')),
  title text not null check (char_length(title) between 1 and 200),
  company text not null default '' check (char_length(company) <= 160),
  url text not null check (url ~ '^https?://' and char_length(url) <= 600),
  source text not null check (char_length(source) between 1 and 80),
  location text not null default '' check (char_length(location) <= 200),
  role text not null check (char_length(role) between 1 and 80),
  pay_text text not null default 'salary not listed' check (char_length(pay_text) <= 40),
  posted_at timestamptz,
  score integer not null default 0 check (score between -100 and 200),
  shown_on date not null,
  shown_slot text not null check (shown_slot in ('morning', 'afternoon', 'saturday')),
  rating smallint not null default 0 check (rating in (-1, 0, 1)),
  status text not null default 'new' check (status in ('new', 'pursuing', 'applied', 'dismissed')),
  created_at timestamptz not null default now(),
  unique (owner_id, key)
);
create index job_matches_owner_shown on public.job_matches (owner_id, shown_on desc);

alter table public.job_matches enable row level security;
create policy owner_read on public.job_matches for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
create policy owner_rate on public.job_matches for update to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
-- The owner can only rate a match and move it along; matches are written by the agent.
revoke all on public.job_matches from authenticated, anon;
grant select on public.job_matches to authenticated;
grant update (rating, status) on public.job_matches to authenticated;

create table public.applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  company text not null check (char_length(company) between 1 and 160),
  role text not null check (char_length(role) between 1 and 200),
  type text not null default 'full-time' check (type in ('full-time', 'gig')),
  target_role text not null default '' check (char_length(target_role) <= 80),
  source text not null default '' check (char_length(source) <= 80),
  url text not null default '' check (url = '' or (url ~ '^https?://' and char_length(url) <= 600)),
  pay_text text not null default '' check (char_length(pay_text) <= 40),
  tier text not null default 'semi' check (tier in ('semi')),
  status text not null default 'applied' check (status in ('saved', 'applied', 'replied', 'interview', 'offer', 'rejected')),
  applied_on date,
  status_at timestamptz not null default now(),
  notes text not null default '' check (char_length(notes) <= 2000),
  origin text not null default 'atlas' check (origin in ('atlas', 'job-hunt')),
  external_id text not null default '' check (char_length(external_id) <= 600),
  created_at timestamptz not null default now()
);
create index applications_owner_status on public.applications (owner_id, status, status_at desc);
-- An imported job-hunt application or a pursued match becomes at most one application.
create unique index applications_owner_external on public.applications (owner_id, external_id) where external_id <> '';

alter table public.applications enable row level security;
create policy owner_all on public.applications for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.applications from anon;

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null check (kind in ('application', 'gig-proposal', 'follow-up', 'outreach')),
  title text not null check (char_length(title) between 1 and 300),
  detail text not null default '' check (char_length(detail) <= 4000),
  url text not null default '' check (url = '' or (url ~ '^https?://' and char_length(url) <= 600)),
  match_id uuid references public.job_matches (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index approvals_owner_status on public.approvals (owner_id, status, created_at desc);
create unique index approvals_owner_match on public.approvals (owner_id, match_id) where match_id is not null;

alter table public.approvals enable row level security;
create policy owner_all on public.approvals for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.approvals from anon;
revoke delete, truncate on public.approvals from authenticated;

-- Retention: matches you never acted on are kept 120 days (long enough to never repeat).
create or replace function private.prune()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.job_hunt_snapshots where received_at < now() - interval '90 days';
  delete from public.audit_events where at < now() - interval '365 days';
  delete from public.inbox_items where received_at < now() - interval '30 days';
  delete from public.agent_runs where at < now() - interval '180 days';
  delete from public.job_matches where shown_on < current_date - 120 and status in ('new', 'dismissed') and rating = 0;
$$;
