import "server-only";

// Live store on Supabase Postgres. Pages and actions run every query as the signed-in
// owner through the publishable key, so Row Level Security (supabase/migrations) is the
// final authority on access: owner_id = auth.uid(), and only at MFA level aal2.
//
// Scheduled jobs (the 7 AM brief, inbox sync) have no browser session. They use the
// secret-key client, which bypasses RLS, so createSupabaseStore takes the owner's id and
// then filters every read and stamps every write with it explicitly.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentRunEvent, AgentStateRecord, ApplicationEvent, ConnectionInfo, InboxItem, JobMatch, Notice, PushSubscriptionRecord, Settings, StoredBrief } from "@/lib/domain/types";
import type { KnowledgeSource, ManifestRow } from "@/lib/domain/knowledge";
import type { MarketPosting, StoredMarketReport } from "@/lib/domain/market";
import { mergeTech, type DailyRow, type RunQuality, type TechPosting } from "@/lib/domain/techMarket";
import type { MentorInsight } from "@/lib/domain/mentor";
import { slotFromRow, slotToRow } from "@/lib/domain/moreMatches";
import type { ListedEvent } from "@/lib/domain/pipelineList";
import type { PortfolioRepo } from "@/lib/domain/portfolio";
import type { RoleProposal } from "@/lib/domain/roleOutlook";
import type { RoleProfile } from "@/lib/domain/roleProfile";
import type { RoleSkillStat } from "@/lib/domain/skillStats";
import type { RoleDescription } from "@/lib/domain/roleDescription";
import { toTsQuery, type Hit } from "@/lib/domain/retrieval";
import type { StoredQaReport } from "@/lib/domain/qa";
import { DEFAULT_SETTINGS, type Collection, type Store } from "./store";
import type { AgentState, Lesson } from "@/lib/domain/agentState";

const toSnake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

export function rowToRecord<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "owner_id") continue;
    out[toCamel(k)] = v;
  }
  return out as T;
}

export function recordToRow(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v === undefined || k === "id" || k === "createdAt") continue;
    out[toSnake(k)] = v;
  }
  return out;
}

// Atlas tracks full-time roles only (since 18 Nov 2026). job_matches and market_postings
// still have the `type` column from when contract work was tracked too. New rows are
// written as full-time; the few older contract rows stay in the database and are not read.
const FULL_TIME = "full-time";

// A match found on demand ("Find more good fits") belongs to no brief. The shown_slot column only
// allows the three brief slots, so slotToRow stores it under the one no brief writes for a
// match, and this reads it back. Only this file knows (lib/domain/moreMatches.ts).
const matchFromRow = (row: Record<string, unknown>): JobMatch => {
  const m = rowToRecord<JobMatch>(row);
  return { ...m, shownSlot: slotFromRow(m.shownSlot) };
};

function fail(table: string, op: string, error: { message: string; code?: string }): never {
  // The message names the table and operation; row data is never included.
  throw new Error(`Database ${op} on ${table} failed (${error.code ?? "error"})`);
}

/** Filters a query to the owner when running with the secret key; a no-op under RLS. */
type Scope = <Q>(q: Q) => Q;

function table<T extends { id: string }>(db: SupabaseClient, name: string, scope: Scope, stamp: Stamp, order = "created_at"): Collection<T> {
  return {
    async list() {
      const { data, error } = await scope(db.from(name).select("*")).order(order, { ascending: true }).limit(2000);
      if (error) fail(name, "list", error);
      return (data ?? []).map((r) => rowToRecord<T>(r));
    },
    async get(id) {
      const { data, error } = await scope(db.from(name).select("*").eq("id", id)).maybeSingle();
      if (error) fail(name, "get", error);
      return data ? rowToRecord<T>(data) : null;
    },
    async create(input) {
      const { data, error } = await db.from(name).insert(stamp(recordToRow(input))).select("*").single();
      if (error) fail(name, "insert", error);
      return rowToRecord<T>(data);
    },
    async update(id, patch) {
      const { data, error } = await scope(db.from(name).update(recordToRow(patch)).eq("id", id)).select("*").maybeSingle();
      if (error) fail(name, "update", error);
      return data ? rowToRecord<T>(data) : null;
    },
    async remove(id) {
      const { error } = await scope(db.from(name).delete().eq("id", id));
      if (error) fail(name, "delete", error);
    },
  };
}

type Stamp = (row: Record<string, unknown>) => Record<string, unknown>;

/** Postgres numeric arrives as a string; the log wants a number. */
function toRun(r: Record<string, unknown>): AgentRunEvent {
  const e = rowToRecord<AgentRunEvent>(r);
  return { ...e, costUsd: Number(e.costUsd) || 0 };
}

const CONNECTION_COLUMNS = "id, provider, account_email, scopes, status, last_sync_at, last_error, created_at";

/**
 * @param ownerId Required with the secret-key client (scheduled jobs); omit with the
 * signed-in user's client, where RLS does the scoping.
 */
