# Agent architecture

How Atlas's agents are built (owner's direction, 23 Nov 2026). An agent gets smarter through
systems architecture, not prompt tweaking. These five levers are rules for every agent; the
"In Atlas" lines say how each one is applied here, and what is still to build.

The goal they serve: get Tyler an engineering job paying $100K or more, as soon as possible,
by focusing on the best-fit roles, closing his gaps, and reading the market correctly.

---

## What makes it an agent (and what does not)

Atlas calls something an **agent** only when it does all four:

1. **Goal-directed iteration.** After each step it checks whether the state meets the goal. If
   something is missing, or a tool failed, it runs another cycle instead of stopping at a
   half-answer.
2. **Dynamic action selection.** It decides which tool to call, when, and how to read the
   result, based on what it just found.
3. **Feedback and recovery.** When a tool fails (a rate limit, a bad input, a missing record, an
   unexpected shape), it reads the failure, changes its input or its approach, and tries a valid
   alternative.
4. **Scoped autonomy.** Its room to act is bounded: least-privilege tools, a step cap and a call
   budget, checks in code, and Tyler's approval before anything leaves the app.

Not agents, and labeled honestly as **workflows** or **assistants**:

- **Prompt + retrieval + one tool call.** Useful and fast, but it does not loop, observe or
  correct itself.
- **A fixed pipeline.** Every step hardcoded in order, with no branching or recovery.

**In Atlas** each part is labeled by what it is. The Pitch agent (tailoring one application), Company Research (researching one company),
Interview Prep (preparing for one interview), the Weekly Strategist (three moves for the week, approved by you) and Follow-up (one specific follow-up you send yourself) are agents, built on the shared loop in
`lib/agents/runtime/`. The Scout, Analyst, Career Mentor and
QA are workflows with judged steps, until one of them needs to loop; then it moves onto the
runtime and earns the name. Mission Control and the Team page show each one's kind, and what qualifies it (`KINDS` in `lib/domain/registry.ts`).

---

## 1. Narrow the scope, and modularize

One agent asked to research, plan, execute and verify loses the thread as its context fills.

- **Decompose the work.** Each job is deterministic steps plus, where judgment is needed,
  specialized roles: a **router** that classifies, a **worker** with a few domain tools, and a
  **reviewer** that checks the output against written rules.
- **Workflows over open-ended loops.** Anything with predictable logic is plain code. The model
  is used only for ambiguity and decisions.

**In Atlas**
- An agent is a module with one role, its own prompt and model tier, and least-privilege tools
  (`lib/agents/<agent>.ts`); pure logic stays in `lib/domain/`.
- Rules first: the Scout filters and ranks postings in code; the model reads only the top 10.
- The model makes the call only where code cannot: which requirement a bullet proves, which of
  two close fits to apply to first, how to word an insight.
- Only the Pitch agent runs a tool-using loop (tailoring is genuinely open-ended). Scout,
  Analyst and Career Mentor are workflows with one judged step each.

## 2. Engineer high-signal context

Context is working memory; noise degrades reasoning.

- **Curated retrieval.** Hybrid search (keyword + meaning), metadata filters, reranking: the
  agent sees only the chunks it needs.
- **Structured state.** An explicit state object (a JSON scratchpad or checklist: what was
  tried, what failed, what remains) instead of a long transcript to re-read.
- **Progressive disclosure.** Short tool summaries first; the detailed schema or reference only
  when a task needs it.

**In Atlas**
- Retrieval is already hybrid: keyword and embeddings, fused by rank (`fuse` in
  `lib/domain/retrieval.ts`), with filters by source. To add: a rerank step that keeps the best
  few passages per requirement.
- Each agent run carries a typed state object (`AgentState`: goal, facts gathered, steps taken,
  open checks, remaining budget) that is passed to the model in place of history, and saved
  with the run's trace.
- The model sees each tool as one line (name, when to use it); a tool's full input schema is
  sent only once it picks that tool.

## 3. Design tools for the model, not for humans

An agent is only as capable as its tools.

- **Clear schemas.** Tool descriptions and parameter names are part of the prompt: say when to
  use the tool, its edge cases, and the format it expects.
- **Actionable errors.** Never a raw stack trace or a bare 400: say why it failed and how to fix
  the input next time.
- **Consolidate granular calls.** If three calls always go together, make them one tool
  (`companySnapshot` instead of `getOpenings` + `getNews` + `getContacts`).

**In Atlas**
- Every tool is a typed function with a zod input and output schema, a one-line "use when", and
  limits (`lib/agents/tools/`). The same tools later back the MCP server.
- A tool never throws at the model: it returns `{ ok: false, fix }`, where `fix` says what to
  change ("company not on a watched board: call companySnapshot with the board slug instead").
- Tools are snapshots, not getters: `jobSnapshot`, `companySnapshot`, `evidenceFor`.

## 4. Verify, and correct

Smart agents check their own work before finishing.

- **Deterministic guardrails.** Validate with code wherever possible: schemas, linters, dry runs.
- **Evaluator-optimizer.** A separate critic, with its own prompt, finds flaws and verifies
  claims against sources before the user sees the output.
- **Human in the loop.** Anything irreversible or outward-facing waits for an explicit approval,
  with a plain summary of what will happen.

**In Atlas**
- Every model output is parsed with zod; a failed parse falls back to the rules' version.
- Truth is enforced in code: a resume bullet, step or insight whose numbers or claims are not in
  your own material is dropped (`checkSteps`, `traceClaims`). A tailored resume cannot be saved
  while `traceClaims` flags anything.
- Writer and judge are separate calls; the judge has a written checklist and its score is stored
  in the trace. Below the bar, the writer gets one revision with the judge's notes.
- The Career Mentor's advice is graded by rules (`gradeInsight`: one step, evidenced, doable
  today, not a repeat of what Tyler did); advice below the bar gets one rewrite with the notes,
  in two slots a day (draft -> critique -> refine).
- Memory (`agent_memory`): funnel findings and Action Taken notes become lessons, kept 21 days
  and renewed while later results say the same thing (`lib/domain/gapPlan.ts`). The Mentor and
  Pitch read them.
- Agents only draft inside Atlas. Nothing is sent, submitted or deleted outside the app; Tyler
  approves and acts.

## 5. Measure against real failures

You cannot improve an agent on vibes.

- **Golden dataset.** 30–50 real inputs per agent, edge cases and past failures included, each
  with what a good run looks like.
- **Trace the trajectory.** Log every tool call, intermediate decision and latency: a right
  answer reached in five unnecessary turns is still a bug.

**In Atlas**
- Each agent has an eval suite in `lib/evals/suites/`, run in CI; a change that lowers a score
  fails the build. Real failures become cases (as the QA review's findings did).
- Every run is traced step by step (`lib/agents/trace.ts`): tool, input summary, result, time,
  model and tokens. Trajectory checks count steps and repeated calls, and flag a run that takes
  more than its budget.
- Outcomes are the final eval: every application records what it was sent with (Step 0,
  `lib/domain/outcomes.ts`), and the funnel shows what actually gets replies.

---

## Limits every agent runs within

- Free tier only: about 60 AI calls a day (`ATLAS_AI_DAILY_LIMIT`) and 10 a minute. A run has a
  step cap and a call budget, and stops cleanly when either is reached.
- A scheduled run has 300 seconds; the watchdog logs where it was if time runs out.
- Each agent has a pause switch in Mission Control. One kill switch (AI off in Settings) stops
  every model call.
- Scraped text is untrusted: it is data for extraction, never instructions.
