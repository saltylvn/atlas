// Ask Atlas, part 1: what gets indexed.
//
// Everything Atlas already stores about your day (briefs, the triaged inbox, people,
// tasks, goals, projects, applications, job matches, renewals) is turned into short
// passages of plain text. Each passage is stored with a search vector and an embedding
// (supabase/migrations/*_knowledge.sql), so a question can find it by its words or by
// its meaning.
//
// Pure: records in, passages out. No I/O, so the same code runs in tests and evals.
//
// Privacy: a passage holds only what a page in Atlas already shows. A contact's email
// and phone are never read, a sender is kept as a name and a domain, and any address or
// link found inside text is stripped. A question never needs them, and what is not
// indexed can never reach a model.

import { localDate } from "./dates";
import { shownHow } from "./moreMatches";
import { projectName, type PortfolioRepo } from "./portfolio";
import type { Application, Contact, Goal, InboxItem, JobMatch, Project, Renewal, StoredBrief, Task } from "./types";

export const KNOWLEDGE_SOURCES = ["brief", "email", "person", "task", "goal", "project", "application", "job", "renewal", "resume"] as const;
export type KnowledgeSource = (typeof KNOWLEDGE_SOURCES)[number];

export const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  brief: "Brief",
  email: "Email",
  person: "Person",
  task: "Task",
  goal: "Goal",
  project: "Project",
  application: "Application",
  job: "Job match",
  renewal: "Renewal",
  resume: "Resume",
};

/** One record, as text. */
export interface KnowledgeDoc {
  source: KnowledgeSource;
  sourceId: string;
  title: string;
  text: string;
  /** The page in Atlas that shows it. Always an in-app path, built here, never from data. */
  href: string;
  /** When it happened (ISO), for display and tie-breaks. */
  occurredAt: string | null;
}

/** One passage of a record: what is embedded, searched and cited. */
export interface KnowledgeChunk {
  source: KnowledgeSource;
  sourceId: string;
  chunkIndex: number;
  title: string;
  content: string;
  href: string;
  occurredAt: string | null;
  /** Changes when the passage changes, so only changed passages are embedded again. */
  hash: string;
}

/** What the index already holds for a passage (no text). */
export interface ManifestRow {
  id: string;
  source: KnowledgeSource;
  sourceId: string;
  chunkIndex: number;
  hash: string;
}

export interface KnowledgeSnapshot {
  briefs?: StoredBrief[];
  inbox?: InboxItem[];
  contacts?: Contact[];
  tasks?: Task[];
  goals?: Goal[];
  projects?: Project[];
  /** Your GitHub projects as the Scout last read them. Only public ones are indexed. */
  portfolio?: PortfolioRepo[];
  applications?: Application[];
  jobMatches?: JobMatch[];
  renewals?: Renewal[];
  /** Resume text by role, read from the Resumes pages in Notion. */
  resumes?: { role: string; text: string }[];
}

/** Upper bounds, so one runaway table cannot crowd out the rest or run up embedding time. */
export const SOURCE_LIMIT: Record<KnowledgeSource, number> = { brief: 60, email: 600, person: 300, task: 400, goal: 100, project: 100, application: 300, job: 300, renewal: 100, resume: 13 };

const MAX_TITLE = 200;
/** About 200 tokens: small enough to be specific, well under the model's 512-token window. */
export const CHUNK_CHARS = 900;
export const MAX_CHUNKS_PER_DOC = 12;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** Addresses and links are taken out of any text before it is indexed, wherever they came from. */
export const scrub = (s: string) => s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "").replace(/\b(?:https?:\/\/|www\.)\S+/gi, "");
/** Phone numbers, in the shapes a resume header uses. Kept narrow so dates and amounts survive. */
export const scrubPhones = (s: string) => s.replace(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, "");
/** One item per line becomes one sentence per item, so passages are cut between items. */
const sentences = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)).join(" ");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const line = (...parts: (string | false | null | undefined)[]) => parts.map((p) => clean(p || "")).filter(Boolean).join(" ");
/** The part of an address after the @: enough to say who an email is from, without the address. */
export const domainOf = (email: string) => clean(email).toLowerCase().split("@")[1] ?? "";

const PATH: Record<Exclude<KnowledgeSource, "brief">, string> = {
  email: "/inbox",
  person: "/people",
  task: "/plan",
  goal: "/plan",
  project: "/projects",
  application: "/applications",
  job: "/career",
  renewal: "/renewals",
  resume: "/roles",
};

const TASK_STATE: Record<Task["status"], string> = { todo: "To do", doing: "In progress", stuck: "Stuck", done: "Done" };

const safeId = (id: string) => /^[A-Za-z0-9-]{1,64}$/.test(id);

