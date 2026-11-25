-- People: your closest people in six categories, four places each, and texts you schedule.
--
--   contacts.category   spouse, family, friends, colleagues, mentors or church; null when the
--                       person is in Atlas but not placed (for example, just added from your phone)
--   contacts.slot       1 to 4: their place in the category
--   messages.remind_at  a text you scheduled: Atlas reminds you then, and you send it yourself
--   messages.reminded_at when the reminder went out, so it goes out once
--
-- The tables keep their owner-only policies from the first migration; only columns are added.
-- One person per place: the unique index refuses a second person in a taken place.

alter table public.contacts
  add column if not exists category text check (category is null or category in ('spouse', 'family', 'friends', 'colleagues', 'mentors', 'church')),
  add column if not exists slot smallint check (slot is null or slot between 1 and 4);
alter table public.contacts drop constraint if exists contacts_slot_needs_category;
alter table public.contacts add constraint contacts_slot_needs_category check ((slot is null) = (category is null));
create unique index if not exists contacts_one_per_place on public.contacts (owner_id, category, slot) where category is not null;

alter table public.messages
  add column if not exists remind_at timestamptz,
  add column if not exists reminded_at timestamptz;
create index if not exists messages_owner_remind on public.messages (owner_id, remind_at) where remind_at is not null and reminded_at is null;
