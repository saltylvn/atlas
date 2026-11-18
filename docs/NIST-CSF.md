# NIST Cybersecurity Framework 2.0 mapping

Atlas is a single-owner personal system, so the "organization" is one person. The mapping below names, for each CSF 2.0 function and the categories that apply, the concrete control and where it lives. Supporting references: NIST SP 800-63B (authentication), SP 800-53 Rev. 5 (control names in brackets), SP 800-218 SSDF (secure development).

## GV — Govern

| Category | Control in Atlas | Where |
| --- | --- | --- |
| GV.OC Context | Purpose, data handled and owner are documented; personal data only, one owner | README, THREAT-MODEL |
| GV.RM Risk strategy | Threat model with ranked risks and accepted residual risks | docs/THREAT-MODEL.md |
| GV.RR Roles | One owner. Each agent has a written scope and a "never" | `lib/domain/agents.ts` |
| GV.PO Policy | Security policy: draft-don't-act, allowlisted egress, no secrets in code, MFA mandatory | docs/SECURITY.md |
| GV.SC Supply chain | Lockfile, Dependabot, `npm audit` in CI, `npm ci --ignore-scripts`, few runtime deps | `.github/` |

## ID — Identify

| Category | Control | Where |
| --- | --- | --- |
| ID.AM Assets | Data inventory (tables + fields), integrations inventory with health on Settings | migration, `app/(app)/settings` |
| ID.RA Risk assessment | STRIDE threats per trust boundary | docs/THREAT-MODEL.md |
| ID.IM Improvement | Findings go to the roadmap; Dependabot PRs weekly | docs/SECURITY.md |

## PR — Protect

| Category | Control | Where |
| --- | --- | --- |
| PR.AA Identity & access [IA-2(1), AC-3, AC-6] | Google sign-in + mandatory TOTP (AAL2, SP 800-63B); single-owner allowlist; sign-up trigger refuses every other email; RLS requires `aal = 'aal2'`; checks in proxy **and** data layer **and** database | `proxy.ts`, `lib/supabase/gate.ts`, `lib/context.ts`, migration |
| PR.AA Delegated access [AC-6, IA-5] | Gmail connected with a revocable app password used over IMAP for header-only reads (EXAMINE) and owner-clicked archive (Inbox label removal, no delete or send), or OAuth 2.0 code + PKCE with least scope (`gmail.readonly`, metadata-only); either credential sealed, verified before storage, and removable from Connectors | `lib/integrations/google.ts`, `app/api/connect/google` |
| PR.AA Machine identity (scheduled + device) [IA-3] | Vercel Cron and the Siri Shortcut each authenticate with their own bearer token, constant-time compared; the capture endpoint can only add; a refused token is recorded (see DE.CM) | `lib/security/bearer.ts`, `app/api/cron`, `app/api/capture` |
| PR.AA Brute force [AC-7] | Rate limits on sign-in, TOTP verify, Gmail actions, AI | `lib/security/rateLimit.ts` |
| PR.DS Data at rest [SC-28] | Supabase Postgres encryption at rest; no message bodies or secrets in logs or audit details | migration, `lib/audit.ts` |
| PR.DS Stored credentials [SC-28(1), SC-12] | OAuth refresh tokens sealed with AES-256-GCM (random IV, owner id as AAD) under a key held only in env; column-level privileges hide the ciphertext from the owner's own session | `lib/security/vault.ts`, migration `20261112201141_connections.sql` |
| PR.DS Data in transit [SC-8] | HTTPS only, HSTS preload, `upgrade-insecure-requests`, outbound https only | `next.config.ts`, `lib/security/*` |
| PR.DS Data minimization | Application tracking reads email headers only (sender, subject, date); email/SMS bodies never stored server-side beyond the outbox you create; feeds keep title/link/date only | `lib/domain/applications.ts`, `rss.ts` |
| PR.DS Secrets [IA-5, SC-12] | Secrets only in env (server-only module, zod-validated, names not values in errors); `server-only` imports; React taint enabled; gitleaks in CI | `lib/env.ts`, `next.config.ts`, CI |
| PR.PS Platform [CM-7, SI-10] | Strict nonce CSP, frame-ancestors none, COOP/CORP, nosniff, Permissions-Policy; zod validation on every action and route; DB check constraints; outbound allowlist + redirect re-check + size/time caps (SSRF) | `lib/security/csp.ts`, `next.config.ts`, `app/actions/*`, `safeFetch.ts` |
| PR.PS Secure development [SSDF PW] | TypeScript strict + `noUncheckedIndexedAccess`; pure domain logic with unit tests incl. security tests; CI gate (lint, types, tests, audit, build) | `tsconfig.json`, `test/`, CI |
| PR.IR Resilience | Twice-weekly authenticated keep-alive so the free database never pauses; each feed isolated (`Promise.allSettled`); AI has offline fallbacks; fail-closed when misconfigured | `lib/briefing.ts`, `lib/ai/*`, `proxy.ts` |

