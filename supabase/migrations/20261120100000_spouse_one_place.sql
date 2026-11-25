-- People: Spouse has one place, not four (20 Nov 2026). The app already offers only place 1;
-- this keeps the database to the same rule. No contact was placed in spouse 2 to 4 when added.

alter table public.contacts drop constraint if exists contacts_spouse_one_place;
alter table public.contacts add constraint contacts_spouse_one_place check (category is distinct from 'spouse' or slot = 1);
