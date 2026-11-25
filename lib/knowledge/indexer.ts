import "server-only";
import { embedTexts, embeddingsConfigured, EMBED_BATCH } from "@/lib/ai/embeddings";
import type { Store } from "@/lib/data/store";
import { addDays, localDate } from "@/lib/domain/dates";
import { readResumeTexts, notionConfigured } from "@/lib/integrations/notion";
import { embedText, planIndex, toChunks, toDocuments, type KnowledgeSnapshot, type KnowledgeSource } from "@/lib/domain/knowledge";
import { inYourLists } from "@/lib/domain/people";

// Ask Atlas: keeping the index current.
//
// Reads what Atlas stores, turns it into passages (lib/domain/knowledge.ts), and makes
// the index match: new and changed passages are written, passages whose record is gone
// are deleted, unchanged ones are left alone. Then passages that have no embedding yet
// are embedded, a few at a time, up to a budget. Runs at the end of every 2-hour sync
// and from the Index button on the Ask page. It only ever writes the knowledge table.

export interface IndexOutcome {
  /** Records read and passages they became. */
  records: number;
  passages: number;
  added: number;
  removed: number;
  /** Passages embedded this run, and how many still wait. */
  embedded: number;
  waiting: number;
  /** False when the embedding function is not set up or did not answer: search is keyword-only until it does. */
  embeddings: boolean;
}

export interface IndexOptions {
  /** At most this many passages are embedded in one run. */
  embedBudget?: number;
  /** Stop embedding after this instant (ms since epoch), so a slow run cannot hold a request open. */
  deadline?: number;
}

/** How far back job matches are indexed. */
const JOB_DAYS = 120;

async function snapshot(store: Store, today: string, notionResumesId: string | undefined): Promise<{ data: KnowledgeSnapshot; loaded: Set<KnowledgeSource> }> {
  const loaded = new Set<KnowledgeSource>();
  const data: KnowledgeSnapshot = {};
  // Each table loads on its own: a failed read leaves that source's passages untouched.
  const read = async <K extends keyof KnowledgeSnapshot>(source: KnowledgeSource, key: K, fn: () => Promise<NonNullable<KnowledgeSnapshot[K]>>) => {
    try {
      data[key] = await fn();
      loaded.add(source);
    } catch {
      console.warn("[knowledge] could not read", source);
    }
  };
  await Promise.all([
    read("brief", "briefs", () => store.briefs.search({ limit: 60 })),
    read("email", "inbox", () => store.inbox.list()),
    // Phonebook imports you have not placed stay out of search and embeddings.
    read("person", "contacts", async () => (await store.contacts.list()).filter(inYourLists)),
    read("task", "tasks", () => store.tasks.list()),
    read("goal", "goals", () => store.goals.list()),
    // Two tables make the project passages: your project list and your GitHub projects.
    // Only when both read is the source complete; otherwise its passages are left as they are.
    (async () => {
      try {
        const [projects, portfolio] = await Promise.all([store.projects.list(), store.portfolio.list()]);
        data.projects = projects;
        data.portfolio = portfolio;
        loaded.add("project");
      } catch {
        console.warn("[knowledge] could not read", "project");
      }
    })(),
    read("application", "applications", () => store.applications.list()),
    read("job", "jobMatches", () => store.jobMatches.since(addDays(today, -JOB_DAYS))),
    read("renewal", "renewals", () => store.renewals.list()),
    // Resume text lives in Notion. If Notion is not connected or does not answer, the
    // resume passages already indexed are left as they are.
    ...(notionConfigured() ? [read("resume", "resumes", () => readResumeTexts(notionResumesId))] : []),
  ]);
  return { data, loaded };
}

export async function indexKnowledge(store: Store, timeZone: string, now: Date, opts: IndexOptions = {}): Promise<IndexOutcome> {
  const { embedBudget = 48, deadline = now.getTime() + 20_000 } = opts;
  const notionResumesId = (await store.settings.get().catch(() => null))?.notionResumesId;
  const { data, loaded } = await snapshot(store, localDate(now, timeZone), notionResumesId);
  const docs = toDocuments(data, timeZone);
  const chunks = toChunks(docs);
  const plan = planIndex(await store.knowledge.manifest(), chunks, loaded);
  if (plan.remove.length > 0) await store.knowledge.remove(plan.remove);
  if (plan.upsert.length > 0) await store.knowledge.upsert(plan.upsert);

  let embedded = 0;
  let embeddings = embeddingsConfigured();
  let size = EMBED_BATCH;
  while (embeddings && embedded < embedBudget && Date.now() < deadline) {
    const batch = await store.knowledge.pending(Math.min(size, embedBudget - embedded));
    if (batch.length === 0) break;
    const vectors = await embedTexts(batch.map(embedText), Math.max(2_000, Math.min(20_000, deadline - Date.now())));
    if (!vectors) {
      // A batch can be too much for one call; try smaller before giving up for this run.
      if (size > 1) {
        size = Math.max(1, Math.floor(size / 4));
        continue;
      }
      embeddings = false;
      break;
    }
    await store.knowledge.setEmbeddings(batch.map((b, i) => ({ id: b.id, embedding: vectors[i]! })));
    embedded += batch.length;
  }
  const stats = await store.knowledge.stats();
  return { records: docs.length, passages: chunks.length, added: plan.upsert.length, removed: plan.remove.length, embedded, waiting: stats.passages - stats.embedded, embeddings };
}

/** One line for the activity log: counts only, never text. */
export function indexNote(o: IndexOutcome): string {
  const changed = o.added || o.removed ? `${o.added} added or changed, ${o.removed} removed` : "nothing changed";
  const vectors = !o.embeddings ? "embeddings unavailable, keyword search only" : o.waiting > 0 ? `${o.embedded} embedded, ${o.waiting} waiting` : o.embedded > 0 ? `${o.embedded} embedded` : "all embedded";
  return `${o.passages} passages from ${o.records} records: ${changed}; ${vectors}`;
}
