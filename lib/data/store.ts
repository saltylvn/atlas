// The data-access contract. Pages and actions depend on this interface only;
// lib/data/memory.ts (demo) and lib/data/supabase.ts (live) implement it.

import type {
  AgentId,
  AgentRunEvent,
  AgentStateRecord,
  Application,
  Approval,
  AuditEvent,
  ConnectionInfo,
  Contact,
  Goal,
  InboxItem,
  JobMatch,
  JobWatch,
  LedgerEntry,
  OutboundMessage,
  Project,
  PushSubscriptionRecord,
  Renewal,
  Routine,
  Settings,
  StoredBrief,
  Snippet,
  Task,
} from "@/lib/domain/types";
import type { KnowledgeChunk, KnowledgeSource, ManifestRow } from "@/lib/domain/knowledge";
import type { MarketPosting, NewMarketPosting, StoredMarketReport } from "@/lib/domain/market";
import type { StoredQaReport } from "@/lib/domain/qa";
import type { MentorInsight, NewInsight } from "@/lib/domain/mentor";
import type { NewPortfolioRepo, PortfolioRepo } from "@/lib/domain/portfolio";
import type { NewRoleProposal, RoleProposal } from "@/lib/domain/roleOutlook";
import type { SearchLists } from "@/lib/domain/retrieval";

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
    setReadings(rows: { messageId: string; verdict: "interview" | "rejection" | "none"; quote: string; role?: string }[]): Promise<void>;
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
    rated(): Promise<Pick<JobMatch, "role" | "company" | "source" | "rating">[]>;
    get(id: string): Promise<JobMatch | null>;
    /** Stores new matches (keys already stored are skipped) and returns what was stored. */
    add(rows: Omit<JobMatch, "id" | "createdAt">[]): Promise<JobMatch[]>;
    update(id: string, patch: Partial<Pick<JobMatch, "rating" | "status">>): Promise<void>;
  };
  applications: Collection<Application>;
  approvals: Collection<Approval>;
  aiUsage: {
    /** AI calls recorded on this UTC day. */
    countToday(): Promise<number>;
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
  /** The Career desk's market data. The Scout writes postings; the Analyst writes reports. */
  market: {
    /** Records postings: new ones are added, ones seen before get today as their last-seen day. Returns how many were new. */
    record(rows: NewMarketPosting[]): Promise<number>;
    /** Postings last seen on or after a day. */
    since(day: string): Promise<MarketPosting[]>;
    saveReport(r: Omit<StoredMarketReport, "id" | "createdAt">): Promise<StoredMarketReport>;
    latestReport(): Promise<StoredMarketReport | null>;
  };
  /** The Mentor's insights. Only the Mentor adds; you may mark one done or dismissed. */
  mentor: {
    add(rows: NewInsight[]): Promise<MentorInsight[]>;
    /** Insights for a day or later, newest first. */
    since(day: string): Promise<MentorInsight[]>;
    setStatus(id: string, status: MentorInsight["status"]): Promise<void>;
  };
  /** Your GitHub projects as the Scout last described them. Only the Scout writes. */
  portfolio: {
    /** Replaces the list: repositories no longer on GitHub are dropped. */
    replace(rows: NewPortfolioRepo[]): Promise<void>;
    /** Most recently pushed first. */
    list(): Promise<PortfolioRepo[]>;
  };
  /** The Mentor's proposals for your target roles. Only the Mentor adds; you decide each one. */
  roleProposals: {
    add(row: NewRoleProposal): Promise<RoleProposal>;
    /** Newest first. */
    recent(limit: number): Promise<RoleProposal[]>;
    get(id: string): Promise<RoleProposal | null>;
    setStatus(id: string, status: RoleProposal["status"]): Promise<void>;
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
