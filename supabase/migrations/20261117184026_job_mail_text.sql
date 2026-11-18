-- The Applications Agent reads the text of job emails (only those, each once) to tell a
-- rejection or an interview invite from a plain "we received your application". The text
-- is never stored: only the verdict and the one sentence that decided it, without email
-- addresses, phone numbers or links. Rules only; the text is not sent to an AI model.
alter table public.inbox_items
  add column text_verdict text check (text_verdict in ('interview', 'rejection', 'none')),
  add column text_quote text not null default '' check (char_length(text_quote) <= 240);

-- The owner's session still reads (select is granted on the table) and may only check
-- items off (update (done)); these columns are written by the server's secret-key client.
