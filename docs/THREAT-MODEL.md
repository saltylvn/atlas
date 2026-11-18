# Threat model

## Assets

1. Personal data: contacts, plans, job search state, the audit trail.
2. Credentials: Supabase secret key, Anthropic key, calendar secret URL, the vault key, the Gmail app password or refresh token, the cron and capture tokens, VAPID private key, the owner's session and TOTP seed.
5. Mail metadata: who writes to you and about what.
3. The owner's reputation: anything sent in their name.
4. Money: AI spend.

## Trust boundaries

```
 Phone / iPad (PWA)  ──https──▶  Atlas on Vercel  ──RLS──▶  Supabase Postgres
                                   │   │   │
  Claude or Gemini API ◀──────────┘   │   └──────▶ allowlisted public feeds, boards, weather, iCal
                                       │        Gmail API (read-only, OAuth + PKCE) ◀──┘
 Siri Shortcut ──bearer──▶ /api/capture        Vercel Cron ──bearer──▶ /api/cron/morning
 Atlas ──VAPID, RFC 8291 encrypted──▶ Apple / Google push service ──▶ your device
 Atlas ──secret key (apikey)──▶ Supabase Edge Function `embed` (gte-small, same project; text in, vectors out)
```

## Threats and mitigations (STRIDE)

| # | Threat | Mitigation | Residual |
| --- | --- | --- | --- |
| S1 | Someone else signs in | Single-owner sign-up trigger; owner email check in proxy, data layer; RLS bound to the enrolled owner id | Low |
| S2 | Stolen password / Google session | TOTP required (AAL2), enforced by RLS; "sign out everywhere" | Low |
| S4 | Gmail connected to an attacker's Google account, or OAuth code injection | Connect flow only for the signed-in owner (AAL2) whose user id matches `ATLAS_OWNER_USER_ID`; `state` + PKCE (S256) in an httpOnly cookie scoped to the route, compared in constant time; exact redirect URI from config, not the Host header | Low |
| S5 | Forged cron or capture call | Bearer tokens (32+ chars) compared in constant time; capture is write-only, size- and rate-limited, lands in the backlog; a refused token is recorded in the audit trail (route and counts only, throttled) and the weekly QA review counts them, so probing shows | Low |
| T1 | Tampering with the audit trail | No update/delete policy; privileges revoked; service writes only inserts | Low |
| T2 | Malicious feed content (XSS) | Feeds reduced to plain-text title + http(s) link; React escapes; strict nonce CSP | Low |
| R1 | "I didn't send that" | Hand-offs, drafts and switches audited with actor and outcome | Low |
| I1 | Secret leaks to the browser | `server-only` modules, taint, only `NEXT_PUBLIC_` Supabase values public, `connect-src 'self'` | Low |
| I2 | Secrets in logs | Errors name settings, not values; DB errors name table + op only; calendar URL never echoed | Low |
| I5 | Database leak exposes Gmail | App password (or OAuth refresh token) sealed with AES-256-GCM (key only in env, owner id bound as AAD); the owner's session cannot select the column; read-only scope; metadata only, no bodies; 30-day retention | Low |
| I8 | A stolen Gmail app password reads or sends mail | It is sealed at rest and decrypted only for a sync, an archive or an unsubscribe lookup; code paths read headers only (EXAMINE) and the one write removes the Inbox label from emails the owner clicked; no SMTP, no delete; revocable alone at Google without touching the account password; requires 2-Step Verification on the account | Medium (an app password grants full mailbox access if leaked) |
| S6 | A malicious email's List-Unsubscribe header points the one-click POST at an internal service (SSRF) | Runs only for senders the owner ticked; https on port 443 only, no IP literals or internal names, every resolved address must be public (private, loopback, link-local/metadata, CGNAT, reserved refused), no redirects, no cookies, response never read, 6 s timeout (`lib/security/oneClick.ts`) | Low |
| I6 | An email manipulates its own triage | Triage is rules over headers, not a model: text cannot change its pile, and nothing acts on mail | Low |
| I7 | SSRF through a push subscription endpoint | Endpoint must be https on Apple, Google, Mozilla or Microsoft push hosts; checked at subscribe and again before each send | Low |
| I3 | Prompt injection via news, job posts, contact notes or a retrieved email passage (Ask Atlas) leads to data exfiltration or a false answer | Data fenced as untrusted and the fence stripped from the data; outputs schema-bound, plain text and display-only; citations checked against what was retrieved; sources always shown; AI has no tools and no network; nothing auto-sends ([RAG.md](RAG.md)) | Low |
| I10 | The Mentor or Analyst invents a fact, or is steered by text in a posting or profile | Every number is computed by rules; model wording is kept only when its numbers appear in the facts it was given and (Mentor) it cites observations it was shown; outputs are plain text, display-only, and the Mentor writes one table and edits nothing | Low |
| S7 | A stranger calls the embeddings function | The project's secret key is required on `apikey`, compared in constant time before the body is read; the function holds no data and opens no connections; size caps | Low |
| I9 | The search function or the passage table is read by anyone but the owner | Same RLS as every table (owner + AAL2); `search_knowledge()` is security invoker, filters on `auth.uid()` and is not executable by `anon`; search words are letters and digits only | Low |
| I4 | SSRF via a job-board slug | Slug regex at input and DB; URL built from a fixed template; host allowlist re-checked on redirects | Low |
| D1 | Huge or slow feed stalls pages | Timeouts, byte caps, `allSettled`, data cache | Low |
| D2 | Runaway AI spend | Per-minute limit, daily cap in DB, kill switch | Low |
| E1 | Server action called with forged input | zod on every action; IDs regex-checked; RLS scopes every row | Low |
| E2 | Supply-chain compromise | Lockfile, `npm ci --ignore-scripts`, Dependabot, audit in CI, few runtime deps | Medium (inherent) |

## Out of scope

A compromised phone or laptop with an unlocked session; a compromised Supabase, Vercel, Google or Anthropic account.
