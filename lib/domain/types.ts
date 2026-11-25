// Domain records shared by every layer. Pure types: no I/O, no framework imports.
// Field names are camelCase here; the Supabase adapter maps them to snake_case columns.

import type { FormProfile } from "./formProfile";

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
  /** Their category on the People tab, or null when they are not placed (lib/domain/people.ts). */
  category?: PeopleCategory | null;
  /** Their place in the category, 1 to 4. */
  slot?: number | null;
  /** True when they came in with the whole-contact-list import: searchable, otherwise out of the way until placed. */
  phonebook?: boolean;
  createdAt: string;
}

export const PEOPLE_CATEGORIES = ["spouse", "family", "friends", "colleagues", "mentors", "church"] as const;
export type PeopleCategory = (typeof PEOPLE_CATEGORIES)[number];

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
  /** A text you scheduled: when Atlas reminds you to send it. You send it yourself. */
  remindAt?: string | null;
  /** When that reminder went out, so it goes out once. */
  remindedAt?: string | null;
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

export const JOB_BOARDS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workable", "recruitee", "bamboohr", "applicantpro"] as const;
export type JobBoard = (typeof JOB_BOARDS)[number];

/** How each board is named on screen, and where its slug sits in a jobs URL. */
export const JOB_BOARD_INFO: Record<JobBoard, { label: string; example: string }> = {
  greenhouse: { label: "Greenhouse", example: "boards.greenhouse.io/vercel" },
  lever: { label: "Lever", example: "jobs.lever.co/plaid" },
  ashby: { label: "Ashby", example: "jobs.ashbyhq.com/linear" },
  smartrecruiters: { label: "SmartRecruiters", example: "jobs.smartrecruiters.com/visa" },
  workable: { label: "Workable", example: "apply.workable.com/huggingface" },
  recruitee: { label: "Recruitee", example: "bunq.recruitee.com" },
  bamboohr: { label: "BambooHR", example: "kiln.bamboohr.com/careers" },
  applicantpro: { label: "ApplicantPro", example: "skullcandy.applicantpro.com" },
};

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
  /** Career Agent: salary floor in USD per year. Posted pay under it rules a posting out. */
  careerMinSalary?: number;
  /** Career Agent: the base pay you are aiming at, in USD per year. A posting that reaches it ranks higher. */
  careerTargetSalary?: number;
  /** The most years of experience a posting may ask for; above it, a job is ignored (lib/domain/levelPolicy.ts). Default 2. */
  careerMaxYears?: number;
  /** What you bring besides engineering, in a sentence, for the agents to use as an angle (lib/domain/levelPolicy.ts). */
  careerBackground?: string;
  /** Career Agent: a link to your resume for each target role (e.g. a Google Drive file), by role name. */
  careerResumes?: Record<string, string>;
  /** Your master resume (the copy the role resumes are tailored from). Synced from Notion. */
  careerMasterResume?: string;
  /** Applications Agent: planned applications a day (default 3). The Career Mentor measures you against it. */
  careerDailyFullTime?: number;
  /** Your LinkedIn headline and About, pasted by you for the Career Mentor to review. Contact details are stripped when it is saved. */
  linkedinProfile?: string;
  /** Career Agent: your answer bank, by question id (lib/domain/careerPrep.ts). */
  careerAnswers?: Record<string, string>;
  /**
   * Your own answers to eligibility questions, typed by you once. The Apply Agent uses them
   * as written and never drafts or guesses them (docs/design.md, 5.5). Unset: it stops.
   */
  careerEligibility?: Eligibility;
  /**
   * Your fixed profile answers for forms: phone country code, country, city, school, degree,
   * discipline and graduation year (lib/domain/formProfile.ts). Typed by you; used as written.
   */
  careerProfile?: Partial<FormProfile>;
  /** The Data Pipeline section's settings, read through pipelineConfig() (lib/domain/dataPipeline.ts), which fills defaults. */
  dataPipeline?: unknown;
  /**
   * Atlas Autofill's key: only its SHA-256 is kept, never the key itself. Set when you connect
   * the extension in Settings, removed when you disconnect it (lib/domain/extensionForm.ts).
   */
  extensionKey?: { hash: string; prefix: string; createdAt: string; lastUsedAt?: string };
  /** Forms the extension asked Atlas to answer today, for its daily cap. Written by Atlas. */
  extensionUsage?: { day: string; forms: number };
  /** Career Agent: skills you already have, by name (lib/domain/skills.ts). */
  careerSkills?: string[];
  /** Claude may read Atlas through its MCP connector (app/api/mcp). Off until you turn it on in Settings. */
  mcpEnabled?: boolean;
  /** When Claude last read Atlas through MCP. Written by Atlas, at most once a minute. */
  mcpLastUsedAt?: string;
  /** The Career Mentor's proof projects: the one open now and those GitHub closed (lib/domain/gapPlan.ts). Written by the Analyst. */
  careerProof?: unknown;
  /** The Weekly Strategist's plan for the week: proposed, approved or dismissed (lib/domain/weeklyPlan.ts). Written by Atlas. */
  weeklyPlan?: unknown;
  /** Gemini's judgments of job titles the six-role rules cannot place (lib/domain/roleLens.ts `LensJudgments`). Written by Atlas. */
  lensJudged?: unknown;
  /** The last sync with Notion (role order and resume links). Written by Atlas. */
  notion?: NotionSync;
  /** The Resumes data source in Notion, remembered so it is read directly. Not a secret. */
  notionResumesId?: string;
  /** Pages read through Firecrawl this month and today, so Atlas stops before the free limit. Written by Atlas. */
  firecrawlUsage?: ReadUsage;
  /** Apply briefs researched today (lib/agents/briefResearch.ts), against its cap of 10 a day. Written by Atlas. */
  briefUsage?: { day: string; n: number };
  /** Heard back: a rejection does not ping your phone; the next brief lists it. Off unless you turn it on. */
  holdRejections?: boolean;
  /**
   * The Pipeline's model reader (docs/design-pipeline.md, 5.5): a job email rules cannot decide
   * may be sent to the AI model, scrubbed and capped. Off unless you turn it on.
   */
  modelReader?: boolean;
  /** When the model reader was last turned on. Only emails that arrived after it are sent. Written by Atlas. */
  modelReaderSince?: string;
}

