# Design: the Pipeline (application tracking, "heard back" alerts, AI copilot)

Status: **approved by Tyler on 20 Nov 2026** (all eight items in section 12). Phases 0 to 2
are merged, and the first of Phase 3's two PRs (the reader, in shadow) is built; what changed
while building is in the decision log (section 13). The system-design skill
names `docs/design.md` as the output, but that file is the Apply Agent's design, so this feature
has its own. Outside facts were checked that day; links are in "Sources".

## 1. Pillars

**Purpose.** Know where every application stands without opening Gmail, hear about it the moment
a company answers, and always know the next thing to do.

**People.** One user, Tyler. Recruiters are affected too: their names and words are in the emails
this feature reads.

**Quality attributes, ranked**

1. **Right application, right stage.** A wrong "interview" or "offer" is worse than a late one.
2. **Timely.** A real answer reaches his phone within 15 minutes, any day.
3. **Private.** No email body is stored. What leaves Atlas is decided once, by him (5.5).
4. **$0.** Inside the free plans of Vercel, Supabase and Gemini, with caps.
5. **Explainable.** Every stage change points at the email, event or click that caused it.

**Constraints.** Vercel Hobby cron runs each job once a day, within a ±59 minute window. Gmail is
read-only. AI output is display-only. Agents draft and never send. 60 AI calls a day, shared.

## 2. What exists, and where it falls short

| Today | The gap |
| --- | --- |
| `applications` holds one `status` and one `status_at` | No history. You cannot see what arrived, when, or why a card moved. |
| An email is matched to an application by company name only (`sameCompany`) | Two roles at one company become one card; a rejection for one closes both. |
| Six statuses; "Interview" is one bucket | A recruiter screen, a take-home and a final round look the same. |
| Rules read a job email for two verdicts: rejection or interview | Assessments, scheduling requests, offers, "send us X" and deadlines are missed. |
| A phone ping only for an interview invite, opening `/inbox` | Rejections, replies and offers are silent until the next brief. |
| Sync runs Mon to Sat, about 6 AM to 4 PM | An evening or Sunday email waits until the next working morning. |
| Two boards (Applications, Tracker), both column grids | Neither works at 375px, and neither has a page per application. |

## 3. Requirements

**In v1**

- A timeline per application: every email, interview, follow-up and status change, with its source.
- Finer stages: Applied, In review, Screen, Assessment, Interview, Offer, Rejected, Withdrawn.
- Emails matched to the right application when there are several at one company; a question to
  Tyler when it cannot be told.
- A push for every real answer, opening that application. Confirmations stay quiet.
- An in-app "Heard back" feed with an unread count.
- A list-first Pipeline page that works on a phone, with a **Needs you** lane on top.
- AI, in three places: reading the emails rules cannot decide, wording the next step and its
  draft, and an interview brief.

**Out of v1**

- Sending or replying to email. Drafts go to the Approval Queue to copy, as follow-ups do today.
- Storing email bodies, attachments or scheduling links.
- Gmail push through Google Pub/Sub (5.8).
- Recruiter contacts as People records. The timeline shows the sender's name; that is enough for now.

## 4. Data flow

```
Gmail ──headers──▶ Email Agent tags job mail ──▶ Reader ──▶ Matcher ──▶ event appended
(every 15 min)                                   │           │            │ (idempotent)
                                rules decide ────┤           │            ▼
                                rules unsure ──▶ model       │      Reducer: stage, last heard,
                                (scrubbed, capped,           │      next step (pure function)
                                 schema + quote check)       │            │
                                                             ▼            ▼
                                         cannot tell which role ──▶  Needs you  ◀── AI reading
                                                                     (one tap)      waits here
                                                                          │
                              notification outbox ──▶ web push ──▶ /applications/[id]
```

## 5. Day-one decisions

### 5.1 Source of truth: an event log, with the status as a projection

- **Recommended: a new append-only table `application_events`; `applications.status`, `stage`,
  `last_heard_at` and the next step are computed from the events by one pure reducer.** The
  timeline comes for free, a replay never duplicates, and when the reading rules improve the
  stages can be recomputed. A misread is fixed by appending a correction, not editing history.
  *Pattern: event sourcing (lite), a log plus a materialized projection.*
- Alternative: keep one status and add a `status_history` JSON column. Less code, but no
  per-event dedupe, unread or notified state, and awkward to query.
- Alternative: pure event sourcing with no status column. Every reader of `applications` (the
  Tracker, the scorecard, the Mentor, the CSV) would have to change at once.

### 5.2 Stages: add a fine `stage`, keep the coarse `status`

- **Recommended: a new `stage` column; the existing six-value `status` stays and is derived from
  it** (Screen, Assessment and Interview all read as `interview`; In review reads as `replied`;
  Withdrawn reads as `rejected`). Nothing that reads `status` today changes.
  *Pattern: expand and contract (parallel change).*
- Alternative: widen `status` itself. One column, but a check constraint and about ten callers
  change in one PR.

"Gone quiet" is not a stage. It is computed from `last_heard_at`, as the Tracker's "Dead end" is now.

### 5.3 Matching an email to an application

- **Recommended: a ladder, strongest signal first, that stops guessing when it runs out.**
  1. The Gmail thread already has an event: same application.
  2. The email names a role, and one open application at that company has it.
  3. The company has exactly one open application.
  4. Several open, no role named: ask in Needs you ("Which Acme application is this?").
  5. No application at that company: log a new one, as today.
  *Pattern: entity resolution with a confidence ladder, human in the loop on a tie.*
