# The 15-minute watch: turning it on

`/api/cron/watch` checks Gmail for answers to your applications and pushes them to your phone
(docs/design-pipeline.md, 5.8). Nothing calls it until you schedule it. Supabase Cron does
that: your database posts to the route every 15 minutes, 7 AM to 9 PM, every day.

**Not run by Atlas or by Claude.** The SQL below is for you to read and run once.

## What was checked (21 Nov 2026)

| Piece | What it does here | On your project |
| --- | --- | --- |
| `pg_cron` | The timer | Installed, 1.6.4 |
| `pg_net` | The HTTP call from Postgres | Available (0.20.4), **not enabled yet**; step 3a enables it |
| Vault (`supabase_vault`) | Holds the bearer secret, encrypted | Installed, 0.3.2 |

Supabase's docs give no plan limit or price for any of the three (links under Sources). That
your Free project already lists them is the stronger evidence. The extension list was read
through Supabase's management API; no SQL was run against your database.

Limits from the docs, and where the watch stands: at most 8 jobs at once (this adds 2); a job
should run under 10 minutes (the job only queues a request, in milliseconds); `pg_net`'s
default timeout is 2 seconds, so the call below sets its own.

## 1. Make the secret

It must be a new value, not `CRON_SECRET`. The route refuses to run if the two are the same.

```bash
openssl rand -hex 32
```

## 2. Vercel

Project > Settings > Environment Variables: add `ATLAS_WATCH_SECRET` with that value, for
Production, marked Sensitive. Redeploy.

## 3. Supabase: SQL editor, once

Replace `YOUR-SITE` with your production address (the one in `ATLAS_SITE_URL`), and paste
the secret in 3b. 3a, 3c and 3d are safe to run again. 3b runs once: a second run fails
because the name is taken (to change the secret, see the end of this page).

```sql
-- 3a. Let Postgres make HTTP calls.
create extension if not exists pg_net with schema extensions;

-- 3b. Put the secret in Vault. This line is the only place the secret is typed; you can
--     add it on the dashboard's Vault page instead, under the same name, and skip this.
select vault.create_secret('PASTE-THE-SECRET', 'atlas_watch_secret', 'Bearer token for /api/cron/watch');

-- 3c. The watch: every 15 minutes in the UTC hours that cover 7 AM to 9 PM Mountain time,
--     summer and winter. The route checks your local time itself and skips the extra hour.
--     The job's text holds no secret: it reads Vault each time it runs.
select cron.schedule(
  'atlas-watch',
  '*/15 0-3,13-23 * * *',
  $$
  select net.http_post(
    url := 'https://YOUR-SITE/api/cron/watch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'atlas_watch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- 3d. Keep the job history small: about 60 rows a day otherwise pile up.
select cron.schedule(
  'atlas-watch-history',
  '10 6 * * *',
  $$ delete from cron.job_run_details where end_time < now() - interval '7 days' $$
);
```

## 4. Check it

After the next quarter hour:

```sql
-- The two jobs, active.
select jobname, schedule, active from cron.job where jobname like 'atlas-watch%';

-- What the route answered. 200 with "watch":"succeeded", or "skipped" with the reason
-- (outside 7 AM to 9 PM, paused, kill switch). 401: the two secrets differ. 503: the
-- variable is missing in Vercel, or it equals CRON_SECRET.
select status_code, content, timed_out, error_msg, created from net._http_response order by created desc limit 5;
```

In Atlas: Connectors shows Gmail's last sync moving every 15 minutes, and Mission Control
lists a "Heard back watch" run each time the watch found something. A quiet check is not logged.

## Turning it off, and changing the secret

```sql
select cron.unschedule('atlas-watch');
```

To change the secret: set the new value in Vercel and redeploy, then

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'atlas_watch_secret'),
  'PASTE-THE-NEW-SECRET',
  'atlas_watch_secret',
  'Bearer token for /api/cron/watch'
);
```

The kill switch in Settings, or pausing the Applications Agent or the Email Agent in
Mission Control, also stops the watch without touching the schedule.

## What can see the secret

- **`cron.job`** (the schedule): no. The command reads Vault when it runs.
- **Vault**: encrypted at rest. `vault.decrypted_secrets` shows it to roles that may read
  that view, so it is not granted to anyone new here.
- **`net.http_request_queue`**: yes, for the moment between queueing and sending; `pg_net`
  deletes the row once the request is made. This is why the watch has its own secret: one
  that leaked from there could start a watch run and nothing else. It cannot run a brief,
  the sync or the QA review.
- **`net._http_response`** (kept 6 hours): the route's answer only: a status and counts,
  nothing from an email.
- The `net` schema is not reachable through Supabase's Data API, and the `anon` and
  `authenticated` roles cannot open a database connection (Supabase's `pg_net` page, Permissions).

## What it costs

- Supabase: about 60 small HTTP calls a day from the database, and the reads each run makes.
  A check with nothing new in Gmail makes a handful of small queries; one with new mail reads
  the inbox and the board. Estimated well under 1 GB of the Free plan's 5 GB egress a month;
  not measured yet, so look at Usage after the first week.
- Vercel: about 60 short function runs a day.
- Gmail: one IMAP login per check, two when there is job mail to read. After an error the
  watch tries every 30 minutes instead of 15.

## Sources

- `pg_net`: https://supabase.com/docs/guides/database/extensions/pg_net (updated 18 Nov 2026, read 21 Nov 2026)
- Supabase Cron: https://supabase.com/docs/guides/cron and https://supabase.com/docs/guides/cron/quickstart (updated 17 and 18 Nov 2026, read 21 Nov 2026)
- Vault: https://supabase.com/docs/guides/database/vault (updated 16 Nov 2026, read 21 Nov 2026)
- Free plan egress: https://supabase.com/pricing (read 21 Nov 2026)
