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
| [QA](qa/instructions.md) | 10 | Live (reviews the team weekly) |
| [Apply](apply/instructions.md) | 11 | Live (answers forms for Atlas Autofill; never submits) |

## The search: what every Career desk agent works toward

Set by Tyler on 18 Nov 2026. It lives in one file, `lib/domain/searchProfile.ts` (place rules
in `lib/domain/workplace.ts`), and every agent reads it from there, so no two agents can
work from different versions of it.

| | The rule |
| --- | --- |
| **Goal** | A full-time engineering role, soon, as close to the pay target as he can get. |
| **Roles** | Solutions Engineer and Software Engineer first, then the rest of the Resumes database in Notion, in its Priority order. |
| **Level** | Junior to mid level, or an associate role. **Not senior.** Senior, staff, principal, lead and manager titles are never shown as matches. |
| **Pay** | Aim at **$120k** base. Show anything from **$100k** up, to negotiate toward it. Posted pay that tops out under the floor is left out; no posted pay is kept and says so. Both figures are in Settings. |
| **Place** | Fully remote first, then hybrid, then on-site. Home is **Salt Lake City, UT**; hybrid and on-site work must be within a **45-minute drive**. |
| **Order in a brief** | 1. Utah companies that are remote or hybrid. 2. Remote, anywhere in the U.S. 3. Offices within the commute. |
| **Team** | A collaborative engineering team, internal or customer-facing. Not a siloed role. |

Who does what with it:

- **Applications bot** filters and ranks by it, and stores each match's place.
- **Chief of Staff** shows job matches in the three groups, in that order.
- **Scout** records the whole market, senior and out-of-reach postings included, and marks which postings he could work.
- **Analyst** measures demand and pay against it.
- **Mentor** is given it as the goal, word for word, whenever it asks the model to judge.

Operating rules for every agent:

1. Report in the Standard Agent Report Format: headline, details, needs approval, errors.
2. Talk only through the Chief of Staff.
3. Shared data lives in Supabase; each agent keeps its own context.
4. Log every run (started, succeeded, failed, skipped) to the activity log.
5. Nothing irreversible without approval: unsubscribing, sending, calendar adds and
   submissions all wait for Tyler's approval in Atlas. No agent submits anything outside
   Atlas: Tyler applies to every job himself, with Atlas Autofill filling the form.
