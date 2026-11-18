-- Logs are append-only for every role, the server's secret key included.
--
-- Until now "append-only" was a matter of privileges: the signed-in role cannot UPDATE or
-- DELETE these tables, but the secret key (service_role) bypasses those grants and Row
-- Level Security. A stolen key or a server bug could rewrite the audit trail, the activity
-- log the QA Agent reviews, or the AI-call ledger behind the daily limit. These triggers
-- refuse any change to a logged row, whoever asks.
--
-- The one exception is retention: private.prune() sets a transaction-local flag before it
-- deletes old rows. The flag cannot be set through the API: set_config lives in
-- pg_catalog, which the REST API does not expose, and no function in the exposed schema
-- sets it.
--
-- Side effect, on purpose: deleting the owner's account cascades to these tables and is
-- refused too. To erase everything, an administrator drops these triggers first.

create or replace function private.refuse_log_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('atlas.retention', true), '') = 'on' then
    return old;
  end if;
  raise exception 'append-only: % on %.% is refused', tg_op, tg_table_schema, tg_table_name using errcode = '42501';
end;
$$;
revoke execute on function private.refuse_log_change() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['audit_events', 'agent_runs', 'ai_usage', 'time_ledger']
  loop
    execute format('drop trigger if exists append_only_rows on public.%I', t);
    execute format('create trigger append_only_rows before update or delete on public.%I for each row execute function private.refuse_log_change()', t);
    execute format('drop trigger if exists append_only_truncate on public.%I', t);
    execute format('create trigger append_only_truncate before truncate on public.%I for each statement execute function private.refuse_log_change()', t);
  end loop;
end;
$$;

-- Retention keeps working: the same deletes as before, inside the flag.
create or replace function private.prune()
returns void
language sql
security definer
set search_path = ''
as $$
  select set_config('atlas.retention', 'on', true);
  delete from public.audit_events where at < now() - interval '365 days';
  delete from public.inbox_items where received_at < now() - interval '30 days';
  delete from public.agent_runs where at < now() - interval '180 days';
  delete from public.job_matches where shown_on < current_date - 120 and status in ('new', 'dismissed') and rating = 0;
  delete from public.ai_usage where at < now() - interval '90 days';
  delete from public.market_postings where last_seen < current_date - 120;
  delete from public.market_reports where for_date < current_date - 180;
  delete from public.mentor_insights where created_at < now() - interval '180 days';
  delete from public.role_proposals where created_at < now() - interval '365 days';
  delete from public.qa_reports where for_date < current_date - 365;
  select set_config('atlas.retention', '', true);
$$;
revoke execute on function private.prune() from public, anon, authenticated;