/** How many web pages Atlas has read through Firecrawl (lib/domain/postingFacts.ts holds the budget). */
export interface ReadUsage {
  /** "2026-11" */
  month: string;
  /** Pages read this month. */
  pages: number;
  day: LocalDate;
  /** Pages read on that day. */
  today: number;
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
export const AGENT_IDS = ["chief-of-staff", "email", "calendar", "news", "finance", "career", "scout", "analyst", "mentor", "qa", "apply"] as const;
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
  /** The color Google Calendar shows it in, as a checked six-digit hex (lib/domain/googleCalendar.ts). */
  color?: string;
  /** You declined it: Google shows it struck through, and it is never a conflict. */
  declined?: boolean;
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

/** What a job email's text says, by rules (lib/domain/jobMailText.ts). "none": no rule decided it. */
export const TEXT_VERDICTS = ["interview", "rejection", "assessment", "scheduling", "offer", "info_request", "none"] as const;
export type TextVerdict = (typeof TEXT_VERDICTS)[number];

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
  /** A job email's text, read by rules: what kind of answer it is, or "none". Unset until read. */
  textVerdict?: TextVerdict | null;
  /** The sentence that decided `textVerdict`, without addresses, phone numbers or links. */
  textQuote?: string;
  /** The role the email's text names ("Senior AI Engineer"), or "". */
  textRole?: string;
  /**
   * When this email was handed to the AI model, if it ever was (docs/design-pipeline.md, 5.5).
   * Set before the call, so an email's text leaves Atlas at most once.
   */
  modelReadAt?: string | null;
}

export const PROVIDERS = ["google", "gmail_imap", "google_calendar"] as const;
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

