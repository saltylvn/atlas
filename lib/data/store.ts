// The data-access contract. Pages and actions depend on this interface only;
// lib/data/memory.ts (demo) and lib/data/supabase.ts (live) implement it.

import type {
  AgentId,
  AgentRunEvent,
  AgentStateRecord,
  Application,
  ApplicationEvent,
  Approval,
  AuditEvent,
  ConnectionInfo,
  Contact,
  Goal,
  InboxItem,
  JobMatch,
  JobWatch,
  LedgerEntry,
  NewApplicationEvent,
  NewNotice,
  Notice,
  NoticeTier,
  OutboundMessage,
  Project,
  PushSubscriptionRecord,
  Renewal,
  Routine,
  Settings,
  StoredBrief,
  Snippet,
  Task,
  TextVerdict,
} from "@/lib/domain/types";
import type { KnowledgeChunk, KnowledgeSource, ManifestRow } from "@/lib/domain/knowledge";
import type { MarketPosting, NewMarketPosting, StoredMarketReport } from "@/lib/domain/market";
import type { DailyRow, RunQuality, TechPosting } from "@/lib/domain/techMarket";
import type { BenchmarkPoint } from "@/lib/domain/benchmarks";
import type { StoredQaReport } from "@/lib/domain/qa";
import type { MentorInsight, NewInsight } from "@/lib/domain/mentor";
import type { ListedEvent } from "@/lib/domain/pipelineList";
import type { NewPortfolioRepo, PortfolioRepo } from "@/lib/domain/portfolio";
import type { NewRoleProposal, RoleProposal } from "@/lib/domain/roleOutlook";
import type { NewRoleProfile, RoleProfile } from "@/lib/domain/roleProfile";
import type { NewRoleSkillStat, RoleSkillStat } from "@/lib/domain/skillStats";
import type { NewRoleDescription, RoleDescription } from "@/lib/domain/roleDescription";
import type { SearchLists } from "@/lib/domain/retrieval";
import type { AgentState, Lesson } from "@/lib/domain/agentState";

type Generated = "id" | "createdAt";

export type NewInboxItem = Omit<InboxItem, "id" | "createdAt" | "done">;

export interface Collection<T extends { id: string }> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  create(input: Omit<T, Generated>): Promise<T>;
  update(id: string, patch: Partial<Omit<T, Generated>>): Promise<T | null>;
  remove(id: string): Promise<void>;
}