- Alternative: let the model pick. It would guess on ties, which is where a guess does harm.

### 5.4 Who reads the email

- **Recommended: a cascade. Rules first; the model only for what rules leave undecided.**
  `readVerdict` grows four kinds (assessment, scheduling request, offer, request for information).
  An email from a company with an open application that rules still read as "none" goes to the
  fast model once. Expected: a handful of calls a day. *Pattern: cascade; rules first, AI for judgment.*
- Alternative: the model reads every job email. One code path and better recall, but three to
  five times the calls, every job email leaves Atlas, and tracking stops when Gemini is busy.
- Alternative: rules only (today). Private and free; unusual wording is missed and nothing reads
  a deadline or an ask.

The model returns a fixed shape, validated with zod: kind, stage, role, what they ask for,
deadline, people named, and **the sentence it rests on**. Code then checks that the sentence is
in the email word for word, that any date is in the email and within 90 days, and that the stage
is a legal move from the current one. A reading that fails a check is dropped and rules stand.

### 5.5 Privacy: may a job email's text go to Gemini's free plan? (changes a standing rule)

`lib/domain/jobMailText.ts` says the text never leaves Atlas. Google's terms for unpaid Gemini
use say submitted content is used to improve its products and may be read by human reviewers.

- **Recommended: yes, narrowly, behind its own switch that starts off.** Only the emails rules
  could not decide; only the email's own words (no quoted thread); addresses, phone numbers and
  links removed by the existing `scrub`; at most 4,000 characters. Company and recruiter names
  stay in, since the reading needs them. Nothing is sent until Tyler turns it on.
- Alternative: rules read; the model only ever sees Atlas's own facts (events, stages, dates) to
  word next steps. Nothing new leaves Atlas. The reader is as good as its rules.
- Alternative: a paid plan, where content is not used for training. Not at $0.

This is needed only from Phase 3. Phases 0 to 2 send nothing new anywhere.

### 5.6 Can the model move a stage?

- **Recommended: no. Rules-decided events apply at once, as now. A model reading is a
  suggestion in Needs you, with its sentence: Confirm or Wrong.** The existing rule (AI output
  is display-only) holds. A recruiter email is untrusted text; if one tricks the model, the
  worst result is a wrong suggestion that Tyler rejects. Each Confirm or Wrong is also a labeled
  example for the eval set. *Pattern: human in the loop; limit the blast radius.*
- Alternative: apply automatically when the checks pass, with Undo. Fewer taps, but it breaks
  the rule, and a false "offer" ping is the most expensive mistake this feature can make.

The **ping does not wait for the model**: "Acme wrote back" is a fact rules know. The model's
reading is added to it, labeled as Atlas's reading.

### 5.7 Notification policy

| Push now | Quiet (timeline and unread count only) |
| --- | --- |
| Interview or screen invite, assessment, offer, scheduling request, a person's reply, rejection | "We received your application", automated "still reviewing", surveys |

- Several in one check become one push ("3 updates: Acme interview, Beta rejected, …").
- The lock screen shows company, kind and role. Never an email's words.
- Quiet hours 9 PM to 7 AM: held, then sent at 7.
- A setting, **Hold rejections for the next brief**, off by default.
- **Recommended delivery: a `notifications` outbox table.** The event and its notification row
  are written together; a sender marks `sent_at`; a unique key per event means a retry never
  pings twice. The same rows are the in-app feed. *Pattern: transactional outbox, idempotency key.*
- Alternative: call `sendToAll` inline as the sync does now. Simpler, but a retry can double-send
  and there is no feed or unread state.

### 5.8 How fast

- **Recommended: a small watch endpoint (`/api/cron/watch`: inbox headers, job mail, events,
  push; no brief, no feeds, target under 10 seconds) called every 15 minutes, 7 AM to 9 PM,
  every day, by Supabase Cron (`pg_cron` + `pg_net`).** Supabase is already the database, so
  this adds no vendor. It gets its own bearer secret that can run the watch and nothing else,
  because `pg_net` keeps request headers in a queue table database roles can read.
  *Pattern: short-interval polling; least privilege per caller.*
- Alternative: stay on Vercel cron. No new moving part, but Hobby allows each job once a day
  inside a ±59 minute window, so an answer is one to two hours old, and evenings need more entries.
- Alternative: Gmail push (`users.watch` to Google Pub/Sub). Seconds, not minutes, but it needs
  a Google Cloud project with Pub/Sub (likely a billing account, not verified), the OAuth
  connection instead of the app password the reader uses now, and a renewal every 7 days.
- Alternative: Inngest cron (the default stack). A new service for one timer.

### 5.9 Which agent owns it

- **Recommended: the Applications Agent (id `career`), as its tracking task, in new modules:
  `lib/domain/pipeline.ts` (reducer, matcher, notification policy, next-step rules; pure) and
  `lib/agents/pipeline.ts` (I/O).** It is already the one writer of `applications`, so "one
  writer per table" holds for the new tables. Its own eval suite and trace steps.
  *Pattern: a seam in a modular monolith; extract when it hurts.*
- Alternative: a new Tracker agent with its own pause switch. Cleaner (the Applications Agent
  already does five jobs), at the cost of the roster, the live map and its tests. Worth doing if
  the watch later needs to be paused apart from matching and kits.

