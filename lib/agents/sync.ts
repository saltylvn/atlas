import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { loadCareerSnapshot } from "@/lib/career";
import { syncNotion } from "@/lib/connections/notion";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { currentSlot, isSyncDay, isSyncTime, SYNC_TASK } from "@/lib/domain/briefSchedule";
import { interviewsFrom } from "@/lib/domain/calendarAgent";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { localDate, localTime } from "@/lib/domain/dates";
import { urgentSince, type Urgent } from "@/lib/domain/urgent";
import type { AgentRunEvent } from "@/lib/domain/types";
import { env, mode } from "@/lib/env";
import { indexKnowledge, indexNote } from "@/lib/knowledge/indexer";
import { ownerServiceStore, ownerUserId, serviceReady } from "@/lib/owner";
import { sendToAll } from "@/lib/push";
import { bearerMatches } from "@/lib/security/bearer";
import { noteRefusedToken } from "@/lib/security/refusedToken";
import { runCalendarAgent } from "./calendar";
import { lookUpNote, lookUpRoles, queueFollowUps, readingNote, readNewJobMail, trackApplications } from "./career";
import { runEmailAgent } from "./email";
import { runFinanceAgent } from "./finance";
import { isPaused, logRun, NO_MODEL } from "./log";
import { runNewsAgent } from "./news";
import { runScout } from "./scout";
import { portfolioReady, scanPortfolio } from "./portfolio";
import { SCHEDULED_LIMIT_MS } from "@/lib/domain/deadline";
import { tracer } from "./trace";

// The 2-hour sync. Monday to Saturday, every two hours from 6 AM to 4 PM, every agent
// reports to the Chief of Staff, so each page in Atlas is at most two hours old:
//   Notion     role order and resumes
//   Email      syncs the inbox (headers only), sorts and tags it
//   Calendar   reads the calendar, checks conflicts and interviews
//   News       reads the feeds (a failing feed shows in Errors & alerts)
//   Career     reads the text of new job emails (rules only), logs applications from
//              them and queues follow-ups for approval
//   Finance    reads bills, payment alerts and deals from the synced inbox
//   Scout      records the job market: every posting that is one of your roles
//   Search     the passages behind Ask Atlas are brought up to date (lib/knowledge)
// It refreshes data only. It never writes a brief (those stay at 9 AM and 2 PM), never
// adds job matches (those come with the briefs), and never sends, archives or applies.
// Rules only, no model call: $0 per run. Your phone is pinged only for something
// urgent that is new since the last sync: an interview invite or a payment alert.

type Trigger = AgentRunEvent["trigger"];

export interface SyncOutcome {
  status: "succeeded" | "skipped" | "failed";
  detail: string;
  urgent: Urgent[];
}

