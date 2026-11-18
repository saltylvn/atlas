-- The role a job email's text names ("Senior AI Engineer"), read by rules alongside the
-- verdict, so an application logged as "Role not listed" can be filled in. Only the role
-- is kept, never the email.
alter table public.inbox_items
  add column text_role text not null default '' check (char_length(text_role) <= 160);