### 5.10 The data model

| Table | Holds | Writer |
| --- | --- | --- |
| `application_events` (new, append-only) | `application_id`, `kind`, `occurred_at`, `source` (email, calendar, you, apply-agent), `source_ref`, `thread_id`, `by` (rules, model, you), `summary` (a kind label plus one scrubbed sentence, 200 chars), `deadline`, `ask`, `confirmed_at`. Unique on `(owner_id, source_ref, kind)`. | Applications Agent; Tyler's own clicks |
| `notifications` (new) | `event_id` (unique), `title`, `body`, `url`, `tier`, `sent_at`, `seen_at` | Applications Agent |
| `applications` (new columns) | `stage`, `last_heard_at`, `next_step`, `next_step_due` | The reducer |

Both new tables get RLS (`owner_id = auth.uid()` and `is_owner_aal2()`), a Store collection and
demo rows. Existing applications are backfilled with one event each from `status` and
`status_at`, plus the inbox readings already stored; tried on a Supabase preview branch first.

## 6. The AI layer

| # | Feature | Rules do | The model does | Guard |
| --- | --- | --- | --- | --- |
| 1 | **Reader** | Decide most emails; match to an application | Read the undecided ones | Schema, word-for-word quote, legal stage move; suggestion only |
| 2 | **Next step** | Pick it from the stage and dates (reply with times, assessment due Friday, prepare, send a thank-you, follow up) | Word the draft | Draft goes to the Approval Queue; facts in it checked as follow-ups are now |
| 3 | **Interview brief** | Gather who, when, format, the posting's facts, your matching resume passages | Likely questions, three to ask, a short company note; draft, critique, refine | Every claim cites a passage; numbers must be in the source; company page fenced as untrusted |
| 4 | **Ask the pipeline** | Counts and dates ("who has been quiet two weeks?") | Words the answer over indexed events | Existing Ask Atlas citations |
| 5 | **Funnel for the Mentor** | Conversion per stage by role, source and method; days to first answer | Picks what matters, as now | Mentor's existing number check |

- Model: the existing router (`lib/ai/model.ts`), fast tier for the reader, writer tier for the
  brief. Every call through `takeAiCall`. With AI off, rules do all of it, with plainer wording.
- **Evals before trust.** A `pipeline` suite: about 60 synthetic job emails (no real ones in the
  repo) scored for kind, matching and, above all, **zero false interview or offer**. It reports
  rules alone against rules plus model, so the model has to earn its place.
- **Shadow mode first.** For a week the reader's suggestions are logged, not shown, and compared
  with what Tyler did by hand. Suggestions turn on only if they would have been right.

## 7. Interface

**Pipeline** (`/applications`, phone first). The six-column grid becomes a list; the grid stays
as a wide-screen view. The answer bank and Autofill move to Setup, where they belong.

```
┌ Pipeline ─────────────── 🔔 3 ┐   ┌ Acme · Solutions Engineer ────────┐
│ 24 sent · 29% answered        │   │ Applied ● Screen ● Interview ○ Offer│
│ NEEDS YOU (2)                 │   │ NEXT STEP                          │
│ ● Acme · reply with times     │   │ Reply with times by Thu            │
│   Interview invite · 12 min   │   │ [See draft]  [Open in Gmail]       │
│ ● Beta · which role is this?  │   │ TIMELINE                           │
│ [All] [Active] [Quiet] [Closed]│  │ Today 2:14  Interview invite       │
│ Acme        Interview  · 12m ●│   │   "We'd like to schedule a call…"  │
│ Corvid      Assessment · due Fri│ │ Nov 14  You followed up            │
│ Delta       Applied · quiet 9d │   │ Nov 6   Application received       │
│ Beta (2)    Screen · 2d        │   │ Nov 6   Applied by Atlas           │
│ [By stage] [By company]       │   │ INTERVIEW BRIEF   PEOPLE   NOTES   │
└───────────────────────────────┘   └────────────────────────────────────┘
```

- **Needs you**: the only place that asks for something. Each card has one action.
- **Row**: company, role, stage badge, last heard, an unread dot. Tap for the application's page.
- **By company**: one row per company with all its roles; fixes the two-roles case visibly.
- **Application page** (`/applications/[id]`, new): stage stepper, next step, timeline, brief.
- **Heard back** feed: every answer across companies, newest first; the 🔔 opens it.
- **Tracker** (the iPad board) keeps its layout and reads the same projection.
- **Push**: `Acme · Interview invite` / `Solutions Engineer. Open to reply.` It opens the page.
- **Funnel** card: Applied, Answered, Screen, Interview, Offer, with rates, by role.

## 8. Caps and controls

- Reader: at most 12 model calls a day; brief and drafts: 8; all inside the shared 60.
- Each email is read once. A failed model call falls back to rules and is not retried that run.
- Watch run: 10 second budget, no model call inline; undecided emails wait for the next full sync.
- Company page for a brief: one Firecrawl page per interview, inside the 1,000 a month.
- The kill switch and the Applications Agent's pause stop the watch, the reader and the pushes.

## 9. Is it working?

- Emails attached to the right application: 95% or better on the eval; ties are asked, not guessed.
- False interview or offer pushes: zero on the eval, zero reported.
- Email arrival to push: 15 minutes or less at the median.
- Manual stage changes a week (counted from the audit trail) fall; "Role not listed" falls.

