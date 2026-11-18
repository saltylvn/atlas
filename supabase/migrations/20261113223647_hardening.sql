-- Security and reliability hardening (security review, 13 Nov 2026).
-- See docs/SECURITY-REVIEW.md. Nothing here changes what the owner can do in the app:
-- it removes privileges nothing uses, closes two API-callable functions, makes data
-- retention actually run, and drops a table whose feature was retired.

-- ---------------------------------------------------------------------------
-- 1. Table privileges: only what the API needs.
-- Row Level Security does not apply to TRUNCATE, so the privilege itself is removed.
-- REFERENCES and TRIGGER are never needed by an API role either.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Functions: nothing is callable through the API except what RLS itself needs.
-- rls_auto_enable is Supabase's event-trigger function (it turns RLS on for every new
-- public table). It fires as an event trigger whether or not API roles may execute it.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
-- The private schema is not exposed and API roles have no USAGE on it; EXECUTE is
-- revoked as well, so access does not rest on a single control.
revoke execute on function private.guard_signup() from public, anon, authenticated;
revoke execute on function private.enroll_owner() from public, anon, authenticated;
revoke execute on function private.prune() from public, anon, authenticated;
-- public.is_owner_aal2() stays executable by `authenticated`: every RLS policy calls it
-- as the querying role. It returns one boolean about the caller and nothing else.

-- ---------------------------------------------------------------------------
-- 3. Defaults for anything a later migration creates (migrations run as postgres).
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The owner record and config are deny-all to every role but their owner.
-- The security-definer functions that read them run as that owner.
alter table private.config enable row level security;
alter table private.owner enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Indexes for the foreign keys that are looked up or cascade on delete.
-- (owner_id foreign keys are left alone: one owner means such an index selects nothing.)
create index if not exists approvals_application_id on public.approvals (application_id) where application_id is not null;
create index if not exists approvals_match_id on public.approvals (match_id) where match_id is not null;
create index if not exists messages_contact_id on public.messages (contact_id);

-- ---------------------------------------------------------------------------
-- 6. Retired: job-hunt snapshots. The ingest endpoint and its secret were removed;
-- the table is empty.
create or replace function private.prune()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.audit_events where at < now() - interval '365 days';
  delete from public.inbox_items where received_at < now() - interval '30 days';
  delete from public.agent_runs where at < now() - interval '180 days';
  delete from public.job_matches where shown_on < current_date - 120 and status in ('new', 'dismissed') and rating = 0;
  delete from public.ai_usage where at < now() - interval '90 days';
$$;
revoke execute on function private.prune() from public, anon, authenticated;
drop table if exists public.job_hunt_snapshots;

-- ---------------------------------------------------------------------------
-- 7. Retention that actually runs. private.prune() existed but nothing called it.
-- pg_cron runs it inside the database once a day (10:23 UTC), with no API surface.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('atlas-prune', '23 10 * * *', 'select private.prune()');
