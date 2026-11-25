# Design: the Apply bot (Browserbase)

> **Removed on 23 Nov 2026.** Tyler found applying for him did not work well enough and asked
> to apply to every job himself, on his MacBook, with Atlas Autofill. The bot's code, its
> cloud browser and the second lane are gone; the `apply_runs` table and `resumes` bucket stay,
> unread. This document is kept as the record of what was built and why. See the decision log.

Status: **approved by Tyler on 19 Nov 2026** (all six items in section 11), with one change he
asked for the same day: resume PDFs come from Figma (section 5.6). Facts below were checked that
day; links are in "Sources".

## 1. Pillars

**Purpose.** Apply to more good-fit jobs per day with less of Tyler's time, without risking his
reputation with an employer or his accounts.

**People.** One user, Tyler. The employers who receive the applications are affected too:
a wrong or spammy application reaches a real recruiter and cannot be recalled.

**Quality attributes, ranked**

1. **Correct and approved.** Nothing is submitted that Tyler has not seen, field by field.
2. **Never twice, never wrong.** One posting, one application, ever.
3. **Fails safe.** Any doubt (a CAPTCHA, an unknown required question, a timeout) stops the run
   and hands the job back to him. A missed application is cheap; a bad one is not.
4. **$0.** Inside Browserbase's and Gemini's free plans, with hard caps.
5. **Observable.** Every run logged, traced and audited, and results measured against manual applying.

**Constraints.** Free plans only. Vercel Hobby (functions stop at 300 s). Migrations run by hand.

**Risks**

| Risk | Likelihood | What the design does |
| --- | --- | --- |
| A job board's bot check flags or silently drops the application | **High** on Ashby, medium elsewhere | Ashby off. Stop on any visible challenge. Confirm every submission. Measure reply rates, with a stop rule (section 9). |
| A wrong answer reaches an employer | Medium | Tyler approves the exact packet. AI drafts only free-text answers, from his resumes, with citations and numbers checked. |
| A run is cut off after Submit and Atlas cannot tell whether it went through | Low | Never retried. Marked "check your email"; the email logger settles it. |
| Personal data in a third-party browser | Certain | Recording and logging off. Only the fields of that one form are sent. |

## 2. What the terms say

Researched 19 Nov 2026. None of the three publishes terms written for candidates applying on a
job board, so nothing found **forbids** a candidate's tool from submitting. Two of them defend
against bots in practice.

| Job board | Terms for candidates | Bot defenses | robots.txt | Recommendation |
| --- | --- | --- | --- | --- |
| **Greenhouse** | None for job boards. The *My Greenhouse* account agreement bans "automated means, including spiders, robots, crawlers"; that covers the My Greenhouse account product, not job-board forms. | Reported invisible reCAPTCHA on forms | `Disallow: /embed/` only | **On, in the pilot.** Never through a My Greenhouse login. |
| **Lever** | None for candidates; Lever's terms are written for its customers. | Reported hCaptcha | `Allow: /`, content signals `ai-train=no, use=reference` | **On, in the pilot.** |
| **Ashby** | None for candidates. | **Built-in "Application Spam Protection" that rejects submissions it judges to be bots**, set by each employer. A public report shows a Playwright-driven submission rejected as "flagged as possible spam" while a normal browser went through. | `Disallow: /api/` | **Off.** The employer has said, through that setting, that it does not want automated submissions. Ashby jobs stay in the manual lane. |
| **LinkedIn, Indeed, Glassdoor** | Their terms forbid automation. | | | **Never.** Manual lane. |
| **Workday, iCIMS, others** | Not researched; most require an account login. | | | **Off.** Manual lane. |

A site moves from Off to On only by a reviewed change to this table, with the terms read and dated.

## 3. The funnel Tyler asked for

```
Found ──▶ 👍 Approved ──▶ Posting read (Firecrawl) ──▶ two lanes
                                                       │
     Greenhouse or Lever ─────────────────────────────┼──▶ AUTO LANE
     everything else (LinkedIn, Indeed, Glassdoor,     │     1. Packet prepared (rules + Gemini)
     Ashby, Workday, company sites) ──────────────────┘     2. You review it: "Submit for me"
                                                             3. Agent submits, confirms
          MANUAL LANE                                        4. "Applied by Atlas" list
          1. Apply kit (answers, resume, Safari autofill)
          2. You apply on the site
          3. "I submitted it"
```

