import "server-only";
import { randomUUID } from "node:crypto";
import { syncGmail } from "@/lib/connections/google";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { SLOT_LABEL } from "@/lib/domain/briefSchedule";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { emailAgentReport, prefsFrom, type EmailAgentResult, type SyncState } from "@/lib/domain/emailAgent";
import type { AgentRunEvent, BriefSlot } from "@/lib/domain/types";
import { isPaused, logRun, NO_MODEL } from "./log";
import { NO_TRACE, tracer, type Tracer } from "./trace";

// The Email Agent at run time: the only agent that reads the inbox. It syncs Gmail
// (headers only, read-only), then hands the pure report builder the stored inbox and
// your Settings lists. Rules only, no model call, so every run costs $0. Archiving and
// unsubscribing never happen here: only on your click (app/actions/inbox.ts).

/**
 * The agent's work without logging. `sync` is the owner-scoped service store when Gmail
 * should be read first (scheduled runs and Run Now), or null to report on the stored
 * inbox only (Today's live preview, demo mode).
 */
export async function emailAgentWork(ctx: Context, slot: BriefSlot, sync: Store | null, t: Tracer = NO_TRACE): Promise<EmailAgentResult> {
  let state: SyncState = "not_run";
  let message: string | undefined;
  if (sync) {
    const r = await t.step(
      "Read Gmail (headers only)",
      () => syncGmail(sync).catch(() => ({ status: "error" as const, message: "sync failed" })),
      (r) => (r.status === "ok" ? `${r.fetched} fetched, ${r.needsReply} need a reply` : r.status === "error" ? "Gmail could not be read" : "Gmail is not connected"),
    );
    state = r.status;
    if (r.status === "error") message = r.message;
  }
  const items = await t.step("Load the stored inbox", () => ctx.store.inbox.list(), (i) => `${i.length} emails`);
  return t.step(
    "Sort, tag and look for senders to declutter",
    () => emailAgentReport({ slot, items, prefs: prefsFrom(ctx.settings), sync: state, syncMessage: message }),
    (r) => `${r.report.headline} ${r.section.jobs?.length ?? 0} job emails passed to the Applications bot.`,
  );
}

export interface EmailRunOptions {
  trigger: AgentRunEvent["trigger"];
  /** Scheduled and Chief of Staff runs honor Pause; the agent's own Run Now does not. */
  honorPause: boolean;
  sync: Store | null;
}

/** One logged Email Agent run. Never throws: a failure comes back as `missing`. */
export async function runEmailAgent(ctx: Context, slot: BriefSlot, opts: EmailRunOptions): Promise<EmailAgentResult | AgentMissing> {
  const agent = "email" as const;
  const runId = randomUUID();
  const task = `Inbox for the ${SLOT_LABEL[slot]}`;
  const { trigger } = opts;

  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }

  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const result = await emailAgentWork(ctx, slot, opts.sync, t);
    const detail = result.report.headline.replace(/\.$/, "");
    if (result.sync === "error") {
      await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: result.report.errors[0] ?? "Gmail sync failed", ...NO_MODEL, ...t.finish() });
    } else if (result.sync === "not_connected") {
      await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Gmail not connected", ...NO_MODEL, ...t.finish() });
    } else {
      await logRun(ctx, { runId, agent, task, status: "succeeded", trigger, detail: result.sync === "not_run" ? `${detail} (stored inbox)` : detail, ...NO_MODEL, ...t.finish() });
    }
    return result;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
