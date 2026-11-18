// Domain records shared by every layer. Pure types: no I/O, no framework imports.
// Field names are camelCase here; the Supabase adapter maps them to snake_case columns.

export const AREAS = ["work", "career", "family", "health", "home", "finance", "personal"] as const;
export type Area = (typeof AREAS)[number];

export const TASK_STATUSES = ["todo", "doing", "stuck", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const ENERGY = ["deep", "shallow"] as const;
export type Energy = (typeof ENERGY)[number];

export const RECURRENCE = ["none", "daily", "weekdays", "weekly"] as const;
export type Recurrence = (typeof RECURRENCE)[number];

/** A local calendar date, "YYYY-MM-DD", in the owner's timezone. */
export type LocalDate = string;

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  area: Area;
  /** The day it is planned for, or null while it sits in the backlog. */
  day: LocalDate | null;
  /** Optional "HH:MM" start time on that day. */
  startTime: string | null;
  estimateMin: number;
  energy: Energy;
  recurrence: Recurrence;
  createdAt: string;
  completedAt: string | null;
}

export interface Goal {
  id: string;
  /** Monday of the week the goal belongs to. */
  weekOf: LocalDate;
  title: string;
  area: Area;
  done: boolean;
  createdAt: string;
}

export const CIRCLES = ["team", "family", "friends", "network"] as const;
export type Circle = (typeof CIRCLES)[number];

export interface Contact {
  id: string;
  name: string;
  circle: Circle;
  email: string | null;
  phone: string | null;
  /** How often you want to be in touch, in days. 0 = no cadence. */
  cadenceDays: number;
  lastContactAt: string | null;
  /** "MM-DD", year-less, so it repeats. */
  birthday: string | null;
  notes: string;
  /** Slack workspace (team) ID, e.g. "T012AB3CD". Optional: Slack hand-off needs both IDs. */
  slackTeamId?: string | null;
  /** Slack member ID, e.g. "U012AB3CD". */
  slackUserId?: string | null;
  createdAt: string;
}

export const CHANNELS = ["email", "sms", "slack"] as const;
export type Channel = (typeof CHANNELS)[number];

export const MESSAGE_STATUSES = ["draft", "handed_off", "cancelled"] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface OutboundMessage {
  id: string;
  contactId: string;
  channel: Channel;
  subject: string;
  body: string;
  status: MessageStatus;
  /** "ai" when Claude drafted it, "template" for the offline drafter, "you" when typed. */
  draftedBy: "ai" | "template" | "you";
  createdAt: string;
  handedOffAt: string | null;
}

export interface Routine {
  id: string;
  title: string;
  /** "morning" | "evening" | "weekly-review" */
  slot: "morning" | "evening" | "weekly-review";
  minutes: number;
  position: number;
  /** Local date it was last checked, so it resets each day. */
  lastDoneOn: LocalDate | null;
  createdAt: string;
}

export const RENEWAL_KINDS = ["bill", "renewal", "document"] as const;
export type RenewalKind = (typeof RENEWAL_KINDS)[number];

export const RENEWAL_CADENCES = ["once", "monthly", "yearly"] as const;
export type RenewalCadence = (typeof RENEWAL_CADENCES)[number];

export interface Renewal {
  id: string;
  title: string;
  kind: RenewalKind;
  /** Next due date, "YYYY-MM-DD" in the owner's calendar. */
  dueOn: LocalDate;
  /** Days before dueOn to start showing it. 0 means only today and overdue. */
  leadDays: number;
  cadence: RenewalCadence;
  /**
   * Day of month the due date wants (1-31). Monthly and yearly steps clamp to the
   * length of the target month, then keep this anchor, so 31 January becomes
   * 28 February and 31 March rather than drifting to the 28th forever.
   */
  anchorDay: number;
  /** Account or document link. Empty, or an https URL with no username. */
  url: string;
  notes: string;
  createdAt: string;
}

export const JOB_BOARDS = ["greenhouse", "lever", "ashby"] as const;
export type JobBoard = (typeof JOB_BOARDS)[number];

