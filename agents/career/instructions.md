# Career Agent (build step 5, part 5a live)

The most complex agent. Goal: a full-time role that fits the owner's target roles,
location and pay floor, plus contract income on the side.

## Focus: Tyler's seven target roles, in priority order

Tyler sets the order in the Priority column of the Resumes database in his Notion (Atlas
HQ), and Atlas syncs it. As of 18 Nov 2026:

1. **Solutions Engineer** (also AI Solutions Engineer, Integration Engineer, Solutions
   Architect, Customer Engineer; demo-only pre-sales postings rank lower)
2. **Software Engineer** (also Full Stack, Backend, Product Engineer)
3. **AI Engineer** (also Applied AI, AI Integration, LLM and GenAI Engineer)
4. **AI + Automation Engineer** (also Internal AI Engineer, Intelligent Automation)
5. **AI Workflow Engineer** (also AI Agent Engineer, Agentic AI Engineer, Workflow Automation)
6. **Forward Deployed Engineer (FDE)** (also Agent Deployment Engineer, Deployment Engineer)
7. **GTM Engineer** (also Go-to-Market, GTM Systems, RevOps and Revenue Engineer)

The sheet's first row, **Master Resume**, is the copy the others are tailored from. It is
a resume, not a role: Atlas never hunts for it.

Entry to mid level: staff, principal, lead, manager, director and above are skipped;
senior is kept but ranked lower. QA/test automation, internships and non-engineering
roles are skipped. A specific role always wins over the generic Software Engineer.

Level and pay, from the 18 Nov 2026 direction below:

- **Engineer I and II rank higher.** "Solutions Engineer II" or "Software Engineer, Level 2"
  is the entry-to-mid level Tyler is aiming at.
- **Associate and Specialist titles rank lower when no base pay is posted**, and the match
  says so ("salary not listed · Associate title"). Those titles usually pay less. A posted
  salary that clears the floor speaks for itself.
- **Base pay is not the same as OTE.** A figure that includes variable pay (OTE,
  commission, bonus, total compensation) is not the salary. When the posting also states
  the base, the base is the figure Atlas shows and checks against the floor. When it does
  not, the match is kept and marked "includes variable pay", so Tyler asks for the base.
The list lives in `lib/domain/targetRoles.ts`, and Tyler can reorder or change it in
Settings without a code change.

## Career direction (Fable, 13 Nov 2026)

Tyler's edge is where building meets the business: he designs agent systems, wires them
into real tools and works with decision-makers. The full advice is in
`lib/domain/careerDirection.ts`, on the Target roles tab and in Notion (Atlas HQ ›
Brainstorm). Tyler's own order above takes priority over its ranking; the direction
shapes how the agent reads the market:

- **Market names count as Tyler's roles.** Agent Deployment Engineer is Forward
  Deployed; AI Agent and Agentic AI Engineer are AI Workflow; Internal AI Engineer is
  AI + Automation; AI Solutions Engineer is Solutions Engineer.
- **Skip demo-only pre-sales.** A Solutions or Sales Engineer posting with several
  sales signals (quota, commission, demos to prospects, sales cycle) and little building
  is ranked well below the rest. Implementation and internal SE roles are kept.
- **Skills to showcase**, tracked on Growth: multi-agent orchestration (call Atlas a
  supervisor pattern), MCP and API integration, evals and observability (the rarest;
  Atlas should get an eval suite and tracing), shipping production software with AI
  coding tools, and scoping with numbers.
- **Drop** "AI fluent" and "prompt engineering" as headline skills: the LinkedIn
  tune-up never suggests them.