/** Where an application stands; the Applications board has one column per status. */
export const APPLICATION_STATUSES = ["saved", "applied", "replied", "interview", "offer", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * The finer stage behind a status (docs/design-pipeline.md, 5.2). A screen, an assessment
 * and an interview all read as status "interview"; "in_review" reads as "replied";
 * "withdrawn" (you closed it) reads as "rejected".
 */
export const APPLICATION_STAGES = ["saved", "applied", "in_review", "screen", "assessment", "interview", "offer", "rejected", "withdrawn"] as const;
export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

/** What can happen to an application. "stage_set" is a stage set outright: by you, or as the timeline's starting point. */
export const EVENT_KINDS = ["saved", "applied", "confirmation", "reply", "info_request", "scheduling", "screen", "assessment", "interview", "offer", "rejection", "withdrawn", "follow_up", "stage_set"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_SOURCES = ["email", "calendar", "you", "apply-agent", "atlas"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** One thing that happened to an application. Rows are only ever added; where it stands is worked out from them. */
export interface ApplicationEvent {
  id: string;
  applicationId: string;
  kind: EventKind;
  occurredAt: string;
  source: EventSource;
  /** What it came from ("email:<message id>", "approval:<id>", "you:<uuid>"), so nothing is logged twice. */
  sourceRef: string;
  /** The Gmail thread, for an email; else "". */
  threadId: string;
  /** Who decided what it means. A "model" event is a suggestion and never moves a stage. */
  decidedBy: "rules" | "model" | "you";
  /** Only for "stage_set": the stage it was set to. */
  stage: ApplicationStage | null;
  /** A kind label, a subject, or the one cleaned sentence the reader kept. Never an email's text. */
  summary: string;
  /** A date the email gives for what it asks ("2026-12-04"), when a reading found one. */
  deadline?: string | null;
  /** What the email asks for, in a few words, when a reading found it. Never an email's text. */
  ask?: string;
  createdAt: string;
}
export type NewApplicationEvent = Omit<ApplicationEvent, "id" | "createdAt">;

/**
 * How a company's answer reaches you (docs/design-pipeline.md, 5.7): "push" pings your phone,
 * "brief" waits for the next brief (a rejection, when you asked for that), "quiet" is only
 * in the Heard back feed.
 */
export const NOTICE_TIERS = ["push", "brief", "quiet"] as const;
export type NoticeTier = (typeof NOTICE_TIERS)[number];

/**
 * One answer from a company, as the Heard back feed lists it and as your phone shows it: one
 * row per timeline event. The text is the company, the kind and the role; never an email's words.
 */
export interface Notice {
  id: string;
  /** The timeline event it is about. One notice per event, so a retry never adds a second. */
  eventId: string;
  applicationId: string;
  kind: EventKind;
  /** When the email arrived. */
  occurredAt: string;
  title: string;
  body: string;
  /** Where it opens in Atlas: the application's page. */
  url: string;
  tier: NoticeTier;
  /** When it reached you: the push, or the brief that listed it. Null: not yet, or never (quiet). */
  sentAt: string | null;
  /** When you saw it in Atlas. Null: unread. */
  seenAt: string | null;
  createdAt: string;
}
export type NewNotice = Omit<Notice, "id" | "createdAt">;

export type PayUnit = "year" | "hour" | "";

/** A full-time posting the Applications Agent showed in a brief. Kept so no match is ever shown twice. */
export interface JobMatch {
  id: string;
  /** Stable identity of the posting (source + id or url); unique per owner. */
  key: string;
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
  /** new, pursuing (a 👍 sent it to an apply queue), applied, or dismissed. */
  status: "new" | "pursuing" | "applied" | "dismissed";
  /** Skills the posting asks for (lib/domain/skills.ts). Added in part 5c. */
  skills?: string[];
  createdAt: string;
}

export interface Application {
  id: string;
  company: string;
  role: string;
  /** Which of your target roles it is for ("" when not one of them). */
  targetRole: string;
  source: string;
  url: string;
  payText: string;
  /** Who submitted it: "semi", you (Semi-Automation); "auto", the Apply Agent after you approved it. */
  tier: "semi" | "auto";
  status: ApplicationStatus;
  /** The finer stage. Unset on rows from before the Pipeline; read it with `stageOf` (lib/domain/pipeline.ts), which checks it against `status`. */
  stage?: ApplicationStage | null;
  /** When the company last wrote, not counting an automatic "we received your application". */
  lastHeardAt?: string | null;
  appliedOn: string | null;
  statusAt: string;
  notes: string;
  /** "atlas". ("job-hunt" remains allowed by the database for any rows imported before it was retired.) */
  origin: "atlas" | "job-hunt";
  /** The email or match it came from ("email:<id>", "match:<key>"), so nothing is logged twice. */
  externalId: string;
  createdAt: string;
  // What it was sent with (Step 0 of the agent plan, 23 Nov 2026; lib/domain/outcomes.ts).
  // Null or absent: not known (logged before, or from an email Atlas could not link to a posting).
  /** The level its title states. */
  level?: "early" | "mid" | "senior" | "unstated" | null;
  /** The day the posting went up. */
  postedOn?: LocalDate | null;
  /** The resume sent: "Software Engineer 1 · 3fa2c19b" (its name and a fingerprint of its text). */
  resumeVersion?: string;
  /** You changed the resume or wrote a note for this job. */
  tailored?: boolean | null;
  /** You knew someone there, or were referred. */
  warm?: boolean | null;
}

export const APPROVAL_KINDS = ["application", "follow-up", "outreach"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

/** One item waiting on you in an apply queue. */
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

// ---- Apply Agent (docs/design.md) ----

/** Your answers to the eligibility questions most forms require. "" means you have not said. */
export interface Eligibility {
  /** Legally authorized to work in the U.S. */
  authorized: "yes" | "no" | "";
  /** Needs visa sponsorship now or in the future. */
  sponsorship: "yes" | "no" | "";
  /** Your usual answer to "have you worked here before?". Shown on every packet, so you can change it for one company. */
  workedHere: "yes" | "no" | "";
  /**
   * Optional: your own answer to a form's Gender question. "" (or unset) means Atlas declines
   * it, as it does every other demographic question. Never guessed, never drafted.
   */
  gender?: "male" | "female" | "nonbinary" | "";
}

/** One field of the application form and the answer the packet gives it. */
export interface PacketItem {
  /** The form's own field name, e.g. "first_name" or "question_123". */
  name: string;
  label: string;
  required: boolean;
  /** "typeahead": a box that suggests as you type (a city, a country); the first suggestion that matches is chosen. */
  kind: "text" | "textarea" | "file" | "select" | "multiselect" | "checkbox" | "typeahead";
  /**
   * Where the answer comes from. "you": picked or written by you in the review. "none": nobody
   * answers it, so it is left blank, or it stops the application when it is required.
   */
  source: "bank" | "eligibility" | "resume" | "ai" | "you" | "none";
  /** For a select: the choices the form offers, so you can pick one in the review. */
  options?: { label: string; value: string }[];
  /** A question Atlas never answers, even with your pick (demographic, SSN, convictions): you apply yourself. */
  locked?: boolean;
  /** For the resume: which Figma frame it came from, and the fingerprints that prove the file sent is the one approved. */
  file?: ResumeProof;
  /** The answer, or for a select the option's label. "" for a file or no answer. */
  value: string;
  /** For a select: the option's value as the form expects it. */
  optionValue?: string;
}

/**
 * Proof that a resume PDF is your Figma frame as it was when you approved it (docs/design.md,
 * 5.6). Taken when the packet is prepared; checked again right before the agent submits.
 */
export interface ResumeProof {
  /** The Resumes row the frame came from ("AI Engineer"), and the role it was asked for when that differs. */
  resume: string;
  fileKey: string;
  nodeId: string;
  /** Fingerprint of the source when the copy was taken: the SHA-256 of the file in Notion (or, on older proofs, of the Figma frame's text). */
  frameFingerprint: string;
  /** SHA-256 of the PDF file kept for this application. */
  pdfSha256: string;
  bytes: number;
  /** Where the file is kept in private storage. */
  path: string;
  exportedAt: string;
  /** "notion": the PDF in the Resumes row's Resume file column. Unset on older proofs, which came from a Figma export. */
  from?: "notion";
  /** The file's name in Notion. */
  fileName?: string;
  /** Whether a job board can read the PDF's text (lib/domain/pdfReadable.ts). */
  reading?: PdfReading;
}

/** What Atlas found when it read a resume PDF's text and compared it with the Figma frame. */
export interface PdfReading {
  /** good: readable, in order. warn: lines missing or stored in a mixed order. bad: no readable text. unknown: not checked. */
  verdict: "good" | "warn" | "bad" | "unknown";
  pages: number;
  /** Lines of the resume as read from Figma, and how many of them the PDF's text holds. */
  lines: number;
  found: number;
  /** What to know, in plain words. */
  notes: string[];
}