export interface JobWatch {
  id: string;
  company: string;
  board: JobBoard;
  /** The board's public slug, e.g. "anthropic" in boards.greenhouse.io/anthropic. */
  slug: string;
  createdAt: string;
}

export interface Settings {
  displayName: string;
  timezone: string;
  /** For the weather card. */
  latitude: number;
  longitude: number;
  placeName: string;
  /** Minutes of planned work per weekday before the planner calls a day full. */
  dailyCapacityMin: number;
  jobKeywords: string[];
  jobLocations: string[];
  newsTopics: NewsTopic[];
  /** Kill switch. Off = no drafts can be handed off and no AI calls run. */
  outboundEnabled: boolean;
  aiEnabled: boolean;
  /** Working hours for time-blocking, "HH:MM". Optional: lib/domain/schedule.ts has defaults. */
  workStart?: string;
  workEnd?: string;
  /** Shortest free gap worth blocking, in minutes. */
  minSlotMin?: number;
  /** Breathing room kept before and after each meeting, in minutes. */
  meetingBufferMin?: number;
  /** Email Agent: stores and senders you keep (never proposed for unsubscribing). */
  emailStores?: string[];
  /** Email Agent: subscriptions you track, e.g. "Apex Fitness" or "Disney/Hulu". */
  emailSubscriptions?: string[];
  /** Email Agent: sender domains already unsubscribed from. Written by Atlas. */
  emailUnsubscribed?: string[];
  /** Career Agent: the roles you target (defaults in lib/domain/targetRoles.ts). */
  careerRoles?: string[];
  /** Career Agent: full-time salary floor in USD per year. */
  careerMinSalary?: number;
  /** Career Agent: contract and gig floor in USD per hour. */
  careerMinRate?: number;
  /** Career Agent: a link to your resume for each target role (e.g. a Google Drive file), by role name. */
  careerResumes?: Record<string, string>;
  /** Your master resume (the copy the role resumes are tailored from). Synced from Notion. */
  careerMasterResume?: string;
  /** Applications Agent: planned applications a day per track (defaults 3 and 1). The Mentor measures you against them. */
  careerDailyFullTime?: number;
  careerDailyGigs?: number;
  /** Your LinkedIn headline and About, pasted by you for the Mentor to review. Contact details are stripped when it is saved. */
  linkedinProfile?: string;
  /** Career Agent: your answer bank, by question id (lib/domain/careerPrep.ts). */
  careerAnswers?: Record<string, string>;
  /** Career Agent: skills you already have, by name (lib/domain/skills.ts). */
  careerSkills?: string[];
  /** The last sync with Notion (role order and resume links). Written by Atlas. */
  notion?: NotionSync;
  /** The Resumes data source in Notion, remembered so it is read directly. Not a secret. */
  notionResumesId?: string;
}

export interface NotionSync {
  /** When Atlas last tried, ISO. */
  at: string;
  ok: boolean;
  /** The Notion workspace the token belongs to. */
  workspace: string;
  /** Roles read, and how many resumes Notion holds (role resumes plus the master). */
  roles: number;
  resumes: number;
  /** True when the sheet has a Master Resume row with a file or link. */
  master?: boolean;
  /** What went wrong, in plain words, when ok is false. */
  message: string;
  /** After a refused sync: titles of what the connection can see in Notion (first few). */
  sees?: string[];
}

export const NEWS_TOPICS = ["politics", "world", "tech", "ai"] as const;
export type NewsTopic = (typeof NEWS_TOPICS)[number];
/** How the plan groups news sources: center, conservative, or not political (tech). */
export type Lean = "center" | "conservative" | "none";

export interface AuditEvent {
  id: string;
  at: string;
  actor: "owner" | "system" | "job-hunt" | "ai";
  action: string;
  target: string;
  detail: string;
  outcome: "success" | "denied" | "error";
}

export interface LedgerEntry {
  id: string;
  at: string;
  agent: AgentId;
  activity: string;
  minutesSaved: number;
}