/** One sync run. `service` writes the inbox and applications; null in demo mode. */
export async function runSync(ctx: Context, trigger: Trigger, service: Store | null): Promise<SyncOutcome> {
  const agent = "chief-of-staff" as const;
  const runId = randomUUID();
  const persist = service ?? ctx.store;

  if (trigger === "schedule" && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task: SYNC_TASK, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { status: "skipped", detail: "paused", urgent: [] };
  }

  // What counts as "new": anything that arrived after the last sync that worked.
  const recent = await ctx.store.agentRuns.recent(120).catch(() => []);
  const last = recent.find((r) => r.task === SYNC_TASK && r.status === "succeeded");
  const since = last?.at ?? new Date(ctx.now.getTime() - 2 * 3_600_000).toISOString();

  await logRun(ctx, { runId, agent, task: SYNC_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  const said = (r: { report: { headline: string } } | AgentMissing) => ("missing" in r ? `${r.missing}: ${r.why}` : r.report.headline);
  const slot = currentSlot(ctx.today, ctx.time);
  const weekdaySlot = slot === "saturday" ? "morning" : slot;
  const honorPause = trigger === "schedule";

  try {
    const notion = await t.step(
      "Sync role order and resumes from Notion",
      () => syncNotion(persist, ctx.settings, ctx.now).catch(() => null),
      (n) => (!n ? "Notion is not connected" : n.sync.ok ? `${n.sync.roles} roles, ${n.sync.resumes} resumes${n.changed ? " (changed)" : ""}` : n.sync.message),
    );
    if (notion) ctx = { ...ctx, settings: notion.settings };

    // The Email Agent goes first: Career and Finance read the inbox it syncs.
    const email = await t.step("Ask the Email Agent", () => runEmailAgent(ctx, weekdaySlot, { trigger, honorPause, sync: service }), said);
    const snapshot = await loadCareerSnapshot(ctx).catch(() => null);
    const [calendar, news, career, finance, scout] = await Promise.all([
      t.step("Ask the Calendar Agent", () => runCalendarAgent(ctx, slot, { trigger, interviews: interviewsFrom(snapshot), honorPause }), said),
      t.step("Ask the News Agent", () => runNewsAgent(ctx, slot, { trigger, honorPause }), said),
      t.step(
        "Ask the Applications Agent to log applications and queue follow-ups",
        () => careerInSync(ctx, trigger, honorPause, persist),
        (c) => (c ? `${c.jobEmails} job emails: ${c.created} new applications, ${c.updated} moved forward, ${c.followUps} follow-ups queued. Job matches come with the briefs.` : "skipped: paused in Mission Control"),
      ),
      t.step("Ask the Finance Agent", () => runFinanceAgent(ctx, { trigger, honorPause }), said),
      t.step("Ask the Scout", () => runScout(ctx, { trigger, honorPause, persist }), said),
    ]);
    // Once a day the Scout also reads your GitHub projects. Never fails the sync.
    if (ctx.mode === "live" && portfolioReady()) {
      await t.step("Ask the Scout to read your GitHub projects", () => scanPortfolio(ctx, { trigger, honorPause, persist }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" })), said);
    }

    // Anything urgent that is new since the last sync.
    const urgent = urgentSince(await ctx.store.inbox.list(), ctx.settings, since, "missing" in finance ? [] : finance.section.alerts);
    let pinged = 0;
    if (urgent.length > 0 && trigger === "schedule" && ctx.settings.outboundEnabled) {
      const first = urgent[0]!;
      const sent = await t.step(
        "Ping your phone about something urgent",
        () => sendToAll(ctx.store, { title: first.title, body: urgent.length > 1 ? `${first.body} (+${urgent.length - 1} more)` : first.body, url: first.url }).catch(() => ({ sent: 0, removed: 0, failed: 0 })),
        (s) => `${urgent.length} urgent, sent to ${s.sent} device${s.sent === 1 ? "" : "s"}`,
      );
      pinged = sent.sent;
    } else {
      t.note("Check for anything urgent", urgent.length ? `${urgent.length} urgent, no phone ping on a manual run` : "Nothing urgent is new since the last sync. No phone ping.");
    }

    // Last, so it sees what the agents just wrote. A failure here never fails the sync.
    await t.step(
      "Update the search index",
      () => indexKnowledge(persist, ctx.settings.timezone, ctx.now, { embedBudget: 24, deadline: Date.now() + 12_000 }).catch(() => null),
      (o) => (o ? indexNote(o) : "the index could not be updated; it will try again at the next sync"),
    );

    const failed = [email, calendar, news, finance, scout].filter((r) => "missing" in r && r.missing === "failed").length;
    const detail = [
      "missing" in email ? "inbox not synced" : `${email.summary.needsReply} need a reply`,
      career ? `${career.created} new applications, ${career.followUps} follow-ups` : "",
      "missing" in finance ? "" : `${finance.section.alerts.length} payment alerts`,
      "missing" in scout ? "" : `${scout.added} new postings recorded`,
      "missing" in calendar || !calendar.section ? "" : `${calendar.section.conflicts.length} calendar conflicts`,
      urgent.length ? `${urgent.length} urgent${pinged ? " (phone pinged)" : ""}` : "nothing urgent",
      failed ? `${failed} agent${failed === 1 ? "" : "s"} failed` : "",
    ]
      .filter(Boolean)
      .join(", ");
    // The sync succeeds when the Chief of Staff heard back; a failed specialist is in the detail and the alerts.
    await logRun(ctx, { runId, agent, task: SYNC_TASK, status: "succeeded", trigger, detail, ...NO_MODEL, ...t.finish() });
    return { status: "succeeded", detail, urgent };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: SYNC_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { status: "failed", detail: why, urgent: [] };
  }
}

/** The Applications Agent's part in a sync, the task it logs under. Job matches come with the briefs. */
export const CAREER_SYNC_TASK = "Applications and follow-ups";

/**
 * The Applications Agent's part: log applications from job emails and queue follow-ups for
 * approval. It logs its own run, like every other specialist, so Mission Control's live
 * map shows it working. Null when it is paused.
 */
async function careerInSync(ctx: Context, trigger: Trigger, honorPause: boolean, persist: Store) {
  const agent = "career" as const;
  const runId = randomUUID();
  const task = CAREER_SYNC_TASK;
  if (honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return null;
  }
  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const reading = await t.step("Read the text of new job emails (read-only, rules only)", () => readNewJobMail(ctx, persist), readingNote);
    const tracked = await t.step(
      "Track applications from job emails",
      async () => trackApplications(ctx, reading.items, persist).catch(() => ({ created: 0, updated: 0, jobEmails: 0, roles: 0 })),
      (r) => `${r.jobEmails} job emails: ${r.created} new applications, ${r.updated} moved forward${r.roles ? `, ${r.roles} roles filled in` : ""}`,
    );
    await t.step("Look up missing roles in the application emails (read-only, rules only)", () => lookUpRoles(ctx, persist).catch(() => ({ looked: 0, found: 0, skipped: "lookup failed" })), lookUpNote);
    const followUps = await t.step("Queue follow-ups for quiet applications", () => queueFollowUps(ctx, persist).catch(() => 0), (n) => `${n} queued for your approval`);
    const detail = `${tracked.created} new applications, ${tracked.updated} moved forward, ${followUps} follow-ups queued`;
    await logRun(ctx, { runId, agent, task, status: "succeeded", trigger, detail, ...NO_MODEL, ...t.finish() });
    return { ...tracked, followUps };
  } catch (err) {
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: (err as Error).message?.slice(0, 300) || "unknown error", ...NO_MODEL, ...t.finish() });
    throw err;
  }
}

/**
 * The scheduler's entry point. Vercel Cron calls /api/cron/sync once in each candidate
 * hour with `Authorization: Bearer $CRON_SECRET`; the owner's local time decides whether
 * this is a sync hour (so 6 AM stays 6 AM through daylight saving changes).
 */
export async function handleSync(request: NextRequest): Promise<NextResponse> {
  if (!bearerMatches(request.headers.get("authorization"), env().CRON_SECRET)) {
    noteRefusedToken("/api/cron/sync", request.headers.get("authorization"));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (mode() !== "live" || !serviceReady()) return NextResponse.json({ error: "not configured" }, { status: 503 });

  const store = ownerServiceStore();
  const settings = await store.settings.get();
  const now = new Date();
  const today = localDate(now, settings.timezone);
  const time = localTime(now, settings.timezone);
  if (!isSyncTime(today, time)) return NextResponse.json({ ok: true, skipped: isSyncDay(today) ? "not a sync hour" : "Sunday is off" });

  // maxDuration = 300 on the sync route: reading job emails and the search index get room.
  const ctx: Context = { mode: "live", userId: ownerUserId() ?? "", store, settings, now, today, time, deadline: Date.now() + SCHEDULED_LIMIT_MS, patient: true };
  const outcome = await runSync(ctx, "schedule", store);
  if (outcome.status === "failed") await audit(store, { actor: "system", action: "cron.sync", target: "sync", detail: outcome.detail, outcome: "error" });
  return NextResponse.json({ ok: outcome.status !== "failed", sync: outcome.status });
}
