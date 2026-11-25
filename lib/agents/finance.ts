import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { prefsFrom } from "@/lib/domain/emailAgent";
import { financeAgentReport, type FinanceAgentResult } from "@/lib/domain/financeAgent";
import type { AgentRunEvent } from "@/lib/domain/types";
import { isPaused, logRun, NO_MODEL } from "./log";
import { NO_TRACE, tracer, type Tracer } from "./trace";

// The Finance Agent at run time. It never reads Gmail itself: it reads the inbox the Email
// Agent already synced (the Chief of Staff runs the Email Agent first), plus your Renewals
// list and your Settings lists. No bank connection, no logins, no money moves. Rules only,
// no model call, so every run costs $0. Tracking a bill in Renewals happens only on your
// click on the Renewals page.

/** The agent's work without logging. The Renewals page and Today's preview use this directly. */
export async function financeAgentWork(ctx: Context, t: Tracer = NO_TRACE): Promise<FinanceAgentResult> {
  const [items, renewals, connections] = await t.step(
    "Load the inbox the Email bot synced, and your Renewals list",
    () => Promise.all([ctx.store.inbox.list(), ctx.store.renewals.list(), ctx.store.connections.list().catch(() => [])]),
    ([i, r]) => `${i.length} emails, ${r.length} renewals`,
  );
  return t.step(
    "Read bills, payment alerts and deals",
    () => financeAgentReport({ today: ctx.today, items, prefs: prefsFrom(ctx.settings), renewals, inboxReady: items.length > 0 || connections.length > 0 }),
    (r) => `${r.bills.length} bills (${r.section.alerts.length} alerts, ${r.section.untracked} not on Renewals), ${r.deals.length} deals, ${r.dueRows.length} renewals due soon`,
  );
}

export interface FinanceRunOptions {
  trigger: AgentRunEvent["trigger"];
  /** Scheduled and Chief of Staff runs honor Pause; the agent's own Run Now does not. */
  honorPause: boolean;
}

/** One logged Finance Agent run. Never throws: a failure comes back as `missing`. */
export async function runFinanceAgent(ctx: Context, opts: FinanceRunOptions): Promise<FinanceAgentResult | AgentMissing> {
  const agent = "finance" as const;
  const runId = randomUUID();
  const task = "Bills, payment alerts and deals";
  const { trigger } = opts;

  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }

  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const result = await financeAgentWork(ctx, t);
    await logRun(ctx, { runId, agent, task, status: "succeeded", trigger, detail: result.report.headline.replace(/\.$/, ""), ...NO_MODEL, ...t.finish() });
    return result;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
