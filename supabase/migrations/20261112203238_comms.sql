-- Comms: Slack as a third hand-off channel, and saved reusable snippets.
-- Additive: new nullable columns and a new table. The messages.channel check is
-- widened (replaced with a superset) so existing rows stay valid.

-- Slack IDs on contacts. Both are needed to open the DM (slack://user?team=T&id=U).
alter table public.contacts
  add column if not exists slack_team_id text check (slack_team_id is null or slack_team_id ~ '^T[A-Z0-9]{2,20}$'),
  add column if not exists slack_user_id text check (slack_user_id is null or slack_user_id ~ '^[UW][A-Z0-9]{2,20}$');

-- Hand-offs can now go to Slack.
alter table public.messages drop constraint if exists messages_channel_check;
alter table public.messages
  add constraint messages_channel_check check (channel in ('email', 'sms', 'slack'));

-- Reusable snippets, one channel each. {first}, {name} and {me} are filled in the app.
create table if not exists public.snippets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'slack')),
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.snippets enable row level security;

create policy owner_all on public.snippets for all to authenticated
  using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))
  with check (owner_id = (select auth.uid()) and (select public.is_owner_aal2()));