## 10. Risks

| Risk | Likelihood | What the design does |
| --- | --- | --- |
| A wrong stage or a false good-news ping | Medium | Rules-only auto moves; model readings wait for a tap; quote and transition checks |
| An email attached to the wrong role | Medium | The ladder in 5.3; a tie is a question |
| Backfill makes duplicate or wrong events | Low | Unique key; run on a preview branch; the reducer must reproduce today's statuses exactly |
| Too many pings | Medium | Tiers, bundling, quiet hours, the rejections switch |
| Recruiters' words reach Google | Certain if 5.5 is on | Off by default, scrubbed, capped, undecided emails only |
| Gmail throttles a 15 minute IMAP login | Low | Headers only; back off to 30 minutes on an error; the hourly sync still runs |

## 11. Build order

| Phase | What ships | AI | PRs |
| --- | --- | --- | --- |
| 0. Foundation | Events table, reducer, matcher, backfill, the application page with its timeline | None | 2 |
| 1. Heard back | Outbox, push policy, feed and unread count, then the 15 minute watch | None | 2 |
| 2. Pipeline page | List-first page, Needs you, By company, answer bank to Setup | None | 1 to 2 |
| 3. Reader | New rule kinds, model reader, evals, a week of shadow mode, then suggestions | Yes | 2 |
| 4. Copilot | Next step, drafts to the Approval Queue, interview brief | Yes | 2 |
| 5. Insight | Funnel, Mentor observations, Ask the pipeline | Yes | 1 to 2 |

Phases 0 to 2 are useful with no model at all, and are what the AI phases stand on.

## 12. What Tyler is approving

1. The event log with a derived status (5.1) and the finer stages (5.2).
2. The matching ladder, with a question on a tie (5.3).
3. Job-email text to Gemini's free plan, scrubbed and behind a switch, from Phase 3 (5.5).
4. The model suggests; only rules and Tyler move a stage (5.6).
5. A push for every real answer including rejections, with quiet hours (5.7).
6. A 15 minute watch run by Supabase Cron, every day, 7 AM to 9 PM (5.8).
7. It stays in the Applications Agent (5.9).
8. One Pipeline page; the answer bank and Autofill move to Setup (7).

## 13. Decision log

**20 Nov 2026, Phase 0, first PR (the events table and the reducer).**

- **`stage` is nullable and checked on read.** `stageOf` trusts the stored stage only while it
  reads as the row's `status`; otherwise the status decides. So a writer that only knows
  statuses can never leave a stale stage behind, and no existing row had to be rewritten.
  *Pattern: tolerant reader.*
- **One rule engine.** The email tracker's forward-only check was replaced by a call to the
  reducer (`applyEvent`), not copied beside it. Its existing tests pass unchanged, and a new
  test checks every status against every kind of job email.
- **A confirmation is its own event, not a column.** 5.10 listed `confirmed_at` on an event.
  That would mean updating a row in an append-only table, so a model's suggestion will be
  confirmed by appending a `stage_set` event of yours instead. No `confirmed_at`.
- **Append-only by privilege, not by trigger.** A session may select and insert, never update
  or delete. The audit tables' trigger was not used: it would also refuse the cascade when an
  application is deleted.
- **Every job email is an event, whether or not it moves the stage**, keyed by its Gmail id,
  so re-reading the inbox adds nothing. The first sync after this ships puts the last 30 days
  of job emails on their timelines.
- **A move the forward-only rule would not make is logged as `stage_set`** (for example a kit
  marked submitted on an application already interviewing), so replaying a timeline always
  gives the stage the row was given.
- **The backfill was not tried on a preview branch.** 5.10 and the risk table said it would
  be. Supabase branching is on the Pro plan and above (supabase.com/pricing, read 20 Nov 2026),
  so at $0 there is none. Instead the backfill only inserts, skips rows already there, and
  rewrites no existing column; and a test replays its two rows to the status they came from.
- **Left for the PR that uses them:** `next_step` and `next_step_due` (Phase 4), `deadline`
  and `ask` on an event (Phase 3), `notifications` (Phase 1), and the matching ladder with the
  application page (the second Phase 0 PR). Until the ladder lands, an email is still matched
  by company name, as before.

**20 Nov 2026, Phase 0, second PR (the application page).**

- **Phase 0 is three PRs, not two.** The page ships by itself: it reads what the first PR
  writes and changes no behavior. The matching ladder follows in its own PR, because it
  changes which application an email lands on and needs somewhere to ask on a tie (a card on
  Applications until the Needs you lane exists in Phase 2).
- **The page shows what is known today:** the stage, four steps, last heard, the timeline and
  notes. Next step and the interview brief join it in Phase 4. No "Open in Gmail" link yet:
  the link format for a stored message id is not verified.
- **A closed application shows how far it got** (`furthest`), worked out from its timeline, so
  a rejection after a screen does not look the same as one after applying.
- **The migration landed by itself a few minutes after the first PR merged** and is recorded
  as `20261120120000 application_events`: the table has row level security on.

**20 Nov 2026, Phase 0, third PR (the matching ladder).**

