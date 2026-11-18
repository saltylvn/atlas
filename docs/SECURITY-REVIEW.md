# Security review: 13 November 2026

A full review of the Atlas code, repository, database and live site, from the seat of a
senior security engineer and a cloud security engineer. Goals: secure, reliable, fast.

**Verdict.** The design was already strong: one owner, two-step sign-in enforced in the
database, every table behind Row Level Security, a strict Content Security Policy,
allowlisted outbound requests, encrypted stored credentials, no secrets in the repo. The
review found **no critical or high-severity issue and nothing exploitable from the
internet**. It found 15 lower-severity gaps and 3 speed wins. All are fixed in this
change except the items under "Yours to do" (dashboard settings only you can change) and
"Accepted risks".

## What was reviewed

| Area | How |
| --- | --- |
| Sign-in, sessions, two-step | Read `proxy.ts`, `lib/supabase/*`, `lib/context.ts`, `app/actions/auth.ts`, the MFA and callback routes |
| Every entry point | All 10 API routes and all 61 server actions, checked one by one for a session or token check |
| Database | Supabase security and performance advisors; catalog queries for RLS, policies, grants, functions, triggers, extensions, default privileges |
| Outbound requests | `safeFetch` allowlist, the one-click unsubscribe SSRF guard, IMAP, push, Notion |
| Secrets and crypto | `lib/env.ts` (validation, taint), `lib/security/vault.ts`, logging, `.gitignore`, tracked files |
| Browser | Headers and CSP on the live site, XSS sinks, every link built from data, the service worker |
| Supply chain | `npm audit` (all dependencies), outdated packages, GitHub Actions, Dependabot, repo settings |
| Live site | Unauthenticated probes of every route, wrong-token probes, cross-origin action, TLS, redirects |
| Speed and reliability | Function region vs database region, page data loading, indexes, retention, error handling |

## Findings and fixes