/** Turns the records Atlas holds into documents. `timeZone` decides which day an instant falls on. */
export function toDocuments(s: KnowledgeSnapshot, timeZone: string): KnowledgeDoc[] {
  const day = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : localDate(d, timeZone);
  };
  const newest = <T,>(rows: T[] | undefined, at: (r: T) => string, limit: number) => [...(rows ?? [])].sort((a, b) => at(b).localeCompare(at(a))).slice(0, limit);
  const docs: KnowledgeDoc[] = [];
  const add = (source: KnowledgeSource, sourceId: string, title: string, text: string, occurredAt: string | null, href: string = PATH[source as Exclude<KnowledgeSource, "brief">]) => {
    const t = clean(scrub(title));
    const body = clean(scrub(text));
    if (!sourceId || !t || !body) return;
    docs.push({ source, sourceId: sourceId.slice(0, 200), title: clip(t, MAX_TITLE), text: body, href, occurredAt });
  };

  for (const b of newest(s.briefs, (r) => r.createdAt, SOURCE_LIMIT.brief)) {
    add("brief", b.id, `${b.slot[0]!.toUpperCase()}${b.slot.slice(1)} brief, ${b.forDate}: ${b.headline}`, sentences(b.search || b.headline), b.createdAt, safeId(b.id) ? `/briefs/${b.id}` : "/");
  }
  for (const m of newest(s.inbox, (r) => r.receivedAt, SOURCE_LIMIT.email)) {
    const from = line(m.fromName || domainOf(m.fromEmail), domainOf(m.fromEmail) && `(${domainOf(m.fromEmail)})`);
    add("email", m.messageId || m.id, `Email from ${from}: ${m.subject || "(no subject)"}`, line(`Received ${day(m.receivedAt)}.`, m.snippet, `Sorted as ${m.category === "reply" ? "needs a reply" : m.category === "fyi" ? "for your information" : "noise"}${m.reason ? `: ${m.reason}` : ""}.`, m.done ? "Marked done." : ""), m.receivedAt);
  }
  for (const c of newest(s.contacts, (r) => r.createdAt, SOURCE_LIMIT.person)) {
    add("person", c.id, `${c.name} (${c.circle})`, line(`${c.name} is in your ${c.circle} circle.`, c.lastContactAt ? `Last contact ${day(c.lastContactAt)}.` : "No contact logged yet.", c.cadenceDays > 0 && `You want to be in touch every ${c.cadenceDays} days.`, c.birthday && `Birthday ${c.birthday}.`, c.notes && `Notes: ${c.notes}`), c.lastContactAt ?? c.createdAt);
  }
  for (const t of newest(s.tasks, (r) => r.completedAt ?? r.createdAt, SOURCE_LIMIT.task)) {
    add("task", t.id, `Task: ${t.title}`, line(`${TASK_STATE[t.status]}, ${t.priority} priority, ${t.area}.`, t.day ? `Planned for ${t.day}${t.startTime ? ` at ${t.startTime}` : ""}.` : "In the backlog.", t.completedAt && `Completed ${day(t.completedAt)}.`, t.notes), t.completedAt ?? t.createdAt);
  }
  for (const g of newest(s.goals, (r) => r.weekOf, SOURCE_LIMIT.goal)) {
    add("goal", g.id, `Goal for the week of ${g.weekOf}: ${g.title}`, line(`${g.area} goal.`, g.done ? "Done." : "Not done yet."), g.createdAt);
  }
  for (const p of newest(s.projects, (r) => r.createdAt, SOURCE_LIMIT.project)) {
    add("project", p.id, `Project: ${p.title}`, line(`${p.kind}, ${p.status}.`, p.why && `Why: ${p.why}`, p.nextStep && `Next step: ${p.nextStep}`, p.reviewOn && `Review on ${p.reviewOn}.`), p.createdAt);
  }
  // Public GitHub projects, as proof of what you have built. A private repository may hold
  // client work, so it never reaches the index (or Claude through it).
  for (const r of newest(s.portfolio?.filter((x) => !x.isPrivate), (x) => x.pushedAt ?? x.createdAt, SOURCE_LIMIT.project)) {
    const list = (label: string, xs: readonly string[]) => xs.length > 0 && `${label}: ${xs.join(", ")}.`;
    const facts = line(r.description && (/[.!?]$/.test(r.description) ? r.description : `${r.description}.`), list("Built with", r.stack), list("Languages", r.languages), list("Skills shown", r.skills), list("Topics", r.topics), r.pushedAt && `Last worked on ${day(r.pushedAt)}.`);
    add("project", `repo:${r.repo}`, `Project: ${projectName(r)} on GitHub`, `${facts} ${sentences(r.readme ?? "")}`, r.pushedAt ?? r.createdAt, "/growth");
  }
  for (const a of newest(s.applications, (r) => r.statusAt, SOURCE_LIMIT.application)) {
    add("application", a.id, `Application: ${a.role} at ${a.company}`, line(`Status: ${a.status} since ${day(a.statusAt)}.`, a.appliedOn ? `Applied ${a.appliedOn}.` : "", a.targetRole && `Target role: ${a.targetRole}.`, a.payText && `Pay: ${a.payText}.`, a.source && `Found on ${a.source}.`, a.notes && `Notes: ${a.notes}`), a.statusAt);
  }
  for (const j of newest(s.jobMatches, (r) => r.shownOn, SOURCE_LIMIT.job)) {
    add("job", j.key || j.id, `Job match: ${j.title} at ${j.company}`, line(`Shown ${j.shownOn} ${shownHow(j.shownSlot)}.`, j.location && `Location: ${j.location}.`, j.role && `Matches your target role ${j.role}.`, j.payText && `Pay: ${j.payText}.`, j.source && `Source: ${j.source}.`, j.skills?.length ? `Skills: ${j.skills.join(", ")}.` : "", `Status: ${j.status}.`, j.rating > 0 ? "You liked it." : j.rating < 0 ? "You passed on it." : ""), j.postedAt ?? j.createdAt);
  }
  for (const r of newest(s.renewals, (x) => x.dueOn, SOURCE_LIMIT.renewal)) {
    add("renewal", r.id, `${r.kind === "bill" ? "Bill" : r.kind === "document" ? "Document" : "Renewal"}: ${r.title}`, line(`Due ${r.dueOn}.`, r.cadence === "once" ? "One time." : `Repeats ${r.cadence}.`, "Tracked under bills and renewals.", r.notes && `Notes: ${r.notes}`), null);
  }
  for (const r of (s.resumes ?? []).slice(0, SOURCE_LIMIT.resume)) {
    const id = r.role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    // A resume's header carries a phone number and an address line: neither is indexed.
    add("resume", id, `Resume: ${r.role}`, sentences(scrubPhones(r.text)), null);
  }
  return docs;
}

