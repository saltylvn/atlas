# Architecture

## Layers

```
app/(app)/*/page.tsx      Server components: read through getContext(), render.
app/actions/*.ts          Server actions: zod-validate -> getContext() -> store -> audit -> revalidate.
app/api/*                 Route handlers: health, export, applications CSV, Google connect,
                          the 9 AM / 2 PM crons, Siri capture.
agents/*/instructions.md  Versioned instructions for each agent, read at run time.
lib/agents/               Orchestration: the Chief of Staff run, the scheduler, instruction loader.
components/               UI. components/client/* are the only "use client" files.
lib/context.ts            Data-access front door: mode, owner + MFA re-check, store, today.
lib/data/                 Store interface + memory (demo/tests) and Supabase (live) adapters.
lib/domain/               Pure logic: dates, planner, brief, relationships, jobs, renewals, agents. No I/O.
lib/integrations/         Adapters: weather, RSS, job feeds and boards, iCal, Gmail (read-only except archive).
lib/connections/          Stored connections: sealed tokens and the Gmail sync (secret-key client).
lib/owner.ts              Owner-scoped secret-key store for jobs that run without a browser session.
lib/push.ts               Web push to installed devices (VAPID), with an endpoint allowlist.
lib/ai/                   The model router (model.ts), the Claude and Gemini clients, prompts + schemas,
                          budget gate, the embeddings client.
lib/agents/{scout,analyst,mentor}.ts  The Career desk (docs/CAREER-DESK.md): each writes one table.
lib/knowledge/            Ask Atlas: the indexer and the question pipeline (docs/RAG.md).
supabase/functions/embed  Edge function: gte-small embeddings, callable only with the secret key.
lib/security/             CSP, bearer tokens, the token vault, rate limit, outbound allowlist.
public/sw.js              Service worker: shows pushes and opens Atlas. No caching of personal data.
vercel.json               The daily morning cron.
lib/supabase/             Clients, the access-gate rule, the proxy session refresh.
proxy.ts                  Next.js 16 proxy: CSP nonce, session refresh, owner/MFA gate, fail-closed.
supabase/migrations/      Schema, RLS, single-owner trigger, append-only logs (enforced by triggers for every role).
```

Dependencies point inward: pages and actions -> context -> store / integrations / ai -> domain. `lib/domain` imports nothing outside itself, which is why it has the densest tests.

## Modes

| Mode | When | Data | Auth |
| --- | --- | --- | --- |
| `demo` | No Supabase settings, in development (or `ATLAS_DEMO=1`) | In-memory seed, fictional | None |
| `live` | Supabase URL + publishable key + `ATLAS_OWNER_EMAIL` | Postgres with RLS | Google + TOTP (aal2) |
| `misconfigured` | Production with neither | None | Every route -> `/setup` |

## A request, end to end

1. `proxy.ts` makes a nonce, builds the CSP, refreshes the Supabase session, and applies `decide()` from `lib/supabase/gate.ts`: signed out -> `/login`, wrong account -> signed out, no second factor -> `/mfa`.
2. The page calls `getContext()`, which applies the same rule again (defense in depth) and returns a store bound to the user's own Supabase client. RLS is the final authority.
3. Feeds run in parallel through `safeFetch` (allowlist, timeout, size cap, cache). Any one can fail without breaking the page.
4. Pure functions compose the result (for Today: `composeBrief`).

## The agent model

Atlas follows the plan in *Atlas: AI Agent Orchestration*: one orchestrator, the **Chief of Staff**, eight specialists that report to it, and a **QA Agent** that reviews them all and reports to you. The specialists work in two desks: the **Daily desk** (Calendar, News, Finance, Email) and the **Career desk** (Scout, Analyst, Applications, Mentor; see [CAREER-DESK.md](CAREER-DESK.md)). Agents share data in Supabase, not context; each specialist reports in the **Standard Agent Report Format** (headline, details, needs approval, errors); nothing irreversible happens without approval. Instructions are versioned files in [`agents/`](../agents/README.md).

Every agent is live. Four use the AI model for judgment; the rest are rules only. The roster, with what each agent owns and never does, is `lib/domain/agents.ts`.

