-- Your GitHub projects, readable in full.
--
-- The Scout already read the start of each repository's README, used it to find the skills a
-- project shows, then dropped it. These two columns keep it: `readme` is the cleaned opening
-- (prose and headings, no badges, images, HTML or code), `title` is the project's own name
-- from the README's top heading ("DEVELOP" for wellness-tracker), '' when it has none.
-- Public repositories become `project` passages in the knowledge index, so the Tailor, the
-- Coach and Claude (search_material, my_projects) can cite real project proof.
--
-- Additive and safe to re-run. Apply before deploying the code that writes them.

alter table public.portfolio_repos
  add column if not exists title text not null default '' check (char_length(title) <= 120),
  add column if not exists readme text not null default '' check (char_length(readme) <= 4000);
