-- Gmail can also be connected with an app password over IMAP (provider 'gmail_imap'),
-- which needs no Google review and does not expire weekly. The password is sealed by
-- the app exactly like the OAuth token, in the same column the owner's session cannot read.
alter table public.connections drop constraint if exists connections_provider_check;
alter table public.connections
  add constraint connections_provider_check check (provider in ('google', 'gmail_imap'));
