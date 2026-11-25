# Atlas (atlas-optim)

Personal chief-of-staff PWA for one owner (Tyler): morning brief, week plan, people/comms, jobs and applications (logged from email), news, and a security center. See README.md and docs/.

## Rules for changes
- Next.js 16: `proxy.ts` (not middleware), async `cookies()`/`searchParams`. Check `node_modules/next/dist/docs/` before using an API.
- Every page and server action goes through `getContext()` (lib/context.ts). Never query a store or Supabase directly from a page.
- Every server action validates input with zod and returns `ActionResult`. Security-relevant actions call `audit()`.
- Pure logic lives in `lib/domain/` with tests in `test/`. No I/O there.
- Outbound HTTP only via `lib/security/safeFetch.ts`; a new host goes on `ALLOWED_HOSTS`.
- Model calls only via `lib/ai/model.ts` (it routes to `claude.ts` or `gemini.ts`), gated by `takeAiCall`, with an offline fallback. AI output is display-only.
- Bots draft; they never send, submit or delete outside the app. Tyler applies to every job himself on his MacBook, with Atlas Autofill (the Apply bot that submitted forms was removed on 23 Nov 2026).
- New table: migration with RLS (`owner_id = auth.uid()` and `is_owner_aal2()`), Store collection, demo seed.
- Secrets: server-only env, listed in `.env.example`, never logged.
- Mobile-first: 16px inputs, 44px tap targets, test at 375px and 768px.

## Building agents (docs/AGENT-ARCHITECTURE.md)
Smarter agents come from architecture, not prompt tweaks. Call it an agent only if it loops toward a goal, picks its own next tool, recovers from failures and runs within guardrails; prompt + retrieval + one call is a workflow, and is labeled one. Every agent follows these:
- Narrow scope: code for predictable steps; the model only for ambiguity and decisions. Split work into router, worker and reviewer roles rather than one do-everything loop.
- High-signal context: hybrid retrieval (keyword + meaning) with filters and reranking; a typed state object (tried, failed, remaining) instead of long history; tool details disclosed only when picked.
- Tools built for the model: zod schemas with a one-line "use when"; errors return how to fix the input, never a raw failure; consolidate calls that always go together into one snapshot tool.
- Verify before finishing: zod on every output with a rules fallback; claims checked against your material in code; a separate judge with a checklist; nothing outward-facing without Tyler's approval.
- Measure: a golden eval set per agent (real failures included) in CI, and a trace of every step (tool, result, time, tokens) so wasted turns show.

## Build on what exists (work smart)
- Don't reinvent the wheel: before writing infrastructure, a parser, auth, retries or agent orchestration, check for a maintained library, a reference repo's pattern, an MCP server or a Claude skill that already does it; say so in the plan.
- Adopt carefully: audit it first (architecture, network calls, secrets, license), prefer active maintenance and tests, pin the version, ask Tyler before any new dependency ($0: open source and free tiers only).
- Take only the pattern you need, adapted to these rules (zod, safeFetch, lib/domain purity); scope MCP servers and skills to this repo; tests before wiring it into routes; small commits.

## Product pragmatism (how Tyler approaches builds)
- A focused tool, not a platform: every design states a "Not Doing" list (e.g. no multi-user UI, no autonomous daemon, nothing destructive without confirmation).
- Thin entry points, explicit orchestration: pages, routes and actions validate and call a runner in `lib/agents/` or `lib/domain/`; no business logic, prompt strings or queries in handlers.
- Three layers for anything that calls tools: connectors (typed, least privilege, read-only by default), guardrails (dry-run, environment checks, Tyler's confirmation before anything public or irreversible), and a trace of every step (run, step, tool, sanitized args, status, duration, error summary).
- Operational maturity over cleverness: secrets never in traces or logs; rate limits, timeouts and partial data handled on purpose with clear diagnostics; one-command setup and a README that says why each library was chosen or skipped.

## Commands
`npm run dev` (demo mode without Supabase) · `npm run check` (lint, types, tests) · `npm run build`
