-- Google Calendar can be connected on its own (provider 'google_calendar'), read-only, so Atlas
-- shows your events in Google's colors. It is one more row in the existing connections table,
-- under the same RLS; no new table and no change to existing rows.
alter table public.connections
  drop constraint if exists connections_provider_check;
alter table public.connections
  add constraint connections_provider_check check (provider in ('google', 'gmail_imap', 'google_calendar'));
