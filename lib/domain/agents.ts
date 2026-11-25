// Your team. Each bot wears its desk's color: Daily blue, Career orange, System yellow, QA red. Each agent owns one job, drafts or recommends, and never
// acts outside the app on its own. Minutes-saved figures are conservative estimates
// of the manual work each activity replaces; they feed the time-saved ledger.

import type { AiUse, Kind, Reach, Trigger } from "./registry";
import type { AgentId, LedgerEntry } from "./types";

export type AgentStatus = "live" | "next" | "planned";

export interface AgentProfile {
  id: AgentId;
  name: string;
  role: string;
  owns: string;
  never: string;
  color: string;
  initials: string;
  /** Position in the plan's build order. */
  buildStep: number;
  /** live: running as its own agent. next/planned: its work still runs inside the Chief of Staff. */
  status: AgentStatus;
  /** Workflow, bot or agent: who picks the next step (registry.ts defines each). */
  kind: Kind;
  /** The industry name for how it works, for explaining it in a sentence. */
  pattern: string;
  /** Inside Atlas, or acting on a site outside it. */
  reach: Reach;
  /** What starts it: a schedule, a button, or both. */
  trigger: Trigger;
  /** fast = a cheaper model for sorting and tagging; writer = a stronger model for writing. */
  tier: "fast" | "writer";
  reportsTo: AgentId | null;
  /** The Career desk: four agents that share one goal and hand work to each other through shared data. A grouping, not a manager. */
  desk?: "career";
  /**
   * What this agent asks the AI model (Gemini or Claude) to do. Absent means rules only:
   * the agent never calls a model. Every use is checked against facts computed by rules,
   * and falls back to rules when the model is off, over its daily limit, or wrong.
   */
  ai?: string;
}

