-- The International tab: a tech posting's region can now be 'global', a remote job open beyond the
-- U.S. that still hires people in it (worldwide, the Americas, the U.S. and other countries). See
-- regionOf() in lib/domain/techMarket.ts. Only the allowed values of the region columns change; no
-- row, other column or policy does. Safe to run more than once.

do $$
declare
  t text;
  c record;
begin
  foreach t in array array['tech_postings', 'market_daily'] loop
    for c in
      select conname
      from pg_constraint
      where conrelid = format('public.%I', t)::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%region%'
    loop
      execute format('alter table public.%I drop constraint %I', t, c.conname);
    end loop;
    execute format('alter table public.%I add constraint %I check (region in (''utah'', ''us'', ''global'', ''unstated''))', t, t || '_region_check');
  end loop;
end
$$;
