import "server-only";
import { randomUUID } from "node:crypto";
import { geminiModel } from "@/lib/ai/gemini";
import { activeProvider, aiConfigured } from "@/lib/ai/model";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing, StandardReport } from "@/lib/domain/chiefOfStaff";
import { briefedSlots } from "@/lib/domain/briefSchedule";
import { addDays, zonedToUtc } from "@/lib/domain/dates";
import { tabUsage } from "@/lib/domain/layout";
import { QA_TASK, QA_WINDOW_DAYS, qaReview, type QaInput, type StoredQaReport } from "@/lib/domain/qa";
import { TOKEN_REFUSED } from "@/lib/domain/refusedTokens";
import { contactsDue } from "@/lib/domain/relationships";
import type { AgentRunEvent } from "@/lib/domain/types";
import { env } from "@/lib/env";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The QA Agent at run time: gather a week of Atlas's own records (the audit trail's
// refused-token rows among them), review them by rules (lib/domain/qa.ts), save the
// report, log the run. No AI model, no outside request, and nothing changed anywhere but
// its own table. Scheduled for Sunday evening; Run now works any day and reviews the
// seven days ending today.

export interface QaResult {
  report: StandardReport;
  stored: StoredQaReport;
}

export interface QaOptions {
  trigger: AgentRunEvent["trigger"];
  honorPause: boolean;
  /** Writes the report: the owner-scoped service store in live mode. */
  persist: Store;
}

/** Everything the review reads. Each read fails on its own: a missing source narrows the review, it does not stop it. */
export async function qaInput(ctx: Context, persist: Store): Promise<QaInput> {
  const { store, today, now, settings } = ctx;
  const from = addDays(today, -(QA_WINDOW_DAYS - 1));
  // A day more than the window, so a run that started just before it still pairs with its end.
  const since = new Date(now.getTime() - (QA_WINDOW_DAYS + 1) * 86_400_000).toISOString();
  const days = Array.from({ length: QA_WINDOW_DAYS }, (_, i) => addDays(from, i));
  const [runs, briefs, connections, applications, approvals, insights, paused, aiCalls, earlier, refused] = await Promise.all([
    store.agentRuns.since(since).catch(() => []),
    Promise.all(days.map((d) => store.briefs.forDate(d).catch(() => []))).then((rows) => rows.flat().map((b) => ({ forDate: b.forDate, slot: b.slot, createdAt: b.createdAt }))),
    store.connections.list().catch(() => []),
    store.applications.list().catch(() => []),
    store.approvals.list().catch(() => []),
    store.mentor.since(addDays(today, -13)).catch(() => []),
    store.agentState.list().catch(() => []),
    store.aiUsage.since(since).catch(() => []),
    persist.qa.recent(3).catch(() => []),
    // Tokens refused at the machine endpoints: the route, the time and the counts, nothing else of the row.
    store.audit
      .byAction(TOKEN_REFUSED, since)
      .then((rows) => rows.map((r) => ({ at: r.at, target: r.target, detail: r.detail })))
      .catch(() => null),
  ]);
  // The layout check: a week of use per main tab. Counts only; a source that cannot be read leaves the check out.
  const weekStart = zonedToUtc(from, "00:00", settings.timezone).toISOString();
  const usage = await Promise.all([store.ledger.since(since), store.contacts.list(), store.messages.list()])
    .then(([ledger, contacts, messages]) =>
      tabUsage({
        from,
        since: weekStart,
        briefsSaved: briefs.length,
        briefsMarked: days.reduce((sum, d) => sum + briefedSlots(ledger, d, settings.timezone).length, 0),
        insights,
        approvals,
        due: contactsDue(contacts, today).length,
        handedOff: messages.filter((m) => m.status === "handed_off").map((m) => m.handedOffAt),
      }),
    )
    .catch(() => null);
  const gemini = activeProvider() === "gemini";
  return {
    today,
    now,
    timeZone: settings.timezone,
    runs,
    briefs,
    connections,
    applications,
    approvals,
    insights,
    paused,
    aiCalls,
    aiDailyLimit: env().ATLAS_AI_DAILY_LIMIT,
    aiOn: aiConfigured() && settings.aiEnabled && settings.outboundEnabled,
    usage,
    refused,
    models: gemini ? { writer: geminiModel("writer"), fast: geminiModel("fast") !== geminiModel("writer") ? geminiModel("fast") : null } : null,
    // Last week's review: the newest one from an earlier day (a second run today replaces today's).
    previous: earlier.find((r) => r.forDate < today)?.report ?? null,
  };
}

export async function runQa(ctx: Context, opts: QaOptions): Promise<QaResult | AgentMissing> {
  const agent = "qa" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task: QA_TASK, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }
  await logRun(ctx, { runId, agent, task: QA_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const input = await t.step("Gather a week of runs, briefs, eval scores, connections and queues", () => qaInput(ctx, persist), (i) => `${i.runs.length} log rows, ${i.briefs.length} briefs, ${i.connections.length} connections, ${i.aiCalls.length} AI calls, use per tab ${i.usage ? "counted" : "not counted"}, refused tokens ${i.refused ? `${i.refused.length} records` : "not read"}`);
    const review = qaReview(input);
    t.note("Review by rules, and compare with last week", `${review.checks.filter((c) => c.ok).length} of ${review.checks.length} checks passed, ${review.findings.length} findings, ${review.resolved.length} fixed since last week`);
    const stored = await t.step("Save the review", () => persist.qa.save({ forDate: ctx.today, report: review }));
    const n = (s: "high" | "medium" | "low") => review.findings.filter((f) => f.severity === s).length;
    const report: StandardReport = { agent, headline: review.headline, details: review.findings.slice(0, 5).map((f) => `${f.severity}: ${f.title}`), needsApproval: [], errors: [] };
    // Counts only: the findings stay in their own table.
    await logRun(ctx, { runId, agent, task: QA_TASK, status: "succeeded", trigger, detail: `${review.findings.length} findings (${n("high")} high, ${n("medium")} medium, ${n("low")} low), ${review.checks.length} checks`, ...NO_MODEL, ...t.finish() });
    return { report, stored };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: QA_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
