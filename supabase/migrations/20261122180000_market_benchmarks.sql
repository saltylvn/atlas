-- National job-market benchmarks (lib/domain/benchmarks.ts): public BLS and FRED statistics the
-- Scout reads once a week. One row per series and period; a later read of the same period
-- (BLS revises its preliminary month) replaces the value. Kept for good: a few hundred small rows
-- a year. Written only by the owner-scoped service store; you can read it, nothing else.
-- Additive and safe to run more than once.

create table if not exists public.market_benchmarks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  series_id text not null check (series_id ~ '^[A-Z0-9]{4,40}$'),
  period date not null,
  value double precision not null,
  preliminary boolean not null default false,
  fetched_at timestamptz not null default now(),
  unique (owner_id, series_id, period)
);
create index if not exists market_benchmarks_owner_series on public.market_benchmarks (owner_id, series_id, period desc);

alter table public.market_benchmarks enable row level security;
drop policy if exists owner_read on public.market_benchmarks;
create policy owner_read on public.market_benchmarks for select to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
revoke all on public.market_benchmarks from authenticated, anon;
grant select on public.market_benchmarks to authenticated;