/**
 * The roster: one orchestrator, eight specialists, and the QA Agent that reviews them. Four of them form the Career desk
 * (scout, analyst, career, mentor). "career" is the Applications Agent: it keeps the id
 * it has always had, so its history in the activity log stays in one piece.
 */
export const AGENT_IDS = ["chief-of-staff", "email", "calendar", "news", "finance", "career", "scout", "analyst", "mentor", "qa"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

// ---- career tracker (built by the Career Agent from Atlas's own data) ----
// lib/domain/careerSnapshot.ts builds this from the Applications board and the
// interviews on your Google Calendar. Do-next, the Hot List, pipeline counts, interview
// prep and the weekly review all read it.

export interface TrackedApplication {
  applicationId: string;
  company: string;
  role: string;
  /** "Draft", "Applied", "Reply", "Interview 1"..., "Offer", "Rejected". */
  stage: string;
  appliedDate: string;
  stageUpdatedAt: string;
  nextAction: string;
  nextActionDue: string;
  postingUrl: string;
}

export interface TrackedInterview {
  interviewId: string;
  /** The application it belongs to, or "" when no tracked application matched. */
  applicationId: string;
  company: string;
  role: string;
  round: string;
  start: string;
  end: string;
  status: string;
  meetingLink: string;
}

export interface CareerSnapshot {
  generatedAt: string;
  applications: TrackedApplication[];
  interviews: TrackedInterview[];
}

// ---- read-only feeds ----

export interface NewsItem {
  id: string;
  topic: NewsTopic;
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

export interface JobPosting {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;
  board: JobBoard;
  updatedAt: string | null;
  /** 0-100, from keyword and location match. */
  score: number;
  matched: string[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  source: "calendar" | "interview" | "task";
  /** Marked "Free" (TRANSP:TRANSPARENT) in the calendar: shown, but never a conflict. */
  free?: boolean;
}

export interface Weather {
  place: string;
  tempNowF: number;
  highF: number;
  lowF: number;
  precipChance: number;
  summary: string;
}

// ---- projects, inbox, connections, push ----

export const PROJECT_KINDS = ["idea", "side-project", "career", "learning", "home", "other"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const PROJECT_STATUSES = ["idea", "exploring", "active", "parked", "done"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Something worth keeping in mind: a side project, an idea, a skill to learn. */
export interface Project {
  id: string;
  title: string;
  kind: ProjectKind;
  status: ProjectStatus;
  why: string;
  nextStep: string;
  link: string | null;
  /** The day it should come back to the brief. Null = only while active. */
  reviewOn: LocalDate | null;
  createdAt: string;
}

export const INBOX_CATEGORIES = ["reply", "fyi", "noise"] as const;
export type InboxCategory = (typeof INBOX_CATEGORIES)[number];

/**
 * One email, triaged from its headers (and Gmail's one-line preview over OAuth). The text
 * of a job email is read once by the Applications Agent; only its verdict and the one
 * sentence that decided it are kept, never the text.
 */
export interface InboxItem {
  id: string;
  messageId: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  category: InboxCategory;
  reason: string;
  done: boolean;
  createdAt: string;
  /** A job email's text, read: a rejection, an interview invite, or neither. Unset until read. */
  textVerdict?: "interview" | "rejection" | "none" | null;
  /** The sentence that decided `textVerdict`, without addresses, phone numbers or links. */
  textQuote?: string;
  /** The role the email's text names ("Senior AI Engineer"), or "". */
  textRole?: string;
}

export const PROVIDERS = ["google", "gmail_imap"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** A connected account, as the owner's session sees it (the token is never included). */
export interface ConnectionInfo {
  id: string;
  provider: Provider;
  accountEmail: string;
  scopes: string;
  status: "active" | "error";
  lastSyncAt: string | null;
  lastError: string;
  createdAt: string;
}

export interface PushSubscriptionRecord {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  device: string;
  createdAt: string;
}

/** A reusable message you saved for one channel. {first}, {name} and {me} are filled in. */
export interface Snippet {
  id: string;
  channel: Channel;
  title: string;
  body: string;
  createdAt: string;
}

// ---- agent orchestration ----

export const BRIEF_SLOTS = ["morning", "afternoon", "saturday"] as const;
export type BriefSlot = (typeof BRIEF_SLOTS)[number];

export const RUN_STATUSES = ["started", "succeeded", "failed", "skipped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** One line in the activity log. Every agent writes these; Mission Control reads them. */
/** One step of an agent run: what it did, how long it took, and what it decided. */
export interface TraceStep {
  name: string;
  ms: number;
  ok: boolean;
  /** The outcome in plain words: "42 emails: 3 need a reply". Counts and decisions only, never email text. */
  note: string;
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  agent: AgentId;
  task: string;
  status: RunStatus;
  trigger: "schedule" | "run-now" | "owner";
  detail: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Whole run, start to finish. Set on the row that ends a run. Added with tracing. */
  durationMs?: number | null;
  /** The run's steps, in order. Set on the row that ends a run. */
  trace?: TraceStep[] | null;
  at: string;
}

export interface AgentStateRecord {
  agent: AgentId;
  paused: boolean;
  updatedAt: string;
}

/** A brief as kept in history. `report` is the Chief of Staff's assembled report. */
export interface StoredBrief {
  id: string;
  forDate: LocalDate;
  slot: BriefSlot;
  headline: string;
  report: unknown;
  /** Plain text used by brief-history search. */
  search: string;
  createdAt: string;
}

// ---- Career Agent (build step 5) ----

/** Full-time roles, or contract work and gigs. */
export const JOB_TYPES = ["full-time", "gig"] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Where an application stands; the Applications board has one column per status. */
export const APPLICATION_STATUSES = ["saved", "applied", "replied", "interview", "offer", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export type PayUnit = "year" | "hour" | "";

/** A posting the Career Agent showed in a brief. Kept so no match is ever shown twice. */
export interface JobMatch {
  id: string;
  /** Stable identity of the posting (source + id or url); unique per owner. */
  key: string;
  type: JobType;
  title: string;
  company: string;
  url: string;
  source: string;
  location: string;
  /** Which of your target roles it matched. */
  role: string;
  /** "$120k-$150k", "$60/hr", or "salary not listed". */
  payText: string;
  postedAt: string | null;
  score: number;
  /** Date and brief it was first shown in. */
  shownOn: string;
  shownSlot: string;
  /** Your thumbs: 1 up, -1 down, 0 not rated. */
  rating: number;
  /** new, pursuing (a 👍 sent it to the Approval Queue), applied, or dismissed. */
  status: "new" | "pursuing" | "applied" | "dismissed";
  /** Skills the posting asks for (lib/domain/skills.ts). Added in part 5c. */
  skills?: string[];
  createdAt: string;
}

export interface Application {
  id: string;
  company: string;
  role: string;
  type: JobType;
  /** Which of your target roles it is for ("" when not one of them). */
  targetRole: string;
  source: string;
  url: string;
  payText: string;
  /** Semi-Automation: you submit; Full Automation is not available yet. */
  tier: "semi";
  status: ApplicationStatus;
  appliedOn: string | null;
  statusAt: string;
  notes: string;
  /** "atlas". ("job-hunt" remains allowed by the database for any rows imported before it was retired.) */
  origin: "atlas" | "job-hunt";
  /** The email or match it came from ("email:<id>", "match:<key>"), so nothing is logged twice. */
  externalId: string;
  createdAt: string;
}

export const APPROVAL_KINDS = ["application", "gig-proposal", "follow-up", "outreach"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** One item waiting on you in the Approval Queue. */
export interface Approval {
  id: string;
  kind: ApprovalKind;
  title: string;
  /** What you are approving, e.g. the posting link and the prepared notes. */
  detail: string;
  url: string;
  /** The match it came from, when there is one. */
  matchId: string | null;
  /** The application it is about (follow-ups), when there is one. */
  applicationId?: string | null;
  status: "pending" | "approved" | "rejected";
  decidedAt: string | null;
  createdAt: string;
}
