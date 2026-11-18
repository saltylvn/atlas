-- "Refresh and review": when the Mentor reviews again with fresh data and an insight's
-- numbers have moved, the new insight replaces the older one. "replaced" is written by the
-- server only (the owner's status action accepts new, done and dismissed), and unlike
-- "dismissed" it teaches the Mentor nothing about what you want to hear.
alter table public.mentor_insights drop constraint if exists mentor_insights_status_check;
alter table public.mentor_insights add constraint mentor_insights_status_check check (status in ('new', 'done', 'dismissed', 'replaced'));