/** The roster: one orchestrator workflow (the Chief of Staff) and ten bots, four of them on the Career desk. The agents (Pitch, Company Research, Interview Prep, Weekly Strategist, Follow-up) are in registry.ts `LOOP_AGENTS`: they run under the Applications bot. */
export const AGENTS: readonly AgentProfile[] = [
  {
    id: "chief-of-staff",
    name: "Chief of Staff",
    kind: "workflow",
    pattern: "Orchestrator-worker",
    reach: "inside",
    trigger: "both",
    role: "Orchestrator · briefs",
    owns: "Routes work to the specialists, sets priorities, applies Weekend Mode, and writes the 9:00 AM and 2:00 PM briefs, Hot List first.",
    never: "Do a specialist's deep work, or skip a failure silently: anything that failed shows in the brief.",
    color: "var(--c-system)",
    initials: "CS",
    buildStep: 1,
    status: "live",
    tier: "writer",
    reportsTo: null,
    ai: "Words each brief's summary from the specialists' reports. The facts and the Hot List come from rules.",
  },
  {
    id: "calendar",
    name: "Calendar",
    kind: "bot",
    pattern: "Rules-based monitor",
    reach: "inside",
    trigger: "schedule",
    role: "Today and the week ahead",
    owns: "Reviews every Google Calendar event before each brief, covers today and the week ahead, flags conflicts, keeps appointments and interviews top of mind, and links each interview to its application.",
    never: "Add or change an event without your approval.",
    color: "var(--c-daily)",
    initials: "CA",
    buildStep: 2,
    status: "live",
    tier: "fast",
    reportsTo: "chief-of-staff",
  },
  {
    id: "news",
    name: "News",
    kind: "bot",
    pattern: "Rules-based aggregator",
    reach: "inside",
    trigger: "schedule",
    role: "9 stories per brief",
    owns: "Tech (AI and Claude first), big-picture U.S. politics and major world news, 3 stories each, from the plan's sources. Ranks stories several outlets cover, balances center and conservative outlets, and shows only new stories at 2:00 PM.",
    never: "Fetch from a source that is not on the allowlist.",
    color: "var(--c-daily)",
    initials: "NW",
    buildStep: 3,
    status: "live",
    tier: "fast",
    reportsTo: "chief-of-staff",
  },
  {
    id: "email",
    name: "Email",
    kind: "bot",
    pattern: "Rules-based classifier",
    reach: "inside",
    trigger: "both",
    role: "Inbox, categories, declutter",
    owns: "Reads the inbox before each weekday brief, sorts it, counts finance emails, reports on the subscriptions you track, flags job emails for the Applications bot, archives what you tick and proposes senders to unsubscribe from. The only agent that reads the inbox; the Applications bot reads only the text of the job emails it flags and of emails from companies you applied to.",
    never: "Archive or unsubscribe without your click, delete an email, or send one.",
    color: "var(--c-daily)",
    initials: "EM",
    buildStep: 4,
    status: "live",
    tier: "fast",
    reportsTo: "chief-of-staff",
  },
  {
    id: "scout",
    name: "Scout",
    kind: "bot",
    pattern: "Scraper and ETL",
    reach: "inside",
    trigger: "both",
    role: "Job market data",
    owns: "Reads the public job boards and feeds at every 2-hour sync (entry-level searches included), removes repeats, and records every posting that fits one of your roles: title, company, pay, location, the skills and the years it asks for. Reads your GitHub projects once a day. It reports counts and failures, never opinions.",
    never: "Judge, rank or recommend. Record contract, freelance or part-time postings. Read LinkedIn, Indeed or Glassdoor, which have no public feed.",
    color: "var(--c-career)",
    initials: "SC",
    buildStep: 7,
    status: "live",
    tier: "fast",
    reportsTo: "chief-of-staff",
    desk: "career",
  },
  {
    id: "analyst",
    name: "Analyst",
    kind: "bot",
    pattern: "Rules compute, LLM words",
    reach: "inside",
    trigger: "both",
    role: "Market, funnel and gaps",
    owns: "Turns the Scout's postings into a daily market report: demand and pay for each of your roles, the skills asked for most, where you fit best, and what your own applications say (the funnel). Ranks your gaps, assigns one proof project at a time and closes it when GitHub shows the skill, keeps lessons for the Career Mentor and the Tailor, and sorts unclear job titles into your six roles. The numbers are computed by rules; the model may only word them.",
    never: "Invent a number, or read anything but the Scout's data and your own skills and roles.",
    color: "var(--c-career)",
    initials: "AN",
    buildStep: 8,
    status: "live",
    tier: "writer",
    reportsTo: "chief-of-staff",
    ai: "Words the daily market report and a proof project's brief, and sorts job titles the rules cannot place. Every number is computed by rules, and a figure the model adds is thrown away.",
    desk: "career",
  },
  {
    id: "career",
    name: "Applications",
    kind: "bot",
    pattern: "LLM-as-judge with RAG drafts",
    reach: "inside",
    trigger: "both",
    role: "Apply Queue, kits and the pipeline",
    owns: "Picks each day's full-time roles at your level (junior to 2 years asked at most; senior roles ignored), picks the 5 to apply to today, finds more whenever you ask, matches the resume, prepares an apply kit and its company research, logs applications from email (reading the text of job emails, and of emails from companies you applied to, by rules) and queues follow-ups. Runs the Apply Queue and the Pipeline, and runs Atlas's agents: the Researcher researches a company, the Tailor tailors an application, the Coach prepares an interview, the Planner plans your week and the Nudger writes follow-ups.",
    never: "Submit anything: you click apply. Look for contract, freelance or part-time work. LinkedIn, Indeed and Glassdoor always stay semi-automatic.",
    color: "var(--c-career)",
    initials: "AP",
    buildStep: 5,
    status: "live",
    tier: "writer",
    reportsTo: "chief-of-staff",
    ai: "Judges how a job fits your resume, drafts \"what I'd bring\" and the company angle from cited facts, and runs the Tailor and Coach agents. Matching, level and ranking are rules.",
    desk: "career",
  },
  {
    id: "mentor",
    name: "Career Mentor",
    kind: "bot",
    pattern: "LLM-as-judge on evidence",
    reach: "inside",
    trigger: "both",
    role: "Coaching, three times a day",
    owns: "Looks at the whole job hunt from above: results by role, the market report, your level rule, your proof project, your resumes, your LinkedIn text and Growth. Morning sets the day's priority, midday checks progress, evening reviews. At most two insights a run, each resting on evidence you can see; advice is graded by rules (one step, doable today, not something you already did) and builds on your Action Taken notes and the lessons from your results.",
    never: "Edit a resume, a setting or a page, repeat itself, or tell you something it cannot point to in your data.",
    color: "var(--c-career)",
    initials: "MT",
    buildStep: 9,
    status: "live",
    tier: "writer",
    reportsTo: "chief-of-staff",
    ai: "Judges which observations matter most and whether your role order should change, and rewrites advice the rules graded as weak. It may only cite facts it was shown.",
    desk: "career",
  },
  {
    id: "finance",
    name: "Finance",
    kind: "bot",
    pattern: "Rules-based extractor",
    reach: "inside",
    trigger: "schedule",
    role: "Bills, renewals, deals",
    owns: "Reads the bills, statements and payment alerts the Email bot tagged before each weekday brief, finds amounts and due dates, flags failed or past-due payments, keeps your Renewals list in view, offers to track new bills, and flags holiday deals from stores you keep. Email only.",
    never: "Connect to a bank, log in anywhere, move money, or add to Renewals without your click.",
    color: "var(--c-daily)",
    initials: "FN",
    buildStep: 6,
    status: "live",
    tier: "fast",
    reportsTo: "chief-of-staff",
  },
  {
    id: "qa",
    name: "QA",
    kind: "bot",
    pattern: "Rules-based evaluator",
    reach: "inside",
    trigger: "both",
    role: "Weekly review of Atlas itself",
    owns: "Every Sunday evening, reviews the week from the records the other agents write: runs that failed or stopped, briefs that were missed or late, how often the AI model answered, eval scores, connections, tokens refused at the machine endpoints, and your own queues. Ranks what it finds, compares it with last week, and suggests a fix for each.",
    never: "Change Atlas, a setting or your data, read the content of an email or a brief, or use the AI model: the reviewer has to work when the model is what broke.",
    color: "var(--c-qa)",
    initials: "QA",
    buildStep: 10,
    status: "live",
    tier: "fast",
    // Independent: it reviews the Chief of Staff too, and reports to you.
    reportsTo: null,
  },
  {
    id: "apply",
    name: "Apply",
    kind: "bot",
    pattern: "Tool-calling worker, human-in-the-loop",
    reach: "inside",
    trigger: "button",
    role: "Answers application forms for Atlas Autofill",
    owns: "When you press Help me apply in the Safari extension, it answers that form from your answer bank, your fixed answers and your resume, and you review every answer before you submit on the site yourself. It never submits an application (the cloud-browser Apply bot was removed on 23 Nov 2026).",
    never: "Submit, send or click anything on a job site, touch LinkedIn, Indeed or Glassdoor, sign in anywhere, or answer an eligibility or demographic question you did not answer yourself.",
    color: "var(--c-career)",
    initials: "AA",
    buildStep: 11,
    status: "live",
    tier: "writer",
    // You start it, one form at a time; it reports to you.
    reportsTo: null,
    ai: "Drafts an answer to a form's own open question from your resume passages. A draft is kept only when it cites a passage and every number in it is in your resume, and you review it before you submit. Eligibility, salary and demographic questions are never drafted.",
  },
];

