import "server-only";
import { queueThumbsWithoutKit } from "@/lib/applyQueue";
import { remindScheduledTexts } from "./peopleReminders";
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
import { lookUpNote, lookUpRoles, NOT_TRACKED, queueFollowUps, readingNote, readNewJobMail, trackApplications, trackedNote } from "./career";
import { sendHeardBack, sendNote } from "./heardBack";
import { readWithModel } from "./mailReader";
import { NOT_READ, readerNote } from "@/lib/domain/mailReader";
import { runEmailAgent } from "./email";
import { runFinanceAgent } from "./finance";
import { watchdog } from "./watchdog";
import { isPaused, logRun, NO_MODEL } from "./log";
import { runNewsAgent } from "./news";
import { readNote, readPostingsWork } from "./postingReader";
import { researchWork } from "./briefResearch";
import { runScout } from "./scout";
import { portfolioReady, scanPortfolio } from "./portfolio";
import { SCHEDULED_LIMIT_MS } from "@/lib/domain/deadline";
import { prepNewInterviews } from "./interviewPrep";
import { tracer } from "./trace";
import { clearClosedPostings } from "./stillOpen";

// The 2-hour sync. Monday to Saturday, every two hours from 6 AM to 4 PM, every agent
// reports to the Chief of Staff, so each page in Atlas is at most two hours old:
//   Notion     role order and resumes
//   Email      syncs the inbox (headers only), sorts and tags it
//   Calendar   reads the calendar, checks conflicts and interviews
//   News       reads the feeds (a failing feed shows in Errors & alerts)
//   Career     reads the text of new job emails (rules only), logs applications from
//              them, queues follow-ups for approval, and reads the postings of jobs you
//              approved into their apply kits (Firecrawl, inside its free plan)
//   Finance    reads bills, payment alerts and deals from the synced inbox
//   Scout      records the job market: every posting that is one of your roles
//   Search     the passages behind Ask Atlas are brought up to date (lib/knowledge)
// It refreshes data only. It never writes a brief (those stay at 9 AM and 2 PM), never
// adds job matches (those come with the briefs), and never sends, archives or applies.
// Rules only, no model call: $0 per run. Your phone is pinged for a company's answer to an
// application (the Heard back outbox, lib/agents/heardBack.ts: several answers are one
// push, none between 9 PM and 7 AM), and for something urgent that is new since the last
// sync: a payment alert, or an interview invite the tracker could not place.

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
  const stopWatchdog = watchdog(ctx, { runId, agent, task: SYNC_TASK, trigger }, t);
  const said = (r: { report: { headline: string } } | AgentMissing) => ("missing" in r ? `${r.missing}: ${r.why}` : r.report.headline);
  const slot = currentSlot(ctx.today, ctx.time);
  const weekdaySlot = slot === "saturday" ? "morning" : slot;
  const honorPause = trigger === "schedule";

  try {
    const notion = await t.step(
      "Sync resumes from Notion",
      () => syncNotion(persist, ctx.settings, ctx.now).catch(() => null),
      (n) => (!n ? "Notion is not connected" : n.sync.ok ? `${n.sync.roles} roles, ${n.sync.resumes} resumes${n.changed ? " (changed)" : ""}` : n.sync.message),
    );
    if (notion) ctx = { ...ctx, settings: notion.settings };

    // The Email Agent goes first: Career and Finance read the inbox it syncs.
    const email = await t.step("Ask the Email bot", () => runEmailAgent(ctx, weekdaySlot, { trigger, honorPause, sync: service }), said);
    const snapshot = await loadCareerSnapshot(ctx).catch(() => null);
    const [calendar, news, career, finance, scout] = await Promise.all([
      t.step("Ask the Calendar bot", () => runCalendarAgent(ctx, slot, { trigger, interviews: interviewsFrom(snapshot), honorPause }), said),
      t.step("Ask the News bot", () => runNewsAgent(ctx, slot, { trigger, honorPause }), said),
      t.step(
        "Ask the Applications bot to log applications and queue follow-ups",
        () => careerInSync(ctx, trigger, honorPause, persist),
        (c) => (c ? `${c.jobEmails} job emails: ${c.created} new applications, ${c.updated} moved forward, ${c.followUps} follow-ups queued. Job matches come with the briefs.` : "skipped: paused in Mission Control"),
      ),
      t.step("Ask the Finance bot", () => runFinanceAgent(ctx, { trigger, honorPause }), said),
      t.step("Ask the Scout", () => runScout(ctx, { trigger, honorPause, persist }), said),
    ]);
    // Once a day the Scout also reads your GitHub projects. Never fails the sync.
    if (ctx.mode === "live" && portfolioReady()) {
      await t.step("Ask the Scout to read your GitHub projects", () => scanPortfolio(ctx, { trigger, honorPause, persist }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" })), said);
    }

    // Anything urgent that is new since the last sync. An invite on a timeline was the
    // outbox's to send; with the Applications Agent paused, no job email pings at all.
    const onTimeline = new Set((await persist.applicationEvents.index().catch(() => [])).map((e) => e.sourceRef));
    const urgent = urgentSince(await ctx.store.inbox.list(), ctx.settings, since, "missing" in finance ? [] : finance.section.alerts, onTimeline).filter((u) => career !== null || u.kind !== "interview");
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

    // Texts you scheduled whose time has come: a reminder on your phone. Atlas never sends them.
    await t.step("Remind you of texts you scheduled", () => remindScheduledTexts(ctx, persist).catch(() => 0), (n) => `${n} reminder${n === 1 ? "" : "s"} sent`);

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
    stopWatchdog();
    await logRun(ctx, { runId, agent, task: SYNC_TASK, status: "succeeded", trigger, detail, ...NO_MODEL, ...t.finish() });
    return { status: "succeeded", detail, urgent };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    stopWatchdog();
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
      async () => trackApplications(ctx, reading.items, persist).catch(() => NOT_TRACKED),
      trackedNote,
    );
    // The answers that are due go out as one push. A manual run pings nothing: they wait for the next scheduled one.
    if (trigger === "schedule") await t.step("Tell your phone who wrote back", () => sendHeardBack(ctx, persist).catch(() => ({ sent: 0, held: 0, devices: 0, skipped: "the outbox could not be read" })), sendNote);
    else t.note("Tell your phone who wrote back", "No ping on a manual run. Anything due goes out with the next scheduled run.");
    // The model reader (docs/design-pipeline.md, 5.5): only when you turned it on, only what rules
    // left undecided, and in shadow: its readings are stored, shown nowhere and move nothing.
    const reader = ctx.settings.modelReader === true ? await t.step("Ask the AI model about job emails rules could not decide (shadow: stored, not shown)", () => readWithModel(ctx, persist).catch(() => ({ ...NOT_READ, status: "skipped" as const, why: "the reader failed" })), readerNote) : NOT_READ;
    await t.step("Look up missing roles in the application emails (read-only, rules only)", () => lookUpRoles(ctx, persist).catch(() => ({ looked: 0, found: 0, skipped: "lookup failed" })), lookUpNote);
    const followUps = await t.step("Queue follow-ups for quiet applications", () => queueFollowUps(ctx, persist).catch(() => 0), (n) => `${n} queued for your approval`);
    // A thumbs-up you have not applied to is always in a queue: one with no kit gets its kit back.
    await t.step("Queue jobs you gave a thumbs-up that are in no queue", () => queueThumbsWithoutKit(persist, ctx.settings, ctx.today, ctx.now).catch(() => 0), (n) => `${n} put back in a queue`);
    // Jobs in your Apply Queue whose posting came down are cleared (Greenhouse and Lever pages, a few a run).
    if (ctx.mode === "live") await t.step("Clear queued jobs whose posting is closed", () => clearClosedPostings(persist, ctx.now).catch(() => ({ checked: 0, closed: [] as string[] })), (r) => `${r.checked} checked, ${r.closed.length} closed`);
    // The postings of jobs you approved since the last sync, read into their kits (Firecrawl, when it is set up).
    const postings = await readPostingsWork(ctx, persist, {}, t).catch(() => null);
    // Then the apply briefs still without research: news, the company's own pages, the angle (a few a run, 10 a day).
    await researchWork(ctx, persist, { limit: 2 }, t).catch(() => null);
    // A new interview gets its prep (Coach, Step 4): one a run, only with a minute to spare.
    const left = (ctx.deadline ?? Date.now() + 90_000) - Date.now();
    if (left > 80_000) await t.step("Prepare for a new interview", () => prepNewInterviews(ctx, persist, Date.now() + Math.min(60_000, left - 20_000)).catch(() => ({ prepared: null, waiting: 0 })), (r) => (r.prepared ? `prepared ${r.prepared}${r.waiting ? `; ${r.waiting} more next run` : ""}` : "no new interviews"));
    const detail = [`${tracked.created} new applications, ${tracked.updated} moved forward, ${followUps} follow-ups queued`, postings && postings.read + postings.unreadable > 0 ? readNote(postings) : ""].filter(Boolean).join(", ");
    const usage = reader.sent > 0 ? { model: reader.model, inputTokens: reader.inputTokens, outputTokens: reader.outputTokens, costUsd: reader.costUsd } : NO_MODEL;
    await logRun(ctx, { runId, agent, task, status: "succeeded", trigger, detail, ...usage, ...t.finish() });
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
