# Agent instructions

Each agent's instructions live here as a file, versioned in Git, as the Atlas plan
requires. The code loads them at run time (`lib/agents/instructions.ts`); changing an
agent's behavior is a reviewed pull request, not a hidden prompt edit.

| Agent | Build step | Status |
| --- | --- | --- |
| [Chief of Staff](chief-of-staff/instructions.md) | 1 | Live |
| [Calendar](calendar/instructions.md) | 2 | Live |
| [News](news/instructions.md) | 3 | Live |
| [Email](email/instructions.md) | 4 | Live |
| [Applications](career/instructions.md) | 5 | Live (Career desk; its id stays `career`) |
| [Finance](finance/instructions.md) | 6 | Live |
| [Scout](scout/instructions.md) | 7 | Live (Career desk) |
| [Analyst](analyst/instructions.md) | 8 | Live (Career desk) |
| [Mentor](mentor/instructions.md) | 9 | Live (Career desk) |

Operating rules for every agent:

1. Report in the Standard Agent Report Format: headline, details, needs approval, errors.
2. Talk only through the Chief of Staff.
3. Shared data lives in Supabase; each agent keeps its own context.
4. Log every run (started, succeeded, failed, skipped) to the activity log.
5. Nothing irreversible without approval: unsubscribing, sending, calendar adds and
   submissions all go through the Approval Queue.
