import "server-only";
import { randomUUID } from "node:crypto";
import { audit } from "@/lib/audit";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { countReads, mayRead, notReadLine, postingFacts, postingHandled, postingLines, READ_BUDGET, readsLeft, withLines } from "@/lib/domain/postingFacts";
import type { AgentRunEvent, Approval } from "@/lib/domain/types";
import { firecrawlConfigured, READ_HELP, readPage, RETRY_LATER, type PageReader } from "@/lib/integrations/firecrawl";
import { logRun, NO_MODEL } from "./log";
import { NO_TRACE, tracer, type Tracer } from "./trace";

// The Applications Agent, reading the postings you approved. A 👍 puts a job's apply kit
// in an apply queue; this reads that job's full posting through Firecrawl and adds
// what it asks for to the kit: experience, skills, pay, where the work is done, and
// anything to watch for. You see it before you decide to apply.
//
// It reads only postings you approved, never LinkedIn, Indeed, Glassdoor or the other
// sites whose terms forbid it, and at most a few pages a run inside a monthly budget that
// stops well short of Firecrawl's free limit. It changes nothing outside Atlas. The
// posting's text is untrusted: rules take a few facts from it and the text is dropped.
// Rules only, no model call.

export const READ_TASK = "Read the postings you approved";

export interface ReadResult {
  /** Kits that got their posting's facts this run. */
  read: number;
  /** Kits marked as not readable, so they are not tried again. */
  unreadable: number;
  /** Kits still waiting to be read after this run. */
  waiting: number;
  /** Why nothing, or not everything, was read: not set up, or the budget. */
  skipped?: string;
}

/** The kits whose posting has not been read: application kits still waiting on you, oldest first, on sites Atlas may read. */
export function kitsToRead(approvals: readonly Approval[]): Approval[] {
  return approvals
    .filter((a) => a.kind === "application" && a.status === "pending" && a.url !== "" && !postingHandled(a.detail) && mayRead(a.url).ok)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Reads up to `limit` postings and writes their facts into the kits. `only` reads one kit
 * (the one you just queued). Used by the 2-hour sync, by "Read postings now", and right
 * after a 👍. Never throws for a page that cannot be read: the kit says why.
 */
export async function readPostingsWork(
  ctx: Pick<Context, "today">,
  persist: Store,
  opts: { limit?: number; only?: string; read?: PageReader } = {},
  t: Tracer = NO_TRACE,
): Promise<ReadResult> {
  const read = opts.read ?? readPage;
  const todo = kitsToRead(await persist.approvals.list()).filter((a) => !opts.only || a.id === opts.only);
  if (todo.length === 0) {
    t.note("Find approved jobs whose posting has not been read", "none waiting");
    return { read: 0, unreadable: 0, waiting: 0 };
  }
  // In tests and the demo a reader is passed in; live, Firecrawl has to be set up.
  if (!opts.read && !firecrawlConfigured()) {
    t.note("Find approved jobs whose posting has not been read", `${todo.length} waiting; ${READ_HELP.not_configured}`);
    return { read: 0, unreadable: 0, waiting: todo.length, skipped: READ_HELP.not_configured };
  }
  // The newest settings hold the count: another run may have read pages since this one started.
  let usage = (await persist.settings.get()).firecrawlUsage;
  const budget = readsLeft(usage, ctx.today);
  const batch = todo.slice(0, Math.max(0, Math.min(opts.limit ?? READ_BUDGET.perRun, budget.left)));
  t.note("Find approved jobs whose posting has not been read", `${todo.length} waiting; reading ${batch.length}${budget.left === 0 ? `: ${budget.why}` : ""}`);
  if (batch.length === 0) return { read: 0, unreadable: 0, waiting: todo.length, skipped: budget.why };

  let done = 0;
  let unreadable = 0;
  let stopped = "";
  for (const kit of batch) {
    const page = await t.step(`Read the posting on ${hostOf(kit.url)}`, () => read(kit.url), (p) => (p.ok ? `${p.text.length} characters` : READ_HELP[p.problem]));
    // Every request is counted, read or not: Firecrawl may charge for a page it could not read.
    if (page.ok || page.problem === "not_readable") usage = countReads(usage, ctx.today, 1);
    if (page.ok) {
      await persist.approvals.update(kit.id, { detail: withLines(kit.detail, postingLines(postingFacts(page.text), ctx.today)) });
      done++;
    } else if (RETRY_LATER.has(page.problem)) {
      // The key, the credits or the service: the same for every page, so stop here and try again later.
      stopped = READ_HELP[page.problem];
      break;
    } else {
      await persist.approvals.update(kit.id, { detail: withLines(kit.detail, [notReadLine(READ_HELP[page.problem])]) });
      unreadable++;
    }
  }
  if (done + unreadable > 0) await persist.settings.update({ firecrawlUsage: usage });
  const waiting = todo.length - done - unreadable;
  // Kits left over only because one run reads a few at a time need no explanation: the next run reads them.
  const why = stopped || (waiting > 0 ? readsLeft(usage, ctx.today).why : "");
  return { read: done, unreadable, waiting, ...(why ? { skipped: why } : {}) };
}

/** A link's host, for the trace. The path is left out: it can name the job. */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "a site";
  }
}

/** What a run says about itself: counts only, never a posting's text. */
export function readNote(r: ReadResult): string {
  if (r.read === 0 && r.unreadable === 0) return r.skipped ? `no postings read: ${r.skipped}` : "no approved job is waiting to be read";
  return [`${r.read} posting${r.read === 1 ? "" : "s"} read into ${r.read === 1 ? "its kit" : "their kits"}`, r.unreadable ? `${r.unreadable} could not be read` : "", r.waiting ? `${r.waiting} still waiting${r.skipped ? ` (${r.skipped})` : ""}` : ""].filter(Boolean).join(", ");
}

export interface ReadOptions {
  trigger: AgentRunEvent["trigger"];
  /** The store that may write: the owner's session can update its own kits and settings. */
  persist: Store;
  limit?: number;
  only?: string;
  read?: PageReader;
}

/** One logged, traced run of the Applications Agent that reads approved postings. Never throws. */
export async function runPostingReader(ctx: Context, opts: ReadOptions): Promise<ReadResult | AgentMissing> {
  const agent = "career" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  await logRun(ctx, { runId, agent, task: READ_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const result = await readPostingsWork(ctx, persist, opts, t);
    await logRun(ctx, { runId, agent, task: READ_TASK, status: "succeeded", trigger, detail: readNote(result), ...NO_MODEL, ...t.finish() });
    if (result.read + result.unreadable > 0) {
      await audit(ctx.store, { actor: trigger === "schedule" ? "system" : "owner", action: "career.read-postings", target: "firecrawl", detail: `${result.read} read, ${result.unreadable} not readable`, outcome: "success" }).catch(() => undefined);
    }
    return result;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: READ_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
