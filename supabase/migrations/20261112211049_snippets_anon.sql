-- Signed-out visitors get no privileges on snippets, matching every other table.
-- RLS already returned them no rows (there is no anon policy); this removes the
-- table grant as well, so access does not rest on a single control.
revoke all on public.snippets from anon;
