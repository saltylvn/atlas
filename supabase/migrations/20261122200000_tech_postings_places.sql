-- Where each tech posting is, for the job maps on the Market page (lib/domain/jobMap.ts):
--   city    the Utah city the posting names, for the Utah map; null elsewhere or when none is named
--   states  the U.S. states it names (two-letter codes): where an on-site job is, or which states a
--           remote one is open to, for the Remote USA map
-- Additive and safe to run more than once. Existing rows get null and an empty list, and fill in
-- at the next sync that sees them.

alter table public.tech_postings add column if not exists city text check (city is null or char_length(city) between 1 and 60);
alter table public.tech_postings add column if not exists states text[] not null default '{}' check (cardinality(states) <= 12);
