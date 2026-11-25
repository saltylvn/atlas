# Integrations

Integrations are read-only, with two owner-clicked exceptions: archiving an email in Gmail and a one-click unsubscribe you approved.

## Applications from email (the Career Agent)

Atlas is the application tracker; there is no separate job-hunt system. Before each weekday brief the Email Agent syncs Gmail, and the Career Agent reads the job emails it tagged (`lib/domain/applications.ts`, `trackFromEmail`): a "thank you for applying" email logs the application as Applied (company and role read from the subject and sender), and later emails from that company move it forward (a reply to Replied, an interview invite to Interview, a rejection to Rejected). An interview invite or rejection from a company with no application yet also logs one; recruiter outreach never does. Statuses only move forward, and nothing is logged twice (`email:<message id>`). With more than one application at a company, the email is matched by its Gmail thread, then by the role it names, then by the company's one open application (`matchMail`); one that cannot be told apart waits in the **Needs you** lane on the Pipeline page for you to place. Every job email also goes on its application's timeline ([design-pipeline.md](design-pipeline.md)).

**Catch-up:** Applications > **Find past applications in Gmail** searches All Mail for the last 90 days (read-only `X-GM-RAW` query for confirmation, status and interview subjects and the common hiring systems, headers only) and logs what it finds. An email on a timeline is there once, so the tracker places one only after its text has been read (`kindToPlace`): an unread one waits for the next run. The catch-up's emails that are no longer in the inbox are never read, so those go by their subject, and a subject that says "interview" is logged as a reply, never as an invite. Interviews come from Google Calendar: events titled as an interview, or naming a company with an open application, are linked to that application (`lib/domain/careerSnapshot.ts`).

## Gmail (read-only, except Archive)

Two ways to connect; the app password is preferred and wins if both exist.

**App password over IMAP** (`lib/integrations/gmailImap.ts`). Connectors takes the Gmail address and a 16-letter app password, signs in once to `imap.gmail.com:993` (TLS) to check it, then seals it with AES-256-GCM. Each sync opens INBOX with EXAMINE (read-only: nothing is marked read or moved), finds the last three days with Gmail's own search (`X-GM-RAW newer_than:3d`, plus `category:promotions/social/forums` and `category:updates` to tag piles), and fetches only ids, labels, date and the From, To, Cc, Subject, List-Unsubscribe, Precedence and Auto-Submitted headers. No bodies, so no preview line. The one write is **Archive**, only when you click it: Atlas opens INBOX read-write, finds the email by its Gmail id (`X-GM-MSGID`) and removes the `\Inbox` label (`STORE -X-GM-LABELS`), exactly like Gmail's Archive button; nothing is deleted, moved elsewhere or marked read. **Unsubscribe**, only for senders you tick: Atlas reads the newest email's `List-Unsubscribe` and `List-Unsubscribe-Post` headers (read-only) and, when the sender supports RFC 8058 one-click unsubscribe, sends that POST through `lib/security/oneClick.ts` (https only, public addresses only, no redirects, no cookies); otherwise you get the sender's link. The logger is off. Revoke at myaccount.google.com/apppasswords.

**Google sign-in (OAuth).** Connectors > **use Google sign-in** runs OAuth 2.0 (authorization code + PKCE, `state` in an httpOnly cookie) for `openid email gmail.readonly`. Google returns a refresh token; Atlas seals it with AES-256-GCM (`ATLAS_VAULT_KEY`) and stores only the ciphertext.

Each sync lists inbox messages from the last three days (up to 40) and fetches each with `format=metadata`: From, To, Cc, Subject, List-Unsubscribe, Precedence, Auto-Submitted, labels and Gmail's snippet. Bodies and attachments are never requested. Rules in `lib/domain/inbox.ts` sort each message:

| Pile | When |
| --- | --- |
| Needs a reply | The sender is one of your contacts; or it is addressed to you directly and asks something; or Gmail marked it important and it is addressed to you |
| FYI | Receipts and updates; anything else addressed to you or copying you |
| Noise | Mailing lists (List-Unsubscribe, Precedence: bulk), automated mail, no-reply and notification senders, Gmail Promotions / Social / Forums |