export function createSupabaseStore(db: SupabaseClient, ownerId?: string): Store {
  const scope: Scope = <Q,>(q: Q): Q => (ownerId ? (q as unknown as { eq(column: string, value: string): Q }).eq("owner_id", ownerId) : q);
  const stamp: Stamp = (row) => (ownerId ? { ...row, owner_id: ownerId } : row);
  return {
    tasks: table(db, "tasks", scope, stamp),
    goals: table(db, "goals", scope, stamp),
    contacts: table(db, "contacts", scope, stamp),
    phonebook: {
      async addMany(rows) {
        // In chunks, so one request stays small; each chunk is one insert.
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await db.from("contacts").insert(rows.slice(i, i + 500).map((r) => stamp(recordToRow(r as unknown as Record<string, unknown>))));
          if (error) fail("contacts", "insert", error);
        }
        return rows.length;
      },
    },
    messages: table(db, "messages", scope, stamp),
    routines: table(db, "routines", scope, stamp, "position"),
    renewals: table(db, "renewals", scope, stamp, "due_on"),
    watches: table(db, "job_watches", scope, stamp),
    projects: table(db, "projects", scope, stamp),
    applications: table(db, "applications", scope, stamp, "status_at"),
    applicationEvents: {
      async append(rows) {
        if (rows.length === 0) return [];
        // "Do nothing" on the unique key (owner, source, kind): a repeat is skipped, and only new rows come back.
        const { data, error } = await db
          .from("application_events")
          .upsert(rows.map((r) => stamp(recordToRow(r as unknown as Record<string, unknown>))), { onConflict: "owner_id,source_ref,kind", ignoreDuplicates: true })
          .select("*");
        if (error) fail("application_events", "insert", error);
        return (data ?? []).map((r) => rowToRecord<ApplicationEvent>(r));
      },
      async forApplication(applicationId) {
        const { data, error } = await scope(db.from("application_events").select("*").eq("application_id", applicationId).neq("decided_by", "model")).order("occurred_at", { ascending: true }).limit(500);
        if (error) fail("application_events", "list", error);
        return (data ?? []).map((r) => rowToRecord<ApplicationEvent>(r));
      },
      async index() {
        const { data, error } = await scope(db.from("application_events").select("application_id, source_ref, thread_id").neq("decided_by", "model")).order("occurred_at", { ascending: false }).limit(5000);
        if (error) fail("application_events", "list", error);
        return (data ?? []).map((r) => rowToRecord<Pick<ApplicationEvent, "applicationId" | "sourceRef" | "threadId">>(r));
      },
      async listed() {
        const { data, error } = await scope(db.from("application_events").select("application_id, kind, occurred_at, source, decided_by, stage, summary").neq("decided_by", "model")).order("occurred_at", { ascending: false }).limit(5000);
        if (error) fail("application_events", "list", error);
        return (data ?? []).map((r) => rowToRecord<ListedEvent>(r));
      },
      async readings() {
        const { data, error } = await scope(db.from("application_events").select("*").eq("decided_by", "model")).order("occurred_at", { ascending: false }).limit(1000);
        if (error) fail("application_events", "list", error);
        return (data ?? []).map((r) => rowToRecord<ApplicationEvent>(r));
      },
    },
    notifications: {
      async add(rows) {
        if (rows.length === 0) return [];
        // "Do nothing" on the unique key (the event): a repeat is skipped, and only new rows come back.
        const { data, error } = await db
          .from("notifications")
          .upsert(rows.map((r) => stamp(recordToRow(r as unknown as Record<string, unknown>))), { onConflict: "event_id", ignoreDuplicates: true })
          .select("*");
        if (error) fail("notifications", "insert", error);
        return (data ?? []).map((r) => rowToRecord<Notice>(r));
      },
      async recent(limit) {
        const { data, error } = await scope(db.from("notifications").select("*")).order("occurred_at", { ascending: false }).limit(limit);
        if (error) fail("notifications", "list", error);
        return (data ?? []).map((r) => rowToRecord<Notice>(r));
      },
      async unsent(tier, since) {
        const { data, error } = await scope(db.from("notifications").select("*").eq("tier", tier).is("sent_at", null).gte("occurred_at", since)).order("occurred_at", { ascending: true }).limit(200);
        if (error) fail("notifications", "list", error);
        return (data ?? []).map((r) => rowToRecord<Notice>(r));
      },
      async claim(ids, sentAt) {
        if (ids.length === 0) return [];
        // The check ("still unsent") and the write are one statement: a row can be claimed once.
        const { data, error } = await scope(db.from("notifications").update({ sent_at: sentAt }).in("id", ids).is("sent_at", null)).select("*");
        if (error) fail("notifications", "update", error);
        return (data ?? []).map((r) => rowToRecord<Notice>(r));
      },
      async markSeen(seenAt, applicationId) {
        const unseen = scope(db.from("notifications").update({ seen_at: seenAt }).is("seen_at", null));
        const { data, error } = await (applicationId ? unseen.eq("application_id", applicationId) : unseen).select("id");
        if (error) fail("notifications", "update", error);
        return data?.length ?? 0;
      },
    },
    approvals: table(db, "approvals", scope, stamp),
    jobMatches: {
      async since(day) {
        const { data, error } = await scope(db.from("job_matches").select("*")).eq("type", FULL_TIME).gte("shown_on", day).order("shown_on", { ascending: false }).order("score", { ascending: false }).limit(500);
        if (error) fail("job_matches", "list", error);
        return (data ?? []).map(matchFromRow);
      },
      async keys() {
        const { data, error } = await scope(db.from("job_matches").select("key")).limit(20000);
        if (error) fail("job_matches", "keys", error);
        return new Set((data ?? []).map((r) => String((r as { key: string }).key)));
      },
      async rated() {
        const { data, error } = await scope(db.from("job_matches").select("role, company, source, rating, skills")).eq("type", FULL_TIME).neq("rating", 0).limit(5000);
        if (error) fail("job_matches", "rated", error);
        return (data ?? []).map((r) => rowToRecord<Pick<JobMatch, "role" | "company" | "source" | "rating" | "skills">>(r));
      },
      async perfect() {
        const { data, error } = await scope(db.from("job_matches").select("*")).eq("type", FULL_TIME).eq("rating", 2).order("shown_on", { ascending: false }).limit(50);
        if (error) fail("job_matches", "perfect", error);
        return (data ?? []).map(matchFromRow);
      },
      async get(id) {
        const { data, error } = await scope(db.from("job_matches").select("*").eq("id", id).eq("type", FULL_TIME)).maybeSingle();
        if (error) fail("job_matches", "get", error);
        return data ? matchFromRow(data) : null;
      },
      async add(rows) {
        if (rows.length === 0) return [];
        // Inserting needs the secret-key client; the owner's session may only rate and move matches.
        const { data, error } = await db
          .from("job_matches")
          .upsert(rows.map((r) => stamp({ ...recordToRow({ ...r, shownSlot: slotToRow(r.shownSlot) } as unknown as Record<string, unknown>), type: FULL_TIME })), { onConflict: "owner_id,key", ignoreDuplicates: true })
          .select("*");
        if (error) fail("job_matches", "insert", error);
        return (data ?? []).map(matchFromRow);
      },
      async update(id, patch) {
        const { error } = await scope(db.from("job_matches").update(recordToRow(patch as Record<string, unknown>)).eq("id", id));
        if (error) fail("job_matches", "update", error);
      },
    },
    inbox: {
      async list() {
        const { data, error } = await scope(db.from("inbox_items").select("*")).order("received_at", { ascending: false }).limit(500);
        if (error) fail("inbox_items", "list", error);
        return (data ?? []).map((r) => rowToRecord<InboxItem>(r));
      },
      async setDone(itemId, done) {
        const { error } = await scope(db.from("inbox_items").update({ done }).eq("id", itemId));
        if (error) fail("inbox_items", "update", error);
      },
      async upsert(items) {
        if (items.length === 0) return;
        // Inserting needs the secret-key client; the owner's session may only check items off.
        const rows = items.map((i) => stamp(recordToRow(i as unknown as Record<string, unknown>)));
        const { error } = await db.from("inbox_items").upsert(rows, { onConflict: "owner_id,message_id", ignoreDuplicates: true });
        if (error) fail("inbox_items", "upsert", error);
      },
      async remove(messageIds) {
        if (messageIds.length === 0) return;
        // Only the secret-key client may delete; the owner's session cannot.
        const { error } = await scope(db.from("inbox_items").delete().in("message_id", messageIds));
        if (error) fail("inbox_items", "delete", error);
      },
      async setReadings(rows) {
        // Only the secret-key client may write these; the owner's session may only check items off.
        for (const r of rows) {
          const { error } = await scope(db.from("inbox_items").update({ text_verdict: r.verdict, text_quote: r.quote.slice(0, 240), text_role: (r.role ?? "").slice(0, 160) }).eq("message_id", r.messageId));
          if (error) fail("inbox_items", "update", error);
        }
      },
      async claimForModel(messageId, at) {
        // One statement: only a row never handed to the model is marked, and only then does it come back.
        const { data, error } = await scope(db.from("inbox_items").update({ model_read_at: at }).eq("message_id", messageId).is("model_read_at", null)).select("id");
        if (error) fail("inbox_items", "update", error);
        return (data ?? []).length > 0;
      },
    },
    connections: {
      async list() {
        const { data, error } = await scope(db.from("connections").select(CONNECTION_COLUMNS)).order("created_at");
        if (error) fail("connections", "list", error);
        return (data ?? []).map((r) => rowToRecord<ConnectionInfo>(r as Record<string, unknown>));
      },
    },
    push: {
      async list() {
        const { data, error } = await scope(db.from("push_subscriptions").select("*")).order("created_at");
        if (error) fail("push_subscriptions", "list", error);
        return (data ?? []).map((r) => rowToRecord<PushSubscriptionRecord>(r));
      },
      async add(sub) {
        const { error } = await db.from("push_subscriptions").upsert(stamp(recordToRow(sub)), { onConflict: "endpoint", ignoreDuplicates: true });
        if (error) fail("push_subscriptions", "insert", error);
      },
      async remove(endpoint) {
        const { error } = await scope(db.from("push_subscriptions").delete().eq("endpoint", endpoint));
        if (error) fail("push_subscriptions", "delete", error);
      },
    },
    agentRuns: {
      async append(event) {
        const { error } = await db.from("agent_runs").insert(stamp(recordToRow(event)));
        if (error) fail("agent_runs", "insert", error);
      },
      async recent(limit) {
        const { data, error } = await scope(db.from("agent_runs").select("*")).order("at", { ascending: false }).limit(limit);
        if (error) fail("agent_runs", "list", error);
        return (data ?? []).map(toRun);
      },
      async since(iso) {
        // A page at a time: the API returns at most 1,000 rows per request, and a week of runs is more
        // (QA, 22 Nov 2026: 1,178 rows, so the oldest days were cut off and Monday looked empty).
        const rows: Record<string, unknown>[] = [];
        for (let from = 0; from < 10_000; from += 1000) {
          const { data: page, error: pageErr } = await scope(db.from("agent_runs").select("*").gte("at", iso)).order("at", { ascending: false }).order("id").range(from, from + 999);
          if (pageErr) fail("agent_runs", "list", pageErr);
          rows.push(...(page ?? []));
          if ((page ?? []).length < 1000) break;
        }
        return rows.map(toRun);
      },
    },
    agentState: {
      async list() {
        const { data, error } = await scope(db.from("agent_state").select("agent, paused, updated_at"));
        if (error) fail("agent_state", "list", error);
        return (data ?? []).map((r) => rowToRecord<AgentStateRecord>(r as Record<string, unknown>));
      },
      async setPaused(agent, paused) {
        const { error } = await db.from("agent_state").upsert(stamp({ agent, paused, updated_at: new Date().toISOString() }), { onConflict: "owner_id,agent" });
        if (error) fail("agent_state", "upsert", error);
      },
    },
    briefs: {
      async save(brief) {
        const { data, error } = await db
          .from("briefs")
          .upsert(stamp(recordToRow(brief as unknown as Record<string, unknown>)), { onConflict: "owner_id,for_date,slot" })
          .select("*")
          .single();
        if (error) fail("briefs", "upsert", error);
        return rowToRecord<StoredBrief>(data);
      },
      async forDate(day) {
        const { data, error } = await scope(db.from("briefs").select("*").eq("for_date", day));
        if (error) fail("briefs", "list", error);
        return (data ?? []).map((r) => rowToRecord<StoredBrief>(r));
      },
      async get(briefId) {
        const { data, error } = await scope(db.from("briefs").select("*").eq("id", briefId)).maybeSingle();
        if (error) fail("briefs", "get", error);
        return data ? rowToRecord<StoredBrief>(data) : null;
      },
      async search({ limit, query }) {
        let q = scope(db.from("briefs").select("*"));
        // Escape LIKE wildcards so the query is matched literally.
        if (query) q = q.ilike("search", `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
        const { data, error } = await q.order("for_date", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
        if (error) fail("briefs", "list", error);
        return (data ?? []).map((r) => rowToRecord<StoredBrief>(r));
      },
    },
    settings: {
      async get() {
        const { data, error } = await scope(db.from("settings").select("data")).maybeSingle();
        if (error) fail("settings", "get", error);
        return { ...DEFAULT_SETTINGS, ...((data?.data as Partial<Settings> | undefined) ?? {}) };
      },
      async update(patch) {
        const current = await this.get();
        const next = { ...current, ...patch };
        const { error } = await db.from("settings").upsert(stamp({ data: next }), { onConflict: "owner_id" });
        if (error) fail("settings", "upsert", error);
        return next;
      },
    },
    audit: {
      async append(event) {
        const { error } = await db.from("audit_events").insert(stamp(recordToRow(event)));
        if (error) fail("audit_events", "insert", error);
      },
      async recent(limit) {
        const { data, error } = await scope(db.from("audit_events").select("*")).order("at", { ascending: false }).limit(limit);
        if (error) fail("audit_events", "list", error);
        return (data ?? []).map((r) => rowToRecord(r));
      },
      async byAction(action, iso) {
        const { data, error } = await scope(db.from("audit_events").select("*").eq("action", action).gte("at", iso)).order("at", { ascending: false }).limit(1000);
        if (error) fail("audit_events", "list", error);
        return (data ?? []).map((r) => rowToRecord(r));
      },
    },
    ledger: {
      async add(entry) {
        const { error } = await db.from("time_ledger").insert(stamp(recordToRow(entry)));
        if (error) fail("time_ledger", "insert", error);
      },
      async since(iso) {
        const { data, error } = await scope(db.from("time_ledger").select("*").gte("at", iso)).order("at");
        if (error) fail("time_ledger", "list", error);
        return (data ?? []).map((r) => rowToRecord(r));
      },
    },
    aiUsage: {
      async countToday(purpose) {
        const start = new Date().toISOString().slice(0, 10) + "T00:00:00Z";
        const today = scope(db.from("ai_usage").select("id", { count: "exact", head: true }).gte("at", start));
        const { count, error } = await (purpose === undefined ? today : today.eq("purpose", purpose));
        if (error) fail("ai_usage", "count", error);
        return count ?? 0;
      },
      async record(purpose) {
        const { error } = await db.from("ai_usage").insert(stamp({ purpose }));
        if (error) fail("ai_usage", "insert", error);
      },
      async since(iso) {
        const { data, error } = await scope(db.from("ai_usage").select("at").gte("at", iso)).order("at", { ascending: false }).limit(2000);
        if (error) fail("ai_usage", "list", error);
        return (data ?? []).map((r) => String((r as { at: string }).at));
      },
    },
    qa: {
      async save(r) {
        // One review per day: running it again that day replaces it. Written by the secret-key client only.
        const { data, error } = await db.from("qa_reports").upsert(stamp({ for_date: r.forDate, report: r.report }), { onConflict: "owner_id,for_date" }).select("*").single();
        if (error) fail("qa_reports", "upsert", error);
        return rowToRecord<StoredQaReport>(data);
      },
      async recent(limit) {
        const { data, error } = await scope(db.from("qa_reports").select("*")).order("for_date", { ascending: false }).limit(limit);
        if (error) fail("qa_reports", "list", error);
        return (data ?? []).map((r) => rowToRecord<StoredQaReport>(r));
      },
    },
    snippets: table(db, "snippets", scope, stamp),
    knowledge: {
      async manifest() {
        // The API returns at most 1,000 rows a request, so read in pages.
        const out: ManifestRow[] = [];
        for (let from = 0; from < 20_000; from += 1000) {
          const { data, error } = await scope(db.from("knowledge_chunks").select("id, source, source_id, chunk_index, hash")).order("id").range(from, from + 999);
          if (error) fail("knowledge_chunks", "list", error);
          for (const r of data ?? []) out.push(rowToRecord<ManifestRow>(r));
          if ((data ?? []).length < 1000) break;
        }
        return out;
      },
      async upsert(chunks) {
        const at = new Date().toISOString();
        for (let i = 0; i < chunks.length; i += 200) {
          const rows = chunks.slice(i, i + 200).map((c) =>
            // embedding: null on purpose. The text changed, so the old vector no longer describes it.
            stamp({ source: c.source, source_id: c.sourceId, chunk_index: c.chunkIndex, title: c.title, content: c.content, href: c.href, occurred_at: c.occurredAt, hash: c.hash, embedding: null, updated_at: at }),
          );
          const { error } = await db.from("knowledge_chunks").upsert(rows, { onConflict: "owner_id,source,source_id,chunk_index" });
          if (error) fail("knowledge_chunks", "upsert", error);
        }
      },
      async remove(ids) {
        for (let i = 0; i < ids.length; i += 200) {
          const { error } = await scope(db.from("knowledge_chunks").delete().in("id", ids.slice(i, i + 200)));
          if (error) fail("knowledge_chunks", "delete", error);
        }
      },
      async pending(limit) {
        const { data, error } = await scope(db.from("knowledge_chunks").select("id, title, content").is("embedding", null)).order("updated_at", { ascending: true }).limit(limit);
        if (error) fail("knowledge_chunks", "list", error);
        return (data ?? []) as { id: string; title: string; content: string }[];
      },
      async setEmbeddings(rows) {
        const results = await Promise.all(rows.map((r) => scope(db.from("knowledge_chunks").update({ embedding: `[${r.embedding.join(",")}]` }).eq("id", r.id))));
        const failed = results.find((r) => r.error);
        if (failed?.error) fail("knowledge_chunks", "update", failed.error);
      },
      async search({ terms, embedding, limit, sources, since, until }) {
        // search_knowledge filters on the signed-in user (auth.uid()). The secret-key store
        // (MCP, night shift, agents) has no user, so it calls the service-only twin with the
        // owner id instead; otherwise every search from it comes back empty.
        const args = { terms: toTsQuery(terms), query_embedding: embedding ? `[${embedding.join(",")}]` : null, match_count: limit, sources: sources?.length ? sources : null, since: since ?? null, until: until ?? null };
        const { data, error } = ownerId ? await db.rpc("search_knowledge_for_owner", { owner: ownerId, ...args }) : await db.rpc("search_knowledge", args);
        if (error) fail("knowledge_chunks", "search", error);
        type Row = { id: string; source: KnowledgeSource; source_id: string; chunk_index: number; title: string; content: string; href: string; occurred_at: string | null; lexical_rank: number | null; semantic_rank: number | null; similarity: number | null };
        const rows = (data ?? []) as Row[];
        const hit = (r: Row): Hit => ({ id: r.id, source: r.source, sourceId: r.source_id, chunkIndex: r.chunk_index, title: r.title, content: r.content, href: r.href, occurredAt: r.occurred_at, ...(typeof r.similarity === "number" ? { similarity: r.similarity } : {}) });
        const ranked = (key: "lexical_rank" | "semantic_rank") => rows.filter((r) => r[key] !== null).sort((a, b) => a[key]! - b[key]!).map(hit);
        return { lexical: ranked("lexical_rank"), semantic: ranked("semantic_rank") };
      },
      async stats() {
        const [all, embedded, last] = await Promise.all([
          scope(db.from("knowledge_chunks").select("id", { count: "exact", head: true })),
          scope(db.from("knowledge_chunks").select("id", { count: "exact", head: true })).not("embedding", "is", null),
          scope(db.from("knowledge_chunks").select("updated_at")).order("updated_at", { ascending: false }).limit(1),
        ]);
        if (all.error) fail("knowledge_chunks", "count", all.error);
        if (embedded.error) fail("knowledge_chunks", "count", embedded.error);
        if (last.error) fail("knowledge_chunks", "list", last.error);
        return { passages: all.count ?? 0, embedded: embedded.count ?? 0, indexedAt: ((last.data ?? [])[0] as { updated_at?: string } | undefined)?.updated_at ?? null };
      },
      async bySource(source, limit) {
        const { data, error } = await scope(db.from("knowledge_chunks").select("source_id, title, content").eq("source", source)).order("source_id").order("chunk_index").limit(limit);
        if (error) fail("knowledge_chunks", "list", error);
        return (data ?? []).map((r) => rowToRecord<{ sourceId: string; title: string; content: string }>(r));
      },
    },
    agentRunState: {
      async save(runId, agent, status, st) {
        const { error } = await db.from("agent_run_state").upsert(stamp({ run_id: runId, agent, status, state: st, updated_at: new Date().toISOString() }), { onConflict: "owner_id,run_id" });
        if (error) fail("agent_run_state", "upsert", error);
      },
      async get(runId) {
        const { data, error } = await scope(db.from("agent_run_state").select("run_id, agent, status, state").eq("run_id", runId)).maybeSingle();
        if (error) fail("agent_run_state", "get", error);
        return data ? { runId: String(data.run_id), agent: String(data.agent), status: String(data.status), state: data.state as AgentState } : null;
      },
      async recent(agent, limit) {
        const { data, error } = await scope(db.from("agent_run_state").select("run_id, status, state, updated_at").eq("agent", agent)).order("updated_at", { ascending: false }).limit(limit);
        if (error) fail("agent_run_state", "list", error);
        return (data ?? []).map((r) => ({ runId: String(r.run_id), status: String(r.status), state: r.state as AgentState, updatedAt: String(r.updated_at) }));
      },
    },
    agentMemory: {
      async add(row) {
        const { data, error } = await db.from("agent_memory").insert(stamp({ agent: row.agent, lesson: row.lesson, evidence: row.evidence, expires_on: row.expiresOn })).select("*").single();
        if (error) fail("agent_memory", "insert", error);
        return rowToRecord<Lesson>(data);
      },
      async list(agent) {
        const { data, error } = await scope(db.from("agent_memory").select("*").eq("agent", agent)).order("expires_on", { ascending: false }).limit(50);
        if (error) fail("agent_memory", "list", error);
        return (data ?? []).map((r) => rowToRecord<Lesson>(r));
      },
      async confirm(id, expiresOn) {
        const { data, error } = await scope(db.from("agent_memory").select("confirmed").eq("id", id)).maybeSingle();
        if (error) fail("agent_memory", "get", error);
        if (!data) return;
        const { error: e2 } = await scope(db.from("agent_memory").update({ confirmed: Number(data.confirmed) + 1, expires_on: expiresOn }).eq("id", id));
        if (e2) fail("agent_memory", "update", e2);
      },
    },
    applyBriefs: {
      async save(approvalId, data, researchedAt) {
        const { error } = await db.from("apply_briefs").upsert(stamp({ approval_id: approvalId, data, researched_at: researchedAt }), { onConflict: "owner_id,approval_id" });
        if (error) fail("apply_briefs", "upsert", error);
      },
      async forKits(ids) {
        if (ids.length === 0) return new Map();
        const { data, error } = await scope(db.from("apply_briefs").select("approval_id, data, researched_at")).in("approval_id", [...ids].slice(0, 200));
        if (error) fail("apply_briefs", "list", error);
        return new Map((data ?? []).map((r) => [String(r.approval_id), { data: r.data as unknown, researchedAt: String(r.researched_at) }]));
      },
    },
    careerMaps: {
      async save(week, data) {
        const { error } = await db.from("career_maps").upsert(stamp({ week, data }), { onConflict: "owner_id,week" });
        if (error) fail("career_maps", "upsert", error);
      },
      async latest(limit) {
        const { data, error } = await scope(db.from("career_maps").select("week, data")).order("week", { ascending: false }).limit(limit);
        if (error) fail("career_maps", "list", error);
        return (data ?? []).map((r) => ({ week: String(r.week), data: r.data as unknown }));
      },
    },
    benchmarks: {
      async upsert(points) {
        if (points.length === 0) return 0;
        const ids = [...new Set(points.map((p) => p.seriesId))];
        const { data, error } = await scope(db.from("market_benchmarks").select("series_id, period").in("series_id", ids));
        if (error) fail("market_benchmarks", "list", error);
        const have = new Set((data ?? []).map((r) => `${r.series_id}|${r.period}`));
        const rows = points.map((p) => stamp({ series_id: p.seriesId, period: p.period, value: p.value, preliminary: p.preliminary, fetched_at: new Date().toISOString() }));
        const { error: upErr } = await db.from("market_benchmarks").upsert(rows, { onConflict: "owner_id,series_id,period" });
        if (upErr) fail("market_benchmarks", "upsert", upErr);
        return points.filter((p) => !have.has(`${p.seriesId}|${p.period}`)).length;
      },
      async since(day) {
        const { data, error } = await scope(db.from("market_benchmarks").select("series_id, period, value, preliminary").gte("period", day)).order("period").limit(5000);
        if (error) fail("market_benchmarks", "list", error);
        return (data ?? []).map((r) => ({ seriesId: r.series_id as string, period: r.period as string, value: Number(r.value), preliminary: Boolean(r.preliminary) }));
      },
    },
    techMarket: {
      async record(rows) {
        let added = 0;
        // 50 at a time: the fingerprints go in the query string to read what is already stored.
        for (let i = 0; i < rows.length; i += 50) {
          const batch = rows.slice(i, i + 50);
          const { data, error } = await scope(db.from("tech_postings").select("fingerprint, first_seen, sources, pay_min, pay_max, skills, years_min, certs").in("fingerprint", batch.map((r) => r.fingerprint)));
          if (error) fail("tech_postings", "list", error);
          const stored = new Map((data ?? []).map((r) => [r.fingerprint as string, rowToRecord<Pick<TechPosting, "fingerprint" | "firstSeen" | "sources" | "payMin" | "payMax" | "skills" | "yearsMin" | "certs">>(r)]));
          added += batch.filter((r) => !stored.has(r.fingerprint)).length;
          const merged = batch.map((r) => {
            const old = stored.get(r.fingerprint);
            return stamp(recordToRow((old ? mergeTech({ ...r, ...old }, r) : r) as unknown as Record<string, unknown>));
          });
          const { error: upErr } = await db.from("tech_postings").upsert(merged, { onConflict: "owner_id,fingerprint" });
          if (upErr) fail("tech_postings", "upsert", upErr);
        }
        return added;
      },
      async since(day) {
        const out: TechPosting[] = [];
        for (let from = 0; from < 50_000; from += 1000) {
          const { data, error } = await scope(db.from("tech_postings").select("*").gte("last_seen", day)).order("id").range(from, from + 999);
          if (error) fail("tech_postings", "list", error);
          for (const r of data ?? []) out.push(rowToRecord<TechPosting>(r));
          if ((data ?? []).length < 1000) break;
        }
        return out;
      },
      async prune(before) {
        const { data, error } = await scope(db.from("tech_postings").delete().lt("last_seen", before)).select("id");
        if (error) fail("tech_postings", "delete", error);
        return (data ?? []).length;
      },
      async size() {
        const { count, error } = await scope(db.from("tech_postings").select("id", { count: "exact", head: true }));
        if (error) fail("tech_postings", "count", error);
        // Days with a summary: the newest and oldest day give the span; rows are few per day.
        const first = await scope(db.from("market_daily").select("day")).order("day", { ascending: true }).limit(1);
        const last = await scope(db.from("market_daily").select("day")).order("day", { ascending: false }).limit(1);
        if (first.error) fail("market_daily", "list", first.error);
        if (last.error) fail("market_daily", "list", last.error);
        const a = first.data?.[0]?.day as string | undefined;
        const b = last.data?.[0]?.day as string | undefined;
        const days = a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1 : 0;
        return { postings: count ?? 0, days };
      },
      async saveDaily(day, rows) {
        const { error } = await scope(db.from("market_daily").delete().eq("day", day));
        if (error) fail("market_daily", "delete", error);
        if (rows.length === 0) return;
        const { error: insErr } = await db.from("market_daily").insert(rows.map((r) => stamp(recordToRow(r as unknown as Record<string, unknown>))));
        if (insErr) fail("market_daily", "insert", insErr);
      },
      async daily(since) {
        const out: DailyRow[] = [];
        for (let from = 0; from < 100_000; from += 1000) {
          const { data, error } = await scope(db.from("market_daily").select("day, family, seniority, region, active, added, gone, remote, with_pay, pay_median").gte("day", since)).order("id").range(from, from + 999);
          if (error) fail("market_daily", "list", error);
          for (const r of data ?? []) out.push(rowToRecord<DailyRow>(r));
          if ((data ?? []).length < 1000) break;
        }
        return out;
      },
      async saveQuality(q) {
        const { error } = await db.from("market_quality").upsert(stamp({ day: q.day, report: q }), { onConflict: "owner_id,day" });
        if (error) fail("market_quality", "upsert", error);
      },
      async quality(since) {
        const { data, error } = await scope(db.from("market_quality").select("report").gte("day", since)).order("day");
        if (error) fail("market_quality", "list", error);
        return (data ?? []).map((r) => r.report as RunQuality);
      },
    },
    market: {
      async record(rows) {
        if (rows.length === 0) return 0;
        const count = async () => {
          const { count: n, error } = await scope(db.from("market_postings").select("id", { count: "exact", head: true }));
          if (error) fail("market_postings", "count", error);
          return n ?? 0;
        };
        const before = await count();
        for (let i = 0; i < rows.length; i += 200) {
          // first_seen is left out on purpose: the database sets it once, when the row is new.
          const batch = rows.slice(i, i + 200).map(({ firstSeen: _first, ...r }) => stamp({ ...recordToRow(r as unknown as Record<string, unknown>), type: FULL_TIME }));
          const { error } = await db.from("market_postings").upsert(batch, { onConflict: "owner_id,key" });
          if (error) fail("market_postings", "upsert", error);
        }
        return Math.max(0, (await count()) - before);
      },
      async since(day) {
        const out: MarketPosting[] = [];
        for (let from = 0; from < 10_000; from += 1000) {
          const { data, error } = await scope(db.from("market_postings").select("*").eq("type", FULL_TIME).gte("last_seen", day)).order("id").range(from, from + 999);
          if (error) fail("market_postings", "list", error);
          for (const r of data ?? []) out.push(rowToRecord<MarketPosting>(r));
          if ((data ?? []).length < 1000) break;
        }
        return out;
      },
      async saveReport(r) {
        const { data, error } = await db.from("market_reports").upsert(stamp({ for_date: r.forDate, report: r.report, summary: r.summary }), { onConflict: "owner_id,for_date" }).select("*").single();
        if (error) fail("market_reports", "upsert", error);
        return rowToRecord<StoredMarketReport>(data);
      },
      async latestReport() {
        const { data, error } = await scope(db.from("market_reports").select("*")).order("for_date", { ascending: false }).limit(1);
        if (error) fail("market_reports", "list", error);
        return data?.[0] ? rowToRecord<StoredMarketReport>(data[0]) : null;
      },
    },
    mentor: {
      async add(rows) {
        if (rows.length === 0) return [];
        const { data, error } = await db.from("mentor_insights").insert(rows.map((r) => stamp(recordToRow(r as unknown as Record<string, unknown>)))).select("*");
        if (error) fail("mentor_insights", "insert", error);
        return (data ?? []).map((r) => rowToRecord<MentorInsight>(r));
      },
      async since(day) {
        const { data, error } = await scope(db.from("mentor_insights").select("*").gte("for_date", day)).order("created_at", { ascending: false }).limit(200);
        if (error) fail("mentor_insights", "list", error);
        return (data ?? []).map((r) => rowToRecord<MentorInsight>(r));
      },
      async setStatus(id, status, note) {
        const { error } = await scope(db.from("mentor_insights").update({ status, ...(note === undefined ? {} : { owner_note: note }) }).eq("id", id));
        if (error) fail("mentor_insights", "update", error);
      },
    },
    portfolio: {
      async replace(rows) {
        const keep = rows.map((r) => r.repo);
        if (rows.length > 0) {
          const { error } = await db.from("portfolio_repos").upsert(rows.map((r) => stamp(recordToRow(r as unknown as Record<string, unknown>))), { onConflict: "owner_id,repo" });
          if (error) fail("portfolio_repos", "upsert", error);
        }
        const { data, error } = await scope(db.from("portfolio_repos").select("id, repo"));
        if (error) fail("portfolio_repos", "list", error);
        const gone = (data ?? []).filter((r) => !keep.includes(r.repo as string)).map((r) => r.id as string);
        if (gone.length > 0) {
          const { error: e } = await scope(db.from("portfolio_repos").delete().in("id", gone));
          if (e) fail("portfolio_repos", "delete", e);
        }
      },
      async list() {
        const { data, error } = await scope(db.from("portfolio_repos").select("*")).order("pushed_at", { ascending: false, nullsFirst: false }).limit(50);
        if (error) fail("portfolio_repos", "list", error);
        return (data ?? []).map((r) => rowToRecord<PortfolioRepo>(r));
      },
    },
    roleProposals: {
      async add(row) {
        const { data, error } = await db.from("role_proposals").insert(stamp(recordToRow(row as unknown as Record<string, unknown>))).select("*").single();
        if (error) fail("role_proposals", "insert", error);
        return rowToRecord<RoleProposal>(data);
      },
      async recent(limit) {
        const { data, error } = await scope(db.from("role_proposals").select("*")).order("created_at", { ascending: false }).limit(limit);
        if (error) fail("role_proposals", "list", error);
        return (data ?? []).map((r) => rowToRecord<RoleProposal>(r));
      },
      async get(id) {
        const { data, error } = await scope(db.from("role_proposals").select("*").eq("id", id)).maybeSingle();
        if (error) fail("role_proposals", "get", error);
        return data ? rowToRecord<RoleProposal>(data) : null;
      },
      async setStatus(id, status) {
        const { error } = await scope(db.from("role_proposals").update({ status, decided_at: new Date().toISOString() }).eq("id", id));
        if (error) fail("role_proposals", "update", error);
      },
    },
    roleProfiles: {
      async save(row) {
        // One profile per role per week: a rewrite replaces that week's text.
        const { data, error } = await db.from("role_profiles").upsert(stamp(recordToRow(row as unknown as Record<string, unknown>)), { onConflict: "owner_id,role,for_week" }).select("*").single();
        if (error) fail("role_profiles", "upsert", error);
        return rowToRecord<RoleProfile>(data);
      },
      async recent(limit) {
        const { data, error } = await scope(db.from("role_profiles").select("*")).order("for_week", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
        if (error) fail("role_profiles", "list", error);
        return (data ?? []).map((r) => rowToRecord<RoleProfile>(r));
      },
    },
    roleSkills: {
      async save(rows) {
        if (rows.length === 0) return;
        // One row per role per day: a second run that day replaces the first.
        const { error } = await db.from("role_skill_stats").upsert(rows.map((r) => stamp(recordToRow(r as unknown as Record<string, unknown>))), { onConflict: "owner_id,role,for_date" });
        if (error) fail("role_skill_stats", "upsert", error);
      },
      async since(day) {
        // 5 roles a day for up to two years: well under the page limit, but bounded anyway.
        const { data, error } = await scope(db.from("role_skill_stats").select("*")).gte("for_date", day).order("for_date", { ascending: true }).limit(4000);
        if (error) fail("role_skill_stats", "list", error);
        return (data ?? []).map((r) => rowToRecord<RoleSkillStat>(r));
      },
    },
    roleDescriptions: {
      async save(row) {
        // One description per role per month: a rewrite replaces that month's text.
        const { data, error } = await db.from("role_descriptions").upsert(stamp(recordToRow(row as unknown as Record<string, unknown>)), { onConflict: "owner_id,role,for_month" }).select("*").single();
        if (error) fail("role_descriptions", "upsert", error);
        return rowToRecord<RoleDescription>(data);
      },
      async recent(limit) {
        const { data, error } = await scope(db.from("role_descriptions").select("*")).order("for_month", { ascending: false }).order("created_at", { ascending: false }).limit(limit);
        if (error) fail("role_descriptions", "list", error);
        return (data ?? []).map((r) => rowToRecord<RoleDescription>(r));
      },
    },
  };
}
