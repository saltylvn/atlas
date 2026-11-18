# The Career desk

Four agents share the job hunt. Each has one job, one output, and its own evals. The
Chief of Staff is still the only orchestrator: the desk's agents never call each other,
they hand work on through tables in Supabase.

```
                        Chief of Staff
                              ▲  (every agent reports here)
   ┌──────────┬─────────┬─────┴───┬──────────────── Career desk ─────────────────┐
Calendar    News    Finance    Email      Applications   Scout ──▶ Analyst ──▶ Mentor
                                              ▲            postings    report
                                    job emails from Email
```

| Agent | One job | Runs on | When | Writes |
| --- | --- | --- | --- | --- |
| **Scout** | Record the market: every posting that is one of your roles, with pay, place and skills. No opinions. | Rules, $0 | Every 2-hour sync | `market_postings` |
| **Analyst** | Demand and pay per role, the skills asked for most, where you fit best, your gaps. | Rules for every number; the model may word it | Once a day, with the morning brief | `market_reports` |
| **Applications** (id `career`) | The day's picks in two tracks, resume match, apply kits, tracking, follow-ups. | Rules; the model for the fit check | With each brief | `job_matches`, `applications`, `approvals` |
| **Mentor** | Review the whole hunt and say the one or two things that matter most. Advises only. | Rules for facts; the model for judgment | Morning brief, 2 PM brief, about 6 PM | `mentor_insights` |

Rules that keep it reliable:

- **One writer per table.** No two agents can overwrite each other.
- **Stale beats missing.** A failed Scout leaves yesterday's rows; the Mentor ignores a
  market report older than three days and says nothing about the market.
- **Every agent logs its own run and trace**, so the live map shows the desk working. The map draws the desk as a 2 by 2 grid in work order (Scout, Analyst, then Mentor, with Applications beside them), the AI model's dashed lines to the three that use it, and the 6 PM evening run that starts the resume sync and the Mentor's review.
- **Only the Applications Agent puts something in front of you to act on**, and nothing
  is submitted without your click.

## Applications: two tracks

Full-time is the goal; gigs build the portfolio. One agent runs both, so one place
balances your time. Each track has a small daily plan (3 full-time, 1 gig by default):

- **Apply today** (Jobs page): the best new matches per track, at most what is left of the
  plan, one per company, never one you passed on. A 👍 sends a job to the Approval
  Queue as an apply kit: the listing, the matched resume, your answers tailored to the
  job, and **How do I fit?**.
- **Save a job**: LinkedIn, Indeed, Glassdoor and Upwork have no public feed and forbid
  scraping, so those jobs come in by paste. You give the link and the description; Atlas
  reads the skills and pay from the text, builds the kit, and never opens the link.
- **You submit.** There is no auto-apply: most forms forbid it, and a wrong application
  cannot be recalled.

## The Mentor

It runs three times a day with a different job each time: the morning sets the day's
priority, midday checks progress on it, the evening reviews.

How it stays worth listening to:

1. **Facts come from rules.** `observe()` in `lib/domain/mentor.ts` turns your data into
   observations: days since you last applied, reply rate overall and by role, kits waiting
   in the queue, a skill you have that no resume mentions, your best market fit against
   your first-priority role, whether your LinkedIn opening says that role, the share of
   gigs. Each is a count, a rate or a date. A model never produces a number.
2. **Judgment comes from the model.** Given the observations, it picks at most two that
   matter most now and writes one action each that can be finished today. It must cite
   the observations it rests on.
3. **It is checked.** An insight is dropped if it cites an observation it was not shown,
   or contains a number that is not in the ones it cites. Two insights are never about
   the same subject.
4. **It remembers.** Dismissed stays away for two weeks. Said-and-unchanged is not
   repeated. After the morning, the next runs follow up: handled, moved, or not moved.
5. **It may say nothing.** Below a threshold there is no insight. If the model chooses
   silence, that is respected unless something serious is on the table.
6. **It advises only.** It writes insights and nothing else.

With AI off, the rules' own top observations are shown, in the rules' words.

What the model is sent: the observations (facts about your pipeline, including company
names), the titles of its last few insights, and in the evening only, your LinkedIn text
with addresses, links and phone numbers removed. About three requests a day.

You see insights on the Growth page (with the facts each rests on, and Done / Not useful),
in the morning and 2 PM briefs, and as a push after the evening review.

## Target roles: what you can show, and the Mentor's proposal