- GTM Engineer was added as a target role (#5) on Tyler's say-so, 13 Nov 2026.

## Positioning (Fable, 18 Nov 2026)

Tyler leads with **Solutions Engineer**: it matches the most postings for what he builds,
which is integrations, workflow automation and AI agents. Integration Engineer is the same
work under another name, so it counts as Solutions Engineer. The notes are in
`lib/domain/careerDirection.ts` (`positioning`) and on the Target roles tab:

- Name the title in the first two lines of the headline and About. "Aspiring" and "seeking"
  read as junior, and the Mentor flags them, along with "entry level", in the LinkedIn text.
- Say the level without writing "entry level": "with senior engineers to learn from".
- Lead with what was built. The current job gets one sentence; the detail goes in Experience.
- MCP is named only as part of the daily workflow until a repo has an MCP server Tyler built.
- For pay at entry to mid level, see "Level and pay" above.

## Targets

- Full-time: at or above the salary floor in Settings; remote (open to the U.S.)
  preferred, hybrid or onsite in Salt Lake County as backup; startups ideal.
- Contract and gigs: at or above the hourly floor in Settings.
- Listings with no posted pay are included and marked "salary not listed". Posted pay
  below the floor rules a listing out. With no floor set, pay rules nothing out.
- A posted base is what counts. "OTE $140k ($95k base)" is read as $95k.

## Matching (part 5a)

- Up to 10 full-time and 10 gig matches per weekday brief; none on Saturday.
- Never repeats a match: the 2:00 PM matches are new since the morning, and nothing
  shown on an earlier day comes back.
- Ranking: freshest first (the last 24-48 hours get far more responses), then role
  priority, remote, posted pay, level (Engineer I and II up; senior, and Associate or
  Specialist with no base posted, down), and Tyler's thumbs up/down on earlier matches
  (by role, company and source).
- Sources with public feeds: Remote OK, We Work Remotely, Hacker News "Who is hiring?"
  and "Freelancer? Seeking freelancer?", and Tyler's company watchlist on Greenhouse,
  Lever and Ashby. LinkedIn, Indeed, Glassdoor, Wellfound, YC Work at a Startup, Dice,
  Welcome to the Jungle, Silicon Slopes, Upwork and Contra have no public feed and
  forbid scraping, so Atlas gives saved searches for them instead.
- Referral check: when someone in People works at a matched company, the match says so.

## Applying

- Semi-Automation only. Pursue sends a match to the Approval Queue with what is needed
  to apply. Tyler opens the posting, applies on their site, and marks it submitted.
  Nothing is ever submitted by Atlas. LinkedIn, Indeed and Glassdoor always stay
  semi-automatic.
- Atlas is the application tracker (the Applications board). Applications are logged from
  email: a "thank you for applying" email adds one as Applied, and later emails from that
  company move it to Replied, Interview or Rejected (forward only, never twice). A one-time
  Gmail catch-up covers the last 90 days. Interviews come from Google Calendar, linked to
  their application.

## Limits

- Rules only, no model call: every run costs $0.
- A failed source is named in the brief; if every source fails, the run is logged as
  failed.

## Part 5b (live)

- **Resume library:** one resume link per role on the Target roles page (files live in
  Tyler's Notion Resumes database or Google Drive). Each pursued job links its role's resume.
- **Answer bank:** one saved answer per common question (intro, work history, salary,
  work authorization, start date, location, "why this company", links). Every application
  in the Approval Queue shows them tailored to the company and role, ready to copy.
- **Follow-ups:** an application still at Applied a week after applying gets one short
  follow-up email in the Approval Queue. Tyler sends it from his own mail; Atlas never sends.
- **Friday scorecard:** Friday's brief and the Applications page show the week's
  applications sent, replies, interviews, offers and the overall response rate.

## Part 5c (live): growth

- **Skill gaps:** every matched job records the skills it asks for. The Growth page ranks
  them by how often they appear, weighted toward Tyler's higher-priority roles, and the
  ones he has not marked as his are his gaps.
- **Monthly portfolio project:** one small project that closes the biggest gap, on the
  Growth page and in the brief on the first weekday of each month. It doubles as an
  Upwork portfolio piece.
- **LinkedIn tune-up:** a headline led by the top two roles, skills to list (ones he has
  that employers ask for most), what to learn next, and About-section tips.

Code: `lib/domain/targetRoles.ts`, `lib/domain/careerAgent.ts` (matching), `lib/domain/careerPrep.ts` (answers, follow-ups, scorecard), `lib/domain/skills.ts` (growth),
`lib/integrations/jobFeeds.ts` (sources), `lib/agents/career.ts` (the run),
`lib/domain/applications.ts` and `app/actions/career.ts` (tracker and Approval Queue).
