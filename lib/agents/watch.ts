import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { readJobMailTexts, syncGmail } from "@/lib/connections/google";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { localDate, localTime } from "@/lib/domain/dates";
import { isWatchTime, triesGmail, WATCH_LIMIT_MS, WATCH_TASK, wholePass } from "@/lib/domain/watch";
import { env, mode } from "@/lib/env";
import { ownerServiceStore, ownerUserId, serviceReady } from "@/lib/owner";
import { pushConfigured, sendToAll } from "@/lib/push";
import { bearerMatches } from "@/lib/security/bearer";
import { noteRefusedToken } from "@/lib/security/refusedToken";
import { NOT_TRACKED, readingNote, readJobMail, trackApplications, trackedNote } from "./career";
import { sendHeardBack, sendNote, type PushDeps } from "./heardBack";
import { logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The 15-minute watch (docs/design-pipeline.md, 5.8): so an answer from a company reaches
// your phone within 15 minutes, any day, 7 AM to 9 PM. One short run of the Applications Agent:
//   1. Gmail's inbox headers, read-only (the same sync the Email Agent uses).
//   2. The text of new job emails, read by rules: a rejection, an interview invite, neither.
//   3. Each one onto its application's timeline, and each answer into the Heard back outbox.
//   4. One push for whatever is due.
// It writes no brief, reads no job feed or calendar, queues no follow-up and calls no model.
// A tick with nothing new in Gmail stops after step 1 and sends what is due. It logs a run
// only when it changed something or failed, so 56 quiet ticks a day do not bury the
// activity log. The kill switch and the Applications or Email Agent's pause stop it.

export interface WatchOutcome {
  status: "succeeded" | "skipped" | "failed";
  /** Counts and a reason. Never anything from an email. */
  detail: string;
}

/** What the watch reaches outside the database. Swapped in tests, which must not reach Gmail or a push service. */
export interface WatchDeps {
  syncInbox: typeof syncGmail;
  readTexts: (ids: string[]) => Promise<Map<string, string> | null>;
  push: PushDeps;
}

const LIVE: WatchDeps = { syncInbox: syncGmail, readTexts: readJobMailTexts, push: { push: sendToAll, ready: pushConfigured } };

/** One watch run. `persist` is the owner-scoped service store. Never throws. */
export async function runWatch(ctx: Context, persist: Store, deps: WatchDeps = LIVE): Promise<WatchOutcome> {
  const skipped = (detail: string): WatchOutcome => ({ status: "skipped", detail });
  if (!isWatchTime(ctx.time)) return skipped("outside 7 AM to 9 PM");
  if (!ctx.settings.outboundEnabled) return skipped("the kill switch is on");
  const paused = (await persist.agentState.list().catch(() => [])).filter((s) => s.paused).map((s) => s.agent);
  if (paused.includes("career") || paused.includes("email")) return skipped("paused in Mission Control");
  // The connection the sync will use: the app password first, as in lib/connections/google.ts.
  const connections = await persist.connections.list().catch(() => []);
  const gmail = connections.find((c) => c.provider === "gmail_imap") ?? connections.find((c) => c.provider === "google");
  if (!gmail) return skipped("Gmail is not connected");
  if (!triesGmail(ctx.time, gmail.status === "error")) return skipped("Gmail failed on the last try; the watch tries every 30 minutes until it works");

  const agent = "career" as const;
  const runId = randomUUID();
  const t = tracer();
  const log = (status: "succeeded" | "failed", detail: string) => logRun(ctx, { runId, agent, task: WATCH_TASK, status, trigger: "schedule", detail, ...NO_MODEL, ...t.finish() });
  try {
    const mail = await t.step(
      "Read Gmail (headers only)",
      () => deps.syncInbox(persist).catch(() => ({ status: "error" as const, message: "sync failed" })),
      (r) => (r.status === "ok" ? `${r.fetched} fetched` : r.status === "error" ? "Gmail could not be read" : "Gmail is not connected"),
    );
    if (mail.status !== "ok") {
      const detail = mail.status === "error" ? "Gmail could not be read; trying again in 30 minutes" : "Gmail is not connected";
      await log("failed", detail);
      return { status: "failed", detail };
    }

    let tracked: Awaited<ReturnType<typeof trackApplications>> = { ...NOT_TRACKED };
    if (wholePass(ctx.time, mail.newestAt, gmail.lastSyncAt)) {
      const reading = await t.step("Read the text of new job emails (read-only, rules only)", async () => readJobMail(ctx, await persist.inbox.list(), persist, deps.readTexts), readingNote);
      // Only an email whose text has been read goes on a timeline: the tracker's own rule
      // (`jobMailsFrom`), the same in every run. An unread one waits for the next tick.
      tracked = await t.step("Track applications from job emails", () => trackApplications(ctx, reading.items, persist), trackedNote);
    } else {
      t.note("Read and track job emails", "Nothing new in Gmail since the last sync.");
    }
    const sent = await t.step("Tell your phone who wrote back", () => sendHeardBack(ctx, persist, deps.push), sendNote);

    const detail = `${tracked.created} new applications, ${tracked.updated} moved forward, ${tracked.heard ?? 0} new in Heard back, ${sent.sent} pushed${sent.held ? `, ${sent.held} held until 7 AM` : ""}`;
    // A quiet tick is not logged; one that changed something is, with its trace.
    if (tracked.created || tracked.updated || tracked.heard !== 0 || sent.sent) await log("succeeded", detail);
    return { status: "succeeded", detail };
  } catch (err) {
    const detail = (err as Error).message?.split("\n")[0]?.slice(0, 300) || "unknown error";
    await log("failed", detail);
    return { status: "failed", detail };
  }
}

/**
 * The scheduler's entry point. Supabase Cron posts to /api/cron/watch every 15 minutes
 * with `Authorization: Bearer $ATLAS_WATCH_SECRET`; the owner's local time decides whether
 * this is a watch hour. The secret is the watch's own: CRON_SECRET does not open this
 * route, and this secret opens no other.
 */
export async function handleWatch(request: NextRequest): Promise<NextResponse> {
  const e = env();
  if (!bearerMatches(request.headers.get("authorization"), e.ATLAS_WATCH_SECRET)) {
    noteRefusedToken("/api/cron/watch", request.headers.get("authorization"));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // The same value as the scheduler's secret would let one leaked secret run everything: refuse to run on it.
  if (mode() !== "live" || !serviceReady() || e.ATLAS_WATCH_SECRET === e.CRON_SECRET) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const store = ownerServiceStore();
  const settings = await store.settings.get();
  const now = new Date();
  const ctx: Context = { mode: "live", userId: ownerUserId() ?? "", store, settings, now, today: localDate(now, settings.timezone), time: localTime(now, settings.timezone), deadline: Date.now() + WATCH_LIMIT_MS };
  const outcome = await runWatch(ctx, store);
  if (outcome.status === "failed") await audit(store, { actor: "system", action: "cron.watch", target: "watch", detail: outcome.detail, outcome: "error" });
  // The answer is kept for a few hours in the database that called (pg_net): status and counts only.
  return NextResponse.json({ ok: outcome.status !== "failed", watch: outcome.status, detail: outcome.detail });
}
