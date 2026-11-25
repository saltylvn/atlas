-- People: your iPhone contact list, imported once by a Shortcut so any empty place on the
-- People tab can find anyone by typing (20 Nov 2026).
--
--   contacts.phonebook   true for a contact that came in with the whole-list import. They are
--                        searchable when you fill a place, and otherwise kept out of the lists
--                        and reminders until you place them. Same owner-only policies as every
--                        contact row; nothing here is sent anywhere.

alter table public.contacts add column if not exists phonebook boolean not null default false;
