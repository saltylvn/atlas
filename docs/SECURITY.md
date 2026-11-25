# Security

## Policy in one screen

- **One owner.** Exactly one account can exist (database trigger). Every request is checked three times: proxy, data layer, and Row Level Security.
- **Two factors, always.** Live mode requires a TOTP authenticator (AAL2). The database itself refuses rows to a session without `aal2`.
- **Draft, don't act.** No agent sends, applies, posts or deletes outside Atlas. Messages are handed to your own Mail or Messages app.
- **Fixed egress.** The server can only call hosts on one allowlist (`lib/security/safeFetch.ts`), over https, with timeouts and size caps. The browser can only talk to Atlas (`connect-src 'self'`).
- **Secrets stay server-side.** Only the Supabase URL and publishable key are public by design. Everything else is server-only, validated at start-up, and never printed.
- **Everything important is audited**, and the audit trail cannot be edited.

## Secrets

| Secret | Where | Rotation |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Vercel env (Sensitive) | Supabase > Settings > API keys, then redeploy |
| `ANTHROPIC_API_KEY` | Vercel env (Sensitive) | Claude Console, then redeploy |
| `GEMINI_API_KEY` | Vercel env (Sensitive) | Google AI Studio (delete the key, create a new one), then redeploy |
| `ATLAS_KEEPALIVE_TOKEN` | Vercel env + GitHub Actions secret | `openssl rand -hex 32`, set in both places |
| `CALENDAR_ICS_URL` | Vercel env (Sensitive) | Google Calendar > Settings > Reset secret address |
| `ATLAS_VAULT_KEY` | Vercel env (Sensitive) | `openssl rand -base64 32`, then reconnect Gmail (old ciphertext no longer opens) |
| `GOOGLE_CLIENT_SECRET` | Vercel env (Sensitive) | Google Cloud > Clients > reset secret, then redeploy |
| Gmail app password | `connections.secret` (provider `gmail_imap`), AES-256-GCM sealed, unreadable by the owner's own session. Used for header-only IMAP reads, and to archive (remove the Inbox label from) emails you click | Delete at myaccount.google.com/apppasswords, create a new one, reconnect in Connectors |
| Gmail refresh token | `connections.secret`, AES-256-GCM sealed, unreadable by the owner's own session | Disconnect in Connectors (revokes at Google) and reconnect |
| `VAPID_PRIVATE_KEY` | Vercel env (Sensitive) | `npx web-push generate-vapid-keys`; every device turns notifications on again |
| `CRON_SECRET` | Vercel env (Sensitive) | `openssl rand -hex 32`, redeploy |
| `ATLAS_WATCH_SECRET` | Vercel env (Sensitive) and Supabase Vault (`atlas_watch_secret`) | `openssl rand -hex 32`, redeploy, then update the Vault secret ([WATCH.md](WATCH.md)). Opens `/api/cron/watch` only; never the same value as `CRON_SECRET` |
| `ATLAS_CAPTURE_TOKEN` | Vercel env + your Siri Shortcut | `openssl rand -hex 32`, update the shortcut |
| TOTP seed | Your authenticator app | Supabase > Auth > Users > remove factor, re-enroll |

`.env*` is gitignored except `.env.example`. CI runs gitleaks on every push.

## Data handled