- **The ladder is 5.3 with two additions**, both about a "we received your application",
  which is strong evidence that you applied:
  - one that names a role no application at that company has logs a new application (5.3
    would have put it on the company's one open application, which is the two-roles bug);
  - one that arrives after an application there was closed logs a new application (before,
    it landed on the rejected one and was lost).
  Any other email that names a role none of them has is a question, not a guess.
- **Titles are compared by their words**, level and punctuation aside, and one may be a fuller
  form of the other ("Solutions Engineer", "Solutions Engineer, Mid-Market"). The title word
  for word wins over a fuller form.
- **Each email is handled once.** The tracker skips an email that is already on a timeline, so
  the ladder never re-decides history when a second application appears later.
- **The question lives on Applications for now**, as a "Which application is this?" card,
  worked out when the page loads from the inbox, the board and the event index; nothing is
  stored for it. Your answer runs the same tracker for that one email, and later emails in
  the thread follow it. It moves into the Needs you lane in Phase 2.
- **The server works the choices out again** before it accepts an answer, so a choice the
  tracker did not offer is refused.

**21 Nov 2026, Phase 1, first PR (the outbox and the alerts).**

- **A confirmation gets no notice.** 5.7 lists it under "timeline and unread count", and 7
  calls the feed "every answer". The reducer already says a "we received your application"
  is not hearing back, so Heard back and its count are the eight kinds of answer only. A
  badge that rises when you apply would mean nothing.
- **Three tiers, not two.** `push` pings; `brief` is a rejection while "Hold rejections for
  the next brief" is on (no ping, unread in the feed, one line in the next brief, which marks
  it sent); `quiet` is in the feed only and arrives already read.
- **"New and recent" is two checks.** A notice is written only for an event added in that
  run, so an answer that was on a timeline before the outbox shipped never gets one. And an
  email more than 48 hours old when Atlas first sees it is `quiet`. 48 hours, not 24, so an
  answer from Saturday evening still pings at Monday's first sync until the watch runs daily.
- **At most once.** The sender marks `sent_at` in one conditional update and pushes only the
  rows that update returned, so two runs cannot both send one. A push the push service drops
  is not sent again; it stays unread in the feed. The other order (push, then mark) pings
  twice after a crash. *Pattern: claim, then act; at-most-once delivery.*
- **Written right after the event, not in one transaction.** 5.7 says "written together".
  The Supabase client has no transaction across two tables short of a database function, so
  the notice is the next statement. If it fails, the timeline is still saved and the run's
  trace says Heard back could not be written. Considered and left out: a sweep for recent
  events with no notice. It would repair that case, and would also ping again for an invite
  the old code had already pinged about on the day this ships.
- **Three columns beyond 5.10:** `kind`, `occurred_at` and `application_id`, copied from the
  event. Events never change, so the copies cannot drift; they give the feed its order and
  dot, a bundle its order, and Phase 2 its unread dot per application without a join.
- **No page of its own.** The feed is a card at the top of Applications (`#heard-back`),
  with the count in its title and in the page header. A push about several answers opens it;
  a push about one opens that application. Phase 2 rebuilds the page around it.
- **Read on open.** Opening an application marks its answers read, from the browser (a link
  that only prefetches the page marks nothing); "Mark all read" does the rest. An email you
  place yourself is listed already read, with no ping.
- **The old interview ping is folded in, not removed.** `urgentSince` now skips an invite
  that is on a timeline (the outbox sends it) and still pings for one the tracker could not
  place: a tie, or no company it can read. Removing it would make exactly those invites
  silent. Its lock-screen text no longer carries the email's subject.
- **A manual sync pings nothing.** Only a scheduled run sends, as before; what is due goes
  out with the next one. The kill switch and the Applications Agent's pause both stop it.
- **The migration was read, not run** (no preview branch at $0, as in Phase 0). It creates
  one table, changes no existing row, and can be run again.

**21 Nov 2026, Phase 1, second PR (the 15-minute watch).**

