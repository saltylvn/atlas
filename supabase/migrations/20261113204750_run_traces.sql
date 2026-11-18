-- Tracing for agent runs (evals and observability).
--
-- The row that ends a run now also records how long the whole run took and its steps:
-- what each step did, how long it took, and what it decided. Mission Control shows the
-- steps under each run. Notes hold counts and decisions only (never email text).
-- Both columns are optional, so older rows and "started" rows stay as they are, and the
-- existing policies apply unchanged (append-only, owner-only, signed-in with a passkey).

alter table public.agent_runs
  add column if not exists duration_ms integer check (duration_ms is null or duration_ms >= 0),
  add column if not exists trace jsonb check (trace is null or (jsonb_typeof(trace) = 'array' and pg_column_size(trace) < 16384));
