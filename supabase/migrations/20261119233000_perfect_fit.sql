-- Perfect fit: a stronger thumbs-up. A match's rating may now be 2 as well as -1, 0 and 1.
-- 2 means "this is a job I most want": it is queued like a thumbs-up, listed first in its
-- queue, counts double in ranking, and the Mentor looks at it harder. No data changes.
alter table public.job_matches drop constraint if exists job_matches_rating_check;
alter table public.job_matches add constraint job_matches_rating_check check (rating in (-1, 0, 1, 2));