- **Supabase Cron is confirmed for the Free project.** `pg_cron` 1.6.4 and Vault are already
  installed on it; `pg_net` 0.20.4 is available and not enabled yet (the extension list was
  read through Supabase's management API; no SQL was run). Supabase's docs give no plan limit
  or price for the three. The steps and the SQL are in `docs/WATCH.md`; Tyler runs them.
- **The watch reads job-mail text too, by rules.** 5.8 says "inbox headers, job mail". Each
  email is placed on a timeline once, so one placed by its subject alone ("Update on your
  application") could never be corrected when its text is a rejection. The watch therefore
  runs the same rules reader as the sync, and puts on a timeline only what has been read; an
  unread email waits for the next tick. No model call, as section 8 says.
- **A quiet tick stops early.** When Gmail holds nothing newer than the last sync that
  worked, the watch stops after the headers and only sends what is due. The tick at the top
  of each hour always does the whole pass, so a read that failed is retried within the hour.
  This keeps most of the 56 daily runs to a few small queries (the Free plan's egress is 5 GB).
- **The back-off needs no stored state.** While the Gmail connection is in error, the watch
  tries on the :00 and :30 ticks only.
- **Its own secret, enforced.** `ATLAS_WATCH_SECRET` opens `/api/cron/watch` and nothing
  else; `CRON_SECRET` does not open the watch; and the route answers 503 if the two are set
  to the same value. The job's SQL reads the secret from Vault each time it runs, so the
  schedule itself holds no secret.
- **POST, answered when the work is done.** `pg_net` gives up after 2 seconds by default, so
  the job sets 55 seconds; the answer (a status and counts) is kept 6 hours in
  `net._http_response`, which is how to see what a run did.
- **A quiet run is not logged.** Only a run that changed something or failed writes to the
  activity log, as an Applications Agent run named "Heard back watch". Gmail's last-sync time
  on Connectors shows the watch is alive.
- **The Email Agent's pause stops the watch too**, since the watch reads the inbox. Section 8
  named the kill switch and the Applications Agent's pause; both still stop it.
- **The cron hours are UTC and cover both offsets** (`*/15 0-3,13-23 * * *`): 7 AM to 9 PM
  Mountain in summer and in winter. The route checks the local hour and skips the extra one.

**21 Nov 2026, Phase 2 (the Pipeline page).**

- **Needs you asks two things, both of which Atlas already asked.** "Which application is
  this?" (5.3, step 4) moved in from its card, and so did "which role did you apply for?"
  (the old "Fill in the role" card), because the lane is the only place that asks. Same
  buttons, same server actions, nothing new stored. The mock's "reply with times" is a next
  step (section 6, row 2) and comes in Phase 4; a model's reading to confirm comes in
  Phase 3. Until then an answer that wants a reply is an unread line in Heard back, right
  under the lane. This is the smaller reading of the mock.
- **Not in the lane:** an interview invite the tracker cannot place at all (no company it
  can read). It still pings and opens the inbox, as Phase 1 left it. The design does not
  list it as a card.
- **Heard back sits under the lane and shows only what is new.** Section 7 says the bell
  opens it. The bell jumps to the card; unread answers (up to six) are listed, and the rest
  and the Hold rejections switch are behind one fold, so with nothing new the card is one
  line and the list stays in reach on a phone. It still has no page of its own, and a push
  about several answers still opens `/applications#heard-back`.
- **Same address, new name.** The page stays at `/applications`: pushes, the stored links
  and the Safari extension already point there. Its title and the links to it say Pipeline.
- **Pipeline is a tab in Career, second after Apply.** The design names no navigation
  entry, so the PR first left the page under Tracker and asked. Tyler chose the tab on
  21 Nov 2026: a phone-first page needs a way in from the phone, and the Apply page's link
  to it is hidden there. The tab is lit on the list and on each application's page. Career
  is now Apply, Pipeline, Tracker, Target Roles, Setup.
- **Quiet is a week with no news.** An open, sent application is Quiet when neither an
  email from the company nor a change of stage has happened for 7 days, the same week the
  follow-up rule waits (`FOLLOW_UP_AFTER_DAYS`). Your own follow-up does not end it. 5.2
  said "as the Tracker's Dead end is now"; Dead end needs the follow-up record and two more
  weeks, which would leave Quiet empty for most of an application's life. Every application
  is in exactly one of Active, Quiet and Closed.
- **All, Active, Quiet and Closed replace "Last 7 days" and "Last 30 days".** The chips for
  your target roles stay.
- **Three ways to see the same rows.** By stage is the default: furthest along first, with
  Rejected and Withdrawn folded. By company puts every role at a company in one group
  ("Acme" and "Acme Inc" are one company, by the tracker's own `sameCompany`). Board is the
  six-column grid with its status picker; its chip is offered from 1024px wide.
- **A row shows the stage, the newest thing on the timeline, when they last wrote and an
  unread dot.** A closed one says how far it got, in the application page's words. Left for
  the phase that has the data: a deadline on the row ("due Fri", Phase 3) and the next step
  (Phase 4). The Funnel card is Phase 5.
- **One new read on the store, no table and no migration.** `applicationEvents.listed()`
  returns each event's kind, time, source and summary (never an email id or thread), up to
  5,000 rows, so the page can find the newest event per application and how far a closed
  one got. The alternative, a "latest event" column on the application, would be a
  migration and a second thing for every writer to keep true.
- **The answer bank and Autofill are on Setup** (`/career/setup#answers`, `#autofill`), with
  every link to them. The extension needs no rebuild: it already runs on `/career` pages
  and reads the same two element ids. Add an application, Saved searches and This week
  stay on the Pipeline, below the list; the design does not move them.
- **Rules only.** No model call, nothing new leaves Atlas, and no migration to run.

**21 Nov 2026, Phase 3, first PR (the reader, in shadow).**

- **Two PRs, as planned. This one shows nothing from the model.** It adds the four rule kinds,
  the model reader behind a switch that starts off, the checks, the eval, and shadow storage.
  Suggestions in Needs you wait for a week of shadow data and are the second PR.
- **What does change on screen is the rules' doing, as 5.6 says rules apply at once.** An
  email rules read as an offer, an assessment, a request for times or a request for something
  now lands on its timeline, moves the stage and pings as that kind, where before it was a
  "Reply" or an "Application received". Inbox labels it so. The Evals page lists one more suite.
- **One verdict per email, the weightiest first:** rejection, offer, interview invite,
  assessment, request for times, request for something. A "scheduling request" is a request
  for times that names no interview (what works for you, a meeting that has to move); a
  request for times for an interview is still an invite, as before.
- **An offer must be said in so many words.** "Offer" in a sentence that says no, or that
  talks about what happens before one ("before we can extend you an offer"), decides nothing.
- **Two interview rules were tightened to hold the bar**, both found by the eval: "would like
  to invite you" no longer counts by itself (it also invites you to view jobs), and "virtual"
  or "technical" must be followed by a conversation ("our virtual open house" is not one).
  "Invite you to a technical assessment" is an assessment.
- **The stage is what moves, not the status.** An assessment and an interview are both status
  "interview", so the tracker now compares stages, carries the stage in its changes, and gives
  an application logged from such an email that stage. Replaying a timeline still gives the
  stage the row holds.
- **The reader runs in the two-hour sync only**, as one step of the Applications Agent's part,
  after tracking. Not in a brief's run (its time is the brief's) and never in the watch.
- **"Read once" means sent at most once.** The email is marked (`inbox_items.model_read_at`)
  in one conditional write before the call. A call that fails is not sent again, that run or
  later: rules stand for that email. When the provider itself fails, the run stops asking and
  the rest wait for the next sync, so an outage costs one email, not the day's calls.
  *Pattern: claim, then act; at-most-once; circuit breaker.*
- **Turning the switch on sends no backlog.** Only email that arrives after it was turned on
  is sent (`modelReaderSince`, set by the switch). 5.5 says nothing is sent until you turn it
  on; this is the narrow reading of it.
- **Which application is settled before the model is asked**, by the ladder. An email that
  could be about two applications is not sent until you place it. The application must be
  open (applied, replied or interviewing) and must not have moved since the email arrived.
  Automatic confirmations go last, so the day's calls go to likely answers first.
- **The subject is sent with the text**, scrubbed the same way, and the two together are at
  most 4,000 characters. Three facts Atlas already holds go with them (company, role, stage)
  and the day the email arrived, which the model needs for the stage and the year of a date.
  No sender address and no message or thread id.
- **"A legal move" is exactly what the reducer would do.** The reading's stage must equal
  `applyEvent`'s result for that kind from where the application stands; anything else is
  dropped. The stage is then not stored: an event holds a stage only for `stage_set`, so a
  confirmation in the second PR derives it from the kind again.
- **A deadline must be written as a calendar date** ("December 4", "12/04"), with the same
  year if one is written, from the day the email arrived to 90 days on. "By Friday" is not
  accepted: the model is told to leave it empty and say it in what is asked. Working out a
  weekday is a wrong date waiting to happen.
- **Role and people are checked, not stored.** They are kept in a reading only when the email
  names them; 5.10 has no column for them, and their first reader is Phase 4's brief.
  `deadline` and `ask` are stored (two new columns on `application_events`, as 5.10 lists).
- **A reading's row is kept apart at the store.** `forApplication`, `index` and `listed`
  leave out rows decided by "model"; a new `readings()` returns them. So no timeline, list,
  tracker or notice can show one by accident. Its source is `reading:email:<id>`, not the
  email's own `email:<id>`: the unique key is (source, kind), and a reading that agrees with
  the rules' event would otherwise be skipped as a repeat, which shadow mode needs to see.
- **Caps:** 12 reader calls a day (counted by purpose in `ai_usage`), 6 a sync, 15 seconds a
  call, each through `takeAiCall`. Two syncs at once could pass the day's count together and
  go a few over; the conditional mark still stops any email being sent twice.
- **The migration was read, not run** (`20261121120000_mail_reader.sql`): it widens the check
  on `inbox_items.text_verdict`, and adds `model_read_at`, `deadline` and `ask`. It only adds,
  and can be run again. Until it lands, an email rules read as one of the four new kinds
  fails to save its verdict and is read again at the next sync; the reader's own switch is
  off, so nothing else depends on it.
- **The eval: 62 made-up emails, 59 of them matched against a made-up board.** Rules alone:
  kind 48 of 62 (77%), no false interview or offer, matching 58 of 59. The 14 misses are all
  emails rules leave undecided (unusual wording), which is what the model is for. The live
  run is opt-in, makes at most 12 calls and has not been run: it has no database, so its calls
  are not in Atlas's own count.
- **The switch is in Settings, under Guardian controls**, with the other two that decide what
  leaves Atlas. Its hint says what is sent, to whom, and what happens to the answer.
- **Seen, not changed:** the Email Agent calls any subject with "next steps" an interview,
  even when the text decides nothing; that can be a false interview and deserves its own
  change with its own eval cases. An account notice from a hiring system that arrives after
  an application closed logs a new application (a known gap in the eval). Inbox still moves
  only an interview invite to "needs a reply".

**21 Nov 2026, a subject alone cannot make an interview invite (after Phase 3's first PR).**

- **Once the text is read, the text decides.** In `jobKind`, when rules read the text and
  found nothing in it ("none") and the subject says interview, the email is a reply, not an
  interview. It is still on the timeline and still pings as "They replied"; the stage goes no
  further than In review. While the text is unread the subject still decides: it is all there
  is. *Pattern: fail safe; the stronger evidence wins.*
- Alternative: not job mail at all once the text says nothing. A real invite in unusual
  wording would then leave the timeline and never ping.
- Alternative: a confirmation when a hiring system sent it. Quieter, but the same real invite
  from a hiring system would not ping. "They replied" for a plain confirmation is the cheaper
  mistake.
- **"Next steps" left the subject's interview words altogether.** It is a reply by its
  subject, read or not, from a hiring system or any sender that is not a mailing list.
  Confirmations, assessments and rejections all say "next steps"; and only the watch waits for
  the text, while the two-hour sync and the briefs track mail whose text could not be read,
  and each email is placed once. As a reply it is still job mail, so its text is read, and
  the text makes it an interview when it says so. Alternative: keep it for unread mail only;
  that leaves the false interview in every run that cannot reach the text.
- **What it costs.** A real invite that only its subject names (text in words no rule knows)
  is a reply until you or the model reader says otherwise: late, not wrong. An unread "Next
  steps" email tracked before its text is read is placed as a reply and stays one.
- **The urgent ping (`urgentSince`) is unchanged code.** It pings for an interview invite
  that is on no timeline. An email now counts as one only when its text says so, or when its
  subject does while the text is unread. A read email that only its subject called an
  interview, and that cannot be placed on an application, no longer pings from there.
- **Inbox (`tagInbox`) is unchanged code.** Only an interview invite is moved to "needs a
  reply". An email that only its subject called one stays in its own pile once read, tagged
  Reply; an unread "Next steps" email is no longer moved.
- **Still open.** The plainer subject words ("interview", "phone screen", "your
  availability") still make an interview while the text is unread, so a run that cannot reach
  the text can still place one by its subject. And a person's "Next steps" email about
  anything is still tagged job mail (a reply now, an interview before).
- **The eval: five emails added (67, 64 of them matched).** Rules alone on the 67 before this
  change: kind 50 of 67, **3 false interviews**, matching 63 of 64. After: kind 51 of 67
  (76%), none false, matching 63 of 64. One miss is new and meant: an invite only its subject
  names. A test now holds the rule itself: no email whose text rules left undecided is ever
  called an interview or an offer.

**21 Nov 2026, unread mail waits: no run places an email before its text is read (closes "Still open" in the entry above).**

- **One rule, in one place.** `kindToPlace` (`lib/domain/applications.ts`) says what the
  tracker may place an email as, and `jobMailsFrom` asks it for every email. A read email is
  placed as what it is; an unread one is left out and waits for a run that reads it. The
  2-hour sync, the brief's run, the Mentor's refresh, the watch, the Needs you lane and the
  action behind it all get their job mail from `jobMailsFrom`, so none keeps a filter of its
  own (the watch's is gone). *Pattern: one source of truth; fail safe.*
- **Why wait, and not place it as a reply.** Each email is placed once. Placed unread as a
  reply, "Interview with Acme" stays a reply after its text says interview, and "Update on
  your application" stays a reply after its text says no. Waiting is late; that is wrong for
  good. Alternative, not taken: keep tracking unread mail, with a subject's "interview"
  turned into a reply. Faster onto a timeline, and wrong on it whenever the text disagrees.
- **What it costs.** An application is logged, and an answer pinged, one run later whenever a
  run cannot read the text: more than a dozen job emails waiting (a dozen are read a run),
  Gmail slow, or a run short on time. With the watch every 15 minutes that is minutes, not
  hours. The Applications Agent's trace counts what is held ("2 not placed until their text
  is read").
- **With no app-password connection, nothing from email is tracked.** Only that connection
  reads text (5.4), so on Google sign-in alone every job email waits and no run places one:
  no applications logged from email, no stage moved, nothing in Heard back or Needs you. Job
  emails still show in Inbox with their label, and an application can be added by hand.
  Before, such an account was tracked by subjects alone, every one of them uncorrectable.
  No page says this yet; the trace does.
- **The one-time catch-up is the exception, and it is narrow.** "Find past applications in
  Gmail" finds mail by its headers in All Mail. One still in the inbox is tracked like any
  other, with the reading the inbox holds, or it waits. One that is not in the inbox will
  never be read by any run, so waiting would never end: it is placed by its subject, except
  that a subject cannot make an interview invite. It is logged as a reply (`neverRead`).
  Alternative: have the catch-up read all of them; up to 300 emails at a dozen a connection
  is too slow for one click.
- **The urgent ping (`urgentSince`) changed: it waits for the text too.** It pinged
  "Interview invite" for an email on no timeline whose subject said so while unread. Until
  now the tracker had usually placed that email in the same run, so the ping rarely fired.
  With unread mail held off the timelines it would fire for every one of them, from a
  subject alone, saying "Atlas could not tell which application it is about" of an email
  Atlas has not read, and again from the outbox once the text was read. Now only an invite
  the text names pings from there.
- **Not covered.** The urgent ping looks at mail newer than the last sync. An invite read
  later than the sync after it arrived, that also cannot be placed on an application, is in
  Needs you and gets no ping. Closing that needs a "read at" time on the inbox row (a
  migration), so it is left.
- **Inbox and the brief are unchanged.** An unread email whose subject says "interview"
  still carries the Interview invite label there and is still moved to "needs a reply": the
  label sits beside the subject it came from, moves no stage and pings nothing.
- **The demo.** It has no Gmail to read, so its sample invite now comes already read, like
  its sample rejection; the demo tracks both as before.
- **Mail placed before this change stays where it is.** Nothing is re-read or moved.

## Sources

- Gemini API Additional Terms of Service, "Unpaid Services": https://ai.google.dev/gemini-api/terms (read 20 Nov 2026)
- Vercel cron limits on Hobby: https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing (read 20 Nov 2026)
- Supabase `pg_net` with `pg_cron`: https://supabase.com/docs/guides/database/extensions/pg_net (updated 18 Nov 2026, read again 21 Nov 2026). On the Free project: `pg_cron` and Vault installed, `pg_net` available (checked 21 Nov 2026). See `docs/WATCH.md`.
- Gmail push notifications: https://developers.google.com/workspace/gmail/api/guides/push (read 20 Nov 2026)