Your target roles and their order are yours, and live in Notion. Three agents keep an eye on whether that order still makes sense, each doing one job:

| Agent | What it does | Model? |
|---|---|---|
| **Scout** | Records postings for your roles **and for seven candidate roles next to them** (Implementation Engineer, Developer Advocate, AI Consultant and so on), and once a day reads your GitHub projects: stack and skills. | No |
| **Analyst** | Computes a **role outlook**: for every role, how much of what its postings ask for you can *show* (in a GitHub project or a resume), plus demand, trend, pay and how your own applications to it went. | No (the outlook is arithmetic) |
| **Mentor** | Each morning, decides whether your order should change, names the three roles to target now, and may suggest one candidate role to add. | Yes: Gemini judges the order |

**Shown, not claimed.** A skill counts toward a role only when a project or a resume backs it. Ticking a skill on Growth does not.

**Facts from rules, judgment from the model.** The rules draft a proposal and decide whether one is worth raising. Gemini is then asked to judge the order, inside bounds that code checks:
- it may not drop a role, and may add at most one of the candidate roles it was offered;
- every role it moves or adds needs a reason;
- any number it writes must be in the facts it was given.

An answer outside those bounds is dropped and the rules' proposal stands. If Gemini judges that nothing should change, nothing is proposed, and the question is not asked again for a week.

**Stability.** A role moves only when it leads the one above it by a clear margin and has at least five postings behind its numbers. After you approve an order the Mentor leaves it alone for a week; an order you dismiss is not raised again for three.

**Your approval is the only thing that changes your roles.** The proposal sits on Target roles with its reasons and the facts behind them. Approve shows exactly what will be written, then sets the Priority numbers in your Notion Resumes database (see [INTEGRATIONS.md](INTEGRATIONS.md)); Target roles follows from there.

**Where the market data comes from.** Public feeds whose terms allow reading them: Remote OK, We Work Remotely, Jobicy, the Hacker News hiring threads, and your company watchlist on Greenhouse, Lever and Ashby. **LinkedIn, Indeed and Glassdoor are not read.** They publish no feed and forbid automated reading, so a job you find there enters Atlas through "Save a job" or its confirmation email.

## What you provide

- **Skills** ticked on Growth. Until some are marked, the Analyst reports demand and pay
  and says plainly that fit and gaps cannot be measured.
- **Resume text** in each Resumes row's page in Notion (see [RAG.md](RAG.md)). With the
  resume sync set up, the Applications Agent mirrors it from Figma each evening, so you
  only edit the design (see [INTEGRATIONS.md](INTEGRATIONS.md), "Figma and the resume sync").
- **LinkedIn text** pasted on Growth. Nothing is read from LinkedIn.
- **Answers** in the answer bank (Applications), so every apply kit is ready to paste. The
  questions are split into every application, full-time jobs and gigs; a gig's kit never
  shows the salary question and a job's never shows the hourly rate. **Draft from my
  resume** fills the empty boxes from your Master Resume in Notion, by rules and in its own
  words; nothing is saved until you press Save. Work authorization, salary, rate and "why
  are you looking" are never drafted, and demographic or EEO questions are not in the bank
  at all. In the Approval Queue each job's kit also offers the summary of the resume that
  matches its role, beside your own intro, and **Draft with AI** writes "what I'd bring"
  for that job from your resume passages: one budgeted call, citations checked, every
  number checked against the resume, shown to copy and never stored.

## Not built yet

- **Resume amendments proposed by the Mentor** (asked for on 2026-11-14). The Mentor reads
  each resume's text as mirrored from Figma, next to the market report and your results,
  and proposes specific amendments: a bullet to reword, a skill the market asks for that a
  resume leaves out, a number that has gone stale. Gemini is the judge, under the Mentor's
  existing rules: every proposal cites the facts it rests on, a number it quotes must be
  in its evidence, and it may stay silent. Each proposal goes to the Approval Queue as a
  before and after; **nothing changes in Figma unless you approve it.** One constraint
  shapes the design: Figma's REST API cannot edit a file, so Atlas cannot apply an approved
  change itself. An approved amendment is applied in Figma by you, or by a Claude session
  through the Figma connector working from the approved list, and the evening resume sync
  then carries it into Notion and Ask Atlas.
- Appending the Scout's and Analyst's findings to a Notion database Atlas owns.
- The Applications Agent still reads the job feeds itself for brief matches; moving it
  onto the Scout's table is the next step.
- Settings controls for the daily plan (the defaults are 3 and 1).