Syncs run from **Sync now** on Inbox (rate-limited) and every morning from the cron. Rows are kept 30 days. **Disconnect** revokes the token at Google and deletes every synced row.

## Morning job and push

`GET /api/cron/morning` with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron, `vercel.json`): syncs Gmail, builds the brief, and sends `Today: <top task>` plus two summary lines to each subscribed device. Skipped pushes when the kill switch is on. Every run is audited (`cron.morning`). `401` bad token · `503` not configured.

Devices subscribe from Connectors (Home Screen app on iOS 16.4+). Subscriptions are accepted only for Apple, Google, Mozilla and Microsoft push hosts. A `404`/`410` from the push service removes that device.

## Capture (Siri Shortcuts)

`POST /api/capture` with `Authorization: Bearer <ATLAS_CAPTURE_TOKEN>` and `{"text": "...", "kind": "task" | "idea"}` (or a plain-text body). Adds a backlog task or a project idea. Up to 200 characters, 4 KB body, 30 calls an hour. `201` saved · `400` bad body · `401` bad token · `413` too large · `429` rate limited.

## Calendar (secret iCal address)

Set `CALENDAR_ICS_URL` to your calendar's secret address (Google Calendar > Settings > your calendar > Integrate calendar > Secret address in iCal format). Atlas reads today's events: single events, all-day events, DAILY/WEEKLY recurrences with INTERVAL, BYDAY, COUNT, UNTIL and EXDATE. Moved single instances of a recurring event (RECURRENCE-ID) are skipped. The URL is a credential: it is never logged or shown.

## Notion

Atlas reads one thing from Notion: the **Resumes** database in Atlas HQ. Each row is a target role with a `Priority` number, an optional `Share link` and an optional attached `Resume file`.

- **What it changes in Atlas:** the order of your target roles (Settings `careerRoles`) and each role's resume link (`careerResumes`). A Share link wins; a row with an attached file links to the row's Notion page, because Notion's file URLs expire within the hour. A role with nothing in Notion keeps the link pasted in Atlas.
- **When it syncs:** before each scheduled brief, when you open Target roles and the copy is older than ten minutes, and on Sync now in Connectors. Notion is never called at page load otherwise, and an outage leaves the last good copy in place.
- **Setup:** create an internal integration at notion.so/profile/integrations with **Read content** (add **Insert content** and **Update content** only if you want the resume sync below); put its secret in Vercel as `NOTION_TOKEN` (Sensitive, Production); in Notion open Atlas HQ, then ••• > Connections, and add the integration. `NOTION_RESUMES_DATA_SOURCE_ID` is optional: without it Atlas uses the shared database titled "Resumes".
- **When a sync is refused**, Atlas asks Notion what the connection can see and says which cause it is: nothing shared with the connection (or the token belongs to another connection), pages shared but not Resumes, Resumes visible but the Read content capability is off, or a malformed request (an Atlas bug). The message names the pages the connection can see.
- **Security:** with Read content only, Atlas cannot change or delete anything in Notion. With the two write capabilities, Atlas's code writes exactly one thing: the block it owns on each resume row's page (see the resume sync below). The only `PATCH` and `DELETE` calls in the codebase are in `writePageMirror`, and a test pins that. It sees only pages shared with the integration. Calls go through `safeFetch` to `api.notion.com` only. The token is tainted against reaching the browser and is never logged; errors shown are fixed text, never Notion's reply. Role names are trimmed to 80 characters and links must be https with no credentials. Code: `lib/integrations/notion.ts`, `lib/domain/notionRoles.ts`, `lib/connections/notion.ts`.

## Figma (read-only) and the resume sync

The resumes are designed in Figma and read by Atlas from Notion. The **resume sync** keeps the two in step: every Monday about 6 PM (weekly, because Figma's free plan allows only a few file reads a month; just before the Mentor's evening review) the Applications Agent reads each resume's Figma frame and, when its text changed, mirrors the text into that role's page in Notion and indexes it for Ask Atlas. **Sync now** on Target roles runs it on demand.

