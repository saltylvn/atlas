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
 Claude (Anthropic's cloud) ──OAuth bearer──▶ /api/mcp (read-only tools)   Claude ◀──OAuth 2.1 + PKCE──▶ Supabase Auth ──consent──▶ /oauth/consent (owner + AAL2)
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
| I11 | A job posting read through Firecrawl carries instructions (prompt injection), or the read is pointed at a private or forbidden page | The posting's text never reaches a model and is never stored or rendered: rules take numbers, skill names from Atlas's own list and a few fixed phrases, then the text is dropped. Only postings of jobs the owner approved are read; `mayRead` refuses non-https, credentialed, private-network and never-read hosts (LinkedIn, Indeed, Glassdoor) before any request; Firecrawl fetches from its own network, never from Atlas's | Low |
| D3 | Reading postings runs past Firecrawl's free plan | A monthly budget of 900 of the 1,000 free pages, 40 a day and 5 a run, counted in Settings; a refused key, spent credits or a rate limit stops the run | Low |
| T3 | The Apply Agent submits an application twice, or one the owner did not approve | One row per posting (unique key in the database); a run claims its row in one conditional update before it starts; the state becomes `unconfirmed` before Submit is clicked and nothing after that is retried; approval is per application, of the exact packet, which cannot be edited once approved; Outbound allowed and the agent's Pause stop it | Low |
| T4 | The resume sent is not the one approved (Figma changed, or the kept file was replaced) | The frame's text fingerprint and the PDF's SHA-256 are recorded at approval; both are checked again before a browser opens; a mismatch, or Figma being unreadable, stops the run | Low |
| I12 | An application form's text steers the agent (prompt injection), or the agent answers what it must not | Labels are matched against fixed patterns and never followed; eligibility comes only from the owner's own answers; demographic, SSN, salary-history and conviction questions are never answered; a required question with no approved answer stops the run; the one drafted answer goes through the fenced model call with citation and number checks and is shown before approval | Low |
| I13 | Answers or the resume are kept by Browserbase, or its session address leaks | Sessions are created with recording and logging off; only that form's values are sent; the WebSocket address (it carries a signing key) is host-checked and no browser failure text reaches a log or trace | Low (7-day session metadata on the free plan) |
| T5 | A resume that no job board can read is sent (text outlined in Figma), wasting the application | Each exported PDF's text is read and compared with the frame; no readable text stops the run before a browser opens; a PDF that cannot be parsed is reported as not checked, never as passed. The parser reads only (no rendering, no network), runs with a 10-second limit on a copy of the bytes, and the file comes from the owner's own Figma export | Low |
| D4 | Applying runs past Browserbase's free plan | Stops at 50 of 60 minutes a month and 3 applications a day, counted in Settings; 10-minute session timeout; every session is released when the run ends | Low |
| S8 | Someone other than the owner connects an MCP client and reads the job search | `/api/mcp` takes only a Supabase OAuth access token (signature checked with `getClaims`) that carries a `client_id`, is the owner's account (id and email) and is unexpired; Claude access must be on in Settings (off by default); consent is given on `/oauth/consent`, behind the owner + AAL2 gate, so Dynamic Client Registration lets any client ask but only the owner can approve; each app can be revoked; 60 requests per 10 minutes; every call audited | Low |
| I14 | Data leaves through the MCP connector beyond what the owner meant, or a tool writes | Ten tools, read-only by construction (CI fails if the tools file calls a store write, an agent or the AI budget); email addresses and phone numbers removed before output; output capped at 14,000 characters; arguments and outputs never logged; no Gmail, contacts or finance tool exists ([MCP-BUILD.md](MCP-BUILD.md)) | Low |
| I15 | A job posting or news headline read through MCP steers Claude (prompt injection) | Web text is labeled as data in the tool output and in the server's instructions; no tool can act, so the worst case is a wrong answer in a chat the owner is reading | Low |
| D5 | A slow tool or a client in a loop ties up the endpoint | 10-second limit per tool, 30-second route limit, stateless (no sessions to exhaust), rate limit | Low (the rate limit is per function instance) |
| I17 | Google Calendar access reads or changes more than the owner meant | Its own connection row, never shared with Gmail; two read-only scopes (`calendar.calendarlist.readonly`, `calendar.events.readonly`), no write scope requested, and the callback refuses a grant without both; refresh token sealed like Gmail's (AES-256-GCM, owner id as AAD) and opened only to read; events kept in server memory for five minutes, never stored; colors accepted only as six-digit hex before they reach a style; disconnect revokes the token at Google | Low |
| I16 | The public demo MCP endpoint (`/api/mcp-demo`, no sign-in) exposes real data or is abused | It serves a separate in-memory showcase store of fictional data; its route and `lib/mcp/showcase.ts` may not import the owner store, Supabase or `getContext` (CI fails otherwise); off unless `ATLAS_MCP_DEMO` is set; read-only, writes nothing; 40 requests per caller and 400 in total per 10 minutes; 16 KB body cap; 15-second route limit | Low (limits are per function instance) |
| D1 | Huge or slow feed stalls pages | Timeouts, byte caps, `allSettled`, data cache | Low |
| D2 | Runaway AI spend | Per-minute limit, daily cap in DB, kill switch | Low |
| E1 | Server action called with forged input | zod on every action; IDs regex-checked; RLS scopes every row | Low |
| E2 | Supply-chain compromise | Lockfile, `npm ci --ignore-scripts`, Dependabot, audit in CI, few runtime deps | Medium (inherent) |

## Out of scope

A compromised phone or laptop with an unlocked session; a compromised Supabase, Vercel, Google or Anthropic account.