/**
 * Splits text into passages of at most `maxChars`, on sentence ends where it can. The
 * last sentence of a passage starts the next one, so a fact that straddles a cut is
 * whole in at least one passage.
 */
export function chunkText(text: string, maxChars: number = CHUNK_CHARS): string[] {
  const body = clean(text);
  if (!body) return [];
  if (body.length <= maxChars) return [body];
  const sentences = body.split(/(?<=[.!?;])\s+/).flatMap((s) => {
    if (s.length <= maxChars) return [s];
    // A sentence longer than a passage (a list, a pasted block): cut on word ends.
    const parts: string[] = [];
    let rest = s;
    while (rest.length > maxChars) {
      const cut = rest.lastIndexOf(" ", maxChars);
      const at = cut > maxChars * 0.5 ? cut : maxChars;
      parts.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  });
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const s of sentences) {
    if (current.length > 0 && size + s.length + 1 > maxChars) {
      chunks.push(current.join(" "));
      const carry = current[current.length - 1]!;
      // Carry the last sentence over only when it leaves room for new text.
      current = carry.length + s.length + 1 <= maxChars && carry.length <= maxChars * 0.3 ? [carry] : [];
      size = current.reduce((n, x) => n + x.length + 1, 0);
    }
    current.push(s);
    size += s.length + 1;
  }
  if (current.length > 0) chunks.push(current.join(" "));
  return chunks;
}

/** cyrb53: a fast, well-spread string hash. For change detection only, never for security. */
function cyrb53(str: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export function hashPassage(title: string, content: string, href: string, occurredAt: string | null): string {
  const s = [title, content, href, occurredAt ?? ""].join("\u0001");
  return cyrb53(s, 1) + cyrb53(s, 2);
}

export function toChunks(docs: readonly KnowledgeDoc[]): KnowledgeChunk[] {
  const out: KnowledgeChunk[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    const key = `${d.source}:${d.sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chunkText(d.text)
      .slice(0, MAX_CHUNKS_PER_DOC)
      .forEach((content, chunkIndex) => {
        out.push({ source: d.source, sourceId: d.sourceId, chunkIndex, title: d.title, content, href: d.href, occurredAt: d.occurredAt, hash: hashPassage(d.title, content, d.href, d.occurredAt) });
      });
  }
  return out;
}

export const chunkKey = (c: Pick<KnowledgeChunk, "source" | "sourceId" | "chunkIndex">) => `${c.source}:${c.sourceId}:${c.chunkIndex}`;

/** The text that is embedded: the title rides along, so every passage carries its context. */
export const embedText = (c: Pick<KnowledgeChunk, "title" | "content">) => `${c.title}\n${c.content}`;

export interface IndexPlan {
  /** New or changed passages: stored, and embedded again. */
  upsert: KnowledgeChunk[];
  /** Ids of stored passages whose record is gone or got shorter. */
  remove: string[];
  unchanged: number;
}

/**
 * Compares what the index holds with what it should hold. Only sources in `loaded` are
 * ever removed from: if reading a table failed this run, its passages stay as they are.
 */
export function planIndex(existing: readonly ManifestRow[], next: readonly KnowledgeChunk[], loaded: ReadonlySet<KnowledgeSource>): IndexPlan {
  const have = new Map(existing.map((r) => [chunkKey(r), r]));
  const want = new Set<string>();
  const upsert: KnowledgeChunk[] = [];
  let unchanged = 0;
  for (const c of next) {
    if (!loaded.has(c.source)) continue;
    const key = chunkKey(c);
    want.add(key);
    if (have.get(key)?.hash === c.hash) unchanged++;
    else upsert.push(c);
  }
  const remove = existing.filter((r) => loaded.has(r.source) && !want.has(chunkKey(r))).map((r) => r.id);
  return { upsert, remove, unchanged };
}