On the Career page, as separate sections, each labeled with its lane:

1. **Apply Queue** (auto lane: ready for Atlas to submit). Each shows the full packet and one
   button, **Submit for me**, plus **Edit** and **Apply myself instead**.
2. **Apply on MacBook** (manual lane: you apply). Today's apply kits, marked "You submit".
3. **Applied by Atlas.** Submitted by the agent, with the confirmation it saw and the time.
4. **Needs you.** Auto-lane jobs the agent stopped on, each with the reason ("a CAPTCHA appeared",
   "a required question has no approved answer").

The Applications board gets a **Method** label on each card: "Atlas" or "You". The Friday
scorecard splits replies by method.

## 4. Requirements

**In v1**

- Greenhouse and Lever job boards only, reached by the posting's own link.
- Two steps per application: **prepare** (read the form's questions, build the packet) and **submit**
  (only after Tyler presses Submit for me on that packet).
- The packet: name, email, phone, links, location, the resume PDF for the role, answers from his
  answer bank, his own fixed answers to eligibility questions, and Gemini-drafted answers to any
  free-text question.
- Confirmation: the job board's thank-you page, then the "thank you for applying" email the
  Email bot already logs.
- Caps and a kill switch (section 7).
- A local mock form for development and tests. **No real application is ever sent from dev or CI.**

**Out of v1**

- Ashby, Workday and every site that needs an account or a login.
- Cover letters written per job (an answer-bank cover letter can be attached if he has one).
- Any submission without a per-application approval. There is no batch "approve all".
- Retrying a submission.

## 5. Day-one decisions

### 5.1 New agent, or a feature of the Applications bot?

- **Recommended: a new agent, `apply` ("Apply bot").** It is the only agent that acts outside
  Atlas, so it is a privilege boundary: its own instructions, its own pause switch, its own caps,
  its own eval suite and audit trail, and the only code that holds the Browserbase key.
  *Pattern: least privilege / bulkhead.*
- Alternative: a step of the Applications bot. Less code, but the agent that finds jobs would
  also hold the power to submit them, and pausing one would pause the other.

### 5.2 Where it runs

- **Recommended: inside Atlas's own server, in the background after Tyler presses Submit for me**
  (`after()` in the server action, with the Career page's limit raised to 300 s, Vercel Hobby's
  maximum). One application takes about 1 to 3 minutes. *Pattern: fire-and-forget with a state machine.*
- Alternative: Inngest (the default stack's workflow tool, not yet in this repo). Durable retries
  and a run history, but a new service, and retries are exactly what a submission must not do.
- Alternative: Browserbase Functions (code hosted at Browserbase). Free on every plan, but the
  answers and resume would have to be sent to Browserbase's runtime as well as its browser.

**If a run is cut off**, the state machine decides what happens next:

| State when cut off | What happens |
| --- | --- |
| Before the Submit click | Back to "ready", nothing sent. Tyler can press again. |
| After the Submit click | **"Submitted? Check your email."** Never retried. The email logger moves it to Applied when the confirmation email arrives. |

### 5.3 How the browser is driven

- **Recommended: `playwright-core` connected to the Browserbase session over CDP.** One new
  dependency; it downloads no browser. Deterministic: Atlas fills exactly the approved values into
  exactly the fields it read, and checks each one after filling. *Needs Tyler's approval as a new dependency.*
- Alternative: Browserbase's own agent API or Stagehand. An AI decides what to click. More capable on
  odd forms, but non-deterministic, harder to test, and the free plan includes only 3 agent calls a month.
- Alternative: raw CDP over a WebSocket. No dependency, but several hundred lines of protocol code to own.

### 5.4 Reading the form before Tyler approves

- **Greenhouse: no browser needed.** Its public job-board API (already allowlisted) returns each
  job's application questions with `?questions=true`: label, required or not, and type. Checked on
  a real job: 13 questions, including work authorization and sponsorship as required selects.
- **Lever: one short browser session** opens the form, reads its fields and closes, about one minute.

This means Tyler approves answers to the questions the form really asks, not a guess.

### 5.5 Who answers what

| Question | Answered by | Rule |
| --- | --- | --- |
| Name, email, phone, city, LinkedIn, GitHub, portfolio | The answer bank | As written. |
| Resume | The PDF for the role | From storage (5.6). Missing PDF: stop. |
| Work authorization, sponsorship, "worked here before" | **Tyler's own fixed answers**, typed once in Settings | Never drafted, never guessed. No fixed answer: stop. |
| Demographic and EEO questions | Nobody | Left blank, or "I don't wish to answer" when that option exists. Required with no such option: stop. |
| "Why this company", "tell us about yourself" and the other bank questions | The answer bank, with {company} and {role} filled | As written. |
| Any other free-text question | **Gemini**, from his resume passages | Must cite a passage; every number must be in it (the checks "Draft with AI" already uses). The question text is untrusted: fenced, never followed. Fails a check: stop. |
| Any other required question (a select, a checkbox) | Nobody | Stop. |

Every answer is shown in the packet before he approves. He can edit any of them.

### 5.6 Where the resume PDFs come from

Changed 19 Nov 2026, at Tyler's request: the PDFs come from Figma, not from an upload.

- **Recommended: export the role's resume frame from Figma as a PDF when the packet is prepared,**
  then keep that exact file with the application in a private Supabase Storage bucket. Figma's
  REST API renders a frame to PDF (`GET /v1/images/:file_key?ids=…&format=pdf`), with the
  read-only `FIGMA_TOKEN` Atlas already uses for the resume sync, and the frame links are already
  in the Resumes rows in Notion. Freezing the copy means the file Tyler approves is the file that
  is sent, even if the design changes in Figma afterwards. *Pattern: snapshot at approval time.*
- Alternative: export at submit time and keep nothing. No storage, but what is sent could differ
  from what he reviewed.
- Alternative: upload a PDF per role by hand. Simplest, but one more thing to keep current.

To check while building: Figma renders the PDF to a temporary file link on another host, which
goes on the allowlist; the text in the PDF must stay selectable so job boards can read it (Atlas
will extract it and compare with the resume text it already mirrors); and the AI Workflow
Engineer row has no frame of its own yet, so it uses the AI Engineer frame, as its Notes say.

### 5.7 The data model

A migration is needed anyway: the database only accepts known agent ids, and `apply` is new.

- **Recommended: one migration** that:
  - adds `apply` to the agent id checks (`agent_runs` and the other two tables that check it);
  - adds `auto` to `applications.tier`, so the board can say who applied;
  - adds an `apply_runs` table: one row per auto-lane application, holding the packet Tyler
    approved, its state (`prepared`, `approved`, `submitting`, `submitted`, `unconfirmed`,
    `stopped`), the reason it stopped, the confirmation text, timestamps, and a **unique key on
    the posting's link**, so a second submission is impossible at the database level;
  - adds the private `resumes` storage bucket.
- Alternative: no migration, by reusing approval kinds and notes text. Rejected: the agent id
  alone requires one, and "never twice" deserves a database constraint, not a convention.

You run it in the SQL editor, as with every migration before. *Pattern: idempotency key.*

### 5.8 What leaves Atlas

- **To Browserbase:** that one form's values and the resume PDF. Sessions are created with
  **`recordSession: false`** and **`logSession: false`** (both default to on), so no recording or
  log of what was typed is kept. The free plan keeps session metadata for 7 days.
- **To Gemini:** the job title, company, the free-text question, and his resume passages. Never
  his contact details.
- **Never:** passwords. The agent never signs in anywhere.

## 6. Architecture

```
Career page ──"Submit for me"──▶ server action (zod, owner check, audit)
                                      │  claims the apply_runs row: approved ▶ submitting
                                      ▼  after()
                               Apply bot run (lib/agents/apply.ts)
                                 1. checks: kill switch, caps, site On, row still approved
                                 2. Browserbase: create session (no recording, no log,
                                    no CAPTCHA solving, no proxies, no stealth, 10 min timeout)
                                 3. playwright-core over CDP: open the posting's form
                                 4. stop if a challenge, login wall or unknown required field shows
                                 5. fill exactly the packet; read every field back
                                 6. click Submit once; mark "submitted?" before waiting
                                 7. read the confirmation page; release the session
                                 8. state ▶ submitted / unconfirmed / stopped; log, trace, audit
```

New files: `lib/integrations/browserbase.ts` (the one adapter), `lib/domain/applyPacket.ts` (pure:
fields to answers, stop rules), `lib/domain/applySites.ts` (the site table in section 2),
`lib/agents/apply.ts` (the run), `agents/apply/instructions.md`, an eval suite, the migration,
and a mock form under `test/fixtures/`. New hosts on the allowlist: `api.browserbase.com`; the
browser itself connects over a WebSocket to Browserbase, which `safeFetch` does not cover, so the
adapter checks that URL's host itself.

## 7. Caps and controls

| Control | Value | Why |
| --- | --- | --- |
| Browser minutes a month | Stop at **50** of the free 60 | Billed by the minute, one-minute minimum per session |
| Applications a day | **3** in the pilot, then up to 5 | Quality over volume; matches the daily plan |
| Session timeout | 10 minutes (the free plan allows 15) | A stuck run cannot eat the month |
| CAPTCHA solving | **Off** (`solveCaptchas: false`), no proxies, no stealth | Never work around a bot check |
| Kill switch | The existing **Outbound allowed** switch stops all submitting; the agent's own Pause stops it alone | One place to stop everything |
| Per-application approval | Required, after seeing the packet | No batch approval exists |

At about 2 minutes per application, the free plan covers roughly 20 a month.

## 8. Observability

- One logged, traced run per application on Mission Control (site name only, never the answers).
- An audit row for each approval and each submission.
- An eval suite (labeled cases, run in CI): which sites are On, which questions stop a run, which
  answers come from where, what a challenge looks like on the mock form.

## 9. Is it working? The pilot and its stop rule

Pilot: **2 weeks, at most 3 auto applications a day, Greenhouse and Lever only.**

Measured on the Friday scorecard, split by method (Atlas or you):

- confirmation emails received for agent submissions (did they really arrive?);
- replies and interviews per application.

**Stop rule:** if fewer than 9 in 10 agent submissions get a confirmation email, or agent
submissions get replies at clearly under half the rate of his own, the auto lane is turned off and
those jobs go back to the manual lane. A silently dropped application costs a real chance at a job.

## 10. The rule this changes

`CLAUDE.md`, "Rules for changes":

> **Before:** Agents draft; they never send, apply or delete outside the app.
>
> **After:** Agents draft; they never send or delete outside the app. One exception: the Apply
> Agent submits a job application on a site marked On in `lib/domain/applySites.ts`, only after
> Tyler approves that application's exact packet, and never on LinkedIn, Indeed or Glassdoor.

The same exception goes into `agents/README.md` (operating rule 5) and the Applications bot's
instructions.

## 11. What Tyler is approving

1. The new **Apply bot** and the rule change in section 10.
2. **Ashby off**, Greenhouse and Lever on, in a pilot with the stop rule in section 9.
3. The new dependency **`playwright-core`**.
4. **One migration** (section 5.7) and a private Supabase Storage bucket for resume PDFs.
5. One new thing for him to provide: **fixed answers** to work authorization, sponsorship and
   "worked here before". Resume PDFs come from his Figma frames (section 5.6).
6. **Browserbase keys** (`BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`) in Vercel, only after the code is merged.

Build order once approved, one PR each: (1) migration, site table, packet rules and mock form, with
no Browserbase; (2) the Browserbase adapter and the run, tested against the mock form only;
(3) the Career page lanes and lists; (4) the pilot.

## 12. Decision log

**23 Nov 2026: removed.** Tyler: the Apply bot was not working well; drop it and walk him
through applying on his MacBook instead. Deleted the Apply Agent's submit and prepare steps,
the Browserbase adapter, the form filler, the employer-posting lookup and the auto lane. One
Apply Queue remains. The Apply Agent now only answers forms for Atlas Autofill; Tyler submits.
Kept: `apply_runs` (read-only history) and the answer rules (`buildPacket`), which Autofill uses.

**19 Nov 2026, part 2 (the run):**

- **Greenhouse only for now.** Lever stays On in the site table (its terms allow it) but the run
  refuses it until its form reader is built: a one-site pilot is simpler to judge.
- **A run claims its row first.** `approved` to `submitting` is one database step (an update that
  only matches the old state), so two tabs or a retry cannot both submit. *Pattern: compare-and-set.*
- **The state is saved as `unconfirmed` before the Submit click**, not after. A run cut off after
  the click is never offered again; one cut off before it (still `submitting` after 15 minutes)
  goes back to review.
- **The resume is proved twice.** When the packet is prepared: the frame's text fingerprint and
  the PDF's SHA-256 are recorded. Before a browser opens: the kept file must hash the same and
  Figma must still read the same, else the run stops and asks for a new packet.
- **What a prepared packet still needs is read from the packet**, not stored, so it stays true as
  answers are edited. The owner's session may change only `packet`, `state` and `approved_at`.
- **Browserbase's `allowedDomains` limits page navigation only** (not scripts or frames), and a
  host covers its subdomains. Both Greenhouse job-board hosts are listed. It is marked experimental.
- **Daily cap counts Submit clicks; browser minutes count every session**, each rounded up.
- **No failure text reaches the log or trace** from the browser: a connection error can carry the
  session's signing key.
- **The eval suite waits for go-live** (part 3): the roster test requires a suite for exactly the
  live agents, and this one is still "being built". Until then the rules are covered by unit tests.

**19 Nov 2026, the test application (asked for by Tyler):**

- **A test application is shown in Atlas, not emailed.** Tyler asked for a "send test application
  via email" button, to be sure of the data and the resume PDF. Atlas cannot send email (Gmail is
  read-only), and adding it would mean a new sending service, a key, his resume passing through
  it, and a change to "agents never send". He chose the in-app result with a push notification:
  the same file, nothing new leaving Atlas. *Trade-off: he does not see it arrive as an attachment.*
- **It runs the real prepare step** on a sample form (`lib/domain/applyTest.ts`) that has one
  question of every kind the agent handles. The resume is exported from Figma at that moment and
  kept; the card shows every answer, who gave it, and a link to the exact file (served only while
  its SHA-256 still matches). No job board, no browser, no row in the auto lane.
- **The latest test is kept in Settings**, like the usage counters: no migration.
- **The eligibility answers are set on the same card**, saved as picked, and audited as "how many
  are answered", never what they are.
- **`BROWSERBASE_PROJECT_ID` became optional.** Browserbase reads the project from the key; a
  value that is not an id is ignored rather than stopping the app from starting.

**19 Nov 2026, the readability check (section 5.6's open item):**

- **Every exported resume PDF is read the way a job board reads it**: the text stored in the
  file, in the file's order, compared with the frame's own lines (`lib/domain/pdfReadable.ts`).
  Verdicts: good; warn (lines missing, or sections stored in a mixed order); bad (no readable
  text: outlined or flattened in Figma); not checked (the PDF could not be read).
- **Only "bad" stops a real application.** A mixed order is a warning: some job boards lay the
  page out again and read it correctly, so Atlas does not claim to know. The test card shows the
  PDF's own text so Tyler can judge.
- **One new dependency, `unpdf` 2.1.0** (PDF.js built for servers; MIT; no required
  dependencies; reads only, renders and fetches nothing). Chosen over `pdfjs-dist` (37 MB, optional
  native parts) and `pdf-parse` (pulls a native canvas). Pinned to a release more than two weeks
  old, loaded only when a resume is checked, and kept out of the bundler.
- **A PDF the library cannot read is "not checked", never a pass and never a stop.**

**19 Nov 2026, part 3 (the review screen; the agent goes live in its pilot):**

- **One lane card above the queue**, in the order things need Tyler: working, needs you, ready for
  review, applied by Atlas. A job Atlas can submit is listed there only; everything else stays in
  the manual queue, now named Apply on MacBook. Every lane item keeps **Apply myself instead**.
- **Submit for me asks once more** ("Yes, submit it") because it cannot be taken back.
- **What a packet still needs is counted on its rows**; the full list is shown only for reasons
  that mean "apply yourself".
- **The lane is on only when it can run**: Browserbase set up and the `apply_runs` table readable.
  Otherwise every kit stays in the manual queue and nothing breaks.
- **An unconfirmed application is settled by the job board's email**: when the email logger logs
  a confirmation for that company on or after the day Atlas clicked Submit, the run becomes
  submitted and that application is marked as sent by Atlas.
- **A job already on the board as applied is never submitted**, even if its packet was prepared.
- **The board says who applied** ("Atlas applied" or "You applied") and the scorecard counts
  sent and answered by method, which is what the stop rule in section 9 reads.
- **The agent is live with an eval suite of 47 cases** (where it may apply, what it may answer,
  when it stops, never twice), and the live map draws its one line: the model's draft.
- **The Career page's time limit is five minutes**, Vercel Hobby's maximum, so a run started
  from it can finish in the background.

**19 Nov 2026, from Tyler's first live test:**

- **The resume PDF opens on a page inside Atlas with a Back button.** Opened by itself, a PDF
  fills an installed phone app's screen and leaves no way back (no browser bar). The viewer page
  frames the PDF, so `/api/apply/*` alone may be framed, and only by Atlas itself
  (`frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`); every other response stays unframeable.
- **Gender may be answered with Tyler's own fixed answer** (asked for by Tyler: "Gender: Male").
  It is optional, set with the other fixed answers, used only when exactly one of the form's
  choices says it plainly, and it can be changed per application in the review. Every other
  demographic question (race, veteran status, disability, pronouns, orientation, transgender
  status) is still only ever declined. This changes section 5.5's "Nobody" row for Gender alone.
- **"How did you hear about this job?" has a default answer in the answer bank.** Used as written
  in a text box; when the form offers a list, only if it is exactly one of the choices, otherwise
  the question waits for his pick. Tyler's own default is the name of the tool Atlas reads
  postings with, as a conversation starter; I flagged that employers will not recognize it and
  that lists will not offer it, and he chose it knowingly.

**19 Nov 2026, resumes come from Notion (changes section 5.6; asked for by Tyler):**

- **Why:** Figma's free plan allows only a handful of file reads a month (its docs give about 6
  as the Starter example), so exporting a PDF for every test and application stopped working.
- **Source:** the PDF in the role's **Resume file** column of the Resumes database in Notion; a
  role without one uses the AI Engineer row (AI Workflow Engineer) or the Master Resume. Only a
  file Notion itself stores is read (`prod-files-secure.s3.us-west-2.amazonaws.com`, on the
  allowlist); a link to another site is not followed.
- **Still a snapshot:** the file is copied and kept when the packet is prepared. Before sending,
  the kept copy must hash the same and Notion must still hold that same file; a newer upload
  stops the run and asks for a new packet.
- **Readability:** with no Figma frame to compare against, the check is whether the PDF's text
  can be selected at all. The order check is kept in the code but no longer has a reference.
- **The Figma to Notion text update is weekly, on Monday evening,** and Atlas sends a notice
  every time: updated, no changes, needs a look, or did not run. The test card no longer offers
  a Figma sync.
- *Trade-off:* after changing a resume in Figma, Tyler exports the PDF and puts it in Notion by
  hand. That upload is now what an application sends.

**19 Nov 2026, the phone flow (asked for by Tyler):**

- **One flow, top of the Career page:** Good fits (jobs Atlas can apply to), a thumb, the Apply
  Queue, then Jobs applied for by Atlas. A 👍 prepares the job in the background, so the queue
  shows the role, the posting link and the resume without another press.
- **"Apply for me" replaces "Submit for me"** as the button's name. It still shows the answers
  and asks once before sending: the rule that Atlas only submits a packet Tyler has seen stands.
- **Manual jobs are desktop only.** On a phone the Apply on MacBook queue and
  Save a job are hidden; they are for the Mac and the Safari extension.
- **Seats are kept for jobs Atlas can apply to** in every brief (5) and search (5). Without
  them the four big job sites filled every list: none of the last 101 matches was one.
- **Only a job that stays on Greenhouse's own board counts.** A company that sends the job to
  its own careers site (Stripe, Datadog and others) redirects away from the board, so Atlas
  cannot apply there. About 28 of 77 boards checked keep their jobs on Greenhouse.
- **"Staff+" and "Principal+" are too senior**, like Staff and Principal.

**19 Nov 2026 — Perfect fit, and the resume shown before a job is prepared**

- **Perfect fit is a stronger thumbs-up, stored as rating 2** on the same field (one migration
  widens the check to -1, 0, 1, 2). Chosen over a separate yes/no column: one field, and the
  ranking's sums count it double without new code. A database that has not had the migration
  keeps the thumbs-up and says so.
- **What it does.** Queued like a 👍; listed first in its queue with a pill; later postings that
  ask for the same skills rank higher (3 per shared skill, at most 12; rules only).
- **The Mentor gets one fact per perfect fit** (three at most): what the posting asks, which of
  it he has, what no resume shows, who he knows there, and where the job stands, with a default
  next step. **No new model call:** the Mentor's three reviews a day word it, under the same
  evidence check. This replaces the planned call per job; it costs nothing and cannot invent.
- **Resume preview (19 Nov).** Each job shows "Resume: <role>"; it opens the PDF Notion holds for that
  role now, inside Atlas. Read-only, owner only, rate-limited, audited. The file that is sent is
  still the copy kept at prepare time and approved in the Apply Queue.

**19 Nov 2026 — Target Roles, the fourth Career tab**

- **Which roles:** the first four by the Priority column of the Resumes database in Notion.
  Chosen over a new "Target" checkbox: one source of truth, nothing new to keep in step.
  *Superseded the same day (see "Five target roles, owned by Atlas" below).*
- **Facts and wording are kept apart.** The card's numbers, skills, gaps and project recipes
  come from the Analyst's outlook and the Growth gap list (rules, refreshed daily). What the
  role does, its tempo, a project idea and the gap to close first are written by the Mentor's
  model once a week, from those facts only.
- **One model call per role, each Monday evening, after the evening review** (four a week,
  inside the daily cap). Chosen over draft-critique-refine: a third of the calls. What comes
  back is checked: no number that is not in the facts, the gap must be one of the role's
  gaps, the project may name only skills the postings ask for, no links or markup. Text that
  fails is not kept and the card shows the facts alone. Tempo is labeled as a judgment.
- **Stored in `role_profiles`**, one row per role per week, kept 60 days, read-only for the
  owner's session. Chosen over the settings row: it keeps last week's text and leaves room
  for the milestone role, which is not built yet.
- **Display-only.** Nothing on the tab sends, applies or changes a role.

**19 Nov 2026 — Atlas Autofill becomes Atlas in the toolbar**

- **The extension shows the Apply on MacBook queue** and fills with the picked job's company
  and role. It shows which resume to attach and what the posting asks for.
- **How it gets the queue: it reads it from the Career page while Tyler is signed in**, as it
  already read the answer bank. Chosen over a stored token: no secret on the Mac, and the
  extension can ask Atlas for nothing. The cost is that the copy refreshes only when he opens
  the page.
- **Reporting back keeps the extension's rule that it never clicks or sends.** "Mark
  submitted" opens Atlas on that job; Atlas asks "Did you apply to this one?" and only his
  answer there moves it to Applied. The link itself changes nothing, so a link from anywhere
  else cannot mark a job. One more click than a direct write, by design.
- **Browserbase is not used here.** It is for jobs Atlas applies to without him. On his Mac
  he is in his own Safari; a cloud browser would spend the free minutes and break the terms
  of the sites this queue exists for. Firecrawl stays where it was: Atlas reads a queued
  posting once, on sites that allow it, and the popup shows what it found.

**20 Nov 2026 — Atlas Autofill, rebuilt to read real forms and answer with Gemini**

- **No new agent.** Answering a form is the Apply bot's job; the extension is that agent
  without its browser. Its runs are logged and traced under the Apply bot
  ("Answer a form for Atlas Autofill").
- **Rules, then Gemini.** The same `buildPacket` rules the Apply bot uses on Greenhouse answer
  first. Gemini then picks options on the lists nothing else answers (one call per form) and drafts
  up to four open questions, each checked: an option must be the form's own, a pick must cite a
  resume passage or a fact Tyler wrote, and consent, demographic, money, relocation and legal
  questions never reach the model. Capped at 20 forms a day.
- **An extension key** replaces the "no token" choice of 19 Nov, because Gemini runs in Atlas.
  Made in Settings, shown once, stored only as a SHA-256, compared in constant time, revocable.
  It can call four routes: ping, answers, resume, learn. Every use is audited; refusals are
  recorded like the other token routes.
- **The reader handles real widgets**: labels from the text before a field, invisible characters
  and placeholders ignored, lists that wrap their label, search-and-pick boxes (opened to read
  their options), React Select dropdowns that ignore scripted clicks (read and picked through the
  component, by a small helper in the page), Yes/No buttons, radios drawn by their labels, file
  uploads. Checked read-only on Fullstack, Ashby, Greenhouse (Arva, SoFi) and JazzHR (Pura).
- **It still never submits.** Clicks go through a guard that refuses anything that sends; Enter is
  never pressed. "Next step" moves a multi-step form forward, except on LinkedIn, Indeed and
  Glassdoor, where it only fills on Tyler's click.

Still to verify with real keys, in the pilot: what the readability check says about Figma's real PDF, and how
Greenhouse's invisible reCAPTCHA scores a cloud browser with no stealth (the stop rule in
section 9 is what catches a silent drop).

