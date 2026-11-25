-- Step 0 of the agent plan (owner's request, 23 Nov 2026): every application records what it
-- was sent with, so Atlas can learn what gets replies. Data not captured now cannot be
-- recovered later. Null means "not known" (an application logged before this, or from an
-- email Atlas could not link to a posting).
--
--   level           the level its title states: early (junior, associate, I), mid (II),
--                   senior (senior, staff, lead) or unstated
--   posted_on       the day the posting went up, when known: how fresh it was when you applied
--   resume_version  the resume sent: its name and a short fingerprint of its text
--   tailored        you changed the resume or wrote a note for this job
--   warm            you knew someone there (or were referred)

alter table public.applications
  add column if not exists level text check (level is null or level in ('early', 'mid', 'senior', 'unstated')),
  add column if not exists posted_on date,
  add column if not exists resume_version text not null default '' check (char_length(resume_version) <= 120),
  add column if not exists tailored boolean,
  add column if not exists warm boolean;
