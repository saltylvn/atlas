-- The tech job market, read broadly (lib/domain/techMarket.ts). Three tables, written only by
-- the Scout through the owner-scoped service store; you can read them, nothing else.
--   tech_postings   the cleaned layer: one row per tech job, duplicates across sources merged.
--                   Kept 60 days after it was last seen.
--   market_daily    the summary: one row per day, role family, seniority and region. Kept for good.
--   market_quality  how each day's latest Scout run went, source by source.
-- Additive and safe to run more than once.

create table if not exists public.tech_postings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fingerprint text not null check (char_length(fingerprint) between 1 and 300),
  title text not null check (char_length(title) between 1 and 200),
  company text not null check (char_length(company) between 1 and 160),
  family text not null check (family in ('software', 'ai-ml', 'data', 'devops-cloud', 'security', 'solutions', 'product', 'it-support')),
  seniority text not null check (seniority in ('intern', 'junior', 'mid', 'senior', 'staff+', 'manager', 'unstated')),
  mode text not null check (mode in ('remote', 'hybrid', 'onsite', 'unstated')),
  region text not null check (region in ('utah', 'us', 'unstated')),
  pay_min integer check (pay_min is null or pay_min between 20000 and 1000000),
  pay_max integer check (pay_max is null or pay_max between 20000 and 1000000),
  skills text[] not null default '{}' check (cardinality(skills) <= 30),
  sources text[] not null check (cardinality(sources) between 1 and 10),
  url text not null check (char_length(url) <= 600 and url ~ '^https://'),
  posted_at timestamptz,
  first_seen date not null,
  last_seen date not null,
  created_at timestamptz not null default now(),
  unique (owner_id, fingerprint)
);
create index if not exists tech_postings_owner_seen on public.tech_postings (owner_id, last_seen desc);

alter table public.tech_postings enable row level security;
drop policy if exists owner_read on public.tech_postings;
create policy owner_read on public.tech_postings for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.tech_postings from authenticated, anon;
grant select on public.tech_postings to authenticated;

create table if not exists public.market_daily (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  family text not null check (family in ('software', 'ai-ml', 'data', 'devops-cloud', 'security', 'solutions', 'product', 'it-support')),
  seniority text not null check (seniority in ('intern', 'junior', 'mid', 'senior', 'staff+', 'manager', 'unstated')),
  region text not null check (region in ('utah', 'us', 'unstated')),
  active integer not null check (active >= 0),
  added integer not null check (added >= 0),
  gone integer not null check (gone >= 0),
  remote integer not null check (remote >= 0),
  with_pay integer not null check (with_pay >= 0),
  pay_median integer check (pay_median is null or pay_median between 20000 and 1000000),
  created_at timestamptz not null default now(),
  unique (owner_id, day, family, seniority, region)
);
create index if not exists market_daily_owner_day on public.market_daily (owner_id, day desc);

alter table public.market_daily enable row level security;
drop policy if exists owner_read on public.market_daily;
create policy owner_read on public.market_daily for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.market_daily from authenticated, anon;
grant select on public.market_daily to authenticated;

create table if not exists public.market_quality (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null,
  report jsonb not null check (jsonb_typeof(report) = 'object' and pg_column_size(report) < 16384),
  created_at timestamptz not null default now(),
  unique (owner_id, day)
);

alter table public.market_quality enable row level security;
drop policy if exists owner_read on public.market_quality;
create policy owner_read on public.market_quality for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.market_quality from authenticated, anon;
grant select on public.market_quality to authenticated;
