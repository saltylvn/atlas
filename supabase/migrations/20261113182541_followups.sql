-- Career Agent, part 5b: follow-ups in the Approval Queue point at their application,
-- so each quiet application gets exactly one follow-up.

alter table public.approvals
  add column application_id uuid references public.applications (id) on delete cascade;

create unique index approvals_owner_application_kind
  on public.approvals (owner_id, application_id, kind)
  where application_id is not null;