Tasks, goals, contacts (name, circle, email, phone, birthday MM-DD, notes), drafts you hand off, routines, job watchlist, settings, the audit trail, the time ledger, and AI usage counts. Inbox triage rows: sender, subject, date, the triage reason and (OAuth only) Gmail's one-line preview, kept 30 days. Never attachments, and never the text of an email that is not job mail: the Gmail API is called with `format=metadata`, and IMAP fetches headers from a read-only (EXAMINE) mailbox; the only write is archiving emails you click. The one exception is job emails (tagged from sender and subject first) every email from a company with an open application on your board (by its domain or name; never its mailing lists or promotions, and never a bill, receipt or subscription), and, for an application logged as "Role not listed", the email it was logged from (by its Gmail id): the Applications Agent reads each one's text part once, over IMAP with BODY.PEEK in a read-only mailbox (nothing marked read), at most 12 a run and 48 KB each, and reads a verdict from it by rules. Only the verdict (a rejection, an interview invite, an assessment, a request for times, an offer, a request for something, or none of these), the one sentence that decided it and the role the email names are stored (`inbox_items.text_verdict`, `text_quote` at most 240 characters with email addresses, phone numbers and links removed, `text_role` at most 160; and the role on the application); the text itself is never stored or logged, and the trace records counts only. By default that text goes to no AI model; the one case in which part of it may is the model reader, which is off until you turn it on (see "The model reader" below). When it has read an email, Atlas keeps when (`inbox_items.model_read_at`) and, for a reading that passed its checks, one timeline row (`application_events`, `decided_by = 'model'`) holding the kind, the one sentence it rests on (cleaned and capped like the rules' quote), a date the email writes (`deadline`) and what it asks for in a few words (`ask`, at most 200 characters, no addresses, phone numbers or links): never the email's text, and never the model's raw answer. Your Email Agent lists (stores, subscriptions, unsubscribed senders) live in your settings row. Projects and ideas. Career: job matches the briefs showed (title, company, link, source, pay as posted, your thumbs; unacted ones kept 120 days), your application tracker (company, role, status, dates, link, pay as posted, notes) and your apply queues; your target roles and pay floors live in your settings row. Brief history (the assembled briefs, searchable) and the agent activity log (agent, task, status, model, tokens, cost; 180 days). Ask Atlas passages (`knowledge_chunks`): short text built from the rows above, with a search vector and an embedding; no email addresses, contact phone numbers or outside links; rewritten when a row changes and deleted when it goes. The Career desk: market postings (public job listings the Scout recorded, 120 days), daily market reports and Mentor insights (180 days), and, if you paste it, your LinkedIn text with contact details removed. Your answer bank, now including contact details (name, email, phone, city) that only the Atlas Autofill extension uses; the Applications page embeds it as data for the extension, which keeps a copy in Safari's extension storage on your Mac (see extension/safari/README.md). Your GitHub projects as the Scout described them (name, description, languages, stack and skills; no code) and the Mentor's role proposals (the orders, reasons and facts; one year). Push subscriptions (an endpoint and public keys per device). Heard back (`notifications`): one row per answer from a company, holding the company, the kind of answer and the role as the lock screen shows them, when it was sent and when you read it; never an email's subject, sender or text. Only the server writes it; your session may read it and mark a row read. A token refused at a machine endpoint (the scheduler's routes, Siri capture, the keep-alive) is recorded in the audit trail as the route and counts only: never the token or any part, hash or length of it, never a request header, the query string or the body, and nothing about the caller. Atlas stores no caller addresses and no user agents. No location history: weather uses the coordinates you type.

What goes to the AI model (Claude, or Google Gemini when `GEMINI_API_KEY` is the active key): for the brief, task titles, agenda titles, contact first names, headline titles; for drafts, the contact's name, circle and notes plus your purpose; for the digest, headline titles; for Ask Atlas, your question and the six passages retrieved for it (which can include an email's sender name, subject and one-line preview). For the Analyst, the computed market facts (no personal data). For the Mentor, observations about your pipeline (counts, rates, company names), the titles of its recent insights and, in the evening, your LinkedIn text without contact details. Embeddings are made inside the Supabase project and go to no AI provider. Nothing is sent when AI is off, the key is absent, or the kill switch is on.

### The model reader (job emails rules cannot decide)

Off by default. Settings > Guardian controls > **Let the AI model read job emails rules cannot decide** turns it on; the change is in the audit trail as `switch.modelReader`. Approved on 20 Nov 2026 (docs/design-pipeline.md, 5.5 and section 12, item 3). It replaces the earlier rule that a job email's text never leaves Atlas with this one:

- **While it is off, nothing of any email's text leaves Atlas.** Rules read every job email, as before.
- **While it is on, an email is sent only if all of this is true:** it arrived after you turned the switch on (turning it on sends no backlog); rules read its text and decided nothing; it is from a company with an open application, and rules can tell which one (a tie is asked of you first, never sent); it was never sent before.
- **What is sent, and nothing else:** the email's subject and its own words (the quoted earlier message, and everything under it, is cut), with email addresses, phone numbers and links removed, 4,000 characters together at most; plus three facts Atlas already holds (the company, the role and the stage of that application) and the day the email arrived. Names of companies and people in the text stay in: the reading needs them. Never the sender's address, a message or thread id, an attachment, or anything from another email.
- **To whom:** the one AI provider in use (`lib/ai/model.ts`), on its fast model. With Gemini's free plan, Google's terms for unpaid use say submitted content may be used to improve its products and may be read by human reviewers; that is why this is a switch and why the text is scrubbed and capped. A paid key removes that; Atlas does not need one.
- **How often:** each email at most once (it is marked before the call, so a failed call is not sent again); at most 6 a sync and 12 a day, inside the shared daily limit; only in the full sync, never in the 15-minute watch. The kill switch, the AI switch and the Applications Agent's pause each stop it.
- **What comes back** is treated as untrusted. The email is fenced as data in the prompt; the answer must match a fixed schema; then code checks that its sentence is in the email word for word, that any date is written in the email and within 90 days, and that its stage is a move the tracker's own rule would make. An answer that fails is dropped. Which application it belongs to is decided by rules before the call; nothing the model returns chooses an application, a recipient or an action.
- **What happens with a reading that passes:** for now it is only recorded (shadow mode). It moves no stage, appears on no page, pings no phone and writes no Heard back row. Showing it as a suggestion you confirm is a later change.
- **Nothing of an email is logged**, traced or audited by the reader: the activity log holds counts and a reason.

## Reporting

This is a personal project. If you find a problem, open a private security advisory on the repository.

## Incident response

1. **Contain.** Settings > Guardian controls > turn **Outbound allowed** off (kill switch: also stops pushes). Then **Sign out everywhere**. If Gmail may be involved, Connectors > Gmail > **Disconnect** (revokes the token at Google and deletes the synced inbox), or revoke "Atlas" at myaccount.google.com/permissions.
2. **Assess.** Read the audit trail (Settings) for `denied` / `error` rows, unexpected `message.handoff`, `data.export`, `application.find-in-gmail` or `switch.*` events (`switch.modelReader` with `value=true` is the model reader being turned on). A `token.refused` row is a missing or wrong token at a machine endpoint: it names the route and gives a count, which is a floor (one row per route per ten minutes per server instance). The weekly QA review adds them up. Check Supabase Auth logs and Vercel logs.
3. **Eradicate.** Rotate the affected secrets (table above). If the account is suspect: Supabase > Auth > remove MFA factors and sessions, change the Google password, re-enroll TOTP.
4. **Recover.** Restore from Supabase backup / PITR if data changed, or re-import from your latest export. Turn outbound back on.
5. **Learn.** Note what happened and what changed in the roadmap.

## Recovery

- Settings > **Export everything** downloads a complete JSON copy. Keep a recent one offline.
- Supabase Free has no automatic backups: export monthly and keep a copy offline. (Pro adds daily backups and PITR.)
- A twice-weekly keep-alive stops the free project from pausing (`.github/workflows/keepalive.yml`).
- The schema is entirely in `supabase/migrations/`, so an empty project can be rebuilt with one command.

## Reviews

- 13 Nov 2026: full review of code, repository, database and live site. No critical or high-severity issue; 15 lower-severity gaps and 3 speed wins fixed. Findings, what was verified, accepted risks and the owner's checklist are in [SECURITY-REVIEW.md](SECURITY-REVIEW.md). `test/hardening.test.ts` keeps the fixes in place.
- Data retention runs daily inside the database (pg_cron, `private.prune()`): inbox 30 days, AI usage 90, activity log 180, unused job matches 120, audit trail 365.
- Session cookies are HttpOnly, Secure and SameSite=Lax. No Supabase client runs in the browser.
- 18 Nov 2026: a second review, and from it a record of tokens refused at the machine endpoints (throttled, counts only), counted in the weekly QA review. `test/secondLayer.test.ts`, `test/machineRoutes.test.ts` and `test/refusedTokens.test.ts` keep it in place.
