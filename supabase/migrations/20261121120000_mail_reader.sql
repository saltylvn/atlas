-- The Pipeline, phase 3, part 1 (docs/design-pipeline.md, 5.4 and 5.5): the reader learns
-- four more kinds of answer, and a model reader is added behind a switch that starts off.
--
--   inbox_items.text_verdict    the rules' verdict may now also be 'assessment', 'scheduling',
--                               'offer' or 'info_request'. The check is widened; no row changes.
--   inbox_items.model_read_at   when an email was handed to the AI model, if it ever was. It
--                               is set before the call, in one conditional update, so an
--                               email's text leaves Atlas at most once. Null for every email
--                               while the switch is off.
--   application_events.deadline, ask
--                               what a reading found beyond the kind: a date the email
--                               writes, and what it asks for in a few words (5.10). Written
--                               only on a model's reading for now (decided_by 'model'),
--                               which no timeline, list or notification reads.
--
-- No email text is stored: `ask` is at most 200 characters with addresses, phone numbers and
-- links removed, like the quote already kept. Additive, and safe to run again.

-- The check was created inline, so its name is Postgres's default. It is found by what it
-- checks rather than by a name this file would have to guess.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.inbox_items'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%text_verdict%'
  loop
    execute format('alter table public.inbox_items drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.inbox_items
  add constraint inbox_items_text_verdict_check
    check (text_verdict in ('interview', 'rejection', 'assessment', 'scheduling', 'offer', 'info_request', 'none')),
  add column if not exists model_read_at timestamptz;

alter table public.application_events
  add column if not exists deadline date,
  add column if not exists ask text not null default '' check (char_length(ask) <= 200);

-- Privileges are unchanged. inbox_items: the owner's session may still only check items off
-- (update (done)); these columns are written by the server's secret-key client.
-- application_events: still select and insert only, never update or delete.