## DE — Detect

| Category | Control | Where |
| --- | --- | --- |
| DE.CM Agent activity [AU-2, AU-6, SI-4] | Every agent run writes started / succeeded / failed / skipped to an append-only activity log with model, tokens and cost; failures are shown in the brief and in Mission Control, never skipped silently; Pause stops a misbehaving agent without touching the others | `agent_runs`, `lib/agents/chiefOfStaff.ts`, `/mission` |
| DE.CM Monitoring [AU-2, AU-12] | Append-only audit trail of security-relevant events: sign-out, deletes, hand-offs (and kill-switch denials), AI calls, settings and switch changes, plan runs, exports | `audit_events`, `lib/audit.ts` |
| DE.CM Unsuccessful access attempts [AC-7, AU-2, SI-4] | A missing or wrong token at a machine endpoint leaves a "denied" row: the route and counts only, no token, header or caller address. Throttled in memory to one row per route per ten minutes, so a flood cannot fill the trail or cost a write per request | `lib/security/refusedToken.ts`, `lib/domain/refusedTokens.ts` |
| DE.CM Tamper resistance [AU-9] | No update/delete policy; privileges revoked; owner sees but cannot edit | migration |
| DE.AE Analysis | Audit trail on Settings with outcome pills (success / denied / error); failed audit writes logged to platform logs | `app/(app)/settings`, `lib/audit.ts` |
| DE.AE Review of refused tokens [AU-6] | The weekly QA review counts the week's refused tokens by rules and raises a finding from five (low), 25 (medium) or 250 (high, shown on Today), with the count, the routes and the times as evidence | `lib/domain/qa.ts`, `lib/agents/qa.ts` |
| DE.CM AI spend | Daily AI cap in the database; usage shown on Settings | `lib/ai/budget.ts` |

## RS — Respond

| Category | Control | Where |
| --- | --- | --- |
| RS.MI Containment | **Kill switch**: one tap stops all hand-offs and AI calls; reads keep working | Settings, `setSwitch` |
| RS.MI Session revocation | "Sign out everywhere" revokes all sessions (global sign-out) | `signOut` |
| RS.MA / RS.AN Playbook | Incident runbook: contain, rotate, review audit, restore | docs/SECURITY.md#incident-response |

## RC — Recover

| Category | Control | Where |
| --- | --- | --- |
| RC.RP Recovery | Full JSON export on demand (Supabase Free has no automatic backups); schema in migrations so the database can be rebuilt | `app/api/export`, docs/DEPLOY.md |
| RC.CO Communication | Single owner; recovery steps in the runbook | docs/SECURITY.md |

## Residual risks (accepted)

- In-memory rate limits are per server instance; the durable control for AI spend is the database cap, and auth brute force is also limited by Supabase. The refused-token record is throttled the same way, so its counts are a floor.
- `style-src 'unsafe-inline'` is kept for inline style attributes; styles cannot execute script.
- The secret iCal URL is a bearer credential held in an env var; rotating it is a one-click action in Google Calendar.