| Agent | Desk | Deterministic core | AI judgment |
| --- | --- | --- | --- |
| Chief of Staff | Orchestrator | `assembleReport` (`lib/domain/chiefOfStaff.ts`), `composeBrief` | Words the brief's headline and summary |
| Calendar | Daily | `calendarAgentReport` (`lib/domain/calendarAgent.ts`): iCal read, conflicts, appointments and interviews | Rules only |
| News | Daily | `newsAgentReport` (`lib/domain/newsAgent.ts`): same-story grouping, coverage ranking, balance, no repeats | Rules only |
| Finance | Daily | `financeAgentReport` and `renewalView`: bills, payment alerts, deals, renewals | Rules only |
| Email | Daily | `triage` (reply / FYI / noise), hands job emails to Applications and bills to Finance | Rules only |
| Scout | Career | Job feeds on your watchlist, your GitHub repos once a day | Rules only |
| Analyst | Career | Demand, pay and skills per role (`lib/domain/roleOutlook.ts`) | Words the market report; every number is rules |
| Applications (id `career`) | Career | Matching, apply kits, answer bank, follow-ups, the 6 PM resume sync | Job fit and drafted answers |
| Mentor | Career | Observations from the whole hunt, role order proposals | Insights and role order, inside the rules' bounds |
| QA (id `qa`) | Reviews the team | `qaReview` (`lib/domain/qa.ts`): a week of runs, briefs, AI answers, eval scores, connections and queues; ranked findings, each with evidence and a fix; compared with last week | Rules only, on purpose: it must work when the model is what broke |

**The weekly QA review** (`lib/agents/qa.ts`, `/api/cron/qa`, Sunday evening Mountain time): the QA Agent reads the records the other agents already write and reviews them by rules. Checks: every agent's runs finished (a run with no result six minutes after it started was stopped mid-run); the 2-hour sync kept its schedule; every brief was saved, on time; the AI model answered when asked, and which model did the writing; the last connection check; AI calls against the daily limit; eval scores (below a bar, dropped this week, cases failing all week); connections healthy and fresh; applications with no role; apply kits waiting more than three days; Mentor subjects you keep dismissing; agents left paused. Each failed check raises a finding with a severity, evidence (counts, task names and times, never content) and a suggested fix. Findings keep a stable key, so the next review says what is new, what is open for how many reviews, and what got fixed. Reports live in `qa_reports` (server-written, owner-read, kept a year), show on Mission Control with every check that ran, and Today points at the review for two days when something is high severity. It is independent of the Chief of Staff, changes nothing, and has its own eval suite: sample weeks with one thing wrong must raise exactly that finding.

