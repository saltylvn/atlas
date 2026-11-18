-- Career Agent, part 5c: the skills each matched posting asks for, so Atlas can track
-- which skills keep appearing in your matches (skill gaps) and suggest projects.

alter table public.job_matches
  add column skills text[] not null default '{}' check (cardinality(skills) <= 30);
