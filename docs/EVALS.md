# Evals and tracing

How Atlas answers "How do you know your agents are working?"

## Evals

Each agent has a suite of labeled cases in `lib/evals/suites/`: a real-looking input and
the answer a person would give. A suite runs the agent's own rules on every case and
scores the share it gets right. Rules only: no network, no model, a few milliseconds, $0.

| Agent | What is scored | Bar |
| --- | --- | --- |
| Chief of Staff | The right brief at the right time (Weekend Mode), Hot List order | 100% |
| Calendar | Interviews and appointments vs routine events; real conflicts, none invented from edited or repeating events | 95% |
| News | Whether two outlets' headlines are the same story | 80% |
| Email | The right pile (reply, glance, noise) and tag (job, subscription, finance, store) | 95% |
| Career | Posted title to one of the five roles or skip; senior titles left out; the place group (Utah remote or hybrid, remote, office within the commute) and what is too far; pay floor and target; demo-only pre-sales | 95% |
| Finance | A bill's kind, amount and date; real sales vs order mail | 95% |
| Scout | Records every posting that is one of your roles, with pay, place and skills, including ones you would not take; judges none | 100% |
| Analyst | Demand, trend, pay, coverage, best fit and gaps computed from fixed postings; wording with a number the report does not hold is thrown away | 100% |
| Mentor | The right thing first for the situation (39 scenarios), memory, midday follow-up, silence, and refusal of invented numbers or evidence | 95% |
| Career: job fit, and Ask filters | `test/askFilters.test.ts`: filters read from a question, resume text from Notion, skill overlap by rules | tests |
| Ask Atlas (Chief of Staff) | The right passage in the top 3 for a question; fusion of keyword and meaning rankings; citations and the prompt fence; privacy of what is indexed. Keyword search runs here; the embedding model does not, so its three questions are known gaps ([RAG.md](RAG.md)) | 90% |

Where they run:

- **Every pull request.** `npm test` includes them, and CI has an "Agent evals" step
  (`npm run evals`) that prints the table. A suite below its bar fails the build.
- **Every morning.** Before the scheduled morning brief the scores are logged to the
  activity log (task "Agent evals"). A suite below its bar is logged as failed, so it
  shows in Mission Control's Errors & alerts.
- **On the Evals page** (`/evals`), scored live against the deployed rules, with every
  miss and the daily history.

Rules for the suites:

- A failing case is either fixed or written down as a `knownGap` with the reason. The
  tests fail on an unexplained failure, and on a known gap that has started passing
  (remove the note).
- Bars only go up. Lowering one needs a reason in the pull request.
- Add a case whenever a real miss turns up (a wrong tag, a bad match, a false conflict).

The first run (13 Nov 2026) scored 210 of 225 and found ten real bugs, since fixed:
GitHub pull-request threads tagged as job replies, login codes filed under "needs a
reply", agentic titles matched as plain Software Engineer, "Interviewer" listings matched as
jobs, bill dates written "by 12/05" or "ends in 3 days" missed, coupons that mention
"your next order" dropped, and a name missed when it follows a headline's first word.

## Tracing

Every agent run records its steps on the activity-log row that ends the run
(`agent_runs.trace`, `agent_runs.duration_ms`): what each step did, how long it took,
and what it decided. The Chief of Staff's trace shows each specialist it asked, what
each reported, the assembly, whether Claude worded the brief, and the save.

- Code: `lib/agents/trace.ts` (`tracer()`); each runner passes it to its work function.
- Mission Control: open "Trace" under any run in Live activity.
- Notes hold counts and decisions only: never email text, addresses, tokens or URLs.
  Notes are clipped to 240 characters, a trace to 24 steps and 16 KB.
- If the trace cannot be stored, the run is still logged without it.
- Traces follow the activity log's retention (180 days) and its policies (owner-only,
  append-only).
