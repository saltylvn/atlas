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

