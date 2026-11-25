# How Atlas's MCP server was built, and why

A reference for the build behind "talk with Claude about my job search": what was built, the order
it was built in, every decision with the options weighed, and how to explain it to an employer.
Setup and day-to-day use are in [CLAUDE-CONNECTOR.md](CLAUDE-CONNECTOR.md); for job prep (why this is the
best way, the stack to showcase, the skills to direct it, elite next steps) see [MCP-CAREER-GUIDE.md](MCP-CAREER-GUIDE.md).

Built 24 Nov 2026 (Step 4 of the agent plan). Server version 1.0.0.

---

## 1. The 30-second version

Atlas is a personal job-search app with agents that scout jobs, tailor applications and prepare
interviews. I exposed its data to Claude as a **remote MCP server**, so I can ask Claude about my
search, or run a spoken mock interview in Claude's voice mode, against live data. It runs on the
existing Next.js app on Vercel at $0:

- **Stateless Streamable HTTP endpoint**, built with the official TypeScript SDK.
- **Supabase Auth as the OAuth 2.1 authorization server**, so no hand-rolled auth.
- **Nine read-only tools**, enforced by a CI test, with redaction, timeouts, rate limiting and an
  audit entry per call.
- **A live view** of the layer on Mission Control's orchestration map.

---

## 2. MCP in five terms

| Term | What it means here |
|---|---|
| **Host** | The app the person talks to: Claude on the web, the phone app, Claude Code. |
| **Client** | The part of the host that speaks MCP to one server. Claude makes one per connector. |
| **Server** | Atlas's `/api/mcp`. It lists tools and runs them. |
| **Tools** | Functions the model may call, each with a name, a one-line description and a JSON Schema for its input. MCP also has *resources* (read-only documents) and *prompts* (templates). Atlas uses tools only, because tools are what hosts support best today. |
| **Transport** | How messages travel. *stdio* is for a local child process; **Streamable HTTP** is for a remote server. Messages are JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`). |

Remote servers are authorized with **OAuth 2.1**. The server is the *protected resource*. It tells
clients which *authorization server* to use through **RFC 9728 protected resource metadata**, and
clients may register themselves with **Dynamic Client Registration (RFC 7591)**. **PKCE** is
mandatory.

---

## 3. Requirements

**Functional**
- Ask Claude about the Apply Queue, one job, applications, the funnel, the market, the proof
  project and interview prep.
- Practise interviews out loud, hands-free, from Claude's phone app.

**Non-functional**
- Only the owner can connect.
- Nothing can be written, sent or applied from Claude.
- Personal contact details never leave.
- It fits Vercel's short-lived functions and costs $0.
- The owner can see when it is used.

**Not doing**
- Write tools.
- Audio inside Atlas (Claude's voice mode does it).
- A local server holding Atlas's secret key.
- Gmail, contacts or finance data.

---

## 4. Architecture

```
 Claude (web, phone, Code)                         Supabase Auth (OAuth 2.1 server)
   │ 1 POST /api/mcp (no token)                          ▲   │
   │ ◀ 401 + WWW-Authenticate: resource_metadata=…        │   │ 5 authorize → redirect to Atlas consent
   │ 2 GET /.well-known/oauth-protected-resource/api/mcp  │   ▼
   │ ◀ { authorization_servers: [supabase/auth/v1] }      │  /oauth/consent  (owner + MFA gate)
   │ 3 discover Supabase's metadata ──────────────────────┘   │ 6 Approve → code
   │ 4 register itself (DCR)                                  │
   │ 7 exchange code + PKCE verifier for tokens ◀─────────────┘
   │
   │ 8 POST /api/mcp  Authorization: Bearer <access token>
   ▼
 /api/mcp  (app/api/mcp/route.ts)
   ├─ rate limit (60 / 10 min)
   ├─ verify token signature + expiry   (lib/mcp/verify.ts → supabase.auth.getClaims)
   ├─ decide: OAuth token? owner? access on?   (lib/mcp/auth.ts → decideMcp, pure)
   ├─ build the owner's Context (owner-scoped store)
   └─ createMcpHandler(factory)  → fresh McpServer per request   (lib/mcp/server.ts)
         └─ tool → read-only domain functions (lib/mcp/tools.ts) → redact, cap → audit row
