-- Bills, renewals and documents. The owner reads and writes their own rows at aal2.
-- A new migration, not an edit of the init file: that file may already be applied.

create table public.renewals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (kind in ('bill', 'renewal', 'document')),
  due_on date not null,
  lead_days integer not null default 14 check (lead_days between 0 and 90),
  cadence text not null check (cadence in ('once', 'monthly', 'yearly')),
  anchor_day integer not null check (anchor_day between 1 and 31),
  url text not null default '' check (
    url = ''
    or (
      char_length(url) <= 300
      and url ~ '^https://[A-Za-z0-9][^[:space:]]*$'
      and position('@' in url) = 0
    )
  ),
  notes text not null default '' check (char_length(notes) <= 300),
  created_at timestamptz not null default now()
);

create index renewals_owner_due on public.renewals (owner_id, due_on);

alter table public.renewals enable row level security;

revoke all on public.renewals from anon;
grant select, insert, update, delete on public.renewals to authenticated;

create policy owner_all on public.renewals for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