export interface Store {
  tasks: Collection<Task>;
  goals: Collection<Goal>;
  contacts: Collection<Contact>;
  /** Your phone's contact list, imported in one go (the import Shortcut). */
  phonebook: {
    /** Adds many contacts at once; returns how many were added. */
    addMany(rows: Omit<Contact, "id" | "createdAt">[]): Promise<number>;
  };
  messages: Collection<OutboundMessage>;
  routines: Collection<Routine>;
  renewals: Collection<Renewal>;
  watches: Collection<JobWatch>;
  projects: Collection<Project>;
  inbox: {
    /** The last 30 days, newest first. */
    list(): Promise<InboxItem[]>;
    setDone(id: string, done: boolean): Promise<void>;
    /** Adds newly triaged mail; messages already stored keep their "done" state. */
    upsert(items: NewInboxItem[]): Promise<void>;
    /** Forgets messages that were archived in Gmail. Needs the owner-scoped service store in live mode. */
    remove(messageIds: string[]): Promise<void>;
    /** Records what a job email's text said (verdict and quote only). Needs the owner-scoped service store in live mode. */
    setReadings(rows: { messageId: string; verdict: TextVerdict; quote: string; role?: string }[]): Promise<void>;
    /**
     * Marks an email as handed to the AI model, and only if it never was: the database checks
     * and writes in one step. True when this call marked it; false means it was already read
     * once and must not be sent again. Needs the owner-scoped service store in live mode.
     */
    claimForModel(messageId: string, at: string): Promise<boolean>;
  };
  connections: {
    /** Connected accounts, without tokens. */
    list(): Promise<ConnectionInfo[]>;
  };
  push: {
    list(): Promise<PushSubscriptionRecord[]>;
    add(sub: Omit<PushSubscriptionRecord, "id" | "createdAt">): Promise<void>;
    remove(endpoint: string): Promise<void>;
  };
  /** The activity log. Append-only: agents write a row when they start, finish, fail or skip. */
  agentRuns: {
    append(event: Omit<AgentRunEvent, "id" | "at">): Promise<void>;
    recent(limit: number): Promise<AgentRunEvent[]>;
    since(isoInstant: string): Promise<AgentRunEvent[]>;
  };
  agentState: {
    list(): Promise<AgentStateRecord[]>;
    setPaused(agent: AgentId, paused: boolean): Promise<void>;
  };
  /** Brief history. One row per day and slot; regenerating a slot replaces it. */
  briefs: {
    save(brief: Omit<StoredBrief, "id" | "createdAt">): Promise<StoredBrief>;
    forDate(day: string): Promise<StoredBrief[]>;
    get(id: string): Promise<StoredBrief | null>;
    search(opts: { limit: number; query?: string }): Promise<StoredBrief[]>;
  };
  settings: {
    get(): Promise<Settings>;
    update(patch: Partial<Settings>): Promise<Settings>;
  };
  audit: {
    /** Append-only: there is deliberately no update or delete. */
    append(event: Omit<AuditEvent, "id" | "at">): Promise<void>;
    recent(limit: number): Promise<AuditEvent[]>;
    /** Events of one action since an instant, newest first, at most 1,000 (one page of the API). The QA review counts refused tokens with it. */
    byAction(action: string, isoInstant: string): Promise<AuditEvent[]>;
  };
  ledger: {
    add(entry: Omit<LedgerEntry, "id" | "at">): Promise<void>;
    since(isoInstant: string): Promise<LedgerEntry[]>;
  };
  /** Career Agent: every posting a brief showed (no match is shown twice). */
  jobMatches: {
    /** Matches shown on or after a date, newest first. */
    since(day: string): Promise<JobMatch[]>;
    /** Every key ever stored, so the agent never repeats a match. */
    keys(): Promise<Set<string>>;
    /** Matches you rated, for ranking. */
    rated(): Promise<Pick<JobMatch, "role" | "company" | "source" | "rating" | "skills">[]>;
    /** Jobs you marked Perfect fit, newest first. */
    perfect(): Promise<JobMatch[]>;
    get(id: string): Promise<JobMatch | null>;
    /** Stores new matches (keys already stored are skipped) and returns what was stored. */
    add(rows: Omit<JobMatch, "id" | "createdAt">[]): Promise<JobMatch[]>;
    update(id: string, patch: Partial<Pick<JobMatch, "rating" | "status">>): Promise<void>;
  };
  applications: Collection<Application>;
  /**
   * The Pipeline's timeline (docs/design-pipeline.md): one row per thing that happened to an
   * application. Append-only: there is deliberately no update or delete.
   */
  applicationEvents: {
    /** Adds events. One already stored (same source and kind) is skipped; returns only the ones added. */
    append(rows: NewApplicationEvent[]): Promise<ApplicationEvent[]>;
    /** One application's timeline, oldest first. A model's reading is not on it (see `readings`). */
    forApplication(applicationId: string): Promise<ApplicationEvent[]>;
    /** Every event's source and thread (no summaries), newest first: what the tracker needs to place an email. No model readings. */
    index(): Promise<Pick<ApplicationEvent, "applicationId" | "sourceRef" | "threadId">[]>;
    /** Every event as the Pipeline lists it (what happened and when, no email ids or threads), newest first. No model readings. */
    listed(): Promise<ListedEvent[]>;
    /**
     * The model's readings (decided by "model"), newest first. They are kept apart from the
     * three reads above on purpose: a reading is a suggestion, so no timeline, list or
     * tracker sees one until you confirm it (docs/design-pipeline.md, 5.6).
     */
    readings(): Promise<ApplicationEvent[]>;
  };
  /**
   * Heard back (docs/design-pipeline.md, 5.7): one row per answer from a company. The same
   * rows are the outbox the phone pings are sent from and the feed on the Pipeline. The
   * server writes (the owner-scoped service store in live mode); you may only mark a row seen.
   */
  notifications: {
    /** Adds rows. An event that already has one is skipped; returns only the ones added. */
    add(rows: NewNotice[]): Promise<Notice[]>;
    /** The feed: the newest answers first. */
    recent(limit: number): Promise<Notice[]>;
    /** Rows of one tier not sent yet, for emails that arrived at or after `since`, oldest first. */
    unsent(tier: NoticeTier, since: string): Promise<Notice[]>;
    /**
     * Marks rows sent, and only the ones still unsent: the database checks and writes in one
     * step, so two runs cannot both send one. Returns the rows this call marked.
     */
    claim(ids: string[], sentAt: string): Promise<Notice[]>;
    /** Marks unread rows seen: all of them, or one application's. Returns how many. */
    markSeen(seenAt: string, applicationId?: string): Promise<number>;
  };
  approvals: Collection<Approval>;
  aiUsage: {
    /** AI calls recorded on this UTC day: all of them, or only those made for one purpose. */
    countToday(purpose?: string): Promise<number>;
    record(purpose: string): Promise<void>;
    /** When each AI call since an instant was made (ISO), for the QA review. */
    since(isoInstant: string): Promise<string[]>;
  };
  /** The QA Agent's weekly reviews. Only the QA Agent writes; you read. */
  qa: {
    save(r: Omit<StoredQaReport, "id" | "createdAt">): Promise<StoredQaReport>;
    /** Newest first. */
    recent(limit: number): Promise<StoredQaReport[]>;
  };
  /** Saved reusable messages for the composer, per channel. */
  snippets: Collection<Snippet>;
  /** Ask Atlas: the passages built from everything above, searchable by words and by meaning. */
  knowledge: {
    /** Every stored passage's identity and hash (no text), for change detection. */
    manifest(): Promise<ManifestRow[]>;
    /** Stores new or changed passages. A changed passage loses its embedding until it is embedded again. */
    upsert(chunks: KnowledgeChunk[]): Promise<void>;
    remove(ids: string[]): Promise<void>;
    /** Passages waiting for an embedding, oldest first. */
    pending(limit: number): Promise<{ id: string; title: string; content: string }[]>;
    setEmbeddings(rows: { id: string; embedding: number[] }[]): Promise<void>;
    /** The best keyword matches and, when `embedding` is given, the nearest passages by meaning. */
    search(q: { terms: string[]; embedding: number[] | null; limit: number; sources?: KnowledgeSource[] | null; since?: string | null; until?: string | null }): Promise<SearchLists>;
    stats(): Promise<KnowledgeStats>;
    /** Every stored passage of one kind, with its text (small kinds only: resumes). */
    bySource(source: KnowledgeSource, limit: number): Promise<{ sourceId: string; title: string; content: string }[]>;
  };
  /**
   * The tech market read broadly (lib/domain/techMarket.ts). Only the Scout writes: the cleaned
   * postings, the daily summary and each day's data-quality record.
   */
  techMarket: {
    /** Merges postings by fingerprint (earliest first-seen, every source). Returns how many were new. */
    record(rows: TechPosting[]): Promise<number>;
    /** Postings last seen on or after a day. */
    since(day: string): Promise<TechPosting[]>;
    /** Deletes postings last seen before a day. Returns how many. */
    prune(before: string): Promise<number>;
    /** How many postings are stored, and how many summary days. Counts only. */
    size(): Promise<{ postings: number; days: number }>;
    /** Replaces one day's summary rows. */
    saveDaily(day: string, rows: DailyRow[]): Promise<void>;
    /** Summary rows on or after a day. */
    daily(since: string): Promise<DailyRow[]>;
    /** Keeps the day's latest run quality. */
    saveQuality(q: RunQuality): Promise<void>;
    quality(since: string): Promise<RunQuality[]>;
  };
  /** National benchmarks (BLS, FRED). Only the Scout writes, once a week. */
  /**
   * The apply brief's research, one row per apply kit (lib/agents/briefResearch.ts): news,
   * the company's own pages and the Gemini angle. Only the server writes; you read.
   */
  applyBriefs: {
    /** Saves a kit's research, replacing what was there. */
    save(approvalId: string, data: unknown, researchedAt: string): Promise<void>;
    /** The research for these kits, by kit id. */
    forKits(approvalIds: readonly string[]): Promise<Map<string, { data: unknown; researchedAt: string }>>;
  };
  /**
   * The Career Map, one snapshot per week (lib/domain/careerMap.ts). Only the Career Mentor writes, with
   * the service role; you read. Stored as JSON and parsed on the way out.
   */
  /** Each agent run's typed state, saved after every step (docs/AGENT-ARCHITECTURE.md). Only the server writes. */
  agentRunState: {
    save(runId: string, agent: string, status: "running" | "done" | "stopped" | "failed", state: AgentState): Promise<void>;
    get(runId: string): Promise<{ runId: string; agent: string; status: string; state: AgentState } | null>;
    /** The newest runs of an agent, newest first. */
    recent(agent: string, limit: number): Promise<{ runId: string; status: string; state: AgentState; updatedAt: string }[]>;
  };
  /** Short dated lessons an agent keeps between runs; they expire unless outcomes confirm them. */
  agentMemory: {
    add(row: Omit<Lesson, "id" | "confirmed">): Promise<Lesson>;
    list(agent: string): Promise<Lesson[]>;
    /** Outcomes confirmed it: counted, and kept until `expiresOn`. */
    confirm(id: string, expiresOn: string): Promise<void>;
  };
  careerMaps: {
    /** Saves the week's snapshot, replacing one already saved that week. */
    save(week: string, data: unknown): Promise<void>;
    /** The newest snapshots, newest first. */
    latest(limit: number): Promise<{ week: string; data: unknown }[]>;
  };
  benchmarks: {
    /** Adds new points and replaces revised ones (same series and period). Returns how many were new. */
    upsert(points: BenchmarkPoint[]): Promise<number>;
    /** Points for periods on or after a day. */
    since(day: string): Promise<BenchmarkPoint[]>;
  };
  /** The Career desk's market data. The Scout writes postings; the Analyst writes reports. */
  market: {
    /** Records postings: new ones are added, ones seen before get today as their last-seen day. Returns how many were new. */
    record(rows: NewMarketPosting[]): Promise<number>;
    /** Postings last seen on or after a day. */
    since(day: string): Promise<MarketPosting[]>;
    saveReport(r: Omit<StoredMarketReport, "id" | "createdAt">): Promise<StoredMarketReport>;
    latestReport(): Promise<StoredMarketReport | null>;
  };
  /** The Career Mentor's insights. Only the Career Mentor adds; you may mark one done or dismissed. */
  mentor: {
    add(rows: NewInsight[]): Promise<MentorInsight[]>;
    /** Insights for a day or later, newest first. */
    since(day: string): Promise<MentorInsight[]>;
    /** Your answer: Action Taken (done, with an optional note of what you did), Not useful, or open again. */
    setStatus(id: string, status: MentorInsight["status"], note?: string): Promise<void>;
  };
  /** Your GitHub projects as the Scout last described them. Only the Scout writes. */
  portfolio: {
    /** Replaces the list: repositories no longer on GitHub are dropped. */
    replace(rows: NewPortfolioRepo[]): Promise<void>;
    /** Most recently pushed first. */
    list(): Promise<PortfolioRepo[]>;
  };
  /** The Career Mentor's proposals for your target roles. Only the Career Mentor adds; you decide each one. */
  roleProposals: {
    add(row: NewRoleProposal): Promise<RoleProposal>;
    /** Newest first. */
    recent(limit: number): Promise<RoleProposal[]>;
    get(id: string): Promise<RoleProposal | null>;
    setStatus(id: string, status: RoleProposal["status"]): Promise<void>;
  };
  /** What each of your top roles is, written weekly by the Career Mentor. Only the Career Mentor writes. */
  roleProfiles: {
    /** Saves a role's profile for its week, replacing that week's earlier one. */
    save(row: NewRoleProfile): Promise<RoleProfile>;
    /** Newest week first. */
    recent(limit: number): Promise<RoleProfile[]>;
  };
  /** The skills each role asked for, one row per role per day. Only the Analyst writes. */
  roleSkills: {
    /** Saves a day's rows, replacing that day's earlier rows for the same roles. */
    save(rows: NewRoleSkillStat[]): Promise<void>;
    /** Rows from `day` on, oldest first. */
    since(day: string): Promise<RoleSkillStat[]>;
  };
  /** What each role is about, one per role per month. Only the Career Mentor writes. */
  roleDescriptions: {
    /** Saves a role's description for its month, replacing that month's earlier one. */
    save(row: NewRoleDescription): Promise<RoleDescription>;
    /** Newest month first. */
    recent(limit: number): Promise<RoleDescription[]>;
  };
}

export interface KnowledgeStats {
  passages: number;
  /** How many of them have an embedding (the rest are keyword-only until the next index run). */
  embedded: number;
  /** When a passage last changed, ISO, or null when nothing is indexed. */
  indexedAt: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  displayName: "Tyler",
  timezone: "America/Denver",
  latitude: 39.7392,
  longitude: -104.9903,
  placeName: "Denver",
  dailyCapacityMin: 360,
  jobKeywords: [
    "Solutions Engineer",
    "Solutions Architect",
    "Sales Engineer",
    "Forward Deployed Engineer",
    "AI Engineer",
    "Customer Engineer",
  ],
  jobLocations: ["Remote", "Denver", "Colorado"],
  newsTopics: ["politics", "world", "tech", "ai"],
  outboundEnabled: true,
  aiEnabled: true,
};