## Sources

- [Browserbase: allowed domains](https://docs.browserbase.com/platform/browser/security/allowed-domains)

- [Browserbase plans and limits](https://docs.browserbase.com/account/billing/plans.md)
- [Browserbase: create a session (recordSession, logSession, solveCaptchas)](https://docs.browserbase.com/reference/api/create-a-session.md)
- [Browserbase CAPTCHA solving](https://docs.browserbase.com/platform/identity/captcha-solving.md)
- [Ashby: Application Spam Protection](https://docs.ashbyhq.com/job-board-application-spam-protection)
- [Report: Playwright submission flagged by Ashby](https://github.com/career-ops-hq/career-ops/issues/4269)
- [My Greenhouse User Agreement](https://my.greenhouse.io/users/agreement)
- [Figma REST API: file endpoints, image export](https://developers.figma.com/docs/rest-api/file-endpoints)
- [Lever Terms of Service (customer terms)](https://www.lever.co/legal/terms-of-service)
- robots.txt of jobs.lever.co, boards.greenhouse.io, job-boards.greenhouse.io and jobs.ashbyhq.com, read 19 Nov 2026

**19 Nov 2026 — Five target roles, owned by Atlas**

- **Atlas owns the list and its order** (`settings.careerRoles`, set on Target Roles with up/down,
  remove, add and Save; the Mentor's approved proposals land there too). Notion keeps only the
  resume for each role. Chosen over Notion's Priority column: the order is a decision Atlas acts
  on every run, so it belongs where the agents read it; Notion stays the home of the documents.
  Atlas no longer writes to Notion rows at all (the Priority writer and row creator are removed).
- **At most five roles:** Solutions Engineer, AI Engineer, Forward Deployed Engineer, Software
  Engineer, AI Automation Engineer (Tyler's order). Every other title folds into one of them
  (`targetRoles.ts`): Implementation, Integration and Customer Success Engineer → Solutions;
  Applied/Generative AI, AI Developer, AI Consultant → AI Engineer; Customer, Field and Deployment
  Engineer → FDE; Full Stack, Backend, Embedded, IoT, Developer Advocate → Software Engineer;
  AI + Automation, AI Workflow, agent, GTM, RevOps, n8n and Zapier titles → AI Automation Engineer.
  Data Engineer, AI Platform Engineer and AI Product Manager stay candidates for the Mentor.
- **Old names are renamed in stored rows** by the migration (postings, matches, applications), so
  a role's history stays whole; `canonicalRole` maps them anywhere else (Notion row names, links).
- **Skills logged daily per role** (`role_skill_stats`, one row per role per day, top 30 skills
  with counts, kept two years). Written by the Analyst with each market report; Target Roles
  shows each role's most asked skills averaged over eight weeks. Chosen over one row per skill:
  5 rows a day instead of 150, and the averaging is pure, tested code. A skill absent from a day
  counts as 0, so one spike does not outrank steady demand.

**20 Nov 2026 — Role descriptions and other names on Target Roles**

- **Description per role, monthly**, from the Analyst's posting facts plus a Firecrawl web search
  (result snippets only, no page scraped; 2 credits per role, about 10 a month from the shared
  budget in `postingFacts.ts`). Gemini writes it from fenced, untrusted data with no tools; the
  check (`acceptDescription`) drops any link, markup, number not in the facts or snippets, or text
  without 1 to 3 real sources. Stored in `role_descriptions`, display-only, sources shown with the
  date read.
- **Rejected: Gemini's Google Search grounding.** Not on the free tier for the 3.x models Atlas uses,
  and Google's terms forbid caching grounded results, require showing Search Suggestions with them,
  and forbid modifying them: a stored, checked monthly description cannot comply. Firecrawl relaxes
  one rule for this task only: search snippets (never whole pages) reach a model, fenced as data.
- **Four other names per role** (`similarTitlesFor`): each posting counts under the title phrase it
  matched, so company and team words never make a new name; spellings merge; the role's own search
  list fills in, marked "searched for". Rules only.