**The daily rhythm** (`lib/domain/briefSchedule.ts`, `lib/agents/cron.ts`, `vercel.json`): Vercel Cron calls `/api/cron/morning` (14:00 UTC, Mon-Sat) and `/api/cron/afternoon` (19:00 UTC, Mon-Fri), so the Morning Brief is ready before 9:00 AM and the 2:00 PM Brief before 2:00 PM Mountain time. Weekend Mode: Saturday gets one lighter brief (Hot List, the weekend's calendar, 3 stories); Sunday is off. The inbox is read before each weekday brief. The 2:00 PM Brief skips stories the morning already showed.

**A run** (`lib/agents/chiefOfStaff.ts`): check the pause switch, log `started`, gather inputs, run each live specialist (the Email Agent syncs the inbox first on weekdays, then the Calendar, News and Career Agents run in parallel; each logs its own runs and gets only the context it needs; a paused or failed specialist is named in the brief), assemble the report (Hot List first, failures listed rather than skipped), let Claude word it when allowed (writer tier, cost logged), save it to `briefs`, log `succeeded` or `failed`, then push a "brief is ready" ping for scheduled runs.

**Mission Control** (`/mission`; laid out for an iPad or laptop, and under More on a phone, where the agent cards become one row per agent that opens for its details and buttons): agent status cards with Run Now and Pause, the live activity feed (polled every 15 s so the browser still talks only to Atlas), errors and alerts, cost today, connection health, the job pipeline, and searchable brief history.

**Live map** (`/mission?view=map`, a toggle on Mission Control): the orchestration drawn as boxes and lines. Triggers start the Chief of Staff (the 6 PM evening run starts Applications and the Mentor directly), the Chief of Staff asks the Daily and Career desks, each agent reads its own sources, and results are delivered to you. The AI model has its own box with today's calls against the daily limit, and dashed lines to the four agents it judges for. Sources and the AI model have dashed borders: they are outside Atlas. Lines run at right angles in lanes between boxes (`route` in `lib/domain/orchestration.ts`; a test checks no line crosses a box). Selecting a box dims the rest and lists what it reads, what the model judges for it, what it writes, and its last run, from static facts (`NODE_FACTS`), nothing personal. On a phone the map keeps a readable size and scrolls sideways. The map itself is fixed in `lib/domain/orchestration.ts`; what moves on it is read from the activity log (`agent_runs`): a "started" row lights a box, the ending row and its traced steps settle it. The browser asks `/api/mission/live` for a snapshot (every 2.5 s while agents work, every 15 s when idle, never while the tab is hidden), so it still talks only to Atlas. A run that finishes between two looks is replayed step by step. Display mode fills the screen and keeps it awake for an iPad or a second monitor. Run details and step notes are left out of the snapshot unless switched on for that device, so a screen others can see shows agent names, timings and results only.

**Model choice and cost** (`lib/ai/models.ts`, `lib/ai/model.ts`): one provider at a time, chosen by which key is set. With Gemini (free tier), `writer` = gemini-3.8-flash and `fast` = gemini-3.5-flash-lite (gemini-4-hydrogen was the writer until it answered "503 high demand" on the free tier; the connection check still tries it, marked not in use); the writer is asked first, and if it has not answered after its head start (45% of the wait, 3 to 10 s) or fails busy, rate-limited or missing, the same request goes to the fast model alongside it; the first good answer wins and the other request is cancelled. A writer that failed or lost the race rests for 30 minutes, so the next calls in the run go straight to the fast model. Requests are shaped JSON Schema first, then plain JSON, then without the thinking setting, and the shape each model accepts is remembered; the thinking level stays low unless a model rejects it. A busy or rate-limited answer gets one more try after the delay Google asks for, when time allows. Google's error code and message are kept (`HttpError.detail`), and traces say why in words (`whyNoAnswer`). Mission Control's AI card has a connection check: a tiny, timed request to each model. With Claude, `fast` = Claude Haiku 5.5 and `writer` = Claude Opus 5.5. Every call passes the daily budget gate (`ATLAS_AI_DAILY_LIMIT`, default 60) and returns token usage; the run logs model, tokens and an estimated cost per agent. Without a model, every agent uses its rules.

**Why the planner is not an LLM.** Placing tasks under a capacity limit is a small constraint problem. Rules give the same answer every time, are unit-tested, cost nothing, and can't be argued into overbooking you. Claude is used where language is the product: rewording, drafting, condensing.

**AI safety rails** (`lib/ai/claude.ts`): one client, server-only; untrusted content fenced in `<data>` with an instruction to treat it as data (the fence itself is stripped from the data first); structured outputs validated twice (SDK + zod); outputs are display-only; refusals and errors fall back to the rules path; a per-minute burst limit and a daily cap stored in the database; the kill switch stops all calls.

## Time-saved ledger

Each agent activity adds a conservative minutes-saved estimate (`MINUTES_SAVED`) to `time_ledger`. Today and Your team show the last 7 days. The numbers are estimates of manual work replaced, not measurements, and the UI says so.

## Adding a feature

- New data: add a type to `lib/domain/types.ts`, a collection to `Store`, the table + RLS policy to a new migration, and the seed to `lib/data/memory.ts`.
- New outbound host: add it to `ALLOWED_HOSTS` in `lib/security/safeFetch.ts` (reviewed in one place).
- New kind of record that Ask Atlas should know: a case in `toDocuments` (`lib/domain/knowledge.ts`), the source name in the migration's check, and an eval question.
- New AI use: a schema + prompt in `lib/ai/prompts.ts`, gated by `takeAiCall`, with an offline fallback.
