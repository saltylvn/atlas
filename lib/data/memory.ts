// In-memory store for demo mode and tests. Seeded with fictional data relative to
// today, so the dashboard looks lived-in. Nothing is persisted or sent anywhere.

import { randomUUID } from "node:crypto";
import { ROLE_NOT_LISTED } from "@/lib/domain/applications";
import { noticeText } from "@/lib/domain/heardBack";
import { EVENT_LABEL, stageOfStatus } from "@/lib/domain/pipeline";
import { addDays, localDate, mondayOf } from "@/lib/domain/dates";
import type {
  AgentRunEvent,
  AgentStateRecord,
  Application,
  ApplicationEvent,
  Approval,
  JobMatch,
  AuditEvent,
  ConnectionInfo,
  Contact,
  Goal,
  InboxItem,
  JobWatch,
  LedgerEntry,
  Notice,
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
import { chunkKey, type KnowledgeChunk } from "@/lib/domain/knowledge";
import type { MarketPosting, StoredMarketReport } from "@/lib/domain/market";
import { mergeTech, type DailyRow, type RunQuality, type TechPosting } from "@/lib/domain/techMarket";
import type { BenchmarkPoint } from "@/lib/domain/benchmarks";
import type { MentorInsight } from "@/lib/domain/mentor";
import type { PortfolioRepo } from "@/lib/domain/portfolio";
import type { RoleProposal } from "@/lib/domain/roleOutlook";
import type { RoleProfile } from "@/lib/domain/roleProfile";
import { skillSnapshot, type RoleSkillStat } from "@/lib/domain/skillStats";
import type { RoleDescription } from "@/lib/domain/roleDescription";
import { bm25, type Hit } from "@/lib/domain/retrieval";
import { TARGET_ROLES } from "@/lib/domain/targetRoles";
import type { StoredQaReport } from "@/lib/domain/qa";
import { DEFAULT_SETTINGS, type Collection, type Store } from "./store";
import type { AgentState, Lesson } from "@/lib/domain/agentState";

function collection<T extends { id: string; createdAt: string }>(rows: T[]): Collection<T> {
  return {
    async list() {
      return rows.map((r) => ({ ...r }));
    },
    async get(id) {
      const row = rows.find((r) => r.id === id);
      return row ? { ...row } : null;
    },
    async create(input) {
      const row = { ...input, id: randomUUID(), createdAt: new Date().toISOString() } as T;
      rows.push(row);
      return { ...row };
    },
    async update(id, patch) {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return { ...row };
    },
    async remove(id) {
      const i = rows.findIndex((r) => r.id === id);
      if (i >= 0) rows.splice(i, 1);
    },
  };
}

export interface MemoryState {
  tasks: Task[];
  goals: Goal[];
  contacts: Contact[];
  messages: OutboundMessage[];
  routines: Routine[];
  renewals: Renewal[];
  watches: JobWatch[];
  projects: Project[];
  jobMatches?: JobMatch[];
  applications?: Application[];
  applicationEvents?: ApplicationEvent[];
  notifications?: Notice[];
  approvals?: Approval[];
  inbox: InboxItem[];
  connections: ConnectionInfo[];
  push: PushSubscriptionRecord[];
  settings: Settings;
  agentRuns: AgentRunEvent[];
  agentState: AgentStateRecord[];
  briefs: StoredBrief[];
  audit: AuditEvent[];
  ledger: LedgerEntry[];
  aiCalls: { at: string; purpose: string }[];
  snippets?: Snippet[];
  knowledge?: (KnowledgeChunk & { id: string; embedding: number[] | null; updatedAt: string })[];
  marketPostings?: MarketPosting[];
  marketReports?: StoredMarketReport[];
  techPostings?: TechPosting[];
  benchmarks?: BenchmarkPoint[];
  careerMaps?: { week: string; data: unknown }[];
  applyBriefs?: { approvalId: string; data: unknown; researchedAt: string }[];
  agentStates?: { runId: string; agent: string; status: string; state: AgentState; updatedAt: string }[];
  agentLessons?: Lesson[];
  marketDaily?: DailyRow[];
  marketQuality?: RunQuality[];
  qaReports?: StoredQaReport[];
  mentorInsights?: MentorInsight[];
  portfolioRepos?: PortfolioRepo[];
  roleProposals?: RoleProposal[];
  roleProfiles?: RoleProfile[];
  roleSkills?: RoleSkillStat[];
  roleDescriptions?: RoleDescription[];
}

export function createMemoryStore(state: MemoryState): Store {
  return {
    tasks: collection(state.tasks),
    goals: collection(state.goals),
    contacts: collection(state.contacts),
    phonebook: {
      async addMany(rows) {
        for (const r of rows) state.contacts.push({ ...structuredClone(r), id: randomUUID(), createdAt: new Date().toISOString() });
        return rows.length;
      },
    },
    messages: collection(state.messages),
    routines: collection(state.routines),
    renewals: collection(state.renewals),
    watches: collection(state.watches),
    projects: collection(state.projects),
    applications: collection((state.applications ??= [])),
    applicationEvents: {
      async append(rows) {
        const all = (state.applicationEvents ??= []);
        const added: ApplicationEvent[] = [];
        for (const r of rows) {
          // The database's unique key: one event per source and kind.
          if (all.some((e) => e.sourceRef === r.sourceRef && e.kind === r.kind)) continue;
          const row = { ...structuredClone(r), id: randomUUID(), createdAt: new Date().toISOString() };
          all.push(row);
          added.push(structuredClone(row));
        }
        return added;
      },
      async forApplication(applicationId) {
        return (state.applicationEvents ?? []).filter((e) => e.applicationId === applicationId && e.decidedBy !== "model").sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((e) => structuredClone(e));
      },
      async index() {
        return (state.applicationEvents ?? []).filter((e) => e.decidedBy !== "model").sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((e) => ({ applicationId: e.applicationId, sourceRef: e.sourceRef, threadId: e.threadId }));
      },
      async listed() {
        return (state.applicationEvents ?? [])
          .filter((e) => e.decidedBy !== "model")
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .map((e) => ({ applicationId: e.applicationId, kind: e.kind, occurredAt: e.occurredAt, source: e.source, decidedBy: e.decidedBy, stage: e.stage, summary: e.summary }));
      },
      async readings() {
        return (state.applicationEvents ?? []).filter((e) => e.decidedBy === "model").sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((e) => structuredClone(e));
      },
    },
    notifications: {
      async add(rows) {
        const all = (state.notifications ??= []);
        const added: Notice[] = [];
        for (const r of rows) {
          // The database's unique key: one notification per event.
          if (all.some((n) => n.eventId === r.eventId)) continue;
          const row = { ...structuredClone(r), id: randomUUID(), createdAt: new Date().toISOString() };
          all.push(row);
          added.push(structuredClone(row));
        }
        return added;
      },
      async recent(limit) {
        return [...(state.notifications ?? [])].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, limit).map((n) => structuredClone(n));
      },
      async unsent(tier, since) {
        return (state.notifications ?? []).filter((n) => n.tier === tier && !n.sentAt && n.occurredAt >= since).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).map((n) => structuredClone(n));
      },
      async claim(ids, sentAt) {
        // Only rows still unsent, as the database's conditional update does.
        const mine = (state.notifications ?? []).filter((n) => ids.includes(n.id) && !n.sentAt);
        for (const n of mine) n.sentAt = sentAt;
        return mine.map((n) => structuredClone(n));
      },
      async markSeen(seenAt, applicationId) {
        const unseen = (state.notifications ?? []).filter((n) => !n.seenAt && (!applicationId || n.applicationId === applicationId));
        for (const n of unseen) n.seenAt = seenAt;
        return unseen.length;
      },
    },
    approvals: collection((state.approvals ??= [])),
    jobMatches: {
      async since(day) {
        return (state.jobMatches ??= []).filter((m) => m.shownOn >= day).sort((a, b) => b.shownOn.localeCompare(a.shownOn) || b.score - a.score).map((m) => ({ ...m }));
      },
      async keys() {
        return new Set((state.jobMatches ??= []).map((m) => m.key));
      },
      async rated() {
        return (state.jobMatches ??= []).filter((m) => m.rating !== 0).map(({ role, company, source, rating, skills }) => ({ role, company, source, rating, skills }));
      },
      async perfect() {
        return (state.jobMatches ??= []).filter((m) => m.rating === 2).sort((a, b) => b.shownOn.localeCompare(a.shownOn)).slice(0, 50).map((m) => ({ ...m }));
      },
      async get(id) {
        const m = (state.jobMatches ??= []).find((x) => x.id === id);
        return m ? { ...m } : null;
      },
      async add(rows) {
        const list = (state.jobMatches ??= []);
        const out: JobMatch[] = [];
        for (const r of rows) {
          if (list.some((m) => m.key === r.key)) continue;
          const m = { ...r, id: randomUUID(), createdAt: new Date().toISOString() };
          list.push(m);
          out.push({ ...m });
        }
        return out;
      },
      async update(id, patch) {
        const m = (state.jobMatches ??= []).find((x) => x.id === id);
        if (m) Object.assign(m, patch);
      },
    },
    inbox: {
      async list() {
        return [...state.inbox].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map((i) => ({ ...i }));
      },
      async setDone(itemId, done) {
        const row = state.inbox.find((i) => i.id === itemId);
        if (row) row.done = done;
      },
      async upsert(items) {
        for (const item of items) {
          if (state.inbox.some((i) => i.messageId === item.messageId)) continue;
          state.inbox.push({ ...item, id: randomUUID(), done: false, createdAt: new Date().toISOString() });
        }
      },
      async remove(messageIds) {
        const drop = new Set(messageIds);
        state.inbox.splice(0, state.inbox.length, ...state.inbox.filter((i) => !drop.has(i.messageId)));
      },
      async setReadings(rows) {
        for (const r of rows) {
          const item = state.inbox.find((i) => i.messageId === r.messageId);
          if (item) Object.assign(item, { textVerdict: r.verdict, textQuote: r.quote.slice(0, 240), textRole: (r.role ?? "").slice(0, 160) });
        }
      },
      async claimForModel(messageId, at) {
        const item = state.inbox.find((i) => i.messageId === messageId);
        if (!item || item.modelReadAt) return false;
        item.modelReadAt = at;
        return true;
      },
    },
    connections: {
      async list() {
        return state.connections.map((c) => ({ ...c }));
      },
    },
    push: {
      async list() {
        return state.push.map((p) => ({ ...p }));
      },
      async add(sub) {
        if (state.push.some((p) => p.endpoint === sub.endpoint)) return;
        state.push.push({ ...sub, id: randomUUID(), createdAt: new Date().toISOString() });
      },
      async remove(endpoint) {
        state.push = state.push.filter((p) => p.endpoint !== endpoint);
      },
    },
    agentRuns: {
      async append(event) {
        state.agentRuns.push({ ...event, id: randomUUID(), at: new Date().toISOString() });
        if (state.agentRuns.length > 1000) state.agentRuns.shift();
      },
      async recent(limit) {
        return [...state.agentRuns].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
      },
      async since(iso) {
        // Newest first, like the database query.
        return state.agentRuns.filter((e) => e.at >= iso).sort((a, b) => b.at.localeCompare(a.at));
      },
    },
    agentState: {
      async list() {
        return state.agentState.map((a) => ({ ...a }));
      },
      async setPaused(agent, paused) {
        const row = state.agentState.find((a) => a.agent === agent);
        if (row) Object.assign(row, { paused, updatedAt: new Date().toISOString() });
        else state.agentState.push({ agent, paused, updatedAt: new Date().toISOString() });
      },
    },
    briefs: {
      async save(brief) {
        state.briefs = state.briefs.filter((b) => !(b.forDate === brief.forDate && b.slot === brief.slot));
        const row: StoredBrief = { ...brief, id: randomUUID(), createdAt: new Date().toISOString() };
        state.briefs.push(row);
        return structuredClone(row);
      },
      async forDate(day) {
        return state.briefs.filter((b) => b.forDate === day).map((b) => structuredClone(b));
      },
      async get(briefId) {
        const b = state.briefs.find((x) => x.id === briefId);
        return b ? structuredClone(b) : null;
      },
      async search({ limit, query }) {
        const q = query?.toLowerCase() ?? "";
        return [...state.briefs]
          .filter((b) => !q || b.search.toLowerCase().includes(q))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit)
          .map((b) => structuredClone(b));
      },
    },
    settings: {
      async get() {
        return structuredClone(state.settings);
      },
      async update(patch) {
        state.settings = { ...state.settings, ...patch };
        return structuredClone(state.settings);
      },
    },
    audit: {
      async append(event) {
        state.audit.push({ ...event, id: randomUUID(), at: new Date().toISOString() });
        if (state.audit.length > 500) state.audit.shift();
      },
      async recent(limit) {
        return state.audit.slice(-limit).reverse();
      },
      async byAction(action, iso) {
        return state.audit.filter((e) => e.action === action && e.at >= iso).reverse().slice(0, 1000);
      },
    },
    ledger: {
      async add(entry) {
        state.ledger.push({ ...entry, id: randomUUID(), at: new Date().toISOString() });
      },
      async since(iso) {
        return state.ledger.filter((e) => e.at >= iso);
      },
    },
    aiUsage: {
      async countToday(purpose) {
        const day = new Date().toISOString().slice(0, 10);
        return state.aiCalls.filter((c) => c.at.startsWith(day) && (purpose === undefined || c.purpose === purpose)).length;
      },
      async record(purpose) {
        state.aiCalls.push({ at: new Date().toISOString(), purpose });
      },
      async since(iso) {
        return state.aiCalls.filter((c) => c.at >= iso).map((c) => c.at);
      },
    },
    qa: {
      async save(r) {
        const row: StoredQaReport = { ...structuredClone(r), id: randomUUID(), createdAt: new Date().toISOString() };
        state.qaReports = [...(state.qaReports ?? []).filter((x) => x.forDate !== r.forDate), row];
        return structuredClone(row);
      },
      async recent(limit) {
        return [...(state.qaReports ?? [])].sort((a, b) => b.forDate.localeCompare(a.forDate)).slice(0, limit).map((r) => structuredClone(r));
      },
    },
    snippets: collection((state.snippets ??= [])),
    // Demo mode has no embedding model, so search here is keyword-only (BM25).
    knowledge: {
      async manifest() {
        return (state.knowledge ??= []).map(({ id, source, sourceId, chunkIndex, hash }) => ({ id, source, sourceId, chunkIndex, hash }));
      },
      async upsert(chunks) {
        const rows = (state.knowledge ??= []);
        const at = new Date().toISOString();
        for (const c of chunks) {
          const row = rows.find((r) => chunkKey(r) === chunkKey(c));
          if (row) Object.assign(row, c, { embedding: null, updatedAt: at });
          else rows.push({ ...c, id: randomUUID(), embedding: null, updatedAt: at });
        }
      },
      async remove(ids) {
        const gone = new Set(ids);
        state.knowledge = (state.knowledge ??= []).filter((r) => !gone.has(r.id));
      },
      async pending(limit) {
        return (state.knowledge ??= []).filter((r) => !r.embedding).slice(0, limit).map(({ id, title, content }) => ({ id, title, content }));
      },
      async setEmbeddings(rows) {
        for (const r of rows) {
          const row = (state.knowledge ??= []).find((x) => x.id === r.id);
          if (row) row.embedding = r.embedding;
        }
      },
      async search({ terms, limit, sources, since, until }) {
        const rows = (state.knowledge ??= []).filter((r) => (!sources?.length || sources.includes(r.source)) && (!since || (r.occurredAt !== null && r.occurredAt >= since)) && (!until || (r.occurredAt !== null && r.occurredAt < until)));
        const byId = new Map(rows.map((r) => [r.id, r]));
        const hit = (id: string): Hit => {
          const r = byId.get(id)!;
          return { id: r.id, source: r.source, sourceId: r.sourceId, chunkIndex: r.chunkIndex, title: r.title, content: r.content, href: r.href, occurredAt: r.occurredAt };
        };
        const lexical = bm25(terms.join(" "), rows.map((r) => ({ id: r.id, text: `${r.title} ${r.content}` }))).slice(0, limit).map((r) => hit(r.id));
        return { lexical, semantic: [] };
      },
      async stats() {
        const rows = (state.knowledge ??= []);
        return { passages: rows.length, embedded: rows.filter((r) => r.embedding).length, indexedAt: rows.reduce<string | null>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null) };
      },
      async bySource(source, limit) {
        return (state.knowledge ??= []).filter((r) => r.source === source).slice(0, limit).map(({ sourceId, title, content }) => ({ sourceId, title, content }));
      },
    },
    agentRunState: {
      async save(runId, agent, status, st) {
        const rows = (state.agentStates ??= []).filter((r) => r.runId !== runId);
        state.agentStates = [...rows, { runId, agent, status, state: structuredClone(st), updatedAt: new Date().toISOString() }];
      },
      async get(runId) {
        const r = (state.agentStates ?? []).find((x) => x.runId === runId);
        return r ? { runId: r.runId, agent: r.agent, status: r.status, state: structuredClone(r.state) } : null;
      },
      async recent(agent, limit) {
        return (state.agentStates ?? [])
          .filter((r) => r.agent === agent)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .slice(0, limit)
          .map((r) => ({ runId: r.runId, status: r.status, state: structuredClone(r.state), updatedAt: r.updatedAt }));
      },
    },
    agentMemory: {
      async add(row) {
        const made: Lesson = { ...row, id: randomUUID(), confirmed: 0 };
        (state.agentLessons ??= []).push(made);
        return structuredClone(made);
      },
      async list(agent) {
        return (state.agentLessons ?? []).filter((l) => l.agent === agent).map((l) => structuredClone(l));
      },
      async confirm(id, expiresOn) {
        const l = (state.agentLessons ?? []).find((x) => x.id === id);
        if (l) {
          l.confirmed += 1;
          l.expiresOn = expiresOn;
        }
      },
    },
    applyBriefs: {
      async save(approvalId, data, researchedAt) {
        state.applyBriefs = [...(state.applyBriefs ?? []).filter((b) => b.approvalId !== approvalId), { approvalId, data: structuredClone(data), researchedAt }];
      },
      async forKits(ids) {
        const want = new Set(ids);
        return new Map((state.applyBriefs ?? []).filter((b) => want.has(b.approvalId)).map((b) => [b.approvalId, { data: structuredClone(b.data), researchedAt: b.researchedAt }]));
      },
    },
    careerMaps: {
      async save(week, data) {
        state.careerMaps = [...(state.careerMaps ?? []).filter((m) => m.week !== week), { week, data: structuredClone(data) }];
      },
      async latest(limit) {
        return [...(state.careerMaps ?? [])].sort((a, b) => b.week.localeCompare(a.week)).slice(0, limit).map((m) => ({ week: m.week, data: structuredClone(m.data) }));
      },
    },
    benchmarks: {
      async upsert(points) {
        const have = new Map((state.benchmarks ??= []).map((p) => [`${p.seriesId}|${p.period}`, p]));
        let added = 0;
        for (const p of points) {
          if (!have.has(`${p.seriesId}|${p.period}`)) added++;
          have.set(`${p.seriesId}|${p.period}`, { ...p });
        }
        state.benchmarks = [...have.values()];
        return added;
      },
      async since(day) {
        return (state.benchmarks ?? []).filter((p) => p.period >= day).map((p) => ({ ...p }));
      },
    },
    techMarket: {
      async record(rows) {
        const have = new Map((state.techPostings ??= []).map((p) => [p.fingerprint, p]));
        let added = 0;
        for (const r of rows) {
          const old = have.get(r.fingerprint);
          if (!old) added++;
          have.set(r.fingerprint, mergeTech(old, structuredClone(r)));
        }
        state.techPostings = [...have.values()];
        return added;
      },
      async since(day) {
        return (state.techPostings ??= []).filter((p) => p.lastSeen >= day).map((p) => structuredClone(p));
      },
      async prune(before) {
        const all = (state.techPostings ??= []);
        state.techPostings = all.filter((p) => p.lastSeen >= before);
        return all.length - state.techPostings.length;
      },
      async size() {
        return { postings: (state.techPostings ?? []).length, days: new Set((state.marketDaily ?? []).map((r) => r.day)).size };
      },
      async saveDaily(day, rows) {
        state.marketDaily =[...(state.marketDaily ?? []).filter((r) => r.day !== day), ...structuredClone(rows)];
      },
      async daily(since) {
        return (state.marketDaily ?? []).filter((r) => r.day >= since).map((r) => structuredClone(r));
      },
      async saveQuality(q) {
        state.marketQuality = [...(state.marketQuality ?? []).filter((r) => r.day !== q.day), structuredClone(q)];
      },
      async quality(since) {
        return (state.marketQuality ?? []).filter((r) => r.day >= since).map((r) => structuredClone(r));
      },
    },
    market: {
      async record(rows) {
        const have = (state.marketPostings ??= []);
        let added = 0;
        for (const r of rows) {
          const old = have.find((p) => p.key === r.key);
          if (old) Object.assign(old, r, { firstSeen: old.firstSeen });
          else {
            have.push({ ...r, id: randomUUID(), createdAt: new Date().toISOString() });
            added++;
          }
        }
        return added;
      },
      async since(day) {
        return (state.marketPostings ??= []).filter((p) => p.lastSeen >= day).map((p) => structuredClone(p));
      },
      async saveReport(r) {
        const row: StoredMarketReport = { ...structuredClone(r), id: randomUUID(), createdAt: new Date().toISOString() };
        state.marketReports = [...(state.marketReports ?? []).filter((x) => x.forDate !== r.forDate), row];
        return structuredClone(row);
      },
      async latestReport() {
        const last = [...(state.marketReports ?? [])].sort((a, b) => b.forDate.localeCompare(a.forDate))[0];
        return last ? structuredClone(last) : null;
      },
    },
    mentor: {
      async add(rows) {
        const made = rows.map((r) => ({ ...structuredClone(r), id: randomUUID(), createdAt: new Date().toISOString() }));
        (state.mentorInsights ??= []).push(...made);
        return made.map((r) => structuredClone(r));
      },
      async since(day) {
        return (state.mentorInsights ??= []).filter((i) => i.forDate >= day).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((i) => structuredClone(i));
      },
      async setStatus(id, status, note) {
        const row = (state.mentorInsights ??= []).find((i) => i.id === id);
        if (!row) return;
        row.status = status;
        if (note !== undefined) row.ownerNote = note;
      },
    },
    portfolio: {
      async replace(rows) {
        const old = state.portfolioRepos ?? [];
        state.portfolioRepos = rows.map((r) => ({ ...structuredClone(r), id: old.find((o) => o.repo === r.repo)?.id ?? randomUUID(), createdAt: old.find((o) => o.repo === r.repo)?.createdAt ?? new Date().toISOString() }));
      },
      async list() {
        return [...(state.portfolioRepos ?? [])].sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "")).map((r) => structuredClone(r));
      },
    },
    roleProposals: {
      async add(row) {
        const made: RoleProposal = { ...structuredClone(row), id: randomUUID(), status: row.status ?? "new", decidedAt: null, createdAt: new Date().toISOString() };
        (state.roleProposals ??= []).push(made);
        return structuredClone(made);
      },
      async recent(limit) {
        return [...(state.roleProposals ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((r) => structuredClone(r));
      },
      async get(id) {
        const row = (state.roleProposals ?? []).find((r) => r.id === id);
        return row ? structuredClone(row) : null;
      },
      async setStatus(id, status) {
        const row = (state.roleProposals ?? []).find((r) => r.id === id);
        if (row) Object.assign(row, { status, decidedAt: new Date().toISOString() });
      },
    },
    roleProfiles: {
      async save(row) {
        const list = (state.roleProfiles ??= []);
        const made: RoleProfile = { ...structuredClone(row), id: randomUUID(), createdAt: new Date().toISOString() };
        const at = list.findIndex((r) => r.role === row.role && r.forWeek === row.forWeek);
        if (at >= 0) list[at] = made;
        else list.push(made);
        return structuredClone(made);
      },
      async recent(limit) {
        return [...(state.roleProfiles ?? [])].sort((a, b) => b.forWeek.localeCompare(a.forWeek) || b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((r) => structuredClone(r));
      },
    },
    roleSkills: {
      async save(rows) {
        const list = (state.roleSkills ??= []);
        for (const row of rows) {
          const made: RoleSkillStat = { ...structuredClone(row), id: randomUUID(), createdAt: new Date().toISOString() };
          const at = list.findIndex((r) => r.role === row.role && r.forDate === row.forDate);
          if (at >= 0) list[at] = made;
          else list.push(made);
        }
      },
      async since(day) {
        return (state.roleSkills ?? []).filter((r) => r.forDate >= day).sort((a, b) => a.forDate.localeCompare(b.forDate)).map((r) => structuredClone(r));
      },
    },
    roleDescriptions: {
      async save(row) {
        const list = (state.roleDescriptions ??= []);
        const made: RoleDescription = { ...structuredClone(row), id: randomUUID(), createdAt: new Date().toISOString() };
        const at = list.findIndex((r) => r.role === row.role && r.forMonth === row.forMonth);
        if (at >= 0) list[at] = made;
        else list.push(made);
        return structuredClone(made);
      },
      async recent(limit) {
        return [...(state.roleDescriptions ?? [])].sort((a, b) => b.forMonth.localeCompare(a.forMonth) || b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((r) => structuredClone(r));
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Demo seed. All people, companies and numbers are fictional.

export function seedState(now: Date = new Date(), timeZone = DEFAULT_SETTINGS.timezone): MemoryState {
  const today = localDate(now, timeZone);
  const monday = mondayOf(today);
  const iso = (day: string, hhmm = "09:00") => new Date(`${day}T${hhmm}:00Z`).toISOString();
  const created = iso(addDays(today, -10));
  let n = 0;
  const id = (p: string) => `${p}-${String(++n).padStart(3, "0")}`;

  const task = (t: Partial<Task> & Pick<Task, "title">): Task => ({
    id: id("task"),
    notes: "",
    status: "todo",
    priority: "medium",
    area: "work",
    day: null,
    startTime: null,
    estimateMin: 30,
    energy: "shallow",
    recurrence: "none",
    createdAt: created,
    completedAt: null,
    ...t,
  });

  const tasks: Task[] = [
    task({ title: "Prep discovery call deck for Northwind", priority: "critical", day: today, estimateMin: 90, energy: "deep", startTime: "09:30" }),
    task({ title: "Review Q4 demo environment checklist", priority: "high", day: today, estimateMin: 45, status: "doing" }),
    task({ title: "Reply to Priya about the onboarding doc", priority: "medium", day: today, estimateMin: 15 }),
    task({ title: "Inbox zero: 20-minute sweep", priority: "low", day: today, estimateMin: 20, recurrence: "weekdays" }),
    task({ title: "Tailor resume for Solutions Architect roles", area: "career", priority: "high", day: addDays(today, 1), estimateMin: 60, energy: "deep" }),
    task({ title: "Book dentist appointment", area: "health", priority: "low", estimateMin: 10 }),
    task({ title: "Draft SE knowledge-base article: SSO setup", priority: "medium", estimateMin: 60, energy: "deep" }),
    task({ title: "Renew car registration", area: "finance", priority: "high", estimateMin: 20 }),
    task({ title: "Plan Saturday family hike", area: "family", priority: "medium", estimateMin: 30 }),
    task({ title: "Weekly review (Sunday reset)", area: "personal", priority: "medium", day: addDays(monday, 6), estimateMin: 25, recurrence: "weekly" }),
    task({ title: "Send follow-up to Halcyon recruiter", area: "career", priority: "high", day: addDays(today, -1), estimateMin: 10 }),
    task({ title: "Customer call notes: Bluebird Health", priority: "medium", day: addDays(today, -1), status: "done", estimateMin: 20, completedAt: iso(addDays(today, -1), "17:00") }),
  ];

  const goals: Goal[] = [
    { id: id("goal"), weekOf: monday, title: "Ship the Northwind demo with zero open questions", area: "work", done: false, createdAt: created },
    { id: id("goal"), weekOf: monday, title: "Apply to 5 Solutions Architect roles", area: "career", done: false, createdAt: created },
    { id: id("goal"), weekOf: monday, title: "Three workouts and one long walk", area: "health", done: true, createdAt: created },
  ];

  const birthdaySoon = addDays(today, 3).slice(5);
  const contacts: Contact[] = [
    { id: id("contact"), name: "Priya Raman", circle: "team", email: "priya@example.com", phone: null, cadenceDays: 7, lastContactAt: iso(addDays(today, -9)), birthday: null, notes: "Onboarding doc owner", createdAt: created },
    { id: id("contact"), name: "Marcus Lee", circle: "team", email: "marcus@example.com", phone: null, cadenceDays: 14, lastContactAt: iso(addDays(today, -3)), birthday: null, notes: "Manager. Prefers short updates.", createdAt: created },
    { id: id("contact"), name: "Mom", circle: "family", email: null, phone: "+15555550100", cadenceDays: 4, lastContactAt: iso(addDays(today, -6)), birthday: null, notes: "", createdAt: created },
    { id: id("contact"), name: "Jordan (brother)", circle: "family", email: "jordan@example.com", phone: "+15555550101", cadenceDays: 10, lastContactAt: iso(addDays(today, -4)), birthday: birthdaySoon, notes: "Loves trail running", createdAt: created },
    { id: id("contact"), name: "Sam Ortiz", circle: "friends", email: "sam@example.com", phone: "+15555550102", cadenceDays: 21, lastContactAt: iso(addDays(today, -30)), birthday: null, notes: "Ask about the new job", createdAt: created },
    { id: id("contact"), name: "Dana Whitfield", circle: "network", email: "dana@example.com", phone: null, cadenceDays: 45, lastContactAt: null, birthday: null, notes: "Met at the AI meetup. Hiring SAs.", createdAt: created },
  ];

  // Slack hand-off demo: fictional workspace and member IDs for the two teammates.
  Object.assign(contacts[0]!, { slackTeamId: "T0DEMO1234", slackUserId: "U0PRIYA001" });
  Object.assign(contacts[1]!, { slackTeamId: "T0DEMO1234", slackUserId: "U0MARCUS01" });

  const snippets: Snippet[] = [
    { id: id("snippet"), channel: "slack", title: "Got a sec?", body: "Hey {first}, got 5 min today for a quick question?", createdAt: created },
    { id: id("snippet"), channel: "sms", title: "Running late", body: "Running about 10 min late, sorry! See you soon.", createdAt: created },
    { id: id("snippet"), channel: "email", title: "Weekly update", body: "Hi {first},\n\nQuick update on this week:\n\n- \n\nThanks,\n{me}", createdAt: created },
  ];

  const routines: Routine[] = [
    { id: id("routine"), title: "Water + 10 minutes outside", slot: "morning", minutes: 10, position: 1, lastDoneOn: null, createdAt: created },
    { id: id("routine"), title: "Read the brief, pick today's one thing", slot: "morning", minutes: 5, position: 2, lastDoneOn: null, createdAt: created },
    { id: id("routine"), title: "Block deep work on the calendar", slot: "morning", minutes: 3, position: 3, lastDoneOn: null, createdAt: created },
    { id: id("routine"), title: "Shutdown: plan tomorrow's top three", slot: "evening", minutes: 5, position: 1, lastDoneOn: null, createdAt: created },
    { id: id("routine"), title: "Phone on the charger outside the bedroom", slot: "evening", minutes: 1, position: 2, lastDoneOn: null, createdAt: created },
    { id: id("routine"), title: "Clear backlog: drop, delegate, or schedule", slot: "weekly-review", minutes: 10, position: 1, lastDoneOn: null, createdAt: created },
    { id: id("routine"), title: "Set next week's three goals", slot: "weekly-review", minutes: 5, position: 2, lastDoneOn: null, createdAt: created },
    { id: id("routine"), title: "Check bills, subscriptions and the budget", slot: "weekly-review", minutes: 10, position: 3, lastDoneOn: null, createdAt: created },
  ];

  const renewal = (r: Pick<Renewal, "title" | "kind" | "dueOn" | "cadence"> & Partial<Renewal>): Renewal => ({
    leadDays: 14,
    url: "",
    notes: "",
    ...r,
    id: id("renewal"),
    createdAt: created,
    anchorDay: Number(r.dueOn.slice(8, 10)),
  });
  const renewals: Renewal[] = [
    renewal({
      title: "Renters insurance",
      kind: "renewal",
      dueOn: addDays(today, -4),
      cadence: "yearly",
      url: "https://example.com/insurance",
      notes: "Policy ends if this lapses.",
    }),
    renewal({ title: "atlas.example domain", kind: "renewal", dueOn: today, cadence: "yearly", url: "https://example.com/registrar" }),
    renewal({ title: "Download last year's tax PDF", kind: "document", dueOn: addDays(today, 3), cadence: "once" }),
    renewal({ title: "Car registration", kind: "document", dueOn: addDays(today, 10), cadence: "yearly", url: "https://example.com/dmv" }),
    renewal({ title: "Passport", kind: "document", dueOn: addDays(today, 400), cadence: "yearly", leadDays: 60 }),
  ];

  const watches: JobWatch[] = [
    { id: id("watch"), company: "Anthropic", board: "greenhouse", slug: "anthropic", createdAt: created },
    { id: id("watch"), company: "Vercel", board: "greenhouse", slug: "vercel", createdAt: created },
    { id: id("watch"), company: "Databricks", board: "greenhouse", slug: "databricks", createdAt: created },
    { id: id("watch"), company: "OpenAI", board: "ashby", slug: "openai", createdAt: created },
    { id: id("watch"), company: "Supabase", board: "ashby", slug: "supabase", createdAt: created },
  ];

  // Demo applications on the Applications board (the interview is on the demo calendar).
  const app = (n: number, a: Omit<Application, "id" | "createdAt" | "tier" | "origin" | "externalId" | "source" | "payText">): Application => ({
    ...a,
    id: `demo-app-${n}`,
    source: "Email",
    payText: "",
    stage: stageOfStatus(a.status),
    lastHeardAt: a.status === "applied" ? null : a.statusAt,
    tier: "semi",
    origin: "atlas",
    externalId: `demo:${n}`,
    createdAt: created,
  });
  const applications: Application[] = [
    app(1, { company: "Northwind Labs", role: "Senior Solutions Engineer", targetRole: "Solutions Engineer", url: "https://example.com/jobs/1", status: "interview", appliedOn: addDays(today, -18), statusAt: iso(addDays(today, -2)), notes: `Next: Prep panel demo (by ${addDays(today, 2)})` }),
    app(2, { company: "Halcyon AI", role: "Solutions Architect", targetRole: "Solutions Engineer", url: "https://example.com/jobs/2", status: "replied", appliedOn: addDays(today, -9), statusAt: iso(addDays(today, -4)), notes: `Next: Send availability (by ${addDays(today, -1)})` }),
    app(3, { company: "Bluebird Health", role: "Sales Engineer", targetRole: "Solutions Engineer", url: "https://example.com/jobs/3", status: "applied", appliedOn: addDays(today, -8), statusAt: iso(addDays(today, -8)), notes: "" }),
    app(4, { company: "Cobalt Systems", role: "Forward Deployed Engineer", targetRole: "Forward Deployed Engineer", url: "https://example.com/jobs/4", status: "applied", appliedOn: addDays(today, -3), statusAt: iso(addDays(today, -3)), notes: "" }),
    app(5, { company: "Pinecrest Data", role: "Customer Engineer", targetRole: "Solutions Engineer", url: "https://example.com/jobs/5", status: "rejected", appliedOn: addDays(today, -25), statusAt: iso(addDays(today, -8)), notes: "" }),
    // Logged from a confirmation email whose subject did not name the role.
    app(6, { company: "Lumen Works", role: ROLE_NOT_LISTED, targetRole: "", url: "", status: "applied", appliedOn: addDays(today, -1), statusAt: iso(addDays(today, -1)), notes: "From email: Thank you for applying to Lumen Works" }),
  ];

  // Each demo application's timeline: the day you applied, then the email that moved it.
  const HEARD_AS = { replied: "reply", interview: "interview", rejected: "rejection" } as const;
  const applicationEvents: ApplicationEvent[] = applications.flatMap((a) => {
    const event = (kind: ApplicationEvent["kind"], occurredAt: string, source: ApplicationEvent["source"], summary: string): ApplicationEvent => ({
      id: `${a.id}-${kind}`,
      applicationId: a.id,
      kind,
      occurredAt,
      source,
      sourceRef: `demo:${a.id}`,
      threadId: "",
      decidedBy: "rules",
      stage: null,
      summary,
      createdAt: created,
    });
    const heard = a.status === "replied" || a.status === "interview" || a.status === "rejected" ? HEARD_AS[a.status] : null;
    return [
      ...(a.appliedOn ? [event("applied", iso(a.appliedOn), "you", "You applied")] : []),
      ...(heard ? [event(heard, a.statusAt, "email", EVENT_LABEL[heard])] : []),
    ];
  });

  // Heard back: the answers above, as the feed lists them. Two are unread; none waits to be sent.
  const notifications: Notice[] = applicationEvents
    .filter((e) => e.source === "email")
    .map((e): Notice => {
      const a = applications.find((x) => x.id === e.applicationId)!;
      return { id: `${e.id}-notice`, eventId: e.id, applicationId: a.id, kind: e.kind, occurredAt: e.occurredAt, ...noticeText(e.kind, a), url: `/applications/${a.id}`, tier: "push", sentAt: e.occurredAt, seenAt: e.kind === "rejection" ? e.occurredAt : null, createdAt: e.occurredAt };
    });

  const ledger: LedgerEntry[] = [
    { id: id("ledger"), at: iso(addDays(today, -1), "13:00"), agent: "chief-of-staff", activity: "Morning brief", minutesSaved: 20 },
    { id: id("ledger"), at: iso(addDays(today, -1), "13:05"), agent: "news", activity: "News digest", minutesSaved: 15 },
    { id: id("ledger"), at: iso(addDays(today, -2), "15:00"), agent: "chief-of-staff", activity: "Week planned", minutesSaved: 30 },
    { id: id("ledger"), at: iso(addDays(today, -2), "16:00"), agent: "email", activity: "Drafted message to Marcus Lee", minutesSaved: 6 },
    { id: id("ledger"), at: iso(addDays(today, -1), "18:00"), agent: "career", activity: "Job board scan", minutesSaved: 20 },
  ];

  const projects: Project[] = [
    { id: id("project"), title: "Atlas: Gmail triage and the 7 AM push", kind: "side-project", status: "active", why: "Saves the most minutes of anything on the roadmap.", nextStep: "Connect Google and run the first inbox sync", link: null, reviewOn: null, createdAt: created },
    { id: id("project"), title: "Claude Certified Architect exam", kind: "learning", status: "exploring", why: "Signals depth for Solutions Architect roles.", nextStep: "Book the exam date", link: null, reviewOn: addDays(today, 5), createdAt: created },
    { id: id("project"), title: "Weekend trail-running group", kind: "idea", status: "idea", why: "Fitness plus friends in one slot.", nextStep: "", link: null, reviewOn: addDays(today, 14), createdAt: created },
    { id: id("project"), title: "Garage shelving", kind: "home", status: "parked", why: "Space for the bikes.", nextStep: "Measure the back wall", link: null, reviewOn: today, createdAt: created },
  ];

  const mail = (minutesAgo: number, m: Omit<InboxItem, "id" | "createdAt" | "receivedAt" | "done">): InboxItem => ({
    ...m,
    id: id("inbox"),
    receivedAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    done: false,
    createdAt: created,
  });
  const inbox: InboxItem[] = [
    mail(50, { messageId: "demo1", threadId: "demo1", fromName: "Sam Ortiz", fromEmail: "sam@example.com", subject: "Dinner next week?", snippet: "Are you free Thursday or Friday? Thinking that taco place downtown.", category: "reply", reason: "From Sam Ortiz (friends)" }),
    mail(190, { messageId: "demo2", threadId: "demo2", fromName: "Dana Whitfield", fromEmail: "dana@example.com", subject: "SA role on my team", snippet: "Would you be open to a 20-minute chat about the opening? Let me know what works.", category: "reply", reason: "From Dana Whitfield (network)" }),
    mail(400, { messageId: "demo3", threadId: "demo3", fromName: "Front Range Dental", fromEmail: "office@frdental.example", subject: "Please confirm your cleaning on the 20th", snippet: "Reply C to confirm or call us to reschedule.", category: "reply", reason: "Asks you something directly" }),
    mail(600, { messageId: "demo4", threadId: "demo4", fromName: "Xcel Energy", fromEmail: "billing@xcel.example", subject: "Your statement is ready", snippet: "Amount due $84.12 by Nov 28.", category: "fyi", reason: "Update or receipt" }),
    mail(900, { messageId: "demo5", threadId: "demo5", fromName: "The Batch", fromEmail: "newsletter@batch.example", subject: "This week in AI", snippet: "Agents, evals, and a new open model.", category: "noise", reason: "Mailing list or automated" }),
    mail(1300, { messageId: "demo6", threadId: "demo6", fromName: "GitHub", fromEmail: "notifications@github.example", subject: "[saltylvn/atlas-optim] CI passed", snippet: "All checks have passed.", category: "noise", reason: "Notification sender" }),
    // Email Agent samples: a job email, a bank, a tracked subscription, a kept store, and promotions to declutter.
    // The demo has no Gmail to read, so its job emails come already read: the tracker places only read mail.
    mail(240, { messageId: "demo7", threadId: "demo7", fromName: "Northwind Labs Recruiting", fromEmail: "no-reply@northwind.greenhouse.io", subject: "Interview availability for Senior Solutions Engineer", snippet: "", category: "noise", reason: "Notification sender", textVerdict: "interview", textQuote: "We would like to schedule a 45-minute interview with the hiring manager next week." }),
    mail(700, { messageId: "demo8", threadId: "demo8", fromName: "Chase", fromEmail: "no.reply.alerts@chase.com", subject: "Your credit card statement is ready", snippet: "", category: "noise", reason: "Notification sender" }),
    mail(800, { messageId: "demo9", threadId: "demo9", fromName: "Apex Fitness", fromEmail: "membership@apexfitness.example", subject: "Your membership renews Dec 1", snippet: "", category: "fyi", reason: "Update or receipt" }),
    mail(1000, { messageId: "demo10", threadId: "demo10", fromName: "Costco", fromEmail: "deals@email.costco.example", subject: "Member-only savings this week", snippet: "", category: "noise", reason: "Mailing list or automated" }),
    mail(1100, { messageId: "demo11", threadId: "demo11", fromName: "Trailhead Outfitters", fromEmail: "news@mail.trailhead.example", subject: "Flash sale: 40% off jackets", snippet: "", category: "noise", reason: "Mailing list or automated" }),
    mail(1500, { messageId: "demo12", threadId: "demo12", fromName: "Trailhead Outfitters", fromEmail: "news@mail.trailhead.example", subject: "Last chance: free shipping", snippet: "", category: "noise", reason: "Mailing list or automated" }),
    // A rejection whose subject reads like a status update: only its text says so.
    mail(320, { messageId: "demo14", threadId: "demo14", fromName: "Cobalt Systems Recruiting", fromEmail: "no-reply@cobalt.greenhouse.io", subject: "Update on your application with Cobalt Systems", snippet: "", category: "noise", reason: "Notification sender", textVerdict: "rejection", textQuote: "After careful consideration, we have decided to move forward with other candidates for the Forward Deployed Engineer role." }),
    mail(1700, { messageId: "demo13", threadId: "demo13", fromName: "Gadget Weekly", fromEmail: "hello@gadgetweekly.example", subject: "This week's best deals", snippet: "", category: "noise", reason: "Gmail promotions" }),
  ];

  return {
    tasks,
    goals,
    contacts,
    messages: [],
    routines,
    renewals,
    watches,
    projects,
    inbox,
    connections: [],
    push: [],
    // Demo-only example lists (the live app starts with these empty; you fill them in Settings).
    settings: { ...DEFAULT_SETTINGS, timezone: timeZone, emailStores: ["Costco"], emailSubscriptions: ["Apex Fitness"] },
    // A morning that already ran, so Mission Control has something to show in demo mode.
    agentRuns: [
      { id: id("run"), runId: "demo-run-1", agent: "chief-of-staff", task: "Morning Brief", status: "started", trigger: "schedule", detail: "", model: "", inputTokens: 0, outputTokens: 0, costUsd: 0, at: iso(addDays(today, -1), "14:12") },
      { id: id("run"), runId: "demo-run-1", agent: "chief-of-staff", task: "Morning Brief", status: "succeeded", trigger: "schedule", detail: "1 hot item, 4 events, 9 stories", model: "claude-opus-5-5", inputTokens: 2100, outputTokens: 380, costUsd: 0.0160, at: iso(addDays(today, -1), "14:12") },
      { id: id("run"), runId: "demo-run-2", agent: "chief-of-staff", task: "2:00 PM Brief", status: "failed", trigger: "schedule", detail: "News: 2 feeds timed out", model: "", inputTokens: 0, outputTokens: 0, costUsd: 0, at: iso(addDays(today, -1), "19:08") },
    ],
    agentState: [],
    briefs: [],
    audit: [
      { id: id("audit"), at: now.toISOString(), actor: "system", action: "demo.start", target: "store", detail: "Demo mode: fictional data held in memory", outcome: "success" },
    ],
    ledger,
    applications,
    applicationEvents,
    notifications,
    aiCalls: [],
    snippets,
    marketPostings: seedMarket(today),
    marketDaily: seedMarketDaily(today),
    benchmarks: seedBenchmarks(today),
    // No Career Map in the demo until the Career Mentor builds one (Update now on the Career Map page).
    careerMaps: [],
    // Filled as you 👍 jobs in the demo: the research runs then, with the news feed and the rules' angle.
    applyBriefs: [],
    roleSkills: seedRoleSkills(today),
    roleDescriptions: seedRoleDescriptions(today),
    portfolioRepos: seedPortfolio(today),
    roleProfiles: seedRoleProfiles(monday, created),
  };
}

/** Sample profiles for the demo's first two roles, as the Career Mentor would write them on a Monday. Fictional. */
function seedRoleProfiles(monday: string, createdAt: string): RoleProfile[] {
  const sample = (n: number, role: string, text: Pick<RoleProfile, "does" | "tempo" | "project" | "closeSkill" | "closeWhy">): RoleProfile => ({
    id: `role-profile-${n}`,
    role,
    forWeek: monday,
    ...text,
    postings: 0,
    facts: ["Sample text for the demo. In your own Atlas this is written from the Analyst's numbers for the role."],
    writer: "model",
    createdAt,
  });
  return [
    sample(1, "Solutions Engineer", {
      does: "You sit between the product and the customer: you learn what a customer is trying to do, show how the product does it, build the proof that it works in their setup, and stay with them until it is live.",
      tempo: "Customer-paced and varied. Several accounts move at once, calls set the rhythm of the week, and you are judged on deals won and customers who go live without trouble.",
      project: "Build a small integration between two tools a customer would use, with a short demo video that walks through the customer's problem first and the build second.",
      closeSkill: "",
      closeWhy: "",
    }),
    sample(2, "Software Engineer", {
      does: "You design, build and maintain features in a shared codebase: reading a ticket or a design, writing and testing the change, reviewing other people's work and keeping what is live healthy.",
      tempo: "Steady and team-paced. Work comes in planned cycles with reviews and releases, long stretches of focus, and you are judged on what ships and how well it holds up.",
      project: "Take one feature from idea to production in a public repository: a written plan, tests, a small deployment and a README that explains the trade-offs you made.",
      closeSkill: "",
      closeWhy: "",
    }),
  ];
}

/** What the Scout would have read from GitHub. Fictional projects. */
function seedPortfolio(today: string): PortfolioRepo[] {
  const repo = (n: number, name: string, description: string, languages: string[], stack: string[], skills: string[], isPrivate = false): PortfolioRepo => ({
    id: `repo-${n}`,
    repo: `demo/${name}`,
    name,
    description,
    url: isPrivate ? "" : `https://github.com/demo/${name}`,
    isPrivate,
    languages,
    topics: [],
    stack,
    skills,
    title: name === "beacon-agents" ? "Beacon" : "",
    readme: `${description}\nBuilt to try ${stack.join(", ")} on a real problem.`,
    pushedAt: new Date(`${addDays(today, -n * 3)}T15:00:00Z`).toISOString(),
    checkedOn: today,
    createdAt: new Date(`${addDays(today, -30)}T15:00:00Z`).toISOString(),
  });
  return [
    repo(1, "beacon-agents", "A supervisor agent that routes daily work to four specialists.", ["TypeScript", "Python"], ["Next.js", "Postgres", "GitHub Actions"], ["Python", "TypeScript", "n8n", "APIs", "SQL"]),
    repo(2, "relay-triage", "Human-in-the-loop inbox triage with an LLM classifier.", ["Python"], ["FastAPI", "Slack API"], ["Python", "APIs", "Zapier"]),
    repo(3, "ledger-notes", "A private notes app with search.", ["TypeScript"], ["React", "Postgres"], ["TypeScript", "React", "SQL"], true),
  ];
}

/** A sample description for the demo's first role, as the Career Mentor would write it from a web search. Fictional sources. */
function seedRoleDescriptions(today: string): RoleDescription[] {
  return [
    {
      id: "role-description-1",
      role: TARGET_ROLES[0]!.name,
      forMonth: today.slice(0, 7),
      description:
        "A Solutions Engineer is the technical partner on a sale and the first weeks after it: they learn what a customer needs, show how the product meets it, and build the integration or proof that it works. Unlike a Sales Engineer, the role often carries on into implementation; unlike a Solutions Architect, it works account by account rather than designing whole systems.",
      sources: [
        { title: "Sample: what a solutions engineer does", url: "https://example.com/solutions-engineer", host: "example.com" },
        { title: "Sample: solutions engineer vs sales engineer", url: "https://example.org/se-vs-sales", host: "example.org" },
      ],
      postings: 6,
      searchedOn: today,
      createdAt: `${today}T15:00:00.000Z`,
    },
  ];
}

/** Three weeks of daily skill counts, as the Analyst would have logged them from the demo's postings. Fictional. */
function seedRoleSkills(today: string): RoleSkillStat[] {
  const postings = seedMarket(today);
  return Array.from({ length: 21 }, (_, d) => addDays(today, -d - 1)).flatMap((day) =>
    skillSnapshot({ boards: postings, searches: [], roles: TARGET_ROLES.map((r) => r.name), day, windowDays: 30 }).map((r, i) => ({ ...r, id: `role-skills-${day}-${i}`, createdAt: `${day}T14:00:00.000Z` })),
  );
}

/** What the Scout would have recorded over the last three weeks. Fictional companies and numbers. */
/**
 * Demo only: two weeks of made-up market summary rows, so the demo has a history before the
 * Scout's first run. Deterministic; every number is invented.
 */
function seedMarketDaily(today: string): DailyRow[] {
  const base: Partial<Record<DailyRow["family"], number>> = { software: 420, "ai-ml": 160, data: 120, "devops-cloud": 90, security: 50, solutions: 40, product: 60, "it-support": 30 };
  const pay: Partial<Record<DailyRow["family"], number>> = { software: 152_000, "ai-ml": 178_000, data: 141_000, "devops-cloud": 149_000, security: 146_000, solutions: 138_000, product: 144_000, "it-support": 72_000 };
  const out: DailyRow[] = [];
  for (let d = 13; d >= 0; d--) {
    const day = addDays(today, -d);
    for (const [family, n] of Object.entries(base) as [DailyRow["family"], number][]) {
      for (const [seniority, share] of [["senior", 0.45], ["unstated", 0.4], ["junior", 0.15]] as const) {
        for (const [region, rShare] of [["us", 0.9], ["utah", 0.1]] as const) {
          const active = Math.round(n * share * rShare * (1 + ((13 - d) % 5) * 0.01 + (family === "ai-ml" ? (13 - d) * 0.006 : 0)));
          out.push({ day, family, seniority, region, active, added: Math.round(active * 0.12), gone: Math.round(active * 0.1), remote: Math.round(active * (region === "utah" ? 0.3 : 0.55)), withPay: Math.round(active * 0.4), payMedian: Math.round((pay[family]! * (seniority === "senior" ? 1.12 : seniority === "junior" ? 0.78 : 1)) / 1000) * 1000 });
        }
      }
    }
  }
  return out;
}

/** Demo only: two years of invented monthly JOLTS values, so the National trend panel has a shape. */
function seedBenchmarks(today: string): BenchmarkPoint[] {
  const out: BenchmarkPoint[] = [];
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  // JOLTS runs about two months behind.
  for (let i = 25; i >= 2; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1)).toISOString().slice(0, 10);
    const wave = Math.sin(i / 4);
    out.push({ seriesId: "JTS510000000000000JOL", period: d, value: Math.round(105 + wave * 12 - i * 0.4), preliminary: i === 2 });
    out.push({ seriesId: "JTS510000000000000JOR", period: d, value: Math.round((3.4 + wave * 0.4) * 10) / 10, preliminary: i === 2 });
    out.push({ seriesId: "JTS510000000000000HIL", period: d, value: Math.round(82 + wave * 8), preliminary: i === 2 });
    out.push({ seriesId: "JTS510000000000000QUL", period: d, value: Math.round(40 + wave * 3), preliminary: i === 2 });
    out.push({ seriesId: "JTS000000000000000JOL", period: d, value: Math.round(7400 + wave * 300), preliminary: i === 2 });
  }
  return out;
}

function seedMarket(today: string): MarketPosting[] {
  const roles = TARGET_ROLES.slice(0, 4).map((r) => r.name);
  const mix: [number, string[], number | null, MarketPosting["place"]][] = [
    [0, ["Python", "RAG", "LangChain", "AWS"], 165_000, "remote"],
    [0, ["Python", "RAG", "Kubernetes"], 150_000, "remote"],
    [0, ["Python", "TypeScript", "Kubernetes"], null, "other"],
    [0, ["Python", "RAG", "SQL"], 172_000, "remote"],
    [1, ["n8n", "Python", "APIs"], 120_000, "remote"],
    [1, ["n8n", "Zapier", "SQL"], null, "remote"],
    [1, ["Python", "APIs", "AWS"], 128_000, "salt-lake"],
    [2, ["n8n", "APIs", "TypeScript"], 110_000, "remote"],
    [2, ["Python", "SQL"], null, "other"],
    [3, ["TypeScript", "React", "SQL", "AWS"], 140_000, "remote"],
    [3, ["TypeScript", "Kubernetes", "AWS"], 155_000, "other"],
    [3, ["Python", "SQL", "Docker"], null, "remote"],
  ];
  // Twice over, so each role has enough postings for the Career Mentor to judge its place.
  return [...mix, ...mix].flatMap(([r, skills, pay, place], i) =>
    roles[r]
      ? [
          {
            id: `market-${String(i + 1).padStart(3, "0")}`,
            key: `demo:market:${i + 1}`,
            title: roles[r]!,
            company: ["Northwind Labs", "Bluebird Health", "Cobalt Systems", "Pinecrest Data", "Harbor AI", "Lumen Works"][i % 6]!,
            source: i % 2 ? "Greenhouse" : "Remote OK",
            url: `https://jobs.example/market/${i + 1}`,
            location: place === "remote" ? "Remote (US)" : place === "salt-lake" ? "Salt Lake City, UT" : "Austin, TX",
            role: roles[r]!,
            place,
            payMin: pay ? pay - 10_000 : null,
            payMax: pay ? pay + 10_000 : null,
            payUnit: pay ? ("year" as const) : ("" as const),
            skills,
            postedAt: null,
            firstSeen: addDays(today, -(i % 3 === 0 ? 2 : i % 3 === 1 ? 9 : 16)),
            lastSeen: addDays(today, -(i % 4)),
            createdAt: new Date(`${addDays(today, -16)}T15:00:00Z`).toISOString(),
          },
        ]
      : [],
  );
}

// One demo store per server process, kept across dev hot reloads.
const g = globalThis as unknown as { __atlasDemo?: Store };
export function demoStore(): Store {
  g.__atlasDemo ??= createMemoryStore(seedState());
  return g.__atlasDemo;
}