- **Which frame:** the first Figma link with a `node-id` in the row's `Notes` in the Resumes database. A row with no link is skipped and listed.
- **How the frame is read:** by where the text sits and how large it is, not by layer names, so renaming or regrouping layers does not break it. The largest text is the name; text clearly larger than the body is a section title; slightly larger is an entry title; indented body text is a bullet. Hidden layers are skipped. The Contact section, and any line holding an email address, phone number or profile link, is left out.
- **What it writes:** one callout block per resume page, labeled "Resume text, mirrored from Figma by Atlas", holding the resume as headings, paragraphs and bullets. The label carries the date and two short fingerprints (the Figma text and the block's text as written).
- **What it will not do:**
  - write a frame that does not read as a whole resume (fewer than three sections, no summary, no bullets, or under 600 characters);
  - overwrite text you edited in Notion: if the block's text no longer matches its fingerprint, the block is kept, and if Figma changed too the run reports a conflict instead of choosing;
  - touch a property, another block, another page, or the attached PDF (re-export the PDF yourself after a change);
  - call a model. The run costs nothing and sends your resume to no AI service.
- **Order of a write:** the new block is appended first, then the old copy is deleted, so a failure part-way never leaves a page without its text. A copy that could not be deleted is removed by the next write.
- **Setup:** in Figma, Settings > Security > Personal access tokens, create a token with the single scope **File content: read** and put it in Vercel as `FIGMA_TOKEN` (Sensitive, Production). Figma tokens expire after at most 90 days; when one does, the run fails with a message that says so. In Notion, give the Atlas connection **Insert content** and **Update content**.
- **Security:** Figma's REST API cannot change a file's contents, so the token cannot edit a design even if it leaked. Calls go through `safeFetch` to `api.figma.com` only; the file key and node ids are pattern-checked before they reach the URL. The token is tainted against reaching the browser and never logged; errors shown are fixed text. Code: `lib/integrations/figma.ts`, `lib/domain/resumeSync.ts`, `lib/knowledge/resumeMirror.ts`, `lib/agents/resumeSync.ts`.

## GitHub (read-only): your projects as evidence

Once a day the Scout reads your own repositories and records what each is built with, so the Analyst can measure how qualified you are for a role against what you have built, not only against what you ticked.

- **What is read:** for each of your 12 most recently pushed repositories (forks, archived ones and the profile repository are skipped): description, topics, languages, the first 4,000 characters of the README, the names of the files at the root, and `package.json`, `requirements.txt` and `pyproject.toml` when they are there. No other source file is read.
- **What is kept** (`portfolio_repos`): name, description, link, whether it is private, languages, topics, the stack (tools found in its dependency files and layout) and the skills it demonstrates, in the same words the market report uses. No code, no README text.
- **What it is used for:** a skill is **shown** when a project or a resume backs it. The Analyst's role outlook counts shown skills only; a ticked skill with nothing behind it does not count.
- **What goes to a model:** nothing from this read. The Mentor's role judgment sees role-level facts (percentages, counts, project names); the names of private repositories are replaced with "a private project" first.
- **Setup:** in Vercel add `GITHUB_USER` (your login). That alone reads public repositories. To include private ones add `GITHUB_TOKEN`: a fine-grained personal access token limited to the repositories you choose, with **Contents: Read-only** and **Metadata: Read-only**.
- **Security:** GET requests only, to `api.github.com` through `safeFetch`; the login and repository names are pattern-checked before they reach a URL. The token is tainted against reaching the browser and never logged; errors shown are fixed text. Code: `lib/integrations/github.ts`, `lib/domain/portfolio.ts`, `lib/agents/portfolio.ts`.

## Firecrawl (read-only): the postings of jobs you approved

A feed gives Atlas a job's title and its first few lines. When you give a job a 👍, the Applications Agent reads the full posting through Firecrawl and adds what it asks for to the apply kit, so you see it before you decide to apply.

- **What is read:** the posting page of a job you gave a 👍, once. Never LinkedIn, Indeed, Glassdoor, Wellfound, YC Work at a Startup, Dice, Welcome to the Jungle or Silicon Slopes (their terms forbid automated reading), and never a page that is not public https. Firecrawl applies each site's robots.txt.
- **What is kept:** a few lines in the kit: the experience asked for ("3–5 years"), the skills it names (from Atlas's own skill list), the pay it states, whether it is remote, hybrid or on-site, and what to watch for (a security clearance, citizenship, heavy travel, a required computer science degree, more experience than a junior to mid level role asks for). The posting's own text is not stored.
- **What goes to a model:** nothing from the posting. "Draft with AI" in a kit is given the skill names the rules found, so it searches and writes against what the job really asks for.
- **When:** right after the 👍 (in the background, so the thumb stays instant), at each 2-hour sync for anything that was missed, and from **Read postings now** in the Apply Queue. A page that will not read is marked in its kit and not tried again.
- **Budget:** Firecrawl's free plan is 1,000 pages a month with no card. Atlas stops at 900 a month, 40 a day and 5 a run, and counts in Settings (`firecrawlUsage`). Connectors shows the month's count.
- **Setup:** create a free Firecrawl account, copy the API key, add `FIRECRAWL_API_KEY` in Vercel and redeploy. Without it everything else works and the queue says how to turn it on.
- **Security:** one host, `api.firecrawl.dev`, through `safeFetch`. The request asks for the page's main text only, with `proxy: "basic"`: Firecrawl's default would retry a blocked page through proxies built to get past bot protection, and Atlas leaves such a page unread instead. The key is tainted against reaching the browser and never logged; errors shown are fixed text. Each run is logged, traced (site names only) and audited. Code: `lib/integrations/firecrawl.ts`, `lib/domain/postingFacts.ts`, `lib/agents/postingReader.ts`.

## Browserbase (removed 23 Nov 2026)

Atlas no longer applies for you, so the Apply Agent's cloud browser is gone: its adapter, its
host on the allowlist (`api.browserbase.com`) and its keys (`BROWSERBASE_API_KEY`,
`BROWSERBASE_PROJECT_ID`). Delete the keys in Vercel. The `apply_runs` table and the private
`resumes` bucket stay, read by nothing, as the record of what it sent.

## The Mentor's role proposals, and the second Notion write

Each morning the Mentor checks whether your target roles are in the right order (see [CAREER-DESK.md](CAREER-DESK.md)). A proposal changes nothing. When you approve one on Target roles:

- Atlas reads the Resumes rows again. If their order no longer matches the order the proposal was made against, nothing is written and the proposal is marked stale.
- It sets the **Priority** number on the role rows that move, reusing the numbers your roles already hold, so the Master Resume keeps its own. For a role you approved adding, it creates one row with the role's name and its Priority.
- If a write fails part-way, the numbers already changed are put back.
- It then reads the order back from Notion like any other sync, so Target roles and the Applications Agent follow.

Nothing else in Notion is touched, and no row is ever deleted. Code: `app/actions/roles.ts`, `writeRolePriority` and `createRoleRow` in `lib/integrations/notion.ts`.

## Public sources

| Source | Host(s) | Cache |
| --- | --- | --- |
| Weather | api.open-meteo.com | 30 min |
| News | news.google.com (Reuters, AP and Anthropic, which publish no RSS), techcrunch.com, www.theverge.com, feeds.arstechnica.com, thehill.com, moxie.foxnews.com, www.washingtonexaminer.com, thedispatch.com, feeds.a.dj.com | 30 min |
| Job boards | boards-api.greenhouse.io, api.lever.co, api.ashbyhq.com | 60 min |
| Job feeds (Career Agent) | remoteok.com (link back to each listing, as its API terms ask), weworkremotely.com (category RSS), hn.algolia.com (the Hacker News "Who is hiring?" thread) | 30-60 min |
| Google (authenticated) | oauth2.googleapis.com, gmail.googleapis.com | never cached |
| Firecrawl (authenticated) | api.firecrawl.dev (the postings of jobs you approved; see above) | never cached by Atlas |

Adding a source means adding its host to `ALLOWED_HOSTS` in `lib/security/safeFetch.ts`.

## Keep-alive

`POST /api/keepalive` with `Authorization: Bearer <ATLAS_KEEPALIVE_TOKEN>` runs one read query so Supabase Free sees activity. `200` ok · `401` bad token · `429` more than 12 calls an hour · `503` not configured or database down. Called by `.github/workflows/keepalive.yml`.
