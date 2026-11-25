-- Action Taken on a Career Mentor insight (owner's request, 23 Nov 2026): when you check it,
-- you may say in a line what you did. The Career Mentor reads that note in its next reviews,
-- so it builds on what you did instead of repeating it.
--
-- You may still change only the status and your own note; the Career Mentor writes the rest.

alter table public.mentor_insights
  add column if not exists owner_note text not null default '' check (char_length(owner_note) <= 500);

grant update (status, owner_note) on public.mentor_insights to authenticated;