Severity is for this app as deployed: a single-owner app where only the owner can hold a session.

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Medium | The MFA enrollment action did not check the owner, or that no authenticator was set up yet. Supabase itself blocks a second factor from a session that has not passed the first, so this was not exploitable, but the app relied on that single control for its most sensitive step. | `startEnrollment` and `verifyTotp` now require the owner's session; enrollment refuses when a verified authenticator exists; enrollment is rate limited. |
| 2 | Medium | Session cookies were readable by page scripts (not HttpOnly). Atlas never runs a Supabase client in the browser, so nothing needed that. | Session cookies are HttpOnly, Secure in production, SameSite=Lax (`lib/supabase/cookies.ts`). |
| 3 | Medium | Data retention never ran. `private.prune()` existed (inbox 30 days, activity 180, audit 365) but nothing called it. | Migration schedules it daily inside the database with pg_cron. |
| 4 | Low | `public.rls_auto_enable()` (Supabase's event-trigger function) was a SECURITY DEFINER function executable through the API without signing in. It cannot be run outside an event trigger, so no impact, but it was open surface. | Migration revokes EXECUTE from API roles. Private functions are revoked too. |
| 5 | Low | The signed-in role held TRUNCATE, REFERENCES and TRIGGER on most tables. Row Level Security does not apply to TRUNCATE. The API cannot issue it, so no path existed. | Migration revokes them, and tightens default privileges for future tables and functions. |
| 6 | Low | The keep-alive endpoint counted unauthenticated requests against its rate limit, so anyone could use the limit up and block the real keep-alive. | The token is checked first (constant time), then the limit. |
| 7 | Low | Credential decryption accepted a shortened AES-GCM tag (Node's default), which is easier to forge for someone who can already write to the database. | Only a 96-bit nonce and full 128-bit tag are accepted. |
| 8 | Low | One-click unsubscribe checked a host's addresses, then resolved the name again to connect (DNS rebinding window). The reply is never read and the body is fixed, so impact was minimal. | The request connects to the exact address that passed the checks; TLS still verifies the host name. |
| 9 | Low | The sign-in return address was built from request headers without a shape check (Supabase's allowlist was the only control). | It must be a bare `https://host` origin. |
| 10 | Low | GitHub Actions were pinned to tags, which can be moved. | Pinned to full commit SHAs. |
| 11 | Low | Next.js was four patch releases behind; 7 moderate advisories in lint tooling. | Next.js 16.4.6. The remaining advisory (minimatch, via typescript-eslint) is in dev-only lint tooling: see Accepted risks. |
| 12 | Info | Nothing told search engines to stay away from the sign-in page. | `X-Robots-Tag: noindex, nofollow, noarchive` on every response. |
| 13 | Info | The data export left out projects, snippets, job matches, brief history, the inbox, connections and agent runs. | Export is complete (version 2). Stored credentials are never included. |
| 14 | Info | The retired `job_hunt_snapshots` table was still there (empty). | Migration drops it. |
| 15 | Info | A job posting with a link over 600 characters would fail the whole batch insert. | That posting is skipped. |

### Speed

| # | Finding | Fix |
| --- | --- | --- |
| S1 | Functions ran in Virginia (`iad1`) while the database is in Oregon (`us-west-2`): every database call crossed the country, and a page makes several rounds of them. | `vercel.json` runs functions in Portland (`pdx1`), next to the database and closer to Utah. |
| S2 | Today loaded the day's briefs and job-match state one after another, after the main load. | They load together with the main load. |
| S3 | Three foreign keys that are looked up or cascade had no index. | Migration adds them. |

Measured before the change, from Utah: sign-in page first byte about 235 to 265 ms. The
signed-in pages could not be timed from outside; S1 and S2 should cut several hundred
milliseconds from Today.

## Verified, and found sound

- **Every table has Row Level Security** with a policy requiring the owner's id and a two-step (aal2) session. The public role has no table privileges at all.
- **Only the owner can exist.** A database trigger refuses every sign-up but the configured email, and refuses a second account. One user, one Google identity, one verified authenticator.
- **All 57 data server actions go through `getContext()`** (owner + two-step). All API routes check a session or a constant-time bearer token, except `/api/health`, which only says "live".
- **Live probes:** every page redirects to sign-in when signed out; data routes answer 401; wrong tokens answer 401; a cross-origin action is refused; `.env`, `.git` and source maps are not served; TLS 1.1 is refused; http redirects to https.
- **Headers:** HSTS with preload, a per-request nonce CSP (`strict-dynamic`, no inline script), `frame-ancestors 'none'`, no-referrer, COOP/CORP same-origin, `no-store` on every page.
- **No XSS sinks** (`dangerouslySetInnerHTML`, `eval`). Every link built from outside data is validated as http(s) when it is read, and again by a database constraint.
- **Outbound requests** go to an allowlist of hosts over https, with timeouts, size caps and checked redirects.
- **Secrets** are validated at start, tainted against reaching the browser, never logged, and absent from the repository (gitleaks runs on every pull request).
- **The service worker caches nothing**, so no personal data is left on a device.

## Yours to do (dashboard settings)

These are account settings, which I do not change for you.

1. **GitHub: turn on Dependabot alerts.** Repo → Settings → Advanced Security → enable *Dependabot alerts* and *Dependabot security updates*. They are off, so a vulnerable dependency raises no alert today.
2. **Supabase: turn off the Email sign-in provider.** Authentication → Sign In / Providers → Email → off. Only Google is used; the sign-up trigger already blocks strangers, and this removes the password path entirely. While there, confirm *URL Configuration* lists only `https://atlas-optim.vercel.app`.
3. **Google account: it is the root of trust.** Use a passkey or security key for 2-Step Verification, and review third-party access. Whoever controls that account still needs your authenticator code to reach Atlas, but it is the first factor.
4. **Vercel: confirm two settings.** Environment Variables: every secret is marked *Sensitive*. Deployment Protection: *Vercel Authentication* is on for preview deployments.
5. **Optional: a durable rate limit.** Vercel → Firewall → add one rate-limit rule for `/login` and `/api/*`. See Accepted risks.
6. **Optional: download an export now and then.** Settings → Export. See Accepted risks (backups).

## Accepted risks

- **Rate limits are per server instance** (in memory). They slow a burst but are not a hard limit. What actually protects sign-in is Google plus the authenticator and Supabase's own limits; what protects the machine endpoints is a 32+ character random token. A Vercel Firewall rule (item 5) makes it durable.
- **No restorable database backups on Supabase's Free plan.** Recovery is the export endpoint (now complete). Moving to Pro adds daily backups.
- **No branch protection.** GitHub does not offer it on a free private repository. The working rule (pull request, green CI, merge on your say-so) stands in.
- **`style-src 'unsafe-inline'`** in the CSP, for inline style attributes. Styles cannot run code; scripts are nonce-only.
- **`is_owner_aal2()` is callable by the signed-in owner.** Every policy needs it. It returns one boolean about the caller.
- **Gemini on the free tier (owner's choice, 14 Nov 2026).** Google may use free-tier prompts to improve its products. Prompts can include retrieved email previews and resume passages, never addresses, phone numbers or links. Moving the key's project to paid billing removes this; the kill switch stops all calls.
- **One dev-only advisory** (minimatch, moderate, denial of service on hostile glob patterns) inside the linter's dependencies. It is not in the production bundle and no untrusted pattern reaches it. It clears when typescript-eslint updates.
- **AI is off.** If `ANTHROPIC_API_KEY` is added later, re-review prompt-injection handling in `lib/ai/` first. *Done 14 Nov 2026 for Ask Atlas: see the security review in [RAG.md](RAG.md). The data fence is now stripped from the data on every Claude call.*

## How it stays fixed

`test/hardening.test.ts` fails the build if: a server action skips `getContext()`; an API
route has no session or token check; a migration creates a table without Row Level
Security; an Action is not pinned to a commit SHA; a secret is not tainted; a third
public environment variable appears; the security headers change; or a Supabase client
appears in browser code.

## Database change, checked before applying

`supabase/migrations/20261113223647_hardening.sql` was run against the live database
inside a transaction that was then rolled back. With it applied: the owner on a two-step
session still read settings, inbox and applications and could save settings; a session
without the second factor saw zero rows; no API role could execute `rls_auto_enable`; no
TRUNCATE privilege remained; the retention job was scheduled and ran cleanly.

---

# Second review: 18 November 2026

A second pass, five days and about sixty pull requests after the first. Since then Atlas
gained the AI model (Gemini), retrieval, the Notion, Figma and GitHub connectors, four
more agents, a browser extension and a weekly QA review. Goal: a second layer, so that
no single control stands alone.

**Verdict.** Still **no critical or high-severity issue and nothing exploitable from the
internet**. Two medium gaps in defense in depth, four low, two informational. All are
fixed in this change except the items under "Yours to do" and "Not built".

## What was run

| Check | Result |
| --- | --- |
| `npm audit`, production dependencies | 0 advisories |
| `npm audit`, all dependencies | 6 moderate fixed; 1 dev-only advisory left (see Accepted risks) |
| Supabase security advisor | Nothing new: `is_owner_aal2` (accepted), leaked-password protection (see Yours to do) |
| Supabase performance advisor | Informational only: owner-id foreign keys on small tables, a few unused indexes |
| Database catalog | All 29 tables have Row Level Security; the public role has no table privilege, no policy and no executable function; every SECURITY DEFINER function pins its search path; one user, one Google identity, one verified authenticator |
| Entry points | All 14 API routes and all 78 server actions read: a session through `getContext()` or a constant-time bearer token on every one |
| Live probes, signed out | Every page redirects to sign-in; every data route answers 401; wrong tokens answer 401; `.env` and `.git` are not served; http redirects to https |
| Live headers | HSTS with preload, nonce CSP with `strict-dynamic`, `frame-ancestors 'none'`, no-referrer, COOP and CORP same-origin, `noindex` |
| New surface | Embedding function (secret-key check before the body is read), extension (three permissions, runs only when you press Fill), Gemini key (header, never the URL), Notion, Figma and GitHub tokens (server-only, tainted) |

## Findings and fixes

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 16 | Medium | A request that carried a token would send it again if the API answered with a redirect to another host on the allowlist. The allowlist now holds token-bearing APIs (Notion, GitHub, Figma, Gmail, Gemini) next to third-party feeds, so one misbehaving API could hand a token to another site. No such redirect was seen. | A request with headers or a body never follows a redirect to another origin (`lib/security/safeFetch.ts`). Plain public reads still follow redirects between allowlisted hosts. |
| 17 | Medium | The logs were append-only by privilege, and the server's secret key bypasses privileges. With that key, or through a server bug, the audit trail, the activity log the QA Agent reviews, the AI-call ledger behind the daily limit and the time ledger could be rewritten or emptied. | Migration: triggers refuse UPDATE, DELETE and TRUNCATE on the four tables for every role. The retention job is the one exception, through a flag the API cannot set. |
| 18 | Low | The one-click unsubscribe guard judged an IPv4 address inside an IPv6 one only when written dotted, and let 6to4 and Teredo addresses through. The system resolver returns the dotted form, so no working path was known. | The hex form is judged by the IPv4 address inside it; 6to4 and Teredo are refused. |
| 19 | Low | The autofill extension took a field for visible unless it was `display: none` or `visibility: hidden`. A page could collect answers with a see-through, one-pixel or off-page field once you pressed Fill there. | A field must be at least 8 pixels, on the page, and not see-through, itself or any ancestor. |
| 20 | Low | The QA Agent reads logs that can hold text from outside (a sender, a posting). It is rules only, so that text cannot steer it, but no test said so. | Three eval cases plant an instruction in a run's detail and in step notes. The same finding must still be raised, and a note shaped like an eval score in another agent's run must change nothing. |
| 21 | Low | Six moderate advisories in lint tooling (minimatch). | Lockfile updated. |
| 22 | Info | The keep-alive route answered "not configured" before it checked the token. | Token first. |
| 23 | Info | `/setup` was served on the live site and said Atlas "isn't configured yet". | A configured deployment redirects it. |

## Database change, checked before applying

The append-only migration was run against the live database inside one block that then
raised an error, so nothing was kept. With it applied, as the server's secret-key role:
UPDATE and DELETE on the audit trail, DELETE on the activity log and UPDATE on the
AI-call ledger were refused; INSERT still worked; TRUNCATE was refused; the retention job
ran; and a DELETE straight after the retention job was refused again. Afterwards the
database held no trigger, function or test row from the run.

## Yours to do (dashboard settings)

1. **Supabase: turn off the Email sign-in provider**, if it is still on. Authentication → Sign In / Providers → Email. That also settles the advisor's "leaked password protection" notice, since no password path is left.
2. **Vercel Firewall: one rate-limit rule** for `/login` and `/api/*`. The app's own limits are per server instance.
3. **Vercel: confirm** every secret is marked Sensitive and preview deployments require Vercel Authentication.
4. **GitHub: Dependabot alerts on.** On a public copy, also turn on branch protection for `main` (require a pull request and the CI checks; it is free on public repositories) and private vulnerability reporting.
5. **Keep-alive token.** `ATLAS_KEEPALIVE_TOKEN` is not set on the live deployment, so the keep-alive route refuses everyone. The scheduled runs keep the database awake today; set the token only if those are ever paused for a week.

## Not built (recommended next)

- **Record refused tokens.** A wrong token on a machine endpoint leaves no trace beyond an hour of host logs. A throttled "denied" audit event, counted by the QA Agent, would show probing.
- **A read-only database role for the QA Agent.** The triggers above mean no role can change the logs it reads. A role of its own would also limit what it can read.
- **One key per job.** Every scheduled job shares one secret key. Separate roles for the sync, the briefs and the reviewer would shrink what a single leaked key reaches.

## Accepted risks (added)

- **One dev-only advisory** (picomatch, denial of service on a hostile glob pattern) inside the test and lint tooling. No patched release exists yet. It is not in the production bundle and no untrusted pattern reaches it.
- **Deleting the owner's account is refused** while the append-only triggers exist, because the delete cascades to the logs. Erasing everything means dropping those triggers first.

## How it stays fixed

`test/secondLayer.test.ts` fails the build if: a request with a token follows a
cross-origin redirect; an IPv4 address hidden in an IPv6 one passes the unsubscribe
guard; the extension fills a field nobody can see; a log table loses its triggers or the
retention job loses its flag; the app starts updating or deleting log rows; the
keep-alive route answers before checking the token; or `/setup` is served on a
configured deployment. The QA eval suite fails if planted text changes a finding.

