# Progress log

Append a new dated section at the bottom after each build session. Add a `### QA` subsection when the daily QA pass finishes. Do not rewrite earlier days.

Entries for 7–10 November are in git history, on the commits before Atlas replaced the Python package (`556e2ae`). This file starts again on main.

### 2026-11-12 — Renewals and document heads-up

**Roadmap day:** 2026-11-12 was "Stalled work as a table" on the Python workload radar. That milestone did not run.

**Shipped:**

- A renewals collection: bill, renewal, or document, with a due date, a lead window, and a cadence of once, monthly, or yearly.
- `renewalView` lists what is overdue, due today, or inside the lead window, soonest first. The Renewals page renders that list. https links are anchors; anything else is not a link.
- Marking a one-time item handled deletes it. Monthly and yearly items roll forward until the next date is after today, keeping the original day of month (31 January becomes 28 February, then 31 March).
- The morning brief adds one watch-out when something is inside the window. Demo data includes an overdue renters-insurance row whose link is `https://example.com/insurance`, and a passport that stays in Later.
- Postgres table `renewals` with owner-and-aal2 row level security. The JSON export includes the rows. Deletes and date rolls are audited.
- `npm run check` on Node 24: eslint, `tsc --noEmit`, and 42 vitest tests, all passing. Main had 32 tests before this session.

**Decisions:**

- 10 November (pin the GitHub payload) is already open as pull request #5 and conflicts with main. 11 November (quiet open pull requests) never landed. Both need the `lfg` package, which main removed on 11 November when Atlas shipped. Building the stalled-pull table on top of that would not merge.
- Pull requests #15–#18 already cover time-blocking, Slack hand-off, the job-hunt "do next" queue, and speed polish. This session takes the next playbook item that is not in those diffs: bills, renewals and documents.
- The brief names the first due item and does not invent a second page for it. Today already renders watch-outs.
- Month-end dates keep an `anchor_day` column so clamping in February does not permanently move a 31st to the 28th.
- Links are https-only, with no username, in the server action, the renderer, and the database check.

**Limitations:**

- Renewals are not on the phone tab bar (it stays five items). Desktop nav has the link. On a phone, open Settings, then Renewals.
- The watch-out is one sentence. It does not list every row.
- There is no amount, autopay flag, or reminder push. The lead window is the reminder.
- Live Supabase was not migrated in this session. The migration file is `supabase/migrations/20261112203317_renewals.sql`.
- ruff, mypy, and pytest are not on main. The check for this tree is `npm run check` (eslint, `tsc --noEmit`, vitest). There is no coverage gate in CI.

**Next:** The Python sequence (quiet open pull requests, then the stalled-work table) stays blocked until someone decides to revive `lfg` beside Atlas or close pull requests #4 and #5. On Atlas, the next playbook item not already in flight is meeting prep packs.

### 2026-11-17 — Seeing where the AI judges, catching up on briefs, the two-desk map

**Shipped:**

