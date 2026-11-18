-- A thumbs up queues a job's apply kit. One waiting kit per job, enforced here too, so a
-- second tap (another tab, a retry) cannot queue the same job twice. Kits already decided
-- (approved or rejected) do not count: a job taken back can be queued again.
create unique index if not exists approvals_one_waiting_per_match
  on public.approvals (owner_id, match_id)
  where status = 'pending' and match_id is not null;
