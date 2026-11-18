// Your optimization team. Each agent owns one job, drafts or recommends, and never
// acts outside the app on its own. Minutes-saved figures are conservative estimates
// of the manual work each activity replaces; they feed the time-saved ledger.

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

/** The roster: one orchestrator, eight specialists (four on the Career desk), and the QA Agent, which reviews them all. */
export const AGENTS: readonly AgentProfile[] = [
  {
    id: "chief-of-staff",
    name: "Chief of Staff",
    role: "Orchestrator · briefs",
    owns: "Routes work to the specialists, sets priorities, applies Weekend Mode, and writes the 9:00 AM and 2:00 PM briefs, Hot List first.",
    never: "Do a specialist's deep work, or skip a failure silently: anything that failed shows in the brief.",
    color: "var(--c-purple)",
    initials: "CS",
    buildStep: 1,
    status: "live",
    tier: "writer",
    reportsTo: null,
    ai: "Words each brief's summary from the specialists' reports. The facts and the Hot List come from rules.",
  },
  {
    id: "calendar",
    name: "Calendar Agent",
    role: "Today and the week ahead",
    owns: "Reviews every Google Calendar event before each brief, covers today and the week ahead, flags conflicts, keeps appointments and interviews top of mind, and links each interview to its application.",
    never: "Add or change an event without your approval.",
    color: "var(--c-blue)",
    initials: "CA",
    buildStep: 2,
    status: "live",
    tier: "fast",
    reportsTo: "chief-of-staff",
  },
  {
    id: "news",
    name: "News Agent",
    role: "9 stories per brief",
    owns: "Tech (AI and Claude first), big-picture U.S. politics and major world news, 3 stories each, from the plan's sources. Ranks stories several outlets cover, balances center and conservative outlets, and shows only new stories at 2:00 PM.",
    never: "Fetch from a source that is not on the allowlist.",
    color: "var(--c-orange)",
    initials: "NW",
    buildStep: 3,
    status: "live",
    tier: "fast",
    reportsTo: "chief-of-staff",
  },
  {
    id: "email",
    name: "Email Agent",
    role: "Inbox, categories, declutter",
    owns: "Reads the inbox before each weekday brief, sorts it, counts finance emails, reports on the subscriptions you track, flags job emails for the Career Agent, archives what you tick and proposes senders to unsubscribe from. The only agent that reads the inbox; the Applications Agent reads only the text of the job emails it flags and of emails from companies you applied to.",
    never: "Archive or unsubscribe without your click, delete an email, or send one.",
    color: "var(--c-green)",
    initials: "EM",
    buildStep: 4,
    status: "live",
    tier: "fast",
    reportsTo: "chief-of-staff",
  },
  {
    id: "scout",
    name: "Scout",
    role: "Job market data",
    owns: "Reads the public job boards and feeds at every 2-hour sync, removes repeats, and records every posting that fits one of your roles: title, company, pay, location and the skills it asks for. It reports counts and failures, never opinions.",
    never: "Judge, rank or recommend. Read LinkedIn, Indeed, Glassdoor or Upwork, which have no public feed.",
    color: "var(--c-teal)",
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
    role: "Trends, fit and gaps",
    owns: "Turns the Scout's postings into a daily market report: demand and pay for each of your roles, the skills asked for most, where you fit best, and the gaps to close, ranked. The numbers are computed by rules; the model may only word them.",
    never: "Invent a number, or read anything but the Scout's data and your own skills and roles.",
    color: "var(--c-blue)",
    initials: "AN",
    buildStep: 8,
    status: "live",
    tier: "writer",
    reportsTo: "chief-of-staff",
    ai: "Words the daily market report. Every number is computed by rules, and a figure the model adds is thrown away.",
    desk: "career",
  },
  {
    id: "career",
    name: "Applications Agent",
    role: "Apply kits, two tracks",
    owns: "Picks each day's jobs to act on in two tracks, Full-time and Gigs, matches the resume, prepares an apply kit (role, listing, resume, your answers), logs applications from email (reading the text of job emails, and of emails from companies you applied to, by rules, for rejections, interview invites and the role) and queues follow-ups. Runs the Approval Queue and the Applications board.",
    never: "Submit anything: you click apply. LinkedIn, Indeed, Glassdoor and Upwork always stay semi-automatic.",
    color: "var(--c-pink)",
    initials: "AP",
    buildStep: 5,
    status: "live",
    tier: "writer",
    reportsTo: "chief-of-staff",
    ai: "Judges how a job fits your resume, and drafts \"what I'd bring\" for an apply kit, from your resume passages only. Matching and ranking are rules.",
    desk: "career",
  },
  {
    id: "mentor",
    name: "Mentor",
    role: "Coaching, three times a day",
    owns: "Looks at the whole job hunt from above: results by role and track, the market report, your resumes, your LinkedIn text and Growth. Morning sets the day's priority, midday checks progress, evening reviews. At most two insights a run, each resting on evidence you can see.",
    never: "Edit a resume, a setting or a page, repeat itself, or tell you something it cannot point to in your data.",
    color: "var(--c-purple)",
    initials: "MT",
    buildStep: 9,
    status: "live",
    tier: "writer",
    reportsTo: "chief-of-staff",
    ai: "Judges which observations matter most and whether your role order should change. It may only cite facts it was shown.",
    desk: "career",
  },
  {
    id: "finance",
    name: "Finance Agent",
    role: "Bills, renewals, deals",
    owns: "Reads the bills, statements and payment alerts the Email Agent tagged before each weekday brief, finds amounts and due dates, flags failed or past-due payments, keeps your Renewals list in view, offers to track new bills, and flags holiday deals from stores you keep. Email only.",
    never: "Connect to a bank, log in anywhere, move money, or add to Renewals without your click.",
    color: "var(--c-teal)",
    initials: "FN",
    buildStep: 6,
    status: "live",
    tier: "fast",
    reportsTo: "chief-of-staff",
  },
  {
    id: "qa",
    name: "QA Agent",
    role: "Weekly review of Atlas itself",
    owns: "Every Sunday evening, reviews the week from the records the other agents write: runs that failed or stopped, briefs that were missed or late, how often the AI model answered, eval scores, connections, tokens refused at the machine endpoints, and your own queues. Ranks what it finds, compares it with last week, and suggests a fix for each.",
    never: "Change Atlas, a setting or your data, read the content of an email or a brief, or use the AI model: the reviewer has to work when the model is what broke.",
    color: "var(--c-orange)",
    initials: "QA",
    buildStep: 10,
    status: "live",
    tier: "fast",
    // Independent: it reviews the Chief of Staff too, and reports to you.
    reportsTo: null,
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