```

**Files**

| File | Job |
|---|---|
| `app/api/mcp/route.ts` | The endpoint: rate limit, token check, context, handler. POST only. |
| `app/.well-known/oauth-protected-resource/[[...rest]]/route.ts` | RFC 9728 metadata: points clients at Supabase Auth. |
| `lib/mcp/auth.ts` | Pure rules: who gets in, bearer parsing, metadata shape, consent id checks. |
| `lib/mcp/verify.ts` | Token signature check with Supabase (`getClaims`). |
| `lib/mcp/server.ts` | The MCP server: registration, annotations, time limit, audit, safe errors. |
| `lib/mcp/tools.ts` | The 10 tools: zod inputs, one-line "use when", redaction, output cap. |
| `app/oauth/consent/page.tsx`, `app/actions/mcp.ts` | Consent screen, approve or deny, the on/off switch, revoke. |
| `lib/supabase/gate.ts`, `lib/supabase/proxy.ts`, `lib/mcp/consentReturn.ts` | Public paths; coming back to consent after sign-in and MFA. |
| `lib/domain/orchestration.ts`, `components/client/LiveMap.tsx`, `lib/agents/live.ts` | The MCP row on Mission Control's live map. |
| `test/mcp.test.ts`, `test/hardening.test.ts` | Auth rules, read-only check, tool contracts, real MCP calls, map. |

---

## 5. The build, step by step

This is the order to build any remote MCP server for real data. Each step says what was done and
the habit behind it.

### Step 1: Scope first, and write the Not Doing list
Decided the server is **read-only** and listed what it would never expose (Gmail, contacts,
finance) before any code.

*Habit: least privilege. The cheapest security control is a capability that doesn't exist.*

### Step 2: Check what the host actually supports
Read Claude's connector docs before designing:
- custom connectors work on web, desktop and mobile;
- voice mode can use connectors;
- Claude connects from Anthropic's cloud, so the server must be public;
- a connector you add yourself authenticates with OAuth (or none).

That ruled out a simple fixed API key for the phone, which was the original plan.

*Habit: verify the platform's constraints from current docs, not from memory.*

### Step 3: Choose the authorization server; buy before build
Found that Supabase Auth, which Atlas already uses, can act as an OAuth 2.1 server with DCR and
PKCE. Atlas only hosts the consent screen.

*Habit: buy before build. Hand-rolled OAuth is a large, risky surface.*

### Step 4: Pick the SDK and audit it before installing
Compared the official `@modelcontextprotocol/server` with Vercel's `mcp-handler` wrapper. Before
installing the SDK, audited it in a temp folder:
- license and publisher;
- install scripts (none);
- network calls (none);
- environment reads (none);
- dependencies (only zod 4, already in Atlas).

Pinned to exactly 2.4.0.

*Habit: supply-chain hygiene. Audit, then pin.*

### Step 5: Design the tools for the model
Nine **snapshot** tools: each returns everything related in one call. For example, `job_snapshot`
returns the posting facts, Pitch's tailoring and the company research together, instead of three
getters.
- Names are snake_case verbs or nouns.
- Each description starts "Use when…", because the description is part of the prompt that picks
  the tool.
- Inputs are zod schemas; ids are regex-checked.
- Errors explain how to recover ("call applications for the ids").
- `practice_interview` returns instructions for running the mock interview along with the data, so
  any host behaves well without a custom prompt.

*Habit: tools are an interface for a model. Fewer, richer calls; actionable errors.*

### Step 6: Make the data layer read-only by construction
Tools receive the owner's Context and call only read methods and pure domain functions. A test
fails the build if `lib/mcp/tools.ts` ever calls a store write, an agent runner or the AI budget.

*Habit: enforce invariants in CI, not in code review.*

### Step 7: Verify the token, then decide with a pure function
- `verify.ts` checks the signature and expiry with Supabase.
- `decideMcp` (pure and unit-tested) requires:
  - a `client_id`, so it is an OAuth token and not a stolen browser session;
  - the owner's id **and** email;
  - an unexpired token;
  - Claude access on.
- A refusal is a 401 or 403 with a `WWW-Authenticate` header pointing at the metadata, which is how
  MCP clients start sign-in.

*Habit: separate I/O from decisions, so security rules are tested exhaustively.*

### Step 8: Build the consent page inside the existing security gate
`/oauth/consent` is *not* a public path, so the session gate requires the owner and the second
factor before it renders. If sign-in interrupts consent, the gate stores the shape-checked
`authorization_id` in a 15-minute httpOnly cookie and MFA returns you there. Approve and deny are
server actions with rate limits and audit rows. The redirect back to Claude must be https.

*Habit: reuse the strongest control you already have instead of building a second one.*

### Step 9: Serve it statelessly
`createMcpHandler(factory)` builds a fresh `McpServer` per request. With no sessions, nothing is
kept between Vercel invocations, nothing can leak between requests, and it scales horizontally.
GET and DELETE answer 405, since there is no stream or session to open or close.

*Habit: match the protocol mode to the runtime.*

### Step 10: Guardrails around every call
- Rate limit: 60 requests per 10 minutes.
- Time limit: 10 seconds per tool.
- Output: capped at 14,000 characters; over the cap, it says so instead of cutting mid-JSON.
- Redaction: email addresses and phone numbers removed from every string except `url` fields.
- Annotations: tools are marked `readOnlyHint` and `idempotentHint`, so hosts can skip asking
  before each call.
- Errors: a plain sentence to Claude; the detail goes to the audit log only.

*Habit: defense in depth, and errors that don't leak internals.*

### Step 11: Off by default, with a kill switch and revoke
- **Claude access** starts off in Settings.
- Each approved app is listed and can be revoked; Supabase then deletes its sessions and refresh
  tokens.
- Turning the switch off refuses every request at once.

*Habit: feature flag the rollout, and make undo one click.*

### Step 12: Observability
Every call writes an audit row: tool, client, duration, outcome. Never arguments or output. The
Mission Control live map has a "Claude connector" row (Supabase Auth, Claude, MCP server, Atlas
data). The MCP box shows blue while Claude is reading, green after calls, red when the last call
failed, and dashed when access is off. Its panel shows today's calls and failures.

*Habit: if you can't see it, you can't operate it.*

### Step 13: Test at every level
- **Unit:** every branch of `decideMcp`, bearer parsing, consent id shape, redaction, the time
  limit, the map's live state.
- **Contract:** every tool runs on demo data, stays under the cap, contains no email address, and
  has a unique snake_case name with a "Use when" description.
- **Policy:** read-only check; the hardening test must list every public route, and fails on a new
  one nobody reviewed.
- **Integration:** real JSON-RPC (`initialize`, `tools/list`, `tools/call`) against the route
  handler.
- **Manual:** the dev server answers tool calls, and the map lights up.

*Habit: test the contract the client depends on, not just the functions.*

### Step 14: Document the threat model
Added the MCP trust boundary and threats S8, I14, I15 and D5 to [THREAT-MODEL.md](THREAT-MODEL.md).

*Habit: every new entry point gets a threat model row.*

---

## 6. Decision log

| # | Decision | Options weighed | Chosen | Why | Trade-off accepted |
|---|---|---|---|---|---|
| 1 | Voice practice | Web Speech API in Atlas; Gemini Live; **Claude's voice mode over MCP** | Claude over MCP | Better voice and coaching, nothing to build for audio, $0 | Practice sessions are not saved in Atlas |
| 2 | Transport | stdio (local); legacy HTTP+SSE; **Streamable HTTP, stateless** | Streamable HTTP | Remote hosts need HTTP; stateless fits serverless | No server-to-client notifications mid-session (not needed) |
| 3 | Where it runs | Separate service; Supabase Edge Function; **a route in the Next.js app** | Next.js route | Reuses the domain code, store, audit and deploys; no new service | Shares the app's function limits (30 s here) |
| 4 | Authorization server | Hand-rolled OAuth; Auth0 or Clerk; **Supabase Auth OAuth 2.1** | Supabase | Already the identity provider; DCR and PKCE included; $0 | Depends on a newer Supabase feature; needs four dashboard settings |
| 5 | Auth for Claude Code only | Static bearer key | Not chosen | The phone needs OAuth anyway; one mechanism is simpler | — |
| 6 | Which tokens are accepted | Any valid Supabase JWT; **OAuth tokens only (`client_id`)** | OAuth only | A leaked browser session token can't be replayed here | Claude must use the OAuth flow |
| 7 | Consent protection | Public consent page; **behind the owner + MFA gate** | Behind the gate | DCR lets anyone register a client; only the owner can approve | An extra sign-in step when the session has expired |
| 8 | SDK | `@modelcontextprotocol/sdk` v1; **`@modelcontextprotocol/server` v2**; `mcp-handler` | Official v2 server | Current spec, web-standard `fetch` handler, deps only zod | A v2 API, newer than most examples online |
| 9 | Tool granularity | Many small getters; **snapshot tools** | Snapshots | Fewer turns, less context, fewer wrong picks | Larger outputs, hence the cap |
| 10 | Write tools | Mark applied, save notes; **none** | None | Least privilege, and nothing outward-facing without the owner | Claude can't update Atlas; you do it in the app |
| 11 | Resources and prompts | Expose as MCP resources and prompts; **tools only** | Tools | Most consistent host support; `practice_interview` carries its own instructions | Less idiomatic for static documents |
| 12 | Response format | Force JSON; **SDK default** (JSON, or one-message SSE) | Default | Works with every client; the JSON-only mode logs a warning each request | Tests parse both shapes |
| 13 | Rate limiting | Upstash Redis (paid at scale); **in-memory per instance** | In-memory | $0; the token gate is the real control | Limit is per function instance, not global |
| 14 | Visibility | Logs only; **audit rows + live map row** | Both | The owner can see the layer working; QA can count it | A few more audit rows a day |
| 15 | Showing it to employers | Screenshots; a video; **a public demo endpoint on fictional data** | Demo endpoint (`/api/mcp-demo`) | A reviewer tries the real protocol in their own Claude in minutes | A public route to keep safe: isolated data, off by default, tight limits |
| 16 | Demo data source | The app's shared demo store; **a separate in-memory showcase store** | Separate (`lib/mcp/showcase.ts`) | It imports no real data source, so there is nothing real to reach; CI enforces it | A little seed data to maintain |

---

## 7. Security model

Every request passes these layers in order. Each is enough to stop something on its own.

1. **Off by default:** a Settings switch, checked on every request.
2. **Identity:** a valid Supabase signature, an OAuth `client_id`, the owner's id and email, an
   unexpired token.
3. **Consent:** given only by the owner with the second factor; revocable per app.
4. **Capability:** nine read-only tools; no write path exists, and CI enforces it.
5. **Data minimization:** no Gmail, contacts or finance; email addresses and phone numbers
   removed; output capped.
6. **Untrusted input:** zod on every argument; web text labeled as data; no tool can act, so
   prompt injection is limited to a wrong answer.
7. **Abuse limits:** rate limit, a time limit per tool, a 30-second route limit.
8. **Accountability:** an audit row per call and per consent decision; the live map shows it.

---

## 8. Running it

- **Rollout:** merge, deploy, set the four Supabase options, turn Claude access on, connect from
  claude.ai.
- **Kill switch:** Settings, Connect Claude, off. Takes effect on the next request.
- **Revoke one app:** Settings, Connect Claude, Revoke.
- **Versioning:** `MCP_SERVER_INFO.version`. Minor for a new tool; major when a tool's input or
  output changes shape. Note it in PROGRESS.md.
- **Adding a tool:**
  1. Write a read-only function in `lib/mcp/tools.ts` with a zod input and a "Use when"
     description.
  2. Add its arguments to the contract test.
  3. Check that it holds no personal fields beyond what it needs.
  4. Bump the minor version.
  5. Add it to the table in CLAUDE-CONNECTOR.md.

## 9. Known limits and what's next

- The rate limit is per serverless instance. Under real multi-user load, it would move to a
  shared store.
- Access tokens last about an hour. Revoking stops refresh at once, but a token already issued
  works until it expires. Shorter token life in Supabase would narrow that.
- No per-tool scopes yet: one consent covers all eleven tools. With write tools, scopes would split
  read from write.
- Next candidates: a `log_practice_note` write tool with explicit confirmation; MCP resources for
  the resume and the role profiles.

---

## 10. Talking about it with employers

**Pitch (about 60 seconds)**
"I built a remote MCP server so Claude can work with my job-search app's live data, including a
hands-free mock-interview mode on my phone. It's a stateless Streamable HTTP endpoint in my
Next.js app on Vercel, using the official TypeScript SDK. For auth I didn't hand-roll OAuth: I
used Supabase Auth as an OAuth 2.1 server with dynamic client registration and PKCE. My app only
hosts the consent screen, and it sits behind my existing owner-plus-MFA gate. The server exposes
nine read-only tools, and read-only is enforced by a CI test, not a convention. Every call is
redacted, time-limited, rate-limited and audited, and the whole layer shows live on my system's
orchestration map. It costs nothing to run."

**As a STAR story**
- **Situation:** I wanted to practise interviews hands-free, against my real application data.
- **Task:** give an AI assistant safe, read-only access to a personal app with sensitive data, at
  $0.
- **Action:**
  - Checked the host's constraints first.
  - Chose MCP over building voice into the app.
  - Reused Supabase as the OAuth server.
  - Audited and pinned the SDK.
  - Designed snapshot tools for the model.
  - Enforced read-only in CI.
  - Layered auth, redaction, limits and an audit trail.
  - Added observability and a threat model.
- **Result:** I can ask Claude about my search or run a mock interview by voice. It took one
  dependency, no new services, a 13-test suite, and documented decisions.

**Questions you may get, with short answers**
- *Why MCP and not a REST API for Claude?* MCP is the standard hosts already speak: discovery,
  tool schemas and auth come for free in every Claude surface. A custom API would need a custom
  integration per host.
- *Why stateless?* Serverless functions don't keep memory between requests, and this server needs
  no server-to-client notifications. Stateless also means nothing can leak between requests.
- *How do you stop other people connecting, given dynamic registration lets anyone register?*
  Registering isn't authorizing. Consent happens on my page behind owner + MFA, and the endpoint
  rejects any token that isn't an OAuth token for my account.
- *How do you handle prompt injection?* The tools can't act, so injected text can at worst produce
  a wrong answer I'm reading. Web text is labeled as data. Arguments are schema-validated.
- *How would you scale it to many users?* Add per-user scopes and RLS-scoped tokens instead of an
  owner-scoped store, move the rate limit to a shared store, add per-tool metrics, and version the
  tool contracts.
- *What would you do differently?* Add per-tool OAuth scopes from the start, so adding a write tool
  later wouldn't widen the existing grants.
