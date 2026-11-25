# The MCP build: a career reference

For job prep and interviews. It sits alongside [MCP-BUILD.md](MCP-BUILD.md), which covers *what*
was built, step by step, and the decision log. This guide covers:
- **why this is the best way to build it**;
- the **tech stack and tools** to showcase;
- **resume lines**;
- the **skills it takes to direct a build like this**;
- the **decisions that would make it elite**.

Written 24 Nov 2026, after PR 197 (Atlas's MCP connector) merged.

---

## Part 1. Why it was built this way, and why that is the best way

The purpose: let an AI assistant (Claude) safely read one person's live job-search data, on any
device including voice, at no cost, without ever being able to change anything.

The answer to "what's the best way" depends on the purpose, so each choice below is measured
against it: **safe, standard, cheap, maintainable, observable**.

### 1. Use the standard protocol instead of a custom integration
**Chosen:** a remote MCP server.

**Why it's best here:** MCP is what Claude's hosts already speak (web, desktop, phone, Claude
Code). Discovery, tool schemas, sign-in and tool calling come for free on every surface, and other
MCP hosts work too.

**Rejected:**
- **A REST API plus a custom GPT or plugin:** one integration per host, a schema to maintain by
  hand, and no voice on Claude.
- **Building voice into the app:** large, browser-specific, and a worse experience than Claude's
  own voice mode.

**Principle:** *Integrate at the standard. Custom glue is a liability you maintain forever.*

### 2. A remote, stateless server inside the existing app
**Chosen:** a stateless Streamable HTTP route in the existing Next.js app on Vercel.

**Why it's best here:**
- **Remote** is required, because Claude connects from Anthropic's cloud and the phone can't run
  local processes.
- **Stateless** matches serverless: no memory between invocations, no sessions to store, expire or
  leak, and it scales horizontally for free.
- **Inside the app** reuses the domain logic, data layer, audit log, CI and deploys, so there is
  no second service to secure and pay for.

**Rejected:**
- **A local stdio server:** it would need the database secret key on a laptop, skip the app's
  guardrails, and not work on the phone.
- **A separate microservice:** duplicated auth, deploys and monitoring for no gain.
- **Stateful sessions:** they only pay off for server-to-client notifications, which this server
  doesn't need.

**Principle:** *Match the protocol mode to the runtime; add a service only when it earns its keep.*

### 3. Delegate authorization to an identity provider you already trust
**Chosen:** Supabase Auth as the OAuth 2.1 authorization server, with Dynamic Client Registration
and PKCE. The app hosts only the consent screen.

**Why it's best here:**
- OAuth is the most security-sensitive code in the system, and the least valuable to write
  yourself.
- Supabase already holds the owner's identity and MFA.
- It implements the exact flow the MCP spec requires, at $0.

**Rejected:**
- **Hand-rolled OAuth:** weeks of work and a large attack surface.
- **Auth0 or Clerk:** a second identity provider, cost at scale, and duplicated users.
- **A static API key:** Claude's consumer connectors expect OAuth, and a long-lived shared secret
  is weaker.

**Principle:** *Buy before build, especially for security primitives.*

### 4. Least privilege by construction, not by convention
**Chosen:**
- nine read-only tools;
- no Gmail, contacts or finance data at all;
- a CI test that fails the build if any tool calls a write, an agent or the AI budget;
- tools annotated read-only for the host.

**Why it's best here:** the strongest control is a capability that doesn't exist. A "be careful"
comment fails on a busy day; a failing test doesn't.

**Principle:** *Make the safe path the only path, and let CI enforce it.*

### 5. Defense in depth: every layer stops something on its own
**Chosen**, in request order:
1. an off-by-default switch;
2. OAuth tokens only (must carry a `client_id`), for the owner's id and email;
3. consent only behind the owner + MFA gate;
4. zod on every input;
5. redaction of email addresses and phone numbers;
6. an output size cap;
7. a 10-second limit per tool;
8. a rate limit;
9. web text labeled as data;
10. an audit row per call;
11. per-app revoke.

**Why it's best here:** any one layer can have a bug. Dynamic registration means *anyone* can
register a client, so the consent page and the token checks have to hold on their own.

**Principle:** *Assume each control fails once; design so one failure is never a breach.*

### 6. Tools designed for the model, not for a human API consumer
**Chosen:**
- **Snapshot tools** that return everything related in one call (`job_snapshot` = posting facts +
  tailoring + company research).
- A **"Use when…" one-liner** on every tool.
- **Errors that say how to recover.**
- A **`practice_interview` tool that carries its own coaching instructions.**

**Why it's best here:** the model picks tools from their descriptions and pays for every round
trip in latency and context. Fewer, richer calls mean fewer wrong picks and faster voice turns.

**Principle:** *A tool description is part of the prompt. Design for the reader, which is a model.*

### 7. Separate decisions from I/O, and test every level
**Chosen:** the access rule is one pure function (`decideMcp`) tested on every branch. Contract
tests run every tool on demo data. Integration tests send real JSON-RPC to the route. A policy
test lists every public route.

**Why it's best here:** security logic you can unit-test completely is security logic you can
trust and change safely.

**Principle:** *Pure core, thin shell. Test the contract the client depends on.*

### 8. Observability and reversibility from day one
**Chosen:** an audit row per call (tool, client, time, outcome; never content), a live row on
Mission Control's orchestration map, an off switch, and per-app revoke.

**Why it's best here:** you can't operate what you can't see, and you can't ship safely what you
can't turn off.

**Principle:** *Every capability ships with its off switch and its dashboard.*

### 9. Supply-chain hygiene
**Chosen:** compared the official SDK with a framework wrapper; audited the SDK in a temp folder
(license, publisher, install scripts, network calls, env reads, dependencies); pinned the exact
version.

**Why it's best here:** an MCP server sits on a trust boundary, so its dependencies sit there too.

**Principle:** *Audit, then pin. Fewer dependencies, each one justified.*

### The one-line answer
It's the best way for this purpose because it **uses the standard** (MCP), **reuses trusted
infrastructure** (Supabase identity, the existing app), **makes misuse impossible rather than
discouraged** (read-only by construction, enforced in CI), **layers independent controls**, and
**ships observable and reversible**, all at $0 with one new dependency.

---

## Part 2. Tech stack and tools to showcase

| Layer | Technology | What to say about it |
|---|---|---|
| Protocol | **Model Context Protocol** (Streamable HTTP, JSON-RPC 2.0) | Remote MCP server, stateless mode, tools with JSON Schema inputs and annotations |
| SDK | **`@modelcontextprotocol/server` 2.4.0** (official TypeScript SDK v2) | Per-request server factory over a web-standard `fetch` handler |
| App framework | **Next.js 16** route handlers and server actions, **React 19**, **TypeScript strict** | The MCP endpoint lives in the same app as the UI and domain logic |
| Auth | **OAuth 2.1 + PKCE**, **Dynamic Client Registration (RFC 7591)**, **Protected Resource Metadata (RFC 9728)** | Standards-compliant MCP authorization |
| Identity provider | **Supabase Auth** (OAuth 2.1 server, asymmetric JWT signing keys, `getClaims`, MFA/AAL2) | Delegated auth; consent behind owner + MFA |
| Data | **Supabase Postgres** with **row-level security**, owner-scoped store | Tools read through the existing data layer |
| Validation | **zod 4** | Tool inputs and every external boundary |
| Hosting | **Vercel** (serverless functions) | Stateless design matches the runtime |
| Testing | **Vitest**: unit, contract, policy and protocol-level integration tests | 13 MCP tests, plus the hardening suite |
| CI | **GitHub Actions**: lint, types, tests on every PR | The read-only rule is enforced here |
| Observability | Audit log, Mission Control live map (React + SVG) | Live state from audit rows, counts only |
| Security docs | **STRIDE threat model**, decision log (ADR style) | New trust boundary and four threats documented |
| AI hosts | **Claude** (web, desktop, iOS voice mode), **Claude Code** | The clients the server was built for |
| Build tooling | **Claude Code** (pair-built), Firecrawl (docs research), `npm pack` (dependency audit) | AI-directed development with human design ownership |

### Resume and LinkedIn lines (impact first, every number real)

- Built a **remote MCP server** that gives Claude secure, read-only access to a personal
  job-search platform, including **hands-free voice mock interviews**. Stateless Streamable HTTP on
  Vercel, $0 to run.
- Implemented **OAuth 2.1 authorization (PKCE, Dynamic Client Registration, RFC 9728)** by
  delegating to Supabase Auth; consent gated behind owner + MFA, OAuth-only tokens, per-app revoke.
- Enforced **least privilege in CI**: 9 read-only tools, a build-failing check against any write
  path, redaction, size caps, per-tool timeouts, rate limiting and an audit entry per call.
- Added **live observability** of the MCP layer to the system's orchestration map, and documented
  a **STRIDE threat model** and a **14-decision design log**.

For images and posts, use the proof-of-work framing: production-grade, the post-mortem (the
"consent page could never close" and "Staff stripped mid-title" kind of finds), and impact.

---

## Part 3. Skills it takes to direct a build like this

You directed this build: you set the goal, made the calls, approved the trade-offs and held the
bar. These are the skills that takes, how they showed up here, and how to keep building them.

| Skill | What it looked like in this build | How to strengthen it |
|---|---|---|
| **Product scoping** | Turned "talk with Atlas" into a clear outcome (voice practice on live data) and picked MCP over a custom button | Write the outcome, the users and the Not Doing list before any design |
| **Systems thinking** | Saw that the real requirement was "Claude can reach my data from the phone", not "a mic in my app" | Draw the request path end to end before choosing tools |
| **Protocol literacy** | MCP terms (host, client, server, tools, transports) and how auth plugs in | Read the MCP spec's overview and authorization pages; build a tiny server locally |
| **Identity and access** | OAuth 2.1 roles, PKCE, DCR, why OAuth-only tokens, why consent sits behind MFA | Draw an OAuth sequence from memory; explain PKCE in two sentences |
| **Threat modeling** | Named the risks (other people connecting, data leaving, prompt injection, abuse) and a control for each | Do a five-minute STRIDE pass on every new entry point |
| **API and tool design for LLMs** | Snapshot tools, "Use when" descriptions, recovery hints in errors | Read your tool list as if you were the model choosing |
| **Architecture judgment** | Stateless vs stateful, in-app vs separate service, buy vs build | For each decision, name two alternatives and the trade-off in one line |
| **Supply-chain hygiene** | Asked for an audit and a pinned version before adding the SDK | Make "audit, pin, justify" a reflex for every dependency |
| **Testing strategy** | Asked for "built to last": unit, contract, policy and protocol tests | Ask "what would break silently?" and write that test first |
| **Observability mindset** | Asked to see the layer on Mission Control | Every feature gets its off switch and its view |
| **Directing AI coding agents** | Gave goals and constraints, approved designs before code, and reviewed outcomes, not keystrokes | Write prompts as briefs: goal, constraints, definition of done, what to report back |
| **Technical communication** | Asked for a decision log and interview-ready documentation | Practise the 60-second pitch and one STAR story out loud |
| **Cost and constraint management** | Held a $0 budget (free tiers, no paid services) | State the budget as a design constraint up front |

**How to say it:** "I own the design and the trade-offs; I use AI agents to implement under my
specs, and I verify with tests and reviews." That is how senior engineers increasingly work, and
this build is evidence of it.

---

## Part 4. Decisions that would make it elite

Each is a decision for you, with a recommendation. They're ordered by value for job prep first.

| # | Decision | Options | Recommended | Why it's elite | Effort |
|---|---|---|---|---|---|
| 1 | **A public demo connector for employers** (built, 24 Nov 2026: set `ATLAS_MCP_DEMO=1`) | Keep it private; **add `/api/mcp-demo` serving fictional demo data, no sign-in, read-only, tighter limits** | Add the demo | An interviewer can add it to their own Claude and try it in 2 minutes. Nothing beats a live demo | S |
| 2 | **Structured outputs** | Text JSON (today); **`outputSchema` + `structuredContent` per tool** | Add schemas | Typed contracts the host can validate; shows spec mastery | M |
| 3 | **Tool-selection evals** | None; **a golden set of prompts → expected tool, run against Claude on demand** | Add it | Measures how well the model picks tools: the eval discipline AI teams hire for | M |
| 4 | **MCP Inspector conformance in CI** | Our own JSON-RPC tests; **plus the official Inspector CLI against a preview deploy** | Add it | Proves spec conformance with the reference tool, not just your own tests | S |
| 5 | **Per-tool OAuth scopes** | One consent for everything (today); **`atlas.read.career`, `atlas.read.prep`; write scopes later** | Add scopes before any write tool | Fine-grained consent; ready for safe write tools | M |
| 6 | **A write tool with confirmation** | No writes (today); **`log_practice_note` using MCP elicitation (the host asks you to confirm)** | Later, after #5 | Shows human-in-the-loop design: Claude saves your practice notes only with your yes | M |
| 7 | **Per-tool metrics** | Counts on the map (today); **p50/p95 latency and error rate per tool on Mission Control** | Add it | SLO thinking: you can say "p95 under 400 ms" in an interview | S |
| 8 | **Shared rate limit and per-client quotas** | Per-instance memory (today); **Postgres-backed counter (free) per client id** | Add when a second client appears | Correct under horizontal scale; no paid Redis | S |
| 9 | **Shorter token life and sender-constrained tokens** | ~1 hour (today); **shorter in Supabase; DPoP if supported** | Shorten now; DPoP only if supported | Shrinks the window after a revoke; DPoP is advanced OAuth | S / unknown |
| 10 | **Versioned tool contracts** | Version number (today); **a changelog and a deprecation policy (keep old shapes one minor version)** | Add the changelog | Treats tools as a public API, as platform teams do | S |

**Top three for job prep:** #1 (a live demo anyone can try), #3 (evals) and #2 (structured
outputs). Together they show product sense, AI quality discipline and protocol depth.
