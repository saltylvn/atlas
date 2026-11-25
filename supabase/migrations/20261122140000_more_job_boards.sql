-- The watchlist can follow three more public job-board systems: SmartRecruiters, Workable
-- and Recruitee (lib/integrations/jobBoards.ts). Only the allowed values of job_watches.board
-- change; no row, column or policy does. Safe to run more than once.

-- Drop the old check on the board column by what it checks, whatever Postgres named it.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.job_watches'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%board%'
  loop
    execute format('alter table public.job_watches drop constraint %I', c.conname);
  end loop;
end
$$;

alter table public.job_watches
  add constraint job_watches_board_check
  check (board in ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee'));