- Mission Control has an **AI judgment** card: the model and its fast fallback, today's calls against the daily limit, and for each agent that uses the model what it judges and how its last run went (judged by the model, or fell back to rules and why). The Live Map marks those agents with ✦. (#74)
- **Catching up on briefs**: Today has a day switcher for the last three brief days (Sundays skipped), with how many briefs each day still has unread. A past day opens with every action its briefs had. Briefed counts for the day the brief was written. The server refuses older days, future days and days with no saved brief. (#75)
- **Live Map, two desks**: Daily and Career desks side by side, the AI model as its own box with dashed lines to the four agents it judges for, the 6 PM evening run, GitHub and Figma sources, dashed borders for what is outside Atlas, a status dot per agent, and a focus panel for any box. Lines run in lanes between boxes, and a test checks none crosses a box. (#76)

**Decisions:**

- The layout was approved as a mockup before it was built.
- On a phone the map keeps a readable size and scrolls sideways inside its card, rather than switching to a second, stacked layout that would need its own line routing.
- The live snapshot carries only a count of today's AI calls, never what was asked.

**Limitations:**

- The Live Map was checked in the demo app in dark mode at desktop and phone widths; light mode and the live site with real runs were not checked before merge.

### 2026-11-17 — Mission Control on a phone

**Shipped:**

- Mission Control opens on a phone. It is under More, and the dashboard shows instead of a "laptop only" note. The agent cards become one row per agent (last run and result at a glance) that taps open for the detail, the AI line and Run now and Pause. The iPad and laptop layout is unchanged. The cost card says AI model usage, not Claude.

**Limitations:**

- Checked in the demo app at iPhone width (375 px) and laptop width; not checked on a real iPhone or on the live site.

### 2026-11-17 — Catching up stays inside the week

**Shipped:**

- The brief day switcher on Today covers three days with today: today and up to two days before it, and never a day before this week's Monday. Today shows it as a calendar of this week, Monday to Sunday, with the weekday and date on each day: today and the days you can still catch up on are tappable, with how many briefs are unread; earlier and later days are shown greyed out. On a Monday only today is tappable; on Sunday, Saturday and Friday are the last chance. The server's check uses the same rule, so an older or last-week day is refused.

**Decisions:**

- A new week starts clean: catching up is meant to be done by the weekend, so last week's briefs are never offered.


### 2026-11-17 — A brief is always saved, even when the model is slow

**What happened:** this morning's brief run was stopped at Vercel's 60-second limit while the AI model was still wording it. Gemini was slow (the Mentor waited 10.7 s and fell back to rules), and the wording call had no deadline. The function was stopped before it saved the brief or logged a failure, so Today showed a live preview, which has no Briefed button. Yesterday the same run took 34 s.

**Shipped:**

- Every run has a deadline: when Vercel will stop it. Each model call inside the brief (the Analyst's report, the Mentor's insights and role review, the brief's wording) waits only for the time left, minus what the run still has to do. When too little is left, the model is skipped, the rules' version stands, and nothing counts against the daily AI limit (`lib/domain/deadline.ts`).
- The rules-based brief is saved before the model words it; the wording is saved over it when it comes back. If the run is ever stopped, the brief is still on Today with its Briefed button.
- If a brief's time has passed and it still is not saved, Today marks it "Not saved" and offers **Save the Morning Brief** (the Chief of Staff's Run now). The saved brief then has its Briefed button.

**Limitations:**

- Checked in the demo app (a missed brief saved, then marked as briefed) and in tests that replay this morning's timing; the live run is checked at the next scheduled brief.

### 2026-11-17 — The Approval Queue tops Inbox

**Shipped:**

- The Approval Queue is now the first thing on Inbox, above the email: each pursued job or gig with its apply kit, and each follow-up to send, with Recently decided folded underneath. It shows whether or not Gmail is connected, and it is tinted when something is waiting. On a phone it is one tap away in the Inbox tab.
- The separate Approval Queue page and menu item are gone. `/approvals` and every old link (Mission Control, Jobs, the brief's job matches) go to `/inbox#approvals`. The unsubscribe list was already on Inbox as Declutter.

**Limitations:**

- Checked in the demo app at laptop and phone widths; not on the live site.

### 2026-11-17 — The Applications Agent reads job emails

**Shipped:**

- The Applications Agent reads the text of job emails to tell a rejection or an interview invite from a plain "we received your application". Many rejections arrive under a subject like "Update on your application", so the subject alone missed them. A rejection moves the application to Rejected; an interview invite moves it to Interview and lands in Needs a reply.
- Inbox shows the sentence that decided it under each job email ("From the email: ...").
- It runs before tracking, in the brief's run and in every 2-hour sync.

**Decisions:**

- Only job emails are read (the Email Agent tags them from sender and subject first), each once, over IMAP read-only with BODY.PEEK: nothing is marked read. Text parts only, never attachments or an attached email; at most 12 a run, 48 KB each.
- Rules, not the AI model: the text never leaves Atlas. A rejection must be said plainly ("Unfortunately" alone is not one), and a sentence that only describes what might happen ("if your background matches, a recruiter will reach out to schedule an interview") is not an invite. Quoted earlier messages in a reply are not read.
- Only the verdict and the one deciding sentence are stored (`inbox_items.text_verdict`, `text_quote`, at most 240 characters, addresses, phone numbers and links removed). The text is not stored or logged; the trace records counts only.
- Inside a brief, reading waits for the next sync when the run has less than 25 seconds left, and Gmail gets 15 seconds before the reading is skipped (nothing is marked, so the next run tries again).

**Limitations:**

- Over the app-password (IMAP) connection only; the OAuth connection is not used for this.
- Checked with tests and in the demo app (a sample rejection); the live Gmail read is checked at the next sync after merge. The one-time "find past applications" search still reads headers only.

### 2026-11-17 — Reading every email from the companies you applied to, and the role

**Shipped:**

- Companies often write from their own address with a subject that names nothing ("Regarding your application", "Your Acme application", "Update from Acme"); the subject rules missed 7 of 11 such subjects. The Applications Agent now reads every email from a company with an open application on your board (applied, replied or interviewing, within 120 days). A rejection or an interview invite in the text moves the application.
- The role, from the text: "Thank you for applying for the Senior AI Engineer role", "Position: Solutions Architect", "your application for Customer Engineer at Acme". A new application logged from an email takes it, and one already logged as "Role not listed" gets it from any later email from that company.
- For each application logged as "Role not listed", Atlas reads the very email it was logged from (its Gmail id is on the application) and fills in the role. One whose email names no role is marked so it is read only once, and stays in Fill in the role.

**Decisions:**

- Not a company's newsletters or promotions, and nothing tagged as a bill, receipt or subscription: they carry no application news, and a marketing email ("we'd love to connect") could be misread as an invite. A personal mailbox's domain (gmail.com) never counts as a company.
- A role must name a kind of job (engineer, analyst, manager...), so "this position" or "the next step" is never taken for one. A requisition number is dropped.

**Limitations:**

- Older emails from a company that are not in the inbox's 30 days are not searched, except each application's own email.

**Follow-up, same day:** the first live lookup took too much from one email ("Novaline and the Applied AI Engineer - EMEA", from "your interest in Novaline and the … role"): the role is now taken after "and the", "and our", "and this" or "and your". An email that does not name the role leaves its application in Fill in the role until a later email from the company does.

### 2026-11-17 — The Mentor reaches Gemini again

**What happened:** since the evening of 16 November, Gemini's writer model (gemini-4-hydrogen) did not answer inside its share of the time in any call (6 of 6). The Analyst still got an answer from the fast model (gemini-3.5-flash-lite) in 3 to 5 seconds. The Mentor did not: its request is larger, and the fast model was left a fixed 45% of the wait (about 7.7 of 18 seconds), so all three Mentor runs since fell back to rules ("rules ranking (error)").

**Shipped:**

- The fast model gets all the time left, not a fixed share: a writer that fails at once (rate-limited, busy) leaves it nearly the whole wait.
- A writer that timed out, was busy or rate-limited rests for 30 minutes: the calls after it (the Mentor after the Analyst, in one brief) go straight to the fast model with their whole time.
- The Mentor's two calls wait up to 24 seconds (was 18); inside a brief or the evening run the run's deadline still cuts it.
- Traces say why in words ("no answer in time", "rate-limited (429)", "busy (503)", "key refused (403)"), and Mission Control's AI card reads them back.

**Limitations:**

- Why the writer slowed down is not known: Vercel keeps an hour of logs on this plan, and no AI call ran in the last hour. The new trace wording will show the reason at the next run. Free tier only, as before.

### 2026-11-17 — A stronger, faster Gemini connection

**Review:** Atlas makes about 6 AI calls a day, far under any free-tier limit, so quotas were not the problem. The writer model (gemini-4-hydrogen) had not answered inside its share of the wait in any call since the evening of 16 November, while the fast model (gemini-3.5-flash-lite) answered in about 1 to 3 seconds. Three weak spots made that costly: the fast model only started after the writer's whole share had passed; after a 400 the retry dropped the thinking setting, so a thinking model fell back to its slow "high" default; and Google's error body was thrown away, so the trace could only say "error". Google's docs (gemini-4-hydrogen guide, rate limits, thinking) confirm: thinking levels LOW to XHIGH with HIGH the default, MINIMAL and thinking_budget rejected with a 400, and free-tier limits per project and per model, reset at midnight Pacific, with no published numbers for these models.

**Shipped:**

- Hedged calls: the writer has a head start (45% of the wait, 3 to 10 s, always leaving the fast model 2.5 s); then the fast model runs alongside it. The first good answer wins and the other request is cancelled. A missing model (404) or a request it rejects in every shape hands over at once; a refusal or a bad key does not.
- A writer that failed or lost the race rests for 30 minutes, so the next calls in the same run go straight to the fast model.
- Request shapes: JSON Schema, then plain JSON, then without the thinking setting; the thinking level stays low through the first two, and the shape each model accepts is remembered.
- One more try on a busy or rate-limited answer, after the delay Google asks for (at most 1.5 s), when 3 s are left.
- Google's error code and a short message are kept, so traces say "rate-limited (429 RESOURCE_EXHAUSTED)" or "busy (503 UNAVAILABLE)", and Mission Control reads them back.
- Mission Control's AI card has **Check the connection**: a tiny, timed request to each model on its own (no personal data), showing which answers, how fast, in which shape, or why not. It is logged, so the card shows the last check. It counts once against Atlas's daily AI limit and can be run 3 times in 10 minutes.

**Limitations:**

- Why gemini-4-hydrogen stopped answering in time is still not known; the first connection check will say. Free tier only, as before.
- The writer's rest is per server instance: a new instance asks the writer first again, behind its head start.
- The AI card only shows with a key set, so it was checked with render tests, not in the demo app.


### 2026-11-17 — Scheduled runs get five minutes

**Shipped:**

- The cron routes (morning, 2 PM, evening, 2-hour sync) ask Vercel for 300 seconds instead of 60: the Hobby plan's limit with Fluid compute. Pages and server actions stay at 60, since someone is waiting on them.
- Inside a scheduled run, each model call may wait up to a minute (was 18 to 25 seconds); the run's deadline still cuts it, so the brief is always saved. Gemini's writer then gets about 27 seconds to itself before the fast model starts alongside it (head start up to 30 seconds, was 10).

**Why:** Atlas had capped itself at a fifth of what the plan allows, and a slow but working free-tier model (gemini-4-hydrogen answered in 7 to 17 seconds before it slowed down) was cut off. Nobody waits on a 7 AM run, so waiting a minute for the better model costs nothing.

**Limitations:**

- Worst case, a morning brief now takes about 4 minutes instead of 1; the cron fires by 8 AM, so it is still ready by 9.

### 2026-11-17 — gemini-3.8-flash writes; hydrogen is watched

**What the connection check showed:** gemini-4-hydrogen answered "503 UNAVAILABLE: This model is currently experiencing high demand" after 3.5 s, and later not at all within 20 s. gemini-3.5-flash-lite answered in 0.9 s. Since Google opened hydrogen to the free tier on 12 November it has had more demand than it serves to free-tier requests.

**Shipped:**

- The writer model is gemini-3.8-flash (was gemini-4-hydrogen); the fast fallback stays gemini-3.5-flash-lite. `ATLAS_GEMINI_MODEL_WRITER` in Vercel still overrides it without a code change.
- The connection check also tries gemini-4-hydrogen, marked "not in use", so the card shows when it is worth switching back. A check now costs at most three free-tier requests.
- A 403 from the writer hands over to the fast model (it can mean one model is not offered on the free tier); only a 401, a bad key, stops there.

**Limitations:**

- gemini-3.8-flash on this key is checked by the first connection check after the deploy; if it fails, every call still falls to gemini-3.5-flash-lite at once.


### 2026-11-17 — Refresh and review: the Mentor with fresh data

**Shipped:**

- **Refresh and review** on the Mentor's card in Growth: the Scout reads the job boards and the Applications Agent reads your new job emails (at once), the Analyst recomputes the market report from what the Scout just recorded, then the Mentor reviews with all of it. The button lists what changed, one line per step, and the page shows the updated insights.
- On a refresh the Mentor may say again today what it already said, when the numbers moved since the latest time it said it; the new insight replaces the older one, which is marked "replaced" (not "dismissed", so the Mentor learns nothing about what you want to hear from it) and drops off the list. An insight that was updated carries an "Updated" pill. Unchanged subjects are not repeated, which leaves room for subjects it has not raised yet.
- The refresh is its own traced run ("Refresh and review"), and each agent still logs its own; it runs within the page's 60 seconds, every model call cut to the time left. Three refreshes per 10 minutes.

**Decisions:**

- "replaced" is written only by the server; the owner's status button still accepts new, done and dismissed. Migration: `mentor_insights.status` allows "replaced".
- The refresh replaces Ask now on the Mentor's card; Mission Control's Run now still runs the Mentor alone.

### 2026-11-17 — Refresh and review whenever a run did not work

**Shipped:**

- Today's Mentor card also shows when nothing is open but the Mentor's last review did not finish, or fell back to its rules while the AI model is on; it says which, and offers Refresh and review. Mission Control's Mentor card has the button too, next to Run now.
- A refresh asks the model again about what the rules last said, when the model is on, so a review that fell back to rules can be judged properly once the model answers. A refresh never saves a copy of what is already open (same subject, numbers and writer).
- Five refreshes per 10 minutes (was three).

### 2026-11-17 — A thumbs up means you want the job

**Shipped:**

- The separate Pursue button is gone. A 👍 on a match (in the brief, on Jobs, or on a past day's brief) puts its apply kit in your apply queue at the top of Inbox: listing, matched resume, your answers. Tapping 👍 again, or 👎, takes back a kit still waiting. A job you already acted on (kept as To submit, or submitted) stays on your Applications board whatever the thumb. Thumbs still steer the ranking of later matches.
- Under the thumbs, "In your apply queue" links to the queue, and a short note says what happened.
- One rule (`thumbStep`, pure) and one place that carries it out (`applyThumb`): the rating, the kit, and the audit trail (`career.queue`, `career.withdraw`). A failure to queue is reported and leaves the match unchanged.
- The database allows one waiting kit per job (`approvals_one_waiting_per_match`), so a second tap from another tab cannot queue the same job twice; that refusal is recognised and not shown as an error.

**Fixed along the way:** the Jobs page's Apply today list always showed its matches as not queued.

### 2026-11-17 — The QA Agent: a weekly review of Atlas itself

**Shipped:**

- A tenth agent, the QA Agent. Every Sunday evening it reviews the week from the records the other agents write, by rules: runs that failed or stopped mid-way, the 2-hour sync's schedule, briefs missed or late, how often the AI model answered and which model wrote, the last connection check, AI calls against the limit, eval scores, connections, applications with no role, apply kits waiting, Mentor subjects you keep dismissing, agents left paused.
- Each failed check raises a finding: severity, the facts it rests on, a suggested fix. Findings are ranked and compared with the last review: new, open for N reviews, or fixed.
- Mission Control has a QA review card (findings, what got fixed, every check that ran, Run now). Today shows a note for two days when a review finds something high severity. The Live Map has a Quality band with the QA Agent's box.
- Its own table (`qa_reports`: server-written, owner-read, kept a year), its own cron (`/api/cron/qa`, Monday 01:00 UTC = Sunday evening Mountain), its own instructions, and its own eval suite: 34 sample weeks, each with one thing wrong or nothing, must raise exactly the right finding.

**Decisions:**

- Rules only, no AI model: the reviewer must work when the model is what broke, and it audits the AI connection. The design had Gemini wording a top-three summary; that was left out for this reason. Severity ranking does that job.
- Independent of the Chief of Staff (it reviews it too) and it changes nothing: every fix is yours to make or to hand to a build session.
- Evidence is counts, task names and times, never the content of an email, a brief or an application.

**Limitations:**

- It reviews what Atlas records. It does not read the code, the deploys or Vercel's logs, so a problem that leaves no trace in the activity log is not seen.
- Checked in the demo app (which has no schedule, so the review correctly reported missing briefs and syncs) and by tests; the first live review runs at merge by Run now, then Sunday.

### 2026-11-17 — Four main tabs: Today, Growth, Career, People

**Asked for:** the main tabs, left to right, as Today, Growth, Career, People. The Approval Queue under Career. The Mentor and daily mentoring under Growth. People as the place to send semi-automated texts to keep in touch and share thoughts or ideas. Career as the main job hunt section. A smoother layout and workflow, saved for the QA Agent to keep in mind and look into options later.

**Shipped:**

- The nav is built from one definition of the layout (`lib/domain/layout.ts`). Sidebar: the four main tabs first, a rule, then everything else. Phone tab bar: Today, Growth, Career, People, More. Inbox moved under More.
- **Career** (was Jobs) is the job hunt in the order you work it: the Approval Queue at the top, Apply today, Save a job, then Target roles, Applications and Job watchlist. `/approvals`, the brief, Mission Control and the 👍 button all point at `/career#approvals`. Inbox no longer holds the queue; it shows one line while something waits there.
- **Growth** is a main tab of its own and leads with Daily mentoring: today's three reviews in order (morning priority, midday check, evening review), each showing what it said, "Nothing to flag", or "Still to come", then insights still open from earlier days. A row of jump links covers the rest of the page.
- **People** gains Share a thought or idea: write it once, pick people (or a whole circle), and each gets their own draft in your words with their name, a text whenever they have a phone number. The composer walks the queue; you open and send each one in your own Messages. Nothing is sent by Atlas and the thought is not sent to a model unless you press Draft it.
- **The QA Agent keeps the layout in mind.** Its instructions carry what was asked, its card on Mission Control shows it ("Kept in mind"), and each weekly review now counts a week of use per tab from records: briefs marked Briefed, Mentor insights answered, apply kits queued and decided, messages handed off against people due. A tab with something waiting that went untouched is a finding whose fix is a short list of options. Low, then medium the third review running.

**Decisions:**

- The queue stays at the top of its page, as it was on Inbox: what is waiting on you comes first. Today's picks, which feed it, are directly below.
- A shared thought is never rewritten by the offline drafter: your words, plus a greeting. A check-in still gets the template.
- The layout check does not judge the week the layout changed (the first full week is reviewed next), and a tab with nothing waiting is never called unused.

**Limitations:**

- The QA Agent measures use from what Atlas records, not page views: Atlas does not track which pages you open.
- "Text" means a draft handed to Messages through an `sms:` link. Atlas has no way to send a text itself, by design.
- Checked in the demo app and by tests (634). The interactive share flow was exercised in the preview up to the hand-off; the hand-off itself opens Messages and was not clicked.
- The QA eval suite is now 43 sample weeks.

### 2026-11-17 — README for hiring teams, showcase images

**Shipped:**

- The README now opens with what Atlas is and what was built (orchestration, rules plus AI judgment, reliable model calls, connectors, retrieval, the Mentor, Mission Control, evals, security), each row linked to the code or the doc that backs it.
- Four showcase images and a GitHub social preview in `docs/showcase/`, drawn in the app's own fonts and light theme. Three of them sit in the README under "How it works".
- The tab-by-tab table is unchanged and now sits under "Every screen", folded.
- `docs/DEPLOY.md` uses `you@example.com` for the owner email.

**Limitations:**

- The images are simplified: sample data on the Mission Control map and trace, and not every agent is shown. Their numbers (634 tests, 441 eval cases) are from this date and will age.

### 2026-11-17 — Owner settings out of the code

**Shipped:**

- Pay floors have no default in code. With nothing saved in Settings there is no floor, and the Settings labels say "0 for none". The Mentor's goal sentence leaves pay out when no floor is set.
- The Applications Agent and Chief of Staff instructions point to the floors in Settings instead of stating numbers.
- Answer-bank starters for location, links and availability are empty, and the salary starter is generic.
- Test and eval fixtures use made-up billers, subscriptions and companies, shaped so the sender-matching and subject-parsing rules are tested the same way. Fixture floors are 120,000 and 50.

**Decisions:**

- Salt Lake County stays in the code as the home region.
- The seven target roles, the level filter and the news source list are unchanged.

**Limitations:**

- A deployment that relied on the old defaults has to save its floors and answers in Settings; the live one did before this merged.

### 2026-11-18 — A second layer of security

**Shipped:**

- A second security review, written up in `docs/SECURITY-REVIEW.md`: dependency audits, both Supabase advisors, a catalog check of every table, policy, grant and function, all 14 routes and 78 server actions read, and signed-out probes of the live site. No critical or high-severity issue.
- A request that carries a token no longer follows a redirect to another origin, even to a host on the allowlist.
- Logs are append-only for every role, the server's secret key included: triggers refuse UPDATE, DELETE and TRUNCATE on the audit trail, the activity log, the AI-call ledger and the time ledger. Retention still runs.
- The unsubscribe guard judges an IPv4 address written inside an IPv6 one, and refuses 6to4 and Teredo.
- The autofill extension fills only fields a person can see.
- Three QA eval cases plant an instruction in the log and require the same finding.
- The keep-alive route checks its token before saying anything; `/setup` redirects on a configured deployment.

**Decisions:**

- The logs' triggers also refuse deleting the owner's account, because that delete cascades to the logs. Erasing everything means dropping the triggers first.
- One dev-only advisory (picomatch) stays: no patched release exists.

**Limitations:**

- The migration was dry-run against the live database and rolled back, then applied on 18 November 2026 and checked again: the server's key could add a log row but not change or delete one.
- Not built: recording refused tokens, a read-only database role for the QA Agent, one key per scheduled job.
- 649 tests, 444 eval cases.

### 2026-11-18 — A refused token leaves a trace

**Shipped:**

- A missing or wrong bearer token on a machine endpoint still answers 401 at once, and now leaves a "denied" row in the audit trail (`token.refused`). All seven routes behind a bearer token record it: `/api/capture`, `/api/keepalive` and the five `/api/cron/*` routes.
- The row holds the route (from a fixed list in code) and how many requests were refused, split into no token and wrong token. It never holds the token or any part, hash or length of it, a request header, the query string or body, or anything about the caller.
- Throttled in memory, per route: the first refusal opens a ten-minute window and schedules one write for after the response; the write waits five seconds so a burst is counted in it; later refusals in the window only add to a counter that the next window's row carries. A flood costs one row per route per window, never a write per request.
- The QA Agent counts the week's records by rules, under a new Security area: five or more refused requests raise a finding (low from 5, medium from 25, high from 250) with the count, the routes and the first and last time as evidence. Fewer is noted on the check.
- The first item under "Not built" in `docs/SECURITY-REVIEW.md` is now under "Built since the review".

**Decisions:**

- No database change. The row fits `audit_events` as it is; the store gained one read (`audit.byAction`).
- The route is repeated in the row's detail, because the audit trail on Settings shows the detail and not the target.
- The write runs through Next's `after()`, so the 401 never waits for it. A failed write is logged, keeps its count for the next row, and is not tried again in that window.
- Atlas stores no caller addresses, so the record has none.
- A finding of the same severity as another is listed first when it is about security.

**Limitations:**

- A count is a floor. The throttle is per server instance, and what is refused after a window's row is written reaches the trail only if that instance sees another refusal once the window has closed.
- Checked by tests, and locally in the real Next runtime against a stand-in database: 401 in under 10 ms, one row per route five seconds later, 300 more refusals in the window added no write, and nothing of the request was in what reached the database.
- Checked on the live site after the merge and the deploy, on 18 November 2026: one request with no token to the keep-alive route answered 401, and its row was in the audit trail six seconds later (`1 refused at /api/keepalive: 1 no token, 0 wrong token`).
- Not yet seen on the live site: the QA Agent's count of these rows. The next scheduled review is Sunday 22 November.
- In demo mode there is no database, so nothing is recorded.
- 678 tests, 454 eval cases.

### 2026-11-18 — Solutions Engineer leads

**Shipped:**

- The role order now leads with Solutions Engineer, then Software Engineer, then AI Engineer, AI + Automation Engineer, AI Workflow Engineer, Forward Deployed Engineer and GTM Engineer. This is the fallback order in code; the live order still comes from Notion.
- Integration Engineer and Integrations Engineer count as Solutions Engineer. "AI Integration Engineer" still reads as AI Engineer, because the longer title phrase wins.
- Level in the ranking: "Engineer I" and "Engineer II" (also "Level 2" and "L2") rank higher. An Associate or Specialist title with no base pay posted ranks lower, and the match says "salary not listed · Associate title".
- Base pay against variable pay: a posted figure next to OTE, on-target earnings, total compensation or "including commission" is marked "includes variable pay". When the posting also states the base, the base is the figure shown and checked against the floor, so "OTE $140k ($95k base)" reads as $95k.
- The Mentor flags "aspiring", "seeking" and "entry level" in the first lines of the LinkedIn text.
- Target roles shows the positioning notes ("How to present yourself"), and the LinkedIn tune-up gained three tips from them.

**Decisions:**

- The words that say what a figure covers are read only right next to the figure, and the nearest one wins, so "$95k base, OTE $140k" is a $95k base.
- A figure that includes variable pay cannot rule a posting out unless even that figure is under the floor. It counts for less in the ranking than a base figure.
- An Associate or Specialist title with a posted salary that clears the floor is not marked down.
- No database change: the new pay labels fit the existing 40-character column.

**Limitations:**

- Only the first few hundred characters of a posting are read, so a base stated further down is not seen.
- "Specialist" titles rarely match a target role at all, so the rule mostly affects "Associate ... Engineer" titles.
- 684 tests, 485 eval cases.

### 2026-11-18 — Full-time roles only

**Shipped:**

- Atlas looks for full-time roles only. Contract, freelance, part-time and hourly postings are left out by the Applications Agent and not recorded by the Scout, so the market report covers full-time roles only. The run trace says how many were left out.
- Removed: the Hacker News freelancer thread, the Upwork and Contra saved searches, the gig track in the brief and in Apply today, gig proposals in the Approval Queue, the Mentor's two gig rules and the "side goal" line in its prompt, the gig rate floor in Settings, and the answer bank's proposal opener, hourly rate and weekly availability questions (with the autofill rules that filled them).
- One daily plan (3 applications by default) in place of two tracks. Pay posted by the hour on a full-time role is compared with the salary floor as a 2,080-hour year.
- The agents' instructions say full-time roles only.

**Decisions:**

- No migration. The `type` column stays on `job_matches`, `applications` and `market_postings`; new rows are written as full-time and the store reads full-time rows only. The three older gig matches and nine contract postings stay in the database, unread. Nothing was deleted.
- A posting whose title says contract is left out even when its description says full-time hours; a full-time posting that only mentions a contract in its description is kept.

**Limitations:**

- Settings still holds the old rate floor and the weekly-availability answer until they are saved over; nothing reads them.
- 684 tests, 490 eval cases (483 pass; the 7 misses are the known gaps).

### 2026-11-18 — What you are looking for: level, pay and place

You set the search out in full: a junior to mid level or associate role, not senior; aiming at $120k and open from $100k; remote, then hybrid, then on-site within 45 minutes of Salt Lake City; briefs that show Utah remote or hybrid jobs first, then remote anywhere in the U.S., then offices nearby.

**Shipped:**

- One search profile, `lib/domain/searchProfile.ts`, that every Career desk agent reads: the Applications Agent's rules, the goal the Mentor's model is given (insights and the role order), and the order of the brief's matches. The agents' instructions and `agents/README.md` say the same thing and point at it.
- Level: senior titles are never shown as matches (they are still recorded by the Scout, and an application to one is still tracked). Junior, Associate, Engineer I and II rank higher. Engineer III and above rank lower.
- Pay: a salary target next to the floor, both in Settings (defaults $120k and $100k). Pay that reaches the target ranks higher, and the match says "Reaches your target". A range counts by its top.
- Place, in `lib/domain/workplace.ts`: every match gets a place and a group. Hybrid or on-site work more than 45 minutes from Salt Lake City is left out; a Utah company's remote role is kept wherever it is. A match shows its place and an estimated drive ("Hybrid · Lehi, UT · ~25 min").
- The brief shows up to 15 matches (was 10) in three groups, in your order. Up to 6 seats are kept for Utah postings when there are any.
- Two signs a posting is not for you that level words do not show, both ranked down, not removed: pay that starts at 1.5 times your target (a senior role under a plain title) and a specialty outside what you build (embedded, firmware, robotics, games, native mobile).
- Two local saved searches on the Applications page: LinkedIn for hybrid and on-site roles in the Salt Lake area, and Indeed within 25 miles of Salt Lake City.
- The run's trace says how many senior postings were left out and how many matches are at Utah companies or inside the commute.

**Decisions:**

- No migration. A match's place is stored as its label in the existing `location` column, and the label reads back to the same group (tested for every city in the table). A brief saved before today has no groups and is shown as one list, as it was.
- Senior titles are left out by the Applications Agent, not by `roleFor`, so the Scout's market data and application tracking keep them.
- An Associate title used to rank lower when no pay was posted. You asked for associate roles, so it now ranks with Junior and Engineer I and II, and still says "salary not listed · Associate title" so you ask.
- A town with a namesake in another state (Sandy, Murray, Highland) counts as Utah only when the posting says Utah. "Sandy Springs, GA" and "Sandy, OR" are not yours.
- Hybrid needs an office to drive to. A posting that names the state but no Utah city, and also offers remote work, is remote. Found on a live posting: "Atlanta (hybrid) or REMOTE (US: Utah, Central or Eastern time)".
- Your home city is in code, in a private repository, like your target roles. If the repository is ever made public, move it to Settings first.

**Limitations:**

- Drive times are estimates, off-peak, typed into a table of about 40 Utah cities. They were not measured against a maps service. Correct any that are off.
- The public feeds are mostly remote boards. Run against the live feeds in demo mode, the brief filled with 13 remote matches, one remote role open to Utah and one Utah posting with no city. Hybrid and on-site jobs near home will stay rare until Utah companies are on the watchlist, or a source that covers them is added.
- Rules cannot read years of experience or team culture from a posting. "How do I fit?" on a match is still the check for that.
- Nothing was run against production. Your Notion Resumes database still has Solutions Engineer at Priority 7, so the live order does not yet lead with it.
- 700 tests, 541 eval cases (534 pass; the 7 misses are the known gaps). The Career suite went from 95 cases to 146.

### 2026-11-18 — Find 10 more

You asked for a way to have 10 more jobs searched for and found for review, started by hand.

**Shipped:**

- A **Find 10 more** button on the Career page, under a new "More jobs to review" section. It asks the Applications Agent to read the job feeds again and store up to 10 postings that fit and have never been shown. Each brief's matches card links to it ("Find more").
- The same rules as a brief: your roles, junior to mid level, a place you can work, pay from your floor up, the same ranking. Up to 4 of the 10 are kept for Utah postings.
- What it finds waits in the list for three days, in the brief's three place groups, with the same 👍, 👎 and "How do I fit?". A 👍 sends the apply kit to the Approval Queue.
- Press again for the next 10. When every posting that fits has been shown, it says so.
- Each search is a logged, traced run of the Applications Agent ("Find 10 more job matches"), audited, rate-limited to six in ten minutes, and $0.

**Decisions:**

- Found matches are kept apart from the briefs with their own slot, "on-demand". A brief counts only its own slot, so a search never uses up a brief's 15, and a brief never shows a found match again.
- No migration. The `shown_slot` column allows only the three brief slots, and no brief writes "saturday" for a match (the Saturday brief has none). The database adapter stores "on-demand" under that value and reads it back; nothing else knows. A test pins the mapping to the constraint in the migration file.
- The brief's run and the search share one function for reading and ranking the feeds, so they cannot drift apart.
- It is your trigger only: no schedule starts it, and it runs even when the agent is paused, like Run now.

**Limitations:**

- A posting found here is used up: tomorrow's brief will not show it. If you leave it unrated for three days it drops off the list and does not come back.
- The feeds are cached for about half an hour. Pressing again sooner does not read new postings; it goes further down the same ranked list, so each ten is a little weaker than the last.
- In the database, a found match reads `shown_slot = 'saturday'`. A later migration can give it its own value.
- Checked in demo mode against the live public feeds. Not run against production.

### 2026-11-19 — Firecrawl reads the postings you approve

You asked for Firecrawl and Browserbase in Atlas to help with the job hunt and with applying. This is the first part, the reader. The Browserbase part (submitting after you approve) is designed but not built: see Limitations.

**Shipped:**

- When you give a job a 👍, the Applications Agent reads its full posting through Firecrawl and adds what it asks for to the apply kit: the experience ("3–5 years"), the skills it names, the pay it states, remote or hybrid or on-site, and what to watch for (a clearance, citizenship, heavy travel, a required computer science degree, more experience than a junior to mid level role asks for).
- It reads right after the 👍 (in the background), at each 2-hour sync, and from **Read postings now** in the Approval Queue.
- "Draft with AI" in a kit is now given the skills the full posting names, so it searches your resumes and writes against what the job really asks for.
- A reading budget: 900 of Firecrawl's 1,000 free pages a month, 40 a day, 5 a run. Connectors shows the month's count and how to set it up.
- Demo mode reads a made-up posting, and says so, so the feature can be seen without a key.

**Decisions:**

- Only facts found by rules are kept. The posting's text never reaches a model and is never stored or shown, so nothing a posting says can act as an instruction. Skill names come only from Atlas's own list.
- The request asks Firecrawl for `proxy: "basic"`. Its default retries a blocked page through proxies built to get past bot protection; Atlas leaves such a page unread and says so in the kit.
- Never LinkedIn, Indeed, Glassdoor, Wellfound, YC Work at a Startup, Dice, Welcome to the Jungle or Silicon Slopes, refused before any request. Hacker News postings are not read either: they already arrive whole.
- No migration. The facts are lines in the kit's existing text, the page count is in Settings, and a kit that was read (or could not be) says so, which is how it is not read twice.
- No new dependency: one adapter over `safeFetch`, one new host on the allowlist.

**Limitations:**

- Not run against Firecrawl itself: there is no key yet. The request and reply shapes were taken from Firecrawl's current API reference, and the rules were checked against four real postings fetched from a public job board, which found and fixed two misses ("5+ years in solutions architecture", and a pay range stated after an earlier mention of compensation).
- The rules read what postings usually say. A posting that words its requirements unusually shows fewer facts, never wrong text.
- The count of pages is Atlas's own. It does not ask Firecrawl how many credits are left.
- Browserbase is not in this change. You chose "submit after approval" for company career pages. Its free plan is 60 browser-minutes a month with no CAPTCHA solving, and Greenhouse, Lever and Ashby forms run bot checks, so it needs its own design before code: which sites allow it, what stops a run, and how a wrong application is prevented.
- 727 tests, 558 eval cases (551 pass; the 7 misses are the known gaps). The Career suite went from 146 cases to 163.

### 2026-11-19 — Apply Agent, part 1: the packet and its rules

Tyler approved the Apply Agent design (docs/design.md) and asked that resume PDFs come from his Figma frames. This part builds what decides **whether** and **with what** the agent may apply. It submits nothing: there is no Browserbase code yet.

**Shipped:**

- `lib/domain/applySites.ts`: which job boards are On (Greenhouse, Lever) and Off (Ashby, LinkedIn, Indeed, Glassdoor, Workday), each with the reason, and the lane for any link. One key per posting, however its link is written.
- `lib/domain/applyPacket.ts`: the packet for a form. Contact details and bank questions from the answer bank (never a starter text), eligibility only from Tyler's own fixed answers, demographic questions declined when the form allows and a stop when it does not, never-answered questions (SSN, current salary, convictions, signatures), the form's own free-text questions marked for Gemini (part 2). Any required question without an approved answer is a stop.
- `lib/integrations/greenhouseQuestions.ts`: a Greenhouse job's application questions from its public API, so a packet needs no browser.
- The Apply Agent on the roster (status: being built), its instructions, and its box on the live map, apart from the team with QA.
- Migration `20261119180000_apply_agent.sql`: the agent id, the `auto` tier on applications, the `apply_runs` table (unique posting key per owner, RLS, the owner may only edit or approve a packet) and a private `resumes` bucket.
- The approved rule change in CLAUDE.md and agents/README.md.
- A local mock form for part 2's browser tests.

**Decisions:**

- A select answers an eligibility question only when exactly one option is a plain Yes or No. "Worked here before: Yes" with two Yes options stops instead of picking one.
- The agent stays "being built" with no model use until part 2, so the roster, the map and the evals stay honest.
- Some watchlist matches link to a company's own careers page with a Greenhouse job id (`?gh_jid=`). Those are manual for now; part 3 can map them to the job-board link from the watchlist entry.

**Limitations:**

- The migration has not been run. Run it in the Supabase SQL editor before part 2 ships.
- No eligibility settings screen yet (part 3); without it every packet stops on those questions, by design.
- 744 tests.

### 2026-11-19 — Apply Agent, part 2: the run that submits

The code that prepares a packet and submits an approved one. Nothing calls it yet: there is no review screen (part 3) and no Browserbase key, so no application can be sent.

**Shipped:**

- `lib/agents/apply.ts`: two logged, traced runs. **Prepare** reads the form's questions, exports the role's resume from Figma, builds the packet and drafts the form's own open questions from resume passages. **Submit** checks every limit, claims the row, proves the resume, opens a cloud browser, fills exactly the packet, reads each field back, clicks Submit once and reads the confirmation.
- `lib/domain/applySubmit.ts`: the fill-and-submit steps and every stop rule, written against a small form interface so they are tested without a browser. `lib/integrations/playwrightForm.ts` drives a real Greenhouse page.
- `lib/integrations/browserbase.ts` and `applyBrowser.ts`: one session per application, with CAPTCHA solving, recording and logging off, limited to the job board.
- `lib/domain/resumeProof.ts` and Figma PDF export: the file you approve is the file that is sent, and Figma is checked again before sending.
- `lib/domain/applyCaps.ts`: 50 browser minutes a month, 3 applications a day.
- `app/actions/apply.ts`: prepare, edit one answer, Submit for me.
- New dependency `playwright-core` 1.64.1 (approved); it downloads no browser.

**Decisions:** docs/design.md, section 12.

**Limitations:**

- Greenhouse only. Lever's form reader is not built.
- The page driver's real-browser test runs only where a browser is installed, so CI skips it. It passes locally (4 tests, Playwright's headless Chromium, the mock form). The stop rules are covered without a browser.
- Not yet verified against the real services: Figma's PDF (selectable text), a live Greenhouse form, and Browserbase itself. Those need keys and are what the pilot is for.
- The migration from part 1 still has to be run before part 3.
- 777 tests, 4 skipped.

### 2026-11-19 — Test the Apply Agent: see what it would send, before it applies

Tyler asked for a way to be confident that the Apply Agent sends the data and the resume PDF he expects, in particular after he edits a resume in Figma. He asked for an emailed test; after weighing it (docs/design.md, section 12) he chose a test shown inside Atlas with a push notification.

**Shipped:**

- Career page, **Test the Apply Agent**: pick a role, **Sync resume data**, **Send test application**. The test pulls that role's resume from Figma at that moment and shows the file name, when it was exported, its fingerprint, **Open the PDF** (the exact file kept), a link to the frame in Figma, and every field of a sample form with its answer and who gave it (your answer bank, your fixed answer, drafted from your resume, declined, left blank, needs you).
- **Your fixed answers** (work authorization, sponsorship, worked here before) are picked on the same card. Until now there was nowhere to set them.
- `runApplyTest` in `lib/agents/apply.ts` shares its packet assembly with the real prepare run, so the test cannot drift from what a real application does.
- `app/api/apply/test-resume`: serves the test's PDF to the owner, only while it is still the file recorded with the test.
- A push notification when a test is ready. It says which resume, nothing else.
- Works in the demo with a stand-in resume, so it can be tried with `npm run dev`.
- `BROWSERBASE_PROJECT_ID` is now optional.

**Limitations:**

- The test shows what would be filled in; it does not open a browser or a real form. The page driver is tested separately against the mock form.
- Live, it needs the Apply Agent migration (for the private `resumes` bucket). Without it the test says so.
- Not yet run against the real Figma file: the first live test is the check that Figma's PDF has selectable text.

### 2026-11-19 — Can a job board read the resume PDF?

A designed, two-column resume can look right and still reach a job board as no text, or as text in the wrong order. Atlas now checks every PDF it exports from Figma.

**Shipped:**

- `lib/domain/pdfReadable.ts`: compares the PDF's own text with the frame's lines. Good, warn (lines missing, or sections stored in a mixed order), bad (no readable text), or not checked.
- `lib/integrations/pdfText.ts`: reads a PDF's text with `unpdf` 2.1.0, the one new dependency.
- The test card shows the verdict, what it means, and **What a job board reads**: the start of the PDF's own text.
- A real application whose resume has no readable text is held back before a browser opens.

**Limitations:**

- It checks the file, not any one job board. A mixed order is a warning because some boards read the layout correctly anyway.
- Not yet run on the real Figma export; the first live test is that run.
- 794 tests.

### 2026-11-19 — Apply Agent, part 3: the review screen, and the agent goes live in its pilot

**Shipped:**

- Career page, **Atlas can submit these**: each job you gave a 👍 on a Greenhouse board. **Prepare** builds its packet (the form's real questions, your answers, your Figma resume). You review every answer, change any except the ones Atlas never answers, and press **Submit for me**, which asks once more. While Atlas is on the form the page checks for the result.
- **Needs you**: applications Atlas stopped on, each with the reason, and the buttons to apply yourself. **Applied by Atlas**: what it submitted, with what the job board said.
- The Approval Queue now holds what you apply to yourself; a job is in one place only.
- The board labels each application "Atlas applied" or "You applied"; the scorecard counts sent and answered by method.
- An application Atlas could not confirm on the page is settled when the job board's confirmation email is logged.
- The Apply Agent is live (pilot: Greenhouse only, 3 a day), with an eval suite of 47 cases gating CI, and its line on the live map.

**Limitations:**

- Still never run on a real Greenhouse form or through Browserbase. The first real application is that run; every stop before the Submit click sends nothing.
- Lever is not built. Company career pages that embed a Greenhouse form stay manual.
- 800 tests.

### 2026-11-19 — From the first live test: a Back button, Gender, and "how did you hear"

Tyler ran a live test application: the resume pulled from Figma and opened correctly. Three things came out of it.

- **Back button.** In the installed phone app a PDF opened by itself left no way back. The PDF now opens on a page inside Atlas with **Back to Career** at the top and bottom.
- **Gender.** Optional, with your other fixed answers. Set, Atlas answers a Gender question with it when exactly one choice says it plainly; unset, it declines as before. No other demographic question is ever answered.
- **How did you hear about this job?** A new answer-bank question holding your default. Used as written in a text box; in a list only when it is one of the choices.

**Limitations:**

- How an iPhone draws the PDF inside the page has not been seen on a real phone yet.
- 804 tests.

### 2026-11-19 — Resumes from Notion; the Figma update moves to Mondays

Figma's free plan allows only a handful of file reads a month, so pulling a PDF from Figma for each test and application stopped working.

- **Applications send the PDF in Notion.** The Apply Agent copies the file from the role's Resume file column (falling back to the Master Resume), keeps that copy, and checks Notion again before sending.
- **Weekly update with a notice.** The Figma to Notion text update runs on Monday evening only, and Atlas notifies you each time with what happened.
- The test card no longer has a Figma sync button; the review and viewer say where the file came from.

**What you do now:** after changing a resume in Figma, export the PDF and put it in that role's Resume file in Notion.

**Limitations:** not yet run against the real Notion files; the readability check now only confirms the text is selectable. 809 tests.

### 2026-11-19 — Follow-up emails that read like a person wrote them

Tyler saw doubled phrases and odd wording in the follow-up drafts. The causes: "I applied for the role I applied for at ..." when the role was unknown, raw dates ("2026-11-12"), titles with the posting's suffix ("Applied AI Engineer - USA role"), and one wording for every email.

- The rules now say a title the way a person would, write "November 12", handle a missing role, and rotate three wordings so a week's follow-ups differ.
- Gemini (or Claude) polishes each draft, behind the usual gate. The rewrite is kept only if it keeps the company, role and name, adds no number or link, has no doubled word or repeated sentence, and stays short; otherwise the rules' draft is used.
- Waiting drafts from the old template are written again on the next sync.

### 2026-11-19 — The phone flow: fits, a thumb, Apply for me

- **Good fits** at the top of Career lists jobs Atlas can apply to. 👍 moves one to the **Apply Queue** and prepares it in the background.
- **Apply Queue** shows the role, the posting link and the resume Atlas will send, the answers folded underneath, and **Apply for me** (which asks once).
- **Jobs applied for by Atlas** is its own list; each is also on the Applications board.
- On a phone, jobs you apply to yourself are hidden: they wait for the desktop and the Safari extension.
- Every brief and search keeps seats for jobs Atlas can apply to.

**Limitation:** the list is only as long as the Greenhouse boards on the watchlist produce, and the watchlist is empty until boards are added.

### 2026-11-19 — Status board: the iPad view

A read-only page at `/status` (Career, Status board) for an iPad on the desk. Eight stages, each a count and a column: Good fits, Apply Queue, Applied, Time to follow up, Followed up, In conversation, Rejected, No luck (silent 14 days after a follow-up). Each card says who applied, Atlas or you. It refreshes every minute and changes nothing: thumbs and Apply for me are on the phone, hands-on applications on the Mac.

### 2026-11-19 — Career in three tabs, and good fits that actually arrive

**Layout.** Career is now three tabs: **Apply** (good fits, the Apply Queue, what Atlas applied to; on a computer also the jobs you apply to yourself), **Tracker** (the status board) and **Setup** (your fixed answers and the test, with links to the answer bank, roles and resumes, watched boards and the Safari extension). The older pages still exist behind them, so no link breaks, and `/applications` stays where the Safari extension reads your answers.

**Find more good fits.** A button at the top of Apply searches the watched boards again and adds up to 10 jobs Atlas can apply to, never ones a brief showed.

**The bug behind an empty list.** The board scan kept its best 60 postings by keyword, and with 28 boards those were all senior or overseas roles, which were then thrown away: 0 fits. The scan now drops the wrong level and place before it counts to 60: 32 fits from the same boards.

**The brief.** Matches Atlas can apply to are marked "Atlas can apply", and five seats in each brief are kept for them.

### 2026-11-19 — One Good fits list, two queues, and the Career desk briefed

**The model, as Tyler put it.** Good fits is the one list he decides from. A 👍 goes to the **Apply Queue** when Atlas can apply to the job, and to **Apply on MacBook** when it cannot. There is no "Approval Queue" in Career any more; the Apply on MacBook queue folds when it is long.

**More jobs reach the Apply Queue.** A job approved on a job site is looked up on the employer's own Greenhouse board (public API, rules only). Same title, on Greenhouse's own pages, exactly one: the kit is pointed at it and Atlas can apply. Measured on his waiting jobs: 10 of 32.

**What each Career desk agent was given** (one tool, one owner):
- **Scout**: no new tool; its instructions say the posting's link decides the lane.
- **Analyst**: its report says how many postings Atlas can apply to.
- **Applications**: the employer-posting lookup.
- **Apply**: unchanged; still the only agent with Browserbase.
- **Mentor**: the workflow in its prompt, and new facts: jobs waiting in the Apply Queue, good fits waiting for a thumb, the Apply on MacBook backlog.

**Renamed the same day:** the last "Approval Queue" wording (Mission Control map, brief lines, the Mentor, agent instructions, docs) now says Apply Queue, Apply on MacBook, or "apply queues" for both. Internal names (`ApprovalQueue.tsx`, the `approvals` store, `/career#approvals`) are unchanged.

### 2026-11-19 — Folding queues, 5 + 5 in each brief, and thumbs-ups that cannot fall out of a queue

**Asked for:** every Apply list behind a dropdown that starts closed when it is long; any job with a 👍 and no application in a queue; each brief opening with two Good fits lists of 5.

- **Folds.** Good fits, the Apply Queue, Jobs applied for by Atlas and Apply on MacBook share one Show / Hide bar (`QueueFold`). A list of more than 4 starts folded; a shorter one starts open. Good fits now lists every job waiting for a thumb, not the first 12.
- **A 👍 is always in a queue.** Checked on the live data: 44 of 47 thumbs-ups had a waiting kit, all on job sites, so all in Apply on MacBook, which the phone hides. 3 from 17 Nov had no kit at all. Each sync now puts a thumbs-up with no kit back in a queue (`thumbsWithoutKit`, rules only, safe to repeat). The phone's note now says how many wait in Apply on MacBook.
- **Briefs.** A brief opens with **Good fits: Atlas can apply** and **Good fits: apply on MacBook**, up to 5 each, picked apart so neither crowds the other: 10 a brief, 20 different jobs a day. A short list stays short; it is never filled from the other kind.

**Not done yet:** the Perfect fit button, and showing the resume Atlas will use on each job.

### 2026-11-19 — Perfect fit, and the resume on every job

**Asked for:** a Perfect fit button beside the thumbs, that finds more jobs like those and has the Mentor work out how to land them; and to see the resume Atlas will use for each job, pulled from Notion.

- **Perfect fit** is a stronger 👍 (rating 2; migration `20261119233000_perfect_fit`). It queues the job, lists it first in its queue with a pill, and is audited.
- **More like it.** Ranking keeps the skills each perfect-fit posting asks for; a later posting gains 3 per shared skill, up to 12. Role, company and source count double. Rules only.
- **Mentor.** One fact per perfect fit, three at most: what it asks, what he has, what no resume shows, who he knows there, where it stands, and a default next step. The Mentor's existing three reviews a day word it; no new model call.
- **Resume preview.** "Resume: <role>" on each job in Good fits, the brief and both queues opens the PDF Notion holds for that role, in the in-app viewer with Back. The copy that is sent is still the one kept at prepare time.

**Not done:** a Perfect fit pill on the Tracker; marking a job Perfect fit from inside a queue (the button is on Good fits and in the brief).

### 2026-11-19 — One "Find more good fits" button that sets the Career desk to work

**Asked for:** one button, not two, for extra jobs on top of the briefs; 5 new jobs a press; and the press should set the Career desk agents to work.

- **One button.** "Find 10 more" and the Atlas-only "Find more good fits" are now one **Find more good fits**. The second action, its message and the Atlas-only option are removed.
- **5 a press** (was 10), never a job already shown, with seats kept for jobs Atlas can apply to (3) and a Utah posting (1).
- **The desk runs in order** (`lib/agents/careerDesk.ts`): Scout records the postings, Analyst refreshes the market report when the Scout recorded something new (otherwise today's report stands and no model is asked), Applications adds the 5. Each logs its own run and trace; one that fails does not stop the next. The button says what each did.
- **One pass per press.** The feeds are cached about half an hour, so a second pass at once would read the same postings.

**As it is today:** the Applications Agent picks by its own rules from the same feeds the Scout records. The Analyst's report goes to the Mentor and Growth; it does not yet change which jobs are picked.

### 2026-11-19 — Lists that wait on you say so, and Dead end

**Asked for:** more attention on the jobs that need action; "No luck" renamed and moved.

- **Alert bars.** Good fits, the Apply Queue and Apply on MacBook show an orange badge on their fold: "13 jobs to take action on". The Tracker marks the same stages, plus Time to follow up, with "Needs you" on the tile and the badge in the column. Show and Hide are still read aloud.
- **Dead end** replaces "No luck" and sits before Rejected, with "your work here is done" in its line.

### 2026-11-19 — Two search buttons above Good fits, one for each kind of job

**Asked for:** the search above the Good fits box, as two buttons: jobs for Atlas to apply for, and jobs to apply for on the MacBook.

- **Two buttons, above the box:** "Find more jobs for Atlas to apply for" and "Find more jobs to apply for on MacBook". They replace the single "Find more good fits" from earlier today, and match the brief's two Good fits lists.
- **Each brings up to 5 of its own kind**, never one already shown, and is never topped up with the other kind.
- Either press still runs the Career desk in order (Scout, Analyst, Applications) and says what each did.

### 2026-11-19 — Target Roles, a fourth Career tab

**Asked for:** a tab between Tracker and Setup to see the top four target roles and what they entail, chosen in Notion, refreshed weekly by Gemini and the Mentor with what each role does, its skills, tempo, projects to build and gaps to close (from Growth and the Mentor).

- **Tab:** Apply · Tracker · **Target Roles** · Setup, at `/career/roles`. The older settings page at `/roles` is now titled "Roles and resumes".
- **The four roles** are the first four by Priority in the Resumes database in Notion.
- **Each card:** demand, median pay and how much of the role you can show; the skills asked for with their share, marked shown or gap; gaps to close (flagged when also on Growth's list); a project recipe for each of the top two gaps; and the Mentor's weekly profile.
- **Weekly profile** (`lib/agents/roleProfiles.ts`): Monday evening, after the review, one Gemini call per role. What it writes is checked against the role's facts (`acceptProfile`) before it is kept. "Update now" on the page runs it on demand, twice per ten minutes at most.
- **Table:** `role_profiles` (migration `20261120010000`), read-only for the owner, kept 60 days. Demo seed: two sample profiles.

**Not done:** the milestone role; a note from the Mentor when a profile changes; the Analyst's numbers are only as fresh as its last report.

### 2026-11-19 — Atlas Autofill shows the Apply on MacBook queue

**Asked for:** set up the Safari extension for applying on the MacBook, connected to Atlas as an extension of it.

- **Xcode:** first-launch setup is done, so the converter ran and the project is at `~/engineering-projects/AtlasAutofill` (moved from `~/AtlasAutofill` on 2026-11-20). Signing still needs Tyler's Apple ID in Xcode.
- **Queue in the popup:** the extension copies the Apply on MacBook queue from Career > Apply (plain data on the page, read while signed in; no token). Perfect fits first. Picking a job opens its posting and remembers it.
- **Fill for that job:** company and role come from Atlas, not from the tab's title. The popup names the resume to attach and what the posting asks for.
- **Mark submitted:** opens Atlas at "Did you apply to this one?". Yes moves the job to Applied on the Tracker. The extension still never clicks, submits or sends.
- **Build script** keeps an existing project's signing choice and only copies the extension's files; `--fresh` rebuilds.
- A level written as a Roman numeral stays uppercase in role names ("Engineer II").

**Not verified:** in Safari itself. The popup was run in a headless browser with a pretend extension API, and the Atlas side in the demo.

### 2026-11-20 — Atlas Autofill rebuilt: reads real forms, answers with Gemini

**Asked for:** an extension that is far more hands-on and intelligent, uses Gemini, works across LinkedIn, Indeed, Glassdoor, applicant-tracking sites and companies' own sites, fills company and role accurately, and brings in the right agent (a new one only if needed).

- **Panel on the page**: every question, the proposed answer and its source, editable; Fill all; Next step; Read again; Mark submitted.
- **Reader and filler** for text, lists, search-and-pick boxes, React Select (through a small in-page helper), Yes/No buttons, radios, checkboxes and resume upload, in embedded application frames too. Read-only checks on five real forms: Fullstack (29 questions), Ashby (Anrok), Greenhouse (Arva, SoFi: 33 questions) and JazzHR (Pura).
- **Atlas side**: the Apply Agent answers (rules, then Gemini, checked), through four key-protected routes. Key made in Settings.
- **Company and role** from the page's structured data or the site's own elements, then your queue.

**Not verified:** in Safari itself, and Gemini's live answers (no AI key locally). Workday, iCIMS and LinkedIn Easy Apply have not been read on a real form.

### 2026-11-20 — People: six groups of four, and three ways to reach each

**Asked for:** People structured as Spouse, Family, Friends, Work Colleagues, Mentors and Church, four places each, names from the phone's contacts, and on each name: text, schedule a text, invite to an event.

- **Board:** six cards of four places at the top of People. An empty place takes anyone in Atlas (type to find them) or someone new. Each name shows when you were last in touch, orange when it has been longer than its category's rhythm (spouse daily, family weekly, friends and church every two weeks, colleagues and mentors monthly).
- **From the iPhone:** an "Add to Atlas" Shortcut opens the phone's own contact picker and posts the one person picked to the existing capture route (same token as the Siri capture). Atlas never reads the address book. The same person twice adds nobody.
- **Text:** opens the composer, which drafts in your voice and hands off to Messages.
- **Schedule a text:** keeps the draft and time; a phone notification at the next sync after it is due, plus an optional event in your own calendar at the exact minute. Send in Messages from the Scheduled texts list. Atlas never sends.
- **Invite to an event:** opens Google Calendar with title, time, place and the person as a guest; nothing is sent until you press Save.
- **Data:** migration `20261120080000_people_categories` adds category and place to contacts (one person per place) and reminder times to messages.

**Not verified:** the Shortcut on a real iPhone, and a reminder push on the phone (push is not set up in the demo).

### 2026-11-20 — Five target roles, owned by Atlas, with skills logged daily

**Asked for:** Atlas as the source of truth for target roles (reorderable, at most five, every other title folding into one), Notion holding only the resumes, and the skills each role asks for logged in the database to average over time.

- **The five, in your order:** Solutions Engineer, AI Engineer, Forward Deployed Engineer, Software Engineer, AI Automation Engineer. Reorder, remove or add on Target Roles; Settings links there.
- **Notion:** the sync now reads resumes only and never changes your roles. Atlas no longer writes Priority numbers or creates rows in Notion.
- **Old names** (AI + Automation, AI Workflow, GTM, Implementation, Customer Success, Developer Advocate, AI Consultant) are renamed to the role they folded into, in stored rows and wherever they are read.
- **Skills logged:** `role_skill_stats`, one row per role per day, written by the Analyst. Each Target Roles card shows the most asked skills averaged over eight weeks.
- **Mentor:** profiles all five roles each Monday (five Gemini calls); a proposal that adds a role to a full list says which role it replaces.

**Not done:** your five are set in production after this merges (one settings update). The averages start from the first Analyst run after the migration; there is no backfill from older postings.

### 2026-11-20 — Target Roles: what each role is about, and four other names for it

**Asked for:** a description under each target role, from job postings and an internet search, and the four similar job titles that fall under each role.

- **About this role:** two or three sentences per role, written once a month (first Monday, or Update now fills what is missing) from the Analyst's posting facts and a Firecrawl web search. Sources are linked with the date they were read.
- **Also called:** four other titles per role, with how many of your postings used each; the role's search list fills in when postings show fewer.
- **Why not Gemini search:** not free on the models Atlas uses, and Google's terms forbid storing its results.
- **Table:** `role_descriptions` (migration `20261120090000`), read-only for the owner, kept 400 days. Demo seed: one sample description.

**Not verified:** a live Firecrawl search and Gemini's wording (no keys locally). The first real descriptions appear after Update now or the next first Monday.


### 2026-11-20 — Target Roles: four more roles to pick

**Asked for:** the roles from the Ideal Role Mentoring page in Notion as choices on Target Roles.

- **Your four roles to pick:** AI Automation Engineer (already built in; now also matches "Business Automation Engineer" and "AI Integration Developer"), plus three new choices: AI Solutions Engineer, AI Software Engineer and Agentic Software Engineer, each with the title phrases the saved postings used (for example "Developer, AI Solutions", "Applied AI Engineer", "Agent Engineer"). `MORE_ROLES` in `lib/domain/targetRoles.ts`; `BUILT_IN_ROLES` is the full pick list.
- **Not watched until picked:** their titles overlap the five defaults, so the Scout does not record them as candidates; picking one makes it a target like any other. A tie between an extra role and a default goes to your order.
- **Not changed:** the default five, and the resumes in Notion (the new roles have no resume row yet).

**Not verified:** the picker in a browser.
- **Role fit study:** `lib/domain/roleFit.ts` holds the summary of the 17 saved postings (four role groups, best fits, gaps in order, filters). The Mentor reads it as a material in every review (`roleFitBrief`), and Target Roles shows it as a card linking the full study in Notion (Ideal Role Mentoring).
- **Main roles in one click:** Target Roles has a "Use my main roles" button that fills the list with `MAIN_ROLES` (AI Automation Engineer, AI Solutions Engineer, AI Software Engineer, Agentic Software Engineer, AI Project Manager); Save order keeps it. AI Project Manager is a new choice, and "manager" in a project, program, implementation or delivery manager title no longer counts as too senior (people-manager titles are still skipped).

### 2026-11-20 — Target Roles: only your six roles

**Asked for:** these six as the only target role options under Career > Target Roles, in this order: AI Automation Engineer, AI Workflow Engineer, Agentic Software Engineer, AI Software Engineer, AI Solutions Engineer, AI Project Manager.

- **`ROLE_OPTIONS`** in `lib/domain/targetRoles.ts` holds the six, each with every title it stands for: Solutions, Integration, Implementation and Forward Deployed titles count as AI Solutions Engineer; AI, LLM and applied AI engineer titles as AI Software Engineer; agent titles as Agentic Software Engineer; workflow titles as AI Workflow Engineer.
- **Only the six can be saved.** `optionNames` maps an older role onto the option it folded into (Solutions and Forward Deployed Engineer to AI Solutions Engineer, AI and Software Engineer to AI Software Engineer) and drops anything else, on Save order and when a Mentor proposal is approved. `MAX_ROLES` is now 6, so the Mentor writes six weekly role profiles (one more Gemini call a week).
- **Kept on purpose:** the older five stay defined so a list saved before today still reads until you save the six; the agent evals use them as fixtures. "AI Workflow Engineer" is an option again, no longer a retired name.

**Not verified:** the picker in a browser.

### 2026-11-21 — Pipeline: the reader learns four kinds, and a model reader in shadow (Phase 3, part 1)

**Asked for:** the first of Phase 3's two PRs in `docs/design-pipeline.md`.

- **Rules read four more kinds** of answer in a job email's text: an assessment, a request for times, an offer and a request for something (`readVerdict` in `lib/domain/jobMailText.ts`). Each lands on the timeline as that kind and moves the stage as the reducer says.
- **A model reader behind a switch that starts off** (Settings > Guardian controls). On: an email that arrives afterwards, from a company with an open application, that rules cannot decide, is sent once to the fast model, scrubbed and capped (`lib/domain/mailReader.ts`, `lib/agents/mailReader.ts`). At most 6 a sync and 12 a day; never in the watch.
- **Its answer is checked in code** (the sentence is in the email, a date is written there and within 90 days, the stage is a move the reducer would make) and, if it passes, **stored in shadow**: a timeline row decided by "model" that no page lists, that moves nothing and pings nothing.
- **Eval:** `npm run evals:pipeline`. 62 made-up emails. Rules alone: kind 48/62, no false interview or offer, matching 58/59.
- **Migration** `20261121120000_mail_reader.sql`: additive, safe to run again.

**Not verified:** a live model call (none was made), a real email, the migration (read, not run), and the switch in a browser against the live database.

### 2026-11-21 — Pipeline: a subject alone cannot make an interview invite

**Asked for:** close the hole left open in Phase 3, part 1: a subject that says "next steps" tracked as an interview invite when the text is a plain confirmation.

- **Once rules have read the text and found nothing, the subject cannot make an interview** (`jobKind` in `lib/domain/emailAgent.ts`). The email is a reply: on the timeline, pinged as "They replied", stage no further than In review. Unread mail still goes by its subject.
- **"Next steps" is no longer an interview word in a subject.** It is a reply, read or not, so the email is still job mail and its text decides.
- **Eval:** 67 made-up emails (5 new). Rules alone before, on the 67: kind 50/67, 3 false interviews, matching 63/64. After: kind 51/67, none false, matching 63/64.
- **Unchanged code, changed result:** the urgent ping and Inbox's move to "needs a reply" both act on an interview invite only; fewer emails are one now (`docs/design-pipeline.md`, section 13).

**Not verified:** a real email, and a live run of the watch or the sync against Gmail. No model call is involved.

### 2026-11-21 — Pipeline: unread mail waits

**Asked for:** make sure no run puts a job email on a timeline as an interview invite from its subject alone while its text is unread. Follows "a subject alone cannot make an interview invite", which left this open.

- **The tracker places an email only once its text has been read** (`kindToPlace` in `lib/domain/applications.ts`, asked by `jobMailsFrom` in `lib/agents/career.ts`). An unread one waits for the next run. The 2-hour sync, the brief's run, the Mentor's refresh, the watch and the Needs you lane all go through it; the watch's own filter is gone.
- **Chosen over** placing unread mail as a reply: each email is placed once, so that would stay a reply after its text said interview or rejection.
- **Without the app-password connection nothing from email is tracked**, because nothing is ever read. Inbox still labels job emails.
- **The catch-up ("Find past applications in Gmail")** still logs old mail that is not in the inbox by its subject, since no run will read it; a subject that says "interview" is logged as a reply there.
- **The urgent ping waits for the text too** (`urgentSince`): otherwise it would say "Interview invite" for every email the tracker now holds back.
- **The demo's sample invite comes already read**, so the demo tracks it as before.
- **Tests:** `test/unreadMailWaits.test.ts`, 15 cases; 12 fail on the runners as they were. `npm run evals:pipeline` is unchanged: 51 of 67 kinds, no false interview or offer, 63 of 64 matched.

**Not verified:** a real email, a live run of the sync, the watch or the catch-up against Gmail, and the Applications page in a browser.

### 2026-11-22 — Workflows, bots and agents: every part labeled, and a Day timeline

**Asked for:** precise labels for what Atlas is made of, so it can be described clearly to teams and hiring managers, plus a second view beside the live map for seeing Atlas end to end.

- **One question decides the kind: who picks the next step?** A *workflow* runs steps in an order fixed in code; a *bot* does one job, with code deciding every step and the model allowed one bounded judgment; an *agent* lets the model choose its own tools and next step in a loop. Definitions and everything labeled live in `lib/domain/registry.ts`.
- **Atlas today: 7 workflows, 10 bots, 0 agents.** The Chief of Staff is the orchestrator, labeled a workflow. No component lets the model choose its own steps; that is the "rules first, AI for judgment" design, now stated rather than implied.
- **Three tags beside the kind:** AI use (Rules only / AI-assisted), reach (Inside Atlas / Acts outside, only the Apply bot), trigger (Scheduled / On demand / both). Each roster entry also names its industry pattern (e.g. "Orchestrator-worker", "LLM-as-judge with RAG drafts", "Browser automation, human-in-the-loop").
- **Names:** "Calendar Agent" became "Calendar" with a Bot badge; prose says "the Calendar bot". Ids, tables and the activity log's `agent` column are unchanged. Model-facing prompts (`agents/*/instructions.md`, `lib/ai/prompts.ts`) and code comments were left as they were.
- **Where it shows:** a "What Atlas is made of" card on Mission Control and the Team page; kind badges on dashboard cards and live-map boxes; the Team page lists every workflow with its steps, every bot with its jobs, the (empty) Agents section and the infrastructure jobs.
- **Day timeline** (Mission Control → Timeline): today, 6 AM to 10 PM, one lane per workflow (planned times, red when a planned run left no log) and one per bot (every run it logged, colored by result, outlined when you started it). Read from the activity log; adds no data.
- **Old history still replays:** the live map matches both "Ask the Email Agent" and "Ask the Email bot".
- **Tests:** `test/registry.test.ts` and `test/timeline.test.ts`.

**Not verified:** the timeline against a live day's log (checked in demo mode only).

### 2026-11-22 — Scout: two more feeds, three more job-board systems, and Utah suggestions

**Asked for:** more data gathering for the job-market pipeline. Chosen: free public APIs only (no crawler, no Firecrawl credits), plus a Utah starter list you approve.

- **Himalayas** (public search API, no key): one search per target title, up to 6, U.S. and full-time, newest first, cached six hours. Its terms: credit Himalayas, link to the listing, don't pass jobs on. It holds 121k jobs, so the full feed is not read.
- **Remotive** (public API): software development, DevOps and AI categories, cached six hours. Its terms: credit Remotive and link to the listing; listings arrive 24 hours late.
- **Watchlist boards:** SmartRecruiters (Posting API, U.S. postings, newest 100), Workable (jobs widget feed) and Recruitee (Careers Site API on the company's subdomain; the slug is checked before it becomes a host, passed per call rather than allowlisted by wildcard).
- **Migration** `20261122140000_more_job_boards.sql`: widens `job_watches.board` to the six boards. It drops the old check by what it checks, so it is safe to run twice; it is applied automatically a few minutes after merge, so do not run it by hand.
- **Utah suggestions** (`lib/domain/utahSeed.ts`): 14 companies whose boards were read on 22 Nov 2026 and list Utah or U.S.-remote jobs. Two same-name boards that were other companies were left out. Shown on Jobs under the watchlist; nothing is watched until you press Watch.
- **Unchanged:** the Scout is still a rules-only bot, $0 a run, and never reads LinkedIn, Indeed or Glassdoor.
- **Tests:** `test/moreSources.test.ts`, with response shapes copied from each API.

**Not verified:** a live sync with the new sources against the real database.

### 2026-11-22 — Tech market, phase 1: data you can trust

**Asked for:** a clear snapshot of the current tech job market, built as a senior data engineer would. Phase 1 of 3 (approved): the data foundation. Phase 2 is the Market page and the Pipeline view; phase 3 adds national benchmarks (FRED, BLS JOLTS).

**What the audit found** in the existing market data (`market_postings`): it records only your target roles, it drops senior titles before recording (selection bias), it counts one job listed on two boards twice, it keeps no history past 30 days, and its sources lean remote. It was never a market snapshot. It is unchanged here and still feeds the Analyst, Mentor and Applications.

- **A layered pipeline** (`lib/domain/techMarket.ts`): raw postings, never stored → `tech_postings`, one cleaned row per job → `market_daily`, one summary row per day, role family, seniority and region.
- **Every U.S. full-time tech posting**, not only your roles, labeled with one of 8 role families, the level its title states ("unstated" when none: most titles state none), work mode, region and yearly pay (hourly × 2,080; under $20k or over $1M thrown out). Senior roles are recorded.
- **Duplicates merged across sources** (entity resolution): the same company, title and region is one job; the row lists every source. A posting without a company keeps its own key, so two unnamed postings are never merged.
- **Daily summary**: active (seen in the last 7 days), new, gone (last seen exactly 7 days ago), remote, with pay, median pay. Recomputed from the stored rows each run, so re-running a day gives the same rows (idempotent).
- **Data quality per run** in `market_quality`: read, tech, duplicates, not full-time, outside the U.S., share with pay, skills and a stated level, per source; and whether the 4,000-row cap was hit.
- **Retention**: postings 60 days after last seen; the summary is kept for good (at most a few hundred small rows a day), to stay inside Supabase's free 500 MB.
- **Broader sampling**: four role-family searches on Himalayas, and every job on the watched boards (from the same cache the board scan fills, so no extra requests).
- **Migration** `20261122160000_tech_market.sql`: three tables with owner-only, read-only RLS, written by the Scout's service store. Additive and safe to run twice; applied automatically a few minutes after merge, so do not run it by hand.
- **Demo**: two weeks of invented summary rows, marked as such in `seedMarketDaily`.
- **Tests**: `test/techMarket.test.ts`, 34 cases.

**Not verified:** a live sync writing to the real database.

### 2026-11-22 — Tech market, phase 2: the Market page and the Pipeline view

**Asked for:** a clear snapshot of the tech job market, and a clearer picture of the data pipeline behind it. Phase 2 of 3; it reads the tables phase 1 added.

- **Market page** (Career → Market, `/career/market`), with one filter row (All U.S. / Utah) that scopes every figure:
  - Headline tiles: active postings with the change against 7 days earlier, new and gone this week, median pay, remote share, Utah.
  - Demand by role family as small multiples (one line per family), your target roles' families first in green, the rest grey. One hue, so nothing rests on telling eight colors apart.
  - Median pay by role family and by level as ranked bars, each with its sample size; under 20 postings is marked "small sample". Medians come from postings, never averaged from other medians.
  - Level mix, work mode, the skills asked for most, skills rising (this week's share against the three weeks before, shown only with 20+ postings in both), and the companies hiring most.
  - Every chart has a "Show as a table" view. A closing note says what the figures rest on: the sample size, every source and its count, the days of history, and that it is a sample, not the whole market.
- **Pipeline view** (Mission Control → Pipeline): each stage from the latest Scout run (read → tech, full-time, U.S. → duplicates merged → stored → daily summary → Market page) with its count and what it set aside; postings per source; four data-quality checks (states pay, names a skill, states a level, sources answering) flagged when below a floor; and the your-roles pipeline alongside.
- **Logic** in `lib/domain/marketSnapshot.ts` and `lib/domain/pipelineView.ts` (pure); tests in `test/marketSnapshot.test.ts`.

**Not verified:** with live data in the real database (checked in demo mode against the live sources).
- **Two data fixes found by reviewing the live page:**
  - *Company cap.* Watched companies' boards are read in full, so OpenAI, Databricks and Anthropic were 71% of the sample and set the "market" pay and levels. Shares and medians now count each company at most 25 times (`COMPANY_CAP`); counts of postings stay uncapped, and the page says so.
  - *"Security & compliance" in 42% of postings.* The skill matched the bare words "security" and "compliance", which boilerplate uses ("Social Security", "comply with"). It now matches specific terms (SOC 2, HIPAA, ISO 27001, application security, …): 7% on the same data. This also corrects the Analyst's skill counts. Tests and evals pass.
  - Skill shares now rest on postings that came with a description (company boards give a title only), and the page names that base.

### 2026-11-22 — Tech market, phase 3: national benchmarks (BLS now, FRED ready)

**Asked for:** national context for the market snapshot. The BLS key is added in Vercel; FRED is held for now.

- **Series** (`lib/domain/benchmarks.ts`): BLS JOLTS job openings, openings rate, hires and quits for the information sector, plus total U.S. openings for context; and, once `FRED_API_KEY` is set, Indeed Hiring Lab's software-development postings index from FRED (the closest public measure to what the Scout records).
- **The Scout reads them once a week** (Monday evening run, or any evening while none is stored), as its own logged run, "Read national benchmarks". Rules only, $0, two requests a week. BLS answers without a key too, with lower limits; FRED is skipped, and says so, without its key. A failure is logged and never fails the evening run.
- **Keys:** server-only, listed in `.env.example`. BLS's goes in the request body. FRED's must go in its URL; `safeFetch` never logs URLs (errors name the host only). Both hosts are on `ALLOWED_HOSTS`.
- **Stored** in `market_benchmarks`, one row per series and period; a later read replaces a revised value (BLS revises its preliminary month). Migration `20261122180000_market_benchmarks.sql`: owner-only read RLS, additive, re-runnable; applied automatically a few minutes after merge, so do not run it by hand.
- **Market page → National trend:** each series as its own small chart with its latest value, the change against the period before and a year before, and "preliminary" where BLS says so. Never on Atlas's scale or added to its counts: different methods and coverage. The page says JOLTS runs about two months behind, and that a side-by-side comparison becomes meaningful once Atlas's own history covers the same months.
- **Tests:** `test/benchmarks.test.ts`, with the BLS shape copied from a real response.

**Not verified:** a live run with the BLS key from Vercel (the parser was checked against a real keyless BLS response).

### 2026-11-22 — More data, $0: posting details, Hacker News fixed, official pay by occupation

**Asked for:** implement the recommended job-market sources: public APIs first, crawlers only for gaps.

- **Posting details from the watched boards** (`lib/integrations/jobBoards.ts`): skills and pay are read from each posting's description, and the description itself is never kept. Greenhouse sends descriptions only with `?content=true`, which makes a large board about ten times bigger (Databricks 0.8 MB → 9.8 MB), so it is asked once a day, at the first sync (owner's choice); later syncs read titles and the stored postings keep the morning's pay and skills. Lever (pay range, work mode, job type) and Ashby (salary component, with `includeCompensation=true`) send them every time. Hourly pay × 2,080.
- **Measured on a live demo sync:** postings stating pay 8% → 70%; naming a skill 12% → 78%. Every data-quality check now passes.
- **Hacker News fixed:** the search picked the newest story whose title started "Ask HN: Who is hiring?", and on 19 Nov another user posted a joke thread with that title (1 comment) after the real one (380). It now searches the `whoishiring` account only: 241 postings instead of 1.
- **Official pay by occupation (BLS OEWS)**, chosen by the owner: sales engineers (the match for Solutions Engineer) and software developers, U.S. and Utah, yearly median. Read in the weekly benchmark run (no new request: same BLS call) and shown in National trend.
- **Not built, and why:** Adzuna and USAJobs need keys (USAJobs also requires the owner's email in each request); Arbeitnow lists mostly European jobs; Crawlee, Scrapy, Apify and Common Crawl add dependencies for problems Atlas does not have yet; Firecrawl for custom career pages comes with the board finder later.
- **Tests:** `test/dataDetails.test.ts`.

### 2026-11-22 — The Data Pipeline section, with the Gemini Data Mentor

**Asked for:** a Data Pipeline section to configure the data gathering one step at a time, with a Gemini mentor recommending improvements. Decisions along the way: its own sidebar item; all four controls (sources on/off, quality floors, company cap, detail schedule).

- **Data Pipeline page** (`/data`, in the sidebar after Mission Control):
  - *Setup, one step at a time:* watch 10+ companies, read posting details, choose sources, add national benchmarks, Adzuna (optional), set floors and the cap. Each step's "done" is worked out by rules from the real numbers (`setupSteps` in `lib/domain/dataPipeline.ts`); only the current step is open, with why it matters, where it stands, its one action and "Ask the mentor about this step".
  - *Sources:* every feed with an on/off switch and its last-run counts. A source turned off is not read at the next sync. Audited.
  - *Floors, cap and details:* the quality floors Mission Control flags against, the company cap the Market page uses, and the detail schedule (once a day, every sync, or off). The schedule change is audited.
  - Keys are shown as set or not set, and are never entered in Atlas.
- **Data Mentor** (`lib/agents/dataMentor.ts`), a job of the Mentor bot, run from the page. An evaluator loop: Gemini drafts up to 4 pieces of advice from the pipeline's facts → rules check that each cites known facts and writes no number they lack → one refining call with the problems listed when anything was dropped. Off, over the daily AI limit, slow or wrong → the rules write the advice. It sees numbers and source names only (no scraped text, so a posting cannot instruct it), recommends free steps only, and never changes a setting. The last review is kept on your settings.
- **Settings** live on the existing settings record (`dataPipeline`), read through `pipelineConfig()`, which fills defaults so a bad value never stops a sync. No migration.
- **Tests:** `test/dataPipeline.test.ts` (steps, defaults, the number check, and the draft → check → refine loop with the model mocked).

**Not verified:** the mentor with a live Gemini key (checked in demo mode, where it runs on rules).

### 2026-11-22 — Board finder (Firecrawl, last) and Adzuna (free key)

**Asked for:** the board finder crawler and an Adzuna adapter. Decisions: Adzuna on the free key only.

- **Board finder** (`lib/domain/boardFinder.ts`, `lib/agents/boardFinder.ts`), on Data Pipeline (setup step 1) and Setup. Rules first, Firecrawl last:
  1. Free: try the company's likely board names (from its name and domain, at most 3) on all six job-board APIs.
  2. Only when none answers and you gave a website: Firecrawl maps the site to find the careers page (1 credit), then reads that one page's HTML (1 credit) and finds the board it links to, embeds or loads. A map lists the site's own pages, so the outside board's link is found on the careers page itself.
  3. Every board found is confirmed by reading it: open jobs, U.S. and Utah counts. Nothing is watched until you press Watch.
  - Credits count against the same monthly Firecrawl budget as posting reads (900 of the free 1,000); with fewer than 2 left it says so and does not call Firecrawl. Sites whose terms forbid automated reading are refused before any request. Five searches a minute at most. Firecrawl use is audited; each search is logged as a Scout run.
- **Adzuna** (`parseAdzuna` in `lib/integrations/jobFeeds.ts`), on the free key only: 4 searches a day (software, data, DevOps and solutions engineering, last 7 days), at the first sync. Its terms allow personal research with credit, so the Market page says "Job and salary data in part from Adzuna" whenever its postings are in the sample. A salary Adzuna estimated (`salary_is_predicted`) is not posted pay and is left out. Keys (`ADZUNA_APP_ID`, `ADZUNA_APP_KEY`) are server-only; the key travels in Adzuna's URL, which `safeFetch` never logs. Until the key is set, Adzuna shows as "not set up" and is not counted as a source that stopped answering.
- **Tests:** `test/boardFinder.test.ts` (guesses, HTML matching, the Firecrawl fallback and its budget, Adzuna parsing).

**Not verified:** Adzuna with a live key (none set yet); the Firecrawl fallback live (tested with mocked calls, to spend no credits).

### 2026-11-22 — The Data Map, and two job maps (Utah pins, remote USA)

**Asked for:** a visual display of the data pipeline ("a map"), then both kinds: a Data Map, and a map of where the jobs are. Decisions: Utah local jobs as pins; remote jobs on a separate U.S. map, pinned where a job is limited to some states, with the rest counted as "anywhere in the U.S.".

- **Data Map** (`lib/domain/dataMap.ts`, `components/client/DataMap.tsx`), on Data Pipeline and Mission Control → Pipeline, in the Live Map's style: sources → the Scout → cleaning → stored tables → the pages that show them. A line's width follows the postings along it in the latest run, so where data comes from and where it is set aside can be seen at a glance. Each box shows its live count and a status dot (answering, idle by design, off, did not answer); sources you turned off are greyed. The Scout box glows while it runs (the same live feed the Live Map polls), "Replay the last run" walks the seven stages in the order the code runs them, and selecting a box dims the rest and opens its details. The live feed carries no step details (they stay off screens by default), so the replay follows the code's order with the last run's counts.
- **Where the jobs are** (Market page, `lib/domain/jobMap.ts`, `components/client/JobMaps.tsx`):
  - *Local jobs in Utah:* a pin at each city an on-site or hybrid posting names, sized by count; select a pin for its jobs, with links. Wasatch Front (Payson to Bountiful) and All of Utah views, a Home marker at Salt Lake City. Utah's outline is drawn from its border coordinates, with true proportions; no map file. A job that names no city is listed, never pinned at a guessed place.
  - *Remote jobs in the U.S.:* a tile map (each state one square, so small states stay readable and tappable). A remote job limited to some states shows in each; one open across the U.S. is counted and listed under "Anywhere in the U.S.". A remote job that lists offices but says "Remote - US" or "anywhere" counts as anywhere, not as its office states.
- **New fields** on each tech posting: its Utah city and the states it names (`lib/domain/places.ts`: 48 Utah cities with coordinates; state names and codes, without reading words like "IN" or "OR" as states, and without reading "Virginia" inside "West Virginia"). Migration `20261122200000_tech_postings_places.sql`: two additive columns, re-runnable; applied automatically a few minutes after merge, so do not run it by hand. Until it is applied, the market record step logs a failure and the your-roles record carries on; existing rows fill in at the next sync that sees them.
- **Tests:** `test/maps.test.ts`.
- **Two stats sections** (owner's request, tabs chosen): the Market page opens on **Utah local** (Utah jobs that are on-site or hybrid), then **Remote U.S.** (every remote job) and **Whole market**. Each tab's figures (headline, trends, pay, levels, skills, companies) come only from its own jobs, with its own map; the national trend sits on Whole market. Utah local shows hybrid share and cities; Remote shows the share open anywhere and companies hiring. Trends use the daily summary's remote counts (local Utah = active minus remote there); new and gone this week come from the postings, so each tab counts only its own.

### 2026-11-23 — Utah job sources: the Utah company list, BambooHR and ApplicantPro

**Asked for:** more Utah job sources (1, 2 and 3 of the recommendations). Checked live first: the Silicon Slopes job board and utahtechjobs.com no longer resolve; the State of Utah (Cornerstone) and jobs.utah.gov have no public feed; Built In blocks much of its job listings to robots. So the gain is from employers' own boards.

- **Utah companies** (a new source on Data Pipeline, on by default): the Scout reads the 14 Utah tech companies in `lib/domain/utahSeed.ts` (Qualtrics, Pattern, Filevine, Lucid and others) every sync, **for the market record only**: their jobs never show as your matches, and a company you watch is read once, as a company board. Postings are tagged `· Utah list`, so the Data Map, the run's quality record and the Market page count this source apart. Decision: market-only, not added to the watchlist, so 150+ postings feed the stats without flooding your matches. The per-company cap (25) keeps one big hirer from tilting medians and shares.
- **BambooHR** board reader: the careers list its hosted careers page loads (`{slug}.bamboohr.com/careers/list`). Gives title, place, remote and job type; no description, so no skills or pay.
- **ApplicantPro** board reader (a Utah-made hiring system): each employer's RSS feed (`{slug}.applicantpro.com/feeds/rsswidget.xml`). Gives title, link, description (skills) and often a salary (yearly pay); no location field. Any subdomain answers, so an empty feed counts as no board.
- Both are on the subdomain of the company: the slug is checked before it becomes a host, and only that one host is allowed for the read (as with Recruitee). Both can be watched, and the board finder tries them and spots them in careers pages. Migration `20261123090000_bamboohr_applicantpro.sql` widens the allowed `job_watches.board` values only; re-runnable; applied automatically after merge.
- **Measured (demo mode, live sources):** Utah companies 575 postings read, 132 tech; Utah local on the Market page went from 28 to 49 jobs, 5 cities, 12 companies (Lehi 7 → 21 jobs). Live reads: BambooHR (Kiln, Lehi) 11 jobs; ApplicantPro (Utah State Courts) 6 jobs with pay.
- **Few Utah tech employers use BambooHR or ApplicantPro boards today** (of about 90 names tried, Kiln and Skullcandy, neither mainly tech). The readers are there for the watchlist and the board finder; none were added to the Utah list.
- **Tests:** `test/utahSources.test.ts`.

### 2026-11-23 — Market: International tab, five types of engineer, and "Under the hood"

**Asked for:** see under the hood of the build, with clear labels for the parts and tools behind each figure; job stats by type of tech engineer, top 5; an International tab for remote jobs that hire Americans. Decisions: International is split out from Remote U.S. (no overlap); five fixed engineering types; an "Under the hood" note on every card.

- **International tab** (`?view=intl`): remote jobs open beyond the U.S. that still hire people in it. A new region, `global`, in `regionOf()` (`lib/domain/techMarket.ts`): worldwide, global, international, the Americas or North America, or the U.S. named with another country ("US or Europe", "United States, Canada"). A Utah city or a U.S. state code with nothing worldwide stays local or U.S.; "Anywhere" alone stays U.S.; another country only is still left out. A job open worldwide is recorded as remote. Headline: jobs, median pay (U.S. dollars only), share of all remote jobs, companies hiring.
  - **Remote U.S. now means remote jobs open only in the U.S.**, so its count drops by the international ones; Utah local, Remote U.S. and International do not overlap, and Whole market has all three. The worldwide jobs left the Remote U.S. map.
  - A global job keeps the identity it had as a U.S. job (the fingerprint maps global to us), so stored rows are updated in place, not doubled. Daily summaries before 23 Nov count these jobs under Remote U.S.; the International tab says so.
  - Migration `20261123100000_market_global_region.sql` allows `global` in `tech_postings.region` and `market_daily.region` only; re-runnable; applied automatically after merge.
- **Jobs by type of engineer** (`lib/domain/engTypes.ts`), on every tab: Software engineering; Data and AI/ML; Cloud, DevOps and infrastructure; Security; Solutions and IT. Fixed groups of the role families, ranked by jobs, each with share of engineering jobs, median pay, remote share, top skills, the companies hiring most and the level stated most. Product and program roles are counted apart. Job counts are not capped; pay and shares cap each company at 25.
- **Under the hood** (`lib/domain/provenance.ts`, `components/UnderTheHood.tsx`): a closed note at the foot of every Market card, with how the figure is calculated, its sample and update time, and every part behind it labeled by kind (Workflow, Bot, Reader, Rules, Table, Math, Public data) with its file. A page-level "Under the hood: this page" lists the whole path, from the 2-hour sync to the tables. A test checks every file named exists, so the labels cannot drift from the code silently.
- **Measured (demo mode, live sources):** International 196 jobs (24% of remote jobs), 96 companies; Remote U.S. 630; by type on International: Software 110, Cloud/DevOps 25, Data and AI/ML 20, Solutions and IT 18, Security 13. No sideways scroll at 375px.
- **Tests:** `test/marketTypes.test.ts`.

### 2026-11-23 — The five engineering types, data-backed, with an AI check of the labels

**Asked for:** the engineering types backed by data, with the stats that support the most common categories; AI to judge the category match. Decisions: keep the five types and add evidence; the AI check runs daily in the evening run and on "Check now".

- **Why these five** (`lib/domain/engEvidence.ts`), under "Jobs by type of engineer" on every Market tab: over the last 30 days of that tab's jobs, each type's jobs and share of all tech jobs, how many companies and sources list it, new jobs in the last 14 days against the 14 before, and the most common specialties inside it, read from titles by rules (for example Back end, Full stack, Mobile; Data engineering, Machine learning and AI; Site reliability, Platform; Application security, Security operations; Solutions and sales engineering, IT support). It also says how much of the tech market the five cover together, and how lopsided they are.
- **AI check of the labels** (`lib/domain/typeCheck.ts`, `lib/agents/typeCheck.ts`), a job of the Mentor bot: 40 of this week's jobs, an even share of each label in a stable daily sample, in one model call (Gemini on the free tier, gated by the daily AI limit). The model sees only titles and company names, never the rules' label, and picks one of seven labels (the five types, product and program, not tech); its answer is validated against a schema. Atlas shows the agreement rate, agreement per label (also on each type's card), and up to 12 jobs where the AI differs. **Display-only:** the AI never changes a label; a difference is a hint to fix the rules. Daily in the evening run (last step) and on "Check now" (three a minute at most); saved beside the Data Mentor's review. With no AI key, over the limit, or under 10 jobs, it says why and makes no call.
- Under the hood notes for both, with a new part kind, "AI model".
- **Measured (demo mode, live sources, Whole market):** the five cover 89% of 1,710 tech jobs; Software 710 (42%), Solutions and IT 314, Data and AI/ML 238, Security 147, Cloud/DevOps 121.
- **Not verified live:** the AI check against a real model (no AI key in the local demo; covered by tests with the model mocked). It runs at the first evening run after merge, or with Check now on the Market page.
- **Tests:** `test/engEvidence.test.ts`.

### 2026-11-23 — Career Map: 15 data-backed paths, junior to staff, rebuilt weekly by the Mentor

**Asked for:** the Mentor, with Gemini, to give a roadmap for each role, junior to senior, with the steps and common requirements; three common paths for each of the five engineering types, with stats and salaries; all data-backed and updated weekly. Design approved with these choices: its own Career Map page; the three paths are the top three specialties in the data; years of experience and certifications read from postings; a weekly snapshot table.

- **Career Map page** (`/career/map`, in the Career tabs and linked from Growth): a tab per engineering type; for each, its three most common specialties in the last 60 days of jobs (the type's catch-all only when fewer than three have jobs). Each path is a ladder, Junior, Mid, Senior, Staff and lead, and each rung shows jobs, median pay and the middle half of pay, years of experience asked (median), the skills asked for most, skills new at that level (10+ points more than the level below), certifications named, the companies hiring most and the remote share, each with its sample and a small-sample flag. Paths in your target roles' families are marked. The type's official median pay for the closest occupation (BLS OEWS, U.S. and Utah) is shown when read.
- **Levels:** the level a title states; when it states none, the years the posting asks for (0-2 Junior, 3-4 Mid, 5-7 Senior, 8+ Staff and lead). Each rung says how many it placed by years. In the demo this cut Solutions jobs with no level from 135 of 218 to 56.
- **Requirements** (`lib/domain/requirements.ts`): years of experience ("5+ years of experience", "seven years", the largest asked) and 16 certification groups (AWS, Azure, Google Cloud, CKA, Security+, CISSP, CCNA, security clearance and others), read from descriptions; only the facts are kept. Migration `20261123120000_career_map.sql` adds `years_min` and `certs` to `tech_postings` (additive) and the `career_maps` table (one snapshot per week; you read, only the server writes, like `market_benchmarks`). Applied automatically after merge.
- **Steps up each path** (`lib/agents/careerMap.ts`, a Mentor job): rules build the facts; Gemini writes 1 to 3 steps per move up, one call per type (5 a week), seeing only counts, pay, skill and certification names. A step with a number not in the facts, or a link, is dropped and the rules' step for that move stands (rules write from the skills new at the next level, the years asked and the leading certification). Each move is labeled "AI, checked" or "Rules". Display-only.
- **Weekly:** Monday's evening run (after the BLS read), or "Update now" (two a minute at most). The page shows what changed since last week (a path new to the top three, a level's median pay moving 5% or more, a new top skill). Before the first weekly map, the page shows a preview built by rules.
- **BLS OEWS:** six more series, U.S. and Utah median pay for data scientists, information security analysts, and network and computer systems administrators, so each type has its closest official occupation.
- **Measured (demo mode, live sources):** 15 paths from 1,710 jobs; Security's paths are Security operations, Application security, and Cloud and infrastructure security; Solutions and sales engineering has 218 jobs, median pay $186k (68 state pay). No sideways scroll at 375px.
- **Not verified live:** the AI-written steps (no AI key in the local demo; covered by tests with the model mocked), and the new BLS series (read at the next Monday evening run).
- **Tests:** `test/careerMap.test.ts`; the Career tab tests now include Career Map.

### 2026-11-23 — The QA review's findings (week ending 22 Nov)

**Asked for:** address the QA Agent's findings. Its report had 13 (2 high, 5 medium, 6 low). Read from the live `qa_reports` and `agent_runs` tables (read-only).

- **"The 2-hour sync ran too few times: Mon 0 of 6" was the QA's own bug.** Monday had 7 scheduled syncs. A week of runs is 1,178 rows, and the database API returns at most 1,000 per request, newest first, so Sunday and Monday were cut off. `agentRuns.since` now reads a page at a time; the week's run counts in every finding were short the same way.
- **Runs that stopped mid-run now say where.** A watchdog (`lib/agents/watchdog.ts`) fires 4 seconds before a run's deadline and logs the step it was in, with the trace so far; the tracer now knows the step running now. On the Chief of Staff's briefs and the 2-hour sync. (Tuesday's Morning Brief and a Thursday Sync now stopped with no trace; Vercel's free plan keeps an hour of logs, so their cause could not be read after the fact.)
- **Sync now had 60 seconds; the sync needs more.** It runs from Mission Control, whose limit was 60 seconds, with no deadline: a slower sync was cut off silently. Mission Control's limit is now 300 (the same as the scheduled sync), and Sync now passes the deadline, so model calls and the watchdog know it.
- **Apply: "Browserbase could not be reached" (9 runs) hid the cause.** Every answer Browserbase gave that was not a key, plan or rate-limit error was reported as an outage. A refusal now keeps Browserbase's status and message ("Browserbase refused to start the browser. (400: ...)"), and the Apply run log says why a run did not start. The next press of Apply for me will show the real reason.
- **Evals that failed all week, fixed by rules:**
  - Calendar: "Pick up Dr Pepper for the party" was read as a doctor's appointment; "Dr" no longer matches before "Pepper".
  - News, same story: aliases ("Federal Reserve" is "Fed"; "holds rates steady" is "rates unchanged"; "executive order" is "order"), two-letter acronyms like "AI" kept as key words, and a template check (near-identical headlines whose lead names a different company the other never mentions are two stories: Microsoft and Amazon earnings).
  - Ask Atlas: query expansion for everyday words ("owe" also searches due, bill, premium; "catch up" searches touch, contact; "shut off" and "connection" search interruption, internet). Search by meaning already covered these in production; keyword search now does too.
  - The three suites now pass in full: calendar 32/32, same story 26/26, retrieval 48/48.
- **Yours to do (not code):** 6 applications with no role (Applications, Fill in the role); 35 apply-queue items older than 3 days (clear the oldest, or 👎 the ones you no longer want). Gemini's first-choice model (gemini-3.8-flash) was busy for 61 of 62 calls, and the fallback answered every time: setting ATLAS_GEMINI_MODEL_WRITER to gemini-3.5-flash-lite in Vercel stops calls waiting on the busy one.
- **No change needed:** Figma rate-limited one resume sync; the next run retried.
- **Tests:** `test/qaFixes.test.ts`; `test/knowledge.test.ts` now uses a question that query expansion cannot reach, to keep showing what search by meaning adds.

### 2026-11-23 — Fixed profile answers for forms (Atlas Autofill and the Apply bot)

**Asked for:** phone country code always 1; country United States (USA as the second choice); city Salt Lake City; school, degree, discipline and graduation year always the same answers.

- **Kept in Settings, not code** (owner's choice): Career > Setup > "Your profile on forms", beside the eligibility answers, saved in `settings.careerProfile`. Before anything is saved, the country is United States and the code is 1; the rest waits for you. The city falls back to the answer bank's.
- **Rules, no AI** (`lib/domain/formProfile.ts`, used by `buildPacket`, so both Autofill's "Help me apply" and the Apply bot): in a box the answer is typed as saved (`+1` for the code). In a list Atlas picks the choice that says the same thing: United States, else United States of America, else USA or US; "Bachelor of Science", else "Bachelor's Degree" or BS, never a Bachelor of Arts; your country's +1, never Canada's; "Salt Lake City, UT" for Salt Lake City. When no choice matches, the question waits for you rather than take a near miss.
- **Never used for:** citizenship, nationality or work-authorization questions about a country, or an employment end date (a graduation year only answers an end date in the education section). Month fields are left for you.
- **Tests:** `test/formProfile.test.ts`.

### 2026-11-23 — AI Software Engineer is now Software Engineer 1

**Asked for:** rename the AI Software Engineer target role (and its resume row) to Software Engineer 1, counting any title with "Software Engineer" in it except workflow, automation and solutions work.

- `ROLE_OPTIONS` in `lib/domain/targetRoles.ts`: the role is **Software Engineer 1**. It keeps its AI engineer titles and adds Software Engineer, Software Engineer I and Software Engineer 1.
- **Excluded words**, a new `exclude` on a target role: a title with workflow, automation or solutions in it is never Software Engineer 1 (`roleFor` in `lib/domain/careerAgent.ts`). Other roles' own longer titles still win (Agentic Software Engineer, Forward Deployed Software Engineer). Staff, lead and principal titles stay out as before; senior ones follow the level rule as before.
- **Old names still read:** a saved list or Notion row named AI Software Engineer or AI Software Engineering reads as Software Engineer 1 (`RETIRED_ROLES`, `OPTION_FOR`).
- The Notion Resumes row is renamed after this merges, so the Scout never reads a name the live code does not know.

### 2026-11-23 — Not a Good Fit in the apply queue

**Asked for:** mark a job in the apply queue "Not a Good Fit" so it leaves the job hunt funnel and Tracker.

- **The button replaces Reject** on application items in both queues (Apply Queue and Apply on MacBook): `ApprovalButtons` calls `markNotAGoodFit` (zod-checked id).
- **What it does** (`notAGoodFit` in `lib/applyQueue.ts`): closes the kit, dismisses the match and rates it 👎, so later matches like it rank lower. The Tracker, the Good fits list and the sync's re-queue of 👍 jobs all skip it from then on. Audited as `career.not-a-fit`.
- **Nothing is deleted:** the records stay, out of every list. A job already applied to keeps its place on your board; only its kit closes.
- **Tests:** `test/thumbs.test.ts` (queue, Tracker, the sync, a second press, an applied job).

### 2026-11-23 — Software Engineer 1 first, aimed at junior and associate roles

**Asked for:** Software Engineer as the #1 role (the most listed), aiming at junior or associate roles.

- **Your order:** Software Engineer 1 is Priority 2 in the Notion Resumes database (right after the Master Resume), so Atlas syncs it as your first role; `ROLE_OPTIONS` lists it first too, for "Use my main roles".
- **Level:** Junior, Associate, Entry level, New grad and Engineer I rank well ahead (+12, was +4). Engineer II is now mid level, neither up nor down (it used to count as early). Engineer III and above rank well behind (-15, was -6). Senior titles stay out of your matches, as before (`lib/domain/careerAgent.ts`).

### 2026-11-23 — The Career Map waits for the per-minute AI limit

**Asked for:** spread out the Career Map's Gemini calls. Monday's live run log said "steps by Gemini and rules (Too many AI requests this minute.)".

- **The cause was Atlas's own limit, not Gemini's.** Every model call passes `takeAiCall` (`lib/ai/budget.ts`), which allows 10 calls a minute per server instance across all agents. The evening run's agents (resume sync, the Mentor's review, role profiles, the type check) used up the minute, so the Career Map's later calls, one per engineering type, were refused and those types kept the rules' steps.
- **A scheduled run now waits for the minute to turn.** `takeAiCallPaced` asks the gate; when the per-minute limit refuses, the refusal now says how long until it allows calls again (`retryAfterMs`). A scheduled run (with a deadline) waits that long once and asks again, but only when the call and what follows it still fit before the deadline (`paceWait` in `lib/domain/deadline.ts`). The wait shows in the run's trace. The daily limit and the AI switch are never waited for.
- **Update now does not wait.** Someone is waiting on the button, so a refusal still means the rules' steps, as before.
- **Tests:** `test/aiPacing.test.ts`. Not verified live until next Monday's evening run.

### 2026-11-23 — Your six roles in the Data Pipeline (part 1 of 3)

**Asked for:** split the pipeline into Software, Automation, Workflow, Solutions, Agentic and Forward Deployed Engineer, with counts per role, a graph, and the companies hiring most, in order.

- **Sorting** (`lib/domain/roleLens.ts`): each job's title, at any level, by your roles' own title lists (`ROLE_OPTIONS`) and their excluded words; Software Engineer also counts Software Developer, Full Stack, Backend and Frontend titles. Longest phrase wins. A title no rule places is Other, for Gemini to judge in part 3.
- **Data Pipeline page:** "Your six roles": a bar per role (jobs seen in 30 days, share of all tech jobs, new in 14 days; the trend once there are 4 weeks of data), the 15 companies hiring most for your roles with their split by role, and the top 5 companies and places for each role.
- **Mission Control, Pipeline:** a "Your six roles" stage after Stored, with a lane per role and Other set aside.
- **Next:** part 2, a card per role (pay by level, skills, years, certifications); part 3, Gemini for unclear titles, projects to build and what to know.

### 2026-11-23 — Apply on your MacBook only: the Apply bot is removed

**Asked for:** the "Atlas applies for me" bot was not working well. Drop it, focus on walking Tyler through applying on his MacBook, and make the Apply Queue only for that (no more "Apply on MacBook" wording). Approved plan, PR 1 of 3 (2: an apply brief per job; 3: teams, hiring manager, news).

- **Removed:** the Apply Agent's prepare and submit steps (`lib/agents/apply.ts`, `lib/applyPrepare.ts`), the Browserbase adapter and cloud browser, the Playwright form filler and Greenhouse form reader, the employer-posting lookup (it only moved jobs to the auto lane), the site table, caps, the test application, the Apply lane cards and review panel. `api.browserbase.com` is off the allowlist and `BROWSERBASE_*` off `.env.example` and `lib/env.ts`.
- **Kept:** the `apply_runs` table and `resumes` bucket (no code reads them now; dropping them is irreversible, so not now), the answer rules (`buildPacket`, `formProfile`) that Autofill's Help me apply uses, the extension, and the resume preview by role.
- **One lane:** one Good fits list per brief (10), one Find more button, one Apply Queue. The Tracker has one Apply Queue stage. The Mentor no longer speaks of jobs Atlas can apply to; the Analyst's report drops that fact.
- **Setup:** "Your fixed answers" card (eligibility + profile on forms), without the test application.
- **The Apply Agent** stays on the roster, now only answering forms for Autofill; it never submits. Project rule in CLAUDE.md updated: bots never send, submit or delete outside the app.
- **Yours to do:** delete `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` in Vercel.

### 2026-11-23 — The Mentor is the Career Mentor

**Asked for:** a mentor for career only, called Career Mentor.

- Every name you read is now Career Mentor: Growth, the agents list, Mission Control, briefs, push titles, prompts and the extension (179 places in 62 files, by rule).
- Already career-only: its eight review areas are activity, queue, results, targeting, skills, resume, profile and wins. Nothing else was removed.
- Unchanged on purpose: the agent id `mentor` and task names such as "Mentor: career map", which Atlas matches its run history by. The Data Mentor keeps its name.
- A QA check note may now be 200 characters (was 160), so the longer name does not cut the layout summary short.

### 2026-11-23 — Resume Optimization (part 1 of 2): the scorecard

**Asked for:** the Career Mentor's insights and recommended changes for the resumes in Figma, under a Career subtab called Resume Optimization.

- **New tab:** Career > Resume Optimization (`/career/resume-optimization`), between Target Roles and Setup.
- **A scorecard per resume** (`lib/domain/resumeScore.ts`, rules only), read from the text the Monday sync copies from Figma: the 20 skills that role's postings name most (last 60 days, by the six-role sorting), each on the resume, an easy add you have elsewhere (your skills list or another resume), or a gap; whether the headline names the role; how many bullets carry a number; weak openings; length. Score out of 100: keywords 50, numbers 20, weak openings 10, headline 10, length 10. Your #1 role first; the Master Resume is measured against all six roles.
- **Next (part 2):** the Career Mentor's suggested edits (Gemini, weekly, only from your own facts), with Copy, Open in Figma, Done and Dismiss, and the score before and after.

### 2026-11-23 — What the Other tech roles are

**Asked for:** a dropdown under "Other tech roles" on the Data Pipeline with its top 5 categories.

- The Other row of "Your six roles" opens to its five biggest role families (Software engineering, Product and program, AI and machine learning, Security, DevOps and cloud, ...), each with its job count, its share of Other, and its three most common titles with level words left off (`otherCategories` in `lib/domain/roleLens.ts`).
- In the demo's real listings, Other's biggest family was Software engineering titles without "Software Engineer" in them (Engineering Manager, Engineer): the titles Gemini will judge in part 3.

### 2026-11-23 — Action Taken on the Career Mentor's advice

**Asked for:** a checkbox, "Action Taken", that clears the advice, takes your input, and has the Career Mentor digest it into future advice.

- **Growth > Daily mentoring:** each insight has an Action Taken checkbox (Done is gone). Checking it asks, optionally, what you did; saving clears the insight from the list into "N actions taken today", which lists them with your words. Not useful stays. A review whose advice you cleared says "All cleared".
- **Stored:** `mentor_insights.owner_note` (at most 500 characters; addresses and phone numbers stripped). You may still change only the status and your note (migration `20261124010000_insight_action_taken.sql`).
- **Digested:** each review shows the model the last six things it said plus every Action Taken with your note from the last 30 days, as "youDid" (`recentForModel` in `lib/domain/mentor.ts`); the prompt says to build the next step on it, never repeat it, and treat it as information. The rules already keep a handled insight from coming back while its number is unchanged.
- **Also:** the Refresh and review summary says "Career Mentor:".

### 2026-11-23 — An apply brief on every job in the Apply Queue

**Asked for:** everything needed to apply with confidence: perspective on the role, the company's stats and hiring trends, the team and hiring manager, and any other data. PR 2 of the approved MacBook-only plan: the brief, from the data Atlas already holds. The team, hiring manager and news come in PR 3.

- **Apply brief** (folded, on each application in the Apply Queue; `lib/domain/applyBrief.ts`, rules only, $0):
  - **The role:** level and family from the title, the skills it names marked yours or not, the years and certifications asked, and its pay against the market median for that family and level (last 60 days, each company counted at most 25 times; none shown under 5 postings with pay).
  - **The company:** its open tech roles seen this week, new postings per week for 8 weeks (growing, steady or slowing; no direction until Atlas has two weeks of data), the kinds of roles it hires most, remote share, Utah roles and its pay range.
  - **People:** someone you know there, for a referral.
  - **Your steps:** read the brief, use the role's resume, answers ready, ask for a referral (when you know someone), apply with Autofill, mark it submitted, follow up in a week.
- **Design change from the plan:** computed when the page loads, from `tech_postings` and your settings, instead of a new `apply_briefs` table: no worker and always current. A table arrives in PR 3, when web reads and AI make a brief worth storing.
- **Tests:** `test/applyBrief.test.ts`.

### 2026-11-23 — Agent plan, Step 0: what each application was sent with

**Asked for:** the agent plan (Analyst, Scout, Pitch, Career Mentor as AI agents over typed tools), starting with Step 0: capture outcome data on every application.

- **Diagnosis first (read-only, live data):** 23 applications, 0 replies; 12 too new to judge (Nov 21-23); 10 of the 11 old enough were rejected, 8 of them 7-8 days after applying (a screen, not ghosting); 22 of 23 were logged from email with no posting date, level or resume recorded.
- **Recorded on every application now** (migration `20261124020000_application_outcomes.sql`, `lib/domain/outcomes.ts`): the level its title states, the day the posting went up, the resume sent (name and a fingerprint of its text, so a Figma edit is a new version), and warm when you have a contact there. From the queue (I submitted it, Approve for later) and from "thank you for applying" emails, which take the facts of the one job queued at that company in the 3 weeks before (never a guess between two).
- **Tailored and Warm** checkboxes on each application's page.
- **What's working** on the Tracker: sent, judged (an answer or 14 days), replies and rejections, sliced by level, role, posting age, resume, tailored and warm, with plain reads (fast rejections point at the screen; senior titles with no reply point at level).
- **Next:** Step 1, Scout: entry-level sources, level from years asked, still-open check, a daily "apply to these 5".

### 2026-11-23 — The Apply Queue as cards you work through

**Asked for:** Not a Good Fit should make that job vanish and the page adapt so you keep moving down the list, without the page resetting; and each job in the Apply Queue should be its own box.

- **Its own card:** each job in the Apply Queue is a card (12px radius, hairline border) instead of rows split by a line (`components/client/QueueList.tsx`).
- **Closed in place:** Not a Good Fit, I submitted it and Approve for later close that job at once, where it is. A line says what happened (and is read out), and the next job takes focus. The scroll position stays put.
- **No reset:** a folded list (Good fits, the Apply Queue) keeps the open or closed state you chose after any action; before, a refresh after a 👍 or a close could fold a long list again (`components/client/FoldDetails.tsx`, used by `QueueFold`). The queue's count updates after each close.
- **Tests:** `test/queueCards.test.ts`.

### 2026-11-23 — Agent architecture rules and the shared agent runtime

**Asked for:** store the agent-building principles in the project docs, apply them strongly in the build, and say what major changes they need.

- **Rules:** `docs/AGENT-ARCHITECTURE.md` (the five levers, what makes something an agent and what is only a workflow, each mapped to how Atlas applies it) and a short rule set in `CLAUDE.md`.
- **Decisions (yours):** runs stay on Vercel with state saved after every step (no Inngest); two new tables, `agent_state` and `agent_memory`; rules-based rerank, a model rerank only if evals show it helps.
- **Runtime** (`lib/agents/runtime/`): tools built for the model (one-line menu, schema disclosed when picked, zod in, never throws: a failure says how to fix the input); a loop that refuses "done" while checks are open, sends a failed review back for revision, refuses a repeated failed call, stops at its step cap, call budget or deadline, and saves its state each step so a cut-off run resumes. `lib/domain/agentState.ts`: the typed scratchpad, the trajectory (steps, failures, repeats, recoveries) and dated lessons. `lib/domain/rerank.ts`: the rules rerank.
- **Not yet an agent:** nothing runs on the runtime yet; the Pitch agent is the first (next PR). Scout, Analyst, Career Mentor and QA stay labeled workflows until they loop.
- **Tests:** `test/agentRuntime.test.ts` defines the four behaviours with a scripted model.

### 2026-11-23 — The apply brief researches the company: team, who to reach, news, your angle

**Asked for:** perspective on the company, the team, the hiring manager and anything else that helps you apply with confidence. PR 3 of the approved MacBook-only plan: public sources only, never reading LinkedIn; Firecrawl capped at one search per brief and 10 briefs a day; the AI display-only, drafted, checked and cited.

- **From the posting (rules, no extra credit):** the team it names ("join our Platform team") and who the role reports to ("reports to the VP of Engineering"), as new kit lines `Team:` and `Reports to:` (`lib/domain/postingFacts.ts`). Only a short plain phrase is taken; a bare "a manager" names nobody.
- **News (free):** Google News RSS for the company's last 30 days; only headlines that name the company, newest first, stock-quote pages left out. Shown dated and linked.
- **The company's own pages:** one Firecrawl search; kept only when the host carries the company's name and is not LinkedIn, a job board or a site about companies. Counted in the shared Firecrawl budget.
- **Who to reach:** a LinkedIn people search *you* open (Atlas never fetches it), plus anyone you know there.
- **Your angle:** Gemini drafts why them, what to lead with and three questions from numbered facts; the rules critique each item (it must cite a fact, every number must be in what it cites, no links) and refine by dropping what fails; the rules' angle stands in when no model answers. Each item shows the facts it rests on. Display-only.
- **When:** right after a 👍 (after the posting is read), at the 2-hour sync for up to 2 kits without research, and from **Research this company** on the brief. At most 10 a day (`briefUsage` in Settings).
- **Storage:** new table `apply_briefs` (owner-only read, RLS, server writes), applied automatically a few minutes after merge by the Supabase GitHub integration; do not run it by hand.
- **Tests:** `test/briefResearch.test.ts` (feeds, search and the model are stand-ins).

### 2026-11-23 — Agent plan, Step 1: the Scout focuses on jobs you can win

**Why:** the live feed had 3 junior Software Engineer postings in 557, and 10 of 11 judged applications were rejected by a screen within days.

- **Entry-level searches:** Himalayas also searches junior, associate, Software Engineer I and new grad titles; Adzuna (once its free key is set) searches junior software engineer.
- **Level from years asked** (`lib/domain/scoutFocus.ts`): a title with no level reads as early (0-2 years asked), mid (3-4) or senior (5+). A plain title asking for 5+ years is left out of your matches like a senior one, and early ones rank ahead.
- **Still open:** each sync checks up to 12 queued Greenhouse and Lever jobs against their public APIs, in turn; a 404 or 410 clears the job from your Apply Queue (audited). Anything else is never guessed at.
- **Apply to these 5 today** on the Apply page: the five queued jobs to apply to now, by rules (Perfect fits first, then entry level, fresh postings and fit score; senior roles sink), each with why.
- **Also saved:** the product-pragmatism build approach in `CLAUDE.md`.
- Still a workflow, not an agent (docs/AGENT-ARCHITECTURE.md): rules only, no loop yet.

### 2026-11-24 — Agent plan, Step 2: the Pitch agent, Atlas's first AI agent

**Why:** applications were going out with a generic resume and no proof per requirement; 10 of 11 judged ones were screened out.

- **What it does:** on any queued job, **Tailor with Pitch** maps every must-have to proof from your resume or names it a gap, proposes up to 3 resume line swaps (you make them in Figma) and drafts a short note. Display-only; nothing is changed or sent.
- **Why it is an agent** (docs/AGENT-ARCHITECTURE.md): it loops toward a goal on the shared runtime, picks its own tools (`readJob`, `readResume`, `findEvidence`, `checkClaims`), recovers when a search finds nothing (the tool says which related term to try, or to call it a gap), and finishes only when a review passes.
- **Verification:** rules first (every must-have mapped, proof for each "proven", no number or skill missing from your material, swaps only from lines on your resume, note at most 120 words), then a separate judge call with a checklist. A failed review sends it back with the reasons.
- **Guardrails:** 12 steps and 10 AI calls a run, 6 runs per 10 minutes, a 50-second deadline after which it saves its state and **Continue Pitch** resumes. With no AI, the rules' version stands (proof by keyword, gaps named, no swaps).
- **Must-haves:** the skills the read posting names; before the posting is read, the skills the saved job's description named (found in the browser check: it showed none before).
- **Measured:** 15 golden cases in the career eval suite; each run's steps, failures and recoveries are logged and shown on the panel.
- **Tests:** `test/pitch.test.ts` (a scripted model: reads, searches, recovers, is sent back once, finishes).

### 2026-11-24 — Agent plan, Step 3 (PR A): the Career Mentor closes your gaps

**Why:** gaps were listed but never closed, advice could repeat what you had already done, and nothing remembered what your results said.

- **Gap ranking** (`lib/domain/gapPlan.ts`): the skills your top role's postings ask for that no GitHub project or resume shows, junior and unstated-level postings weighing more. Shares are over postings that name skills (the browser check found most live postings are read by title only, which made every skill look rare).
- **One proof project at a time:** the Analyst assigns the top gap with a brief (AI, checked: names the skill, short, no links; rules' brief otherwise), and closes it when a repo pushed since shows the skill. Shown on Growth as **Your proof project**; the Career Mentor raises it daily and calls the win when it closes. Stored in Settings (`careerProof`), no migration.
- **Analyst funnel:** what your applications say (`findings` in `lib/domain/outcomes.ts`, now with stable ids) joins the facts the market report is worded from.
- **Memory:** funnel findings and your Action Taken notes become lessons in `agent_memory`, kept 21 days and renewed while the funnel says the same thing. The Career Mentor and Pitch read them.
- **Plan grading (draft -> critique -> refine):** rules grade each piece of the Mentor's advice; below the bar gets one AI rewrite with the notes, morning and evening only (2 calls a day at most).
- Still workflows, not agents: the order is fixed in code.
- **Tests:** `test/gapPlan.test.ts`; 7 golden cases in the career eval suite.
### 2026-11-24 — Agent plan, Step 3 (PR B): your six roles, parts 2 and 3

- **Part 2, a card per role** on the Data Pipeline's "Your six roles" chart (rules, `lensProfile` in `lib/domain/roleLens.ts`): median pay by level (junior, mid, senior, staff+, with how many postings state it), the 8 skills asked most (over postings that name skills), years asked (0-2, 3-4, 5+) and certifications named. On the demo's live feed, Software Engineer showed junior pay at a $103k median (8 postings), and only 4 of 218 postings that state years ask for 0-2.
- **Part 3, Gemini sorts unclear titles:** once a day with the Analyst, up to 40 titles the rules cannot place (only software, AI/ML, solutions and DevOps families, most common first) are judged into your six roles or Other. Answers outside the fixed list, or for titles not asked, are ignored; each bare title is judged once and kept in Settings (`lensJudged`, at most 600). One AI call a day at most; with no AI, Other stays Other. The chart says how many jobs Gemini placed in each role.
- Found while testing: the bare-title helper stripped "Staff" mid-title ("Member of Technical Staff"); level words now strip only from the start.
- **Tests:** `test/roleProfiles.test.ts`; 5 golden cases in the career eval suite.

### 2026-11-24 — Agent plan, Step 4 (PR 1): Interview Prep, Atlas's second AI agent

- **What it does:** on any application you sent, **Prepare for the interview** gives likely questions (one per must-have, plus the behavioral round), a true story for each from your resumes and projects (situation, task, action, result, with its source), the gaps to answer honestly, and up to 5 questions to ask them. **Copy the prep** gives it as plain text. Display-only.
- **Why it is an agent:** it runs on the shared loop with its own tools (`readJob`, `readCompany` from the Apply brief's research, `findStory`, `checkClaims`), recovers when a search finds nothing, and finishes only after a rules review (every must-have covered or named a gap, every story sourced and true by `traceClaims`, at least one behavioral question, real questions to ask) and a judge with a checklist.
- **On its own:** when an application reaches Interview, the 2-hour sync prepares it (one a run, only with a minute to spare). The Career Mentor's interview advice now points to it.
- **Guardrails:** 14 steps and 10 AI calls a run, 6 runs per 10 minutes by hand, a 50-second deadline with **Continue prep**. With no AI, the rules' version stands: likely questions, where your closest proof is, honest gaps, no invented stories.
- Found while testing: with no company research the agent could never close its "read the company" check; missing research is now a fact it reports, not a failure.
- **Tests:** `test/interviewPrep.test.ts`; 6 golden cases in the career eval suite.

### 2026-11-24 — Agent plan, Step 4 (PR 2): talk with Claude about your job search (MCP connector)

**Asked for:** a "talk with Atlas" way to walk and practise interview questions out loud; then, better, doing it through Claude over MCP.

- **What:** Atlas is now an MCP server (`/api/mcp`, stateless Streamable HTTP, `@modelcontextprotocol/server` 2.4.0, audited before install). Claude on the web, desktop, phone (voice mode included) and Claude Code reads 9 read-only tools: the Apply Queue, one job, applications, the funnel, the market, the proof project, interview prep, a mock-interview tool and a search of your resumes and projects.
- **Sign-in:** Supabase Auth is the OAuth 2.1 server (Dynamic Client Registration, PKCE); Atlas hosts the consent page at `/oauth/consent`, behind the owner and second-factor gate, and returns you to it after sign-in. The endpoint takes only an OAuth token for the owner's account (a browser session token is refused), only while **Claude access** is on in Settings.
- **Safety:** read-only by construction (CI checks the tools never call a write), email addresses and phone numbers removed, output capped, web text marked as data, 60 requests per 10 minutes, every call audited, revoke per app in Settings.
- **Cost:** $0: no Gemini calls in the tools; Claude does the talking on your Claude plan.
- **Instead of** an in-app voice button: Claude's own voice mode is better and costs nothing to build (Not Doing: audio in Atlas).
- **How to use it:** `docs/CLAUDE-CONNECTOR.md`. Needs four Supabase dashboard settings once (Authentication > OAuth Server).
- **Tests:** `test/mcp.test.ts` (who gets in, read-only, redaction, real MCP calls against the route); the hardening test lists the public OAuth metadata route.
- **Hardened, same PR:** a 10-second limit per tool; read-only and idempotent annotations; contract tests that run every tool on demo data (size cap, no email address, "Use when" descriptions); threats S8, I14, I15 and D5 in THREAT-MODEL.md.
- **Mission Control:** the live map has a "Claude connector (MCP)" row (Supabase Auth, Claude, MCP server, Atlas data). The MCP box lights blue while Claude reads, shows today's reads and failures, and goes dashed when access is off (from the audit log, counts only).
- **How it was built and why:** `docs/MCP-BUILD.md`: the build step by step, a 14-row decision log, the security model, running it, and how to talk about it with employers.

### 2026-11-24 — MCP: a public demo connector, and the MCP layer in volt on Mission Control

- **Public demo connector** (`/api/mcp-demo`): the same nine read-only tools over a fictional job search (Sam Rivera, made-up companies), with no sign-in, so an employer can add it to their own Claude and try it. Off unless `ATLAS_MCP_DEMO=1`.
- **Isolated by construction:** its data is a separate in-memory showcase (`lib/mcp/showcase.ts`: a resume, two queued jobs, a tailored application, an interview prep with stories, a proof project). The route and the showcase may not import the owner store, Supabase or `getContext`; the hardening test fails if they do. It writes nothing, not even audit rows.
- **Limits:** 40 requests per caller and 400 in total per 10 minutes, a 16 KB body cap, 15 seconds a request. It names itself `atlas-demo` and tells Claude the data is fictional.
- **Mission Control:** the Claude connector (MCP) row and the MCP server box are outlined in volt yellow (`--c-volt`), so the MCP layer is easy to find on the map.
- **Tests:** `test/mcpDemo.test.ts` (off by default, demo identity, every tool has something to show, writes nothing, limits).

### 2026-11-24 — Milestone: Claude talks with Atlas, live

The MCP connector went live in production the day it was built: Claude signed in through Supabase OAuth, the first tool call (`funnel`) answered in 125 ms, and voice mode on the phone worked. The owner calls it a major milestone for Atlas and a major breakthrough in the value it brings: the job search can now be asked about and practised in conversation, by text or voice, instead of only read in the app. Its first answer is what produced the level rule below.

### 2026-11-24 — One level rule for every agent: junior to 2 years at most

**Asked for:** apply the funnel's two insights (check the years asked; tailor to the posting's keywords), target junior roles asking for 2 years at most, ignore senior roles, and have every bot and agent on the same page.

- **One rule, one file** (`lib/domain/levelPolicy.ts`): a posting is *your level* (a junior, associate or level I title, or 2 years or fewer asked), *check the years* (nothing says), or *above your level* (a senior, staff, lead, manager or level III+ title, or 3+ years asked). Years asked win over the title. The limit is a Setting (default 2), to raise as experience grows.
- **Who reads it:** the Scout's matches (3+ years and senior are no longer matched; it was 5+ before); Apply to these 5 (never lists one above your level); each Apply Queue card (a level badge); the Career Mentor (the goal its model is given, and observations when the queue or recent applications break the rule); Pitch (told the job's level, and the keyword rule: use the posting's own words for what you really have); Claude through MCP (the rule and each job's level).
- **Your level card** on the Apply page: the rule in one sentence, the queued jobs above it with why, and one button to clear them. Atlas never clears them on its own; clearing is not a thumbs-down.
- **Tests:** `test/levelPolicy.test.ts`; 10 golden cases in the career eval suite; six older tests updated from the old "junior to mid, 5+ years" behaviour.
### 2026-11-24 — Mission Control and the Team page say what Atlas is today

**Asked for:** up-to-date names and details everywhere; clear definitions of workflow, bot and agent and what qualifies each; Mission Control as the place for architecture and system design, with the data pipeline only under Data Pipeline.

- **Agents are shown:** the counts said "0 agents, by design". Pitch and Interview Prep are now listed as Atlas's two agents (`LOOP_AGENTS` in `lib/domain/registry.ts`): on the dashboard count, the Team page (tools, limits, when it starts, what it never does) and the live map (their own row, with an Agent badge and the last run's status from the activity log). They run under the Applications bot, so no database change.
- **Workflow, bot or agent:** `KINDS` now says, for each, who picks the next step, how it may use the AI model, what it must do to qualify, and an example in Atlas. The Team page opens with that guide; "What Atlas is made of" links to it.
- **Roster and map text brought up to date:** Scout (entry-level searches, years asked), Analyst (funnel, gap ranking, proof project, lessons, sorting unclear titles), Applications (your level, Apply to these 5, company research, the two agents), Career Mentor (graded advice, proof project, lessons), Apply (answers forms; you submit, where the map still said it submitted). New jobs listed per bot.
- **Mission Control is architecture only:** the Pipeline tab is gone; the stage-by-stage pipeline view now sits on Data Pipeline, and old links land there.
- **Tests:** `test/registry.test.ts` (agents listed and named as their runs log them, kind definitions, the agents' row on the map, the pipeline off Mission Control).

### 2026-11-24 — Atlas laid out by desk, with a color each

**Asked for:** a simpler layout on the MacBook, iPad and phone, with a clear division between the Daily Desk and the Career Desk and each page showing its desk by color (owner chose option A: desk sections).

- **Four desks** (`DESKS` in `components/navItems.ts`, the one list everything draws from): **Daily Desk** (blue: Today, Inbox, Plan, News, Renewals, People, Projects, Ask Atlas), **Career Desk** (orange: Apply, Pipeline, Tracker, Market, Career Map, Target Roles, Resume Optimization, Setup, Growth), **Data** (purple: Data Pipeline, Evals) and **System** (green: Mission Control, Your team, Connectors, Settings).
- **Sidebar (MacBook, iPad):** one section per desk under a colored label; the page you are on is tinted in its desk's color. Daily and Career start open; Data and System open when you are in them. A label folds its desk.
- **Phone:** the tab bar is Today, Career, Ask Atlas and More; More lists every page by desk, in its color.
- **Every page** has a thin stripe and the desk's name at the top, in the desk's color (`DeskStripe`).
- **Volt outline** (outline only, nothing inside) on every connector and MCP component: the Sources row and the Claude connector row on the live map and each box in them, the Connectors page cards, Connect Claude and Atlas Autofill in Settings, and the Claude connector on the Team page.
- **Mission Control map:** what starts a run is labeled Automation (a schedule that fires on its own) or Manual (you), and each says which workflow it starts; the Chief of Staff lists the workflows it runs.
- The four tabs the weekly QA review counts (Today, Growth, Career, People) are unchanged as pages.
- **Tests:** `test/nav.test.ts` (the desks, their colors and pages, which desk every path belongs to, the phone bar).

### 2026-11-24 — Atlas works while you sleep: the Company Research agent and the night shift

**Asked for:** two more loop agents that bring real value and work overnight, with high clarity on what to focus on; senior roles removed from Good fits and the Apply Queue on their own; a target of early-career to mid-level roles asking for 1 to 3 years; and the owner's 10 years of business, client-facing and stakeholder experience used as an angle.

- **Company Research, Atlas's third agent** (`lib/agents/companyResearch.ts`, rules in `lib/domain/companyResearch.ts`): for one queued job it looks the company up on the public web, choosing its own next search or page (`readJob`, `companyNews`, `searchWeb`, `readPage`, `checkLines`). It may open only pages its own search returned, never LinkedIn, Indeed or Glassdoor. Every line it writes cites a fact it read and states no number the source lacks; a rules review and a separate judge check that. Budget: 3 searches, 3 pages, 12 steps, 8 AI calls. It saves the same research the Apply brief, Pitch, Interview Prep and Claude already read, now with "What the company does". **Research this company** runs it.
- **The night shift** (`lib/agents/nightShift.ts`, a workflow): every night around 10 to 11 PM, in a few short runs. First, by rules, it clears jobs above your level from the Apply Queue and Good fits. Then, for today's top picks in order, it runs Company Research and Pitch, spending only what is left of the day's AI calls, and each run carries on from the last.
- **Ready for you** on Today: your picks, most prepared first, with what is researched and tailored, and the one to start with.
- **Your level is now 1 to 3 years**, early-career to mid-level (a level II title is on target; 4+ years and senior titles are ignored). The limit stays a Setting.
- **Your wider background** (10 years in business administration, client-facing work and stakeholder interaction) is a Setting the Career Mentor, Pitch and Company Research use as an angle, and never count as engineering years.
- **Mission Control and Team:** three agents now; the night shift is listed as a workflow and on the Day timeline.
- **Tests:** `test/companyResearch.test.ts`, `test/companyResearchAgent.test.ts` (scripted model and stand-in web), `test/nightShift.test.ts`; 9 golden eval cases.
- **Not yet exercised:** the agent against live Gemini and Firecrawl, and the cron schedule in production.

### 2026-11-24 — Today as a calendar, for an iPad left standing

**Asked for:** a toggle on Today between the normal view and a calendar pulled from Google Calendar, showing only the current day, and a way to switch back and forth.

- **Today / Calendar toggle** in Today's header (`TodayViewToggle` in `components/DayCalendar.tsx`). Two links, so the calendar has its own address (`/?view=calendar`) and can be bookmarked or added to the iPad's Home Screen.
- **The calendar view** (`components/DayCalendar.tsx`, layout in `lib/domain/dayCalendar.ts`): a large clock, what is on now or next, all-day events on top, and an hour grid from 7 AM to 8 PM that grows for earlier or later events. Overlapping events sit side by side; past events fade; a red line marks now.
- **Left standing** (`components/client/CalendarLive.tsx`): the clock and the line move on their own, the page re-reads the calendar every five minutes, and the screen stays awake while the view is open (where the browser allows it).
- Read-only, from the same iCal feed the schedule already uses (`calendarFor`); it loads only the calendar, so it is quick. Not connected or unreadable: it says so plainly.
- **Tests:** `test/dayCalendar.test.ts` (12). Checked at 768px and 375px in demo mode.
- **Not yet exercised:** against the live Google Calendar feed, and the screen wake lock on a real iPad.

### 2026-11-24 — Today's calendar in Google's colors; toggles that stay put

**Asked for:** the calendar laid out more like Google Calendar, in half hours and in the colors set in Google Calendar (through the Google Calendar API); and every view toggle staying in the same place when you switch views.

- **Google Calendar connection** (`lib/integrations/googleCalendar.ts`, `lib/connections/googleCalendar.ts`): its own read-only connection on Connectors, with two scopes (the calendar list for colors, and events). It reuses the Gmail sign-in plumbing (PKCE, the sealed refresh token, the same callback, with the purpose carried in the state cookie). Events are read live and kept in memory for five minutes, never stored. Not connected or unreachable: the iCal address stands in.
- **Colors like Google** (`lib/domain/googleCalendar.ts`): each event in its own color, else its calendar's; event colors are the palette Google draws on screen (the Colors API returns an older one). Text is white or dark, whichever reads. Free events are paler, declined ones outlined and struck through (and never busy time in the schedule). Colors are accepted only as six-digit hex.
- **Half-hour grid:** half-hour lines and a taller hour, like Google's day view.
- **Toggles stay put:** a view toggle now always sits first on the page, top left (`toggle` on `PageHeader`, `ViewSwitchSlot`): Today / Calendar, Mission Control's three views and the Market tabs.
- **Database:** one migration adds `google_calendar` to the connections table's allowed providers. No new table.
- **Tests:** `test/googleCalendar.test.ts`, more in `test/dayCalendar.test.ts`.
- **Not yet exercised:** the live Google sign-in and API (needs the Calendar API turned on and the app published), and how closely each calendar's own color matches Google's screen.

### 2026-11-24 — The Weekly Strategist: three moves a week, approved by you

**Asked for:** an agent that works while you sleep and gives high clarity on what to focus on, with the option to approve the weekly plan and then have it added to the daily section to follow.

- **The Weekly Strategist, Atlas's fourth agent** (`lib/agents/weeklyStrategist.ts`, rules in `lib/domain/weeklyPlan.ts`): reads your funnel, Apply Queue, applications, the market, your proof project and what happened to last week's plan, choosing what to read next, and proposes exactly three moves for the week. It may not finish before reading the funnel, the queue and last week. Every move cites the facts it rests on and states no number they lack; it never repeats a move finished last week; the week fits in 10 hours. A rules review and a separate judge check it; the rules write the plan when AI is off.
- **You approve, then it is on your days:** Approve adds each move as a high-priority Career task on its weekday (today, if that day has passed). Safe to press twice. Pass drops it; Plan again writes a new one. Nothing reaches your days before you approve (`app/actions/weeklyPlan.ts`, audited).
- **When:** Sunday night, inside the night shift (no new cron), for the coming week; or Plan my week on Growth.
- **Where you see it:** a full card on Growth (with the facts it read) and a compact card on Today, with how many moves are done.
- **Claude:** a new read-only MCP tool, `weekly_plan` (ten tools now).
- **Memory:** last week's moves, finished or not, are the agent's memory for the next plan.
- **Tests:** `test/weeklyPlan.test.ts` (16), `test/weeklyStrategistAgent.test.ts` (scripted model), 8 golden eval cases.
- **Not yet exercised:** the agent against live Gemini, and the first Sunday-night run (29 Nov).

### 2026-11-24 — The Follow-up agent: follow-ups worth answering

**Asked for:** the next build after the Weekly Strategist: the Follow-up agent, as designed and approved (upgrade the existing follow-ups in place, one per application, no second nudge yet, hooks only from saved research and pitches, and a reply measure).

- **Follow-up, Atlas's fifth agent** (`lib/agents/followUp.ts`, rules in `lib/domain/followUpAgent.ts`): for a follow-up waiting in your Apply Queue, it reads the application, looks for one specific, true hook in the saved company research and the tailored pitch, and greets someone you know at the company by first name. It may not finish before reading the application and looking for a hook. The existing follow-up rules still apply (company, role, your name, no link or email address, no made-up number, no doubled words), plus: the hook cites what was read and is used in the email, the greeting is right, and it is 50 to 120 words. A separate judge checks it is specific, true, polite and short. When it cannot do better, the template stands.
- **When:** every night after Research and Pitch, two follow-ups at most (oldest first, each tried once); or **Rewrite with agent** on any follow-up in the Apply Queue. The ones it wrote carry a badge.
- **Does it work:** Tracker now shows how many follow-ups you sent got a reply within a week, and how many of those the agent wrote.
- **Not doing:** sending email, guessing recruiter addresses, LinkedIn messages, second nudges.
- **Tests:** `test/followUpAgent.test.ts` (10), `test/followUpAgentRun.test.ts` (scripted model), 7 golden eval cases.
- **Not yet exercised:** live Gemini, and the first night it runs.

### 2026-11-24 — One palette across Atlas; QA gets its own section; Data Pipeline leads with the map

**Asked for:** consistent colors across the app and their assignments (Daily blue, Career orange, Data purple, AI pink, System design / connectors / MCP yellow; errors stay red, warnings teal), reflected in Mission Control, Team, Connectors and Settings; a red QA section with everything QA, out of Today; sidebar order System, Data, QA; and the Data Pipeline drawn on top in the same colors, with its bots and agents labeled.

- **Semantic tokens** (`app/globals.css`): `--c-daily`, `--c-career`, `--c-data`, `--c-ai`, `--c-system` (and `--c-connector`), `--c-qa`, `--c-warn`. New neutrals `--c-slate`, `--c-brown`; new `--c-yellow`. `--c-amber` is gone. The meaning of each is written beside them.
- **Desks and bots:** each bot's avatar wears its desk's color (Daily blue, Career orange, Chief of Staff yellow, QA red); every AI agent is pink. Kind badges: workflow yellow, bot neutral, agent pink.
- **Mission Control:** desk outlines in their colors, QA red, AI agents pink, sources and the Claude connector yellow, the AI model pink, "running" indigo; a palette key under the map.
- **AI markers** (judged by the model, the Career Mentor, AI-written drafts, the AI pill) are pink; warnings and "needs you" are teal; colors that meant neither moved to neutral hues.
- **QA:** its own red section (QA review, Evals) after System and Data; the QA card left Today and Mission Control.
- **Data Pipeline:** the map comes first, each box in its color (sources yellow, the Scout orange, cleaning and storage purple, AI judgment pink) with a key, and a strip naming the Scout, Analyst and Career Mentor, AI marked.

### 2026-11-24 — Your GitHub projects, searchable and on call from Claude

**Asked for:** every project in the saltylvn GitHub account housed in Atlas, so Claude can recall builds, tools, stack and skills, and discuss and showcase the work. Public repositories only.

- **The Scout keeps the README:** it already read the start of each README to find skills, then dropped it. Now `portfolio_repos` keeps it cleaned (`readme`: prose and headings, no code, badges, images or HTML) and the project's own name from its top heading (`title`: "DEVELOP" for wellness-tracker). Migration `20261124080000_portfolio_readme.sql`, additive.
- **Project passages:** each public repository becomes a `project` passage ("Project: DEVELOP (wellness-tracker) on GitHub": description, stack, languages, skills, topics, last push, README). The Tailor, the Coach and `search_material` already search `project`, so they now cite real project proof. Private repositories never reach the index. The source counts as read only when both the project list and the GitHub projects read, so a failed read never deletes passages.
- **Claude:** a new read-only MCP tool, `my_projects` (eleven tools now): all public projects with stack and skills, or one in full with its README, by name, README title or owner/name. The README is marked as the project's own words.
- **Tests:** `test/portfolioKnowledge.test.ts` (README cleaning and title, passages, index safety, `my_projects`).
- **Not yet exercised:** the migration on production and the first Scout read that fills the new columns.