export function agent(id: AgentId): AgentProfile {
  return AGENTS.find((a) => a.id === id)!;
}

/** Conservative minutes each activity saves versus doing it by hand. */
export const MINUTES_SAVED = {
  briefRead: 20,
  /** The 2:00 PM brief is shorter: only what is new since the morning. */
  afternoonBriefRead: 10,
  weekPlanned: 30,
  draftWritten: 6,
  newsDigest: 15,
  jobScan: 20,
  weeklyReview: 15,
  dayBlocked: 10,
} as const;

export function totalMinutes(entries: LedgerEntry[]): number {
  return entries.reduce((n, e) => n + e.minutesSaved, 0);
}

export function minutesByAgent(entries: LedgerEntry[]): Record<AgentId, number> {
  const out = Object.fromEntries(AGENTS.map((a) => [a.id, 0])) as Record<AgentId, number>;
  for (const e of entries) out[e.agent] += e.minutesSaved;
  return out;
}

/** Rules only, or AI-assisted: read from whether the bot asks the model anything. */
export const aiUse = (p: Pick<AgentProfile, "ai">): AiUse => (p.ai ? "ai-assisted" : "rules");

/** How a sentence names it: "the Email bot", "the Chief of Staff". */
export const spokenName = (p: Pick<AgentProfile, "name" | "kind">): string => (p.kind === "bot" ? `${p.name} bot` : p.name);
