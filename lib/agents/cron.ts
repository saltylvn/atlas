import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import type { Context } from "@/lib/context";
import { isSyncDay, scheduledSlot } from "@/lib/domain/briefSchedule";
import { localDate, localTime, zonedToUtc } from "@/lib/domain/dates";
import { SCHEDULED_LIMIT_MS } from "@/lib/domain/deadline";
import { sendToAll } from "@/lib/push";
import { env, mode } from "@/lib/env";
import { ownerServiceStore, ownerUserId, serviceReady } from "@/lib/owner";
import { syncNotion } from "@/lib/connections/notion";
import { bearerMatches } from "@/lib/security/bearer";
import { runChiefOfStaff } from "./chiefOfStaff";
import { runQa } from "./qa";
import { logEvalRun } from "./evals";
import { logRun } from "./log";
import { MENTOR_TASK, runMentor } from "./mentor";
import { needsYou } from "@/lib/domain/resumeSync";
import { RESUME_SYNC_TASK, resumeSyncReady, runResumeSync } from "./resumeSync";

// The scheduler. Vercel Cron calls /api/cron/morning and /api/cron/afternoon with
// `Authorization: Bearer $CRON_SECRET`, early enough that each brief is ready by
// 9:00 AM and 2:00 PM Mountain time. Weekend Mode and pause switches are applied here.

export async function handleCron(request: NextRequest, wanted: "morning" | "afternoon" | "evening" | "qa"): Promise<NextResponse> {
  if (!bearerMatches(request.headers.get("authorization"), env().CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (mode() !== "live" || !serviceReady()) return NextResponse.json({ error: "not configured" }, { status: 503 });

  // Vercel stops this function SCHEDULED_LIMIT_MS after it starts (maxDuration = 300 on the
  // cron routes); every model call inside the run waits only for the time left, so the
  // brief is always saved. Nobody is waiting, so each call may wait up to a minute.
  const deadline = Date.now() + SCHEDULED_LIMIT_MS;
  const store = ownerServiceStore();
  const settings = await store.settings.get();
  const now = new Date();
  const today = localDate(now, settings.timezone);
  const ctx = { mode: "live" as const, userId: ownerUserId() ?? "", store, settings, now, today, time: localTime(now, settings.timezone), deadline, patient: true };

  if (wanted === "evening") return eveningRun(ctx);
  if (wanted === "qa") {
    // The weekly review of Atlas itself. It reads the week's records and writes its own report.
    const res = await runQa(ctx, { trigger: "schedule", honorPause: true, persist: store });
    const failed = "missing" in res && res.missing === "failed";
    await audit(store, { actor: "system", action: "cron.qa", target: "qa", detail: "missing" in res ? res.missing : res.report.headline.slice(0, 200), outcome: failed ? "error" : "success" });
    return NextResponse.json({ ok: !failed, qa: "missing" in res ? res.missing : "reviewed" });
  }

  const slot = scheduledSlot(today, wanted);
  if (!slot) {
    await logRun(ctx, { runId: randomUUID(), agent: "chief-of-staff", task: wanted === "morning" ? "Morning Brief" : "2:00 PM Brief", status: "skipped", trigger: "schedule", detail: "Weekend Mode: no brief today", model: "", inputTokens: 0, outputTokens: 0, costUsd: 0 });
    return NextResponse.json({ ok: true, skipped: "weekend" });
  }

  // Notion decides the order of the target roles: copy it in before the Applications Agent runs.
  // A Notion problem never blocks the brief; the last good copy is used.
  const notion = await syncNotion(store, ctx.settings, now).catch(() => null);
  if (notion) {
    ctx.settings = notion.settings;
    if (!notion.sync.ok || notion.changed) {
      await audit(store, { actor: "system", action: "connection.notion.sync", target: "notion", detail: notion.sync.ok ? `${notion.sync.roles} roles, ${notion.sync.resumes} resumes` : notion.sync.message, outcome: notion.sync.ok ? "success" : "error" });
    }
  }

  // Once a day, before the morning brief: score every agent's rules against its labeled
  // cases and log it (the Evals page charts these). Never blocks the brief.
  if (wanted === "morning") await logEvalRun(ctx, "schedule").catch(() => undefined);

  // The Chief of Staff runs the specialists; the Email Agent syncs the inbox with this
  // owner-scoped service store before each weekday brief.
  const outcome = await runChiefOfStaff(ctx, slot, "schedule", { service: store });

  await audit(store, {
    actor: "system",
    action: `cron.${slot}`,
    target: "brief",
    detail: `brief ${outcome.status}`,
    outcome: outcome.status === "failed" ? "error" : "success",
  });
  return NextResponse.json({ ok: outcome.status !== "failed", slot, brief: outcome.status });
}

/** The Mentor's evening hours on the owner's clock. The scheduler's timing is approximate, so any of them counts. */
export const EVENING_HOURS: readonly number[] = [17, 18, 19];

/**
 * The evening run, Monday to Saturday, once, about 6 PM: first the Applications Agent's
 * resume sync (Figma to Notion), then the Mentor's evening review, so the Mentor sees
 * tonight's resume text. The scheduler calls in two candidate hours (daylight saving moves
 * the UTC hour); the second call finds the first one's runs in the activity log and stops.
 * Each half is checked on its own, so one failing never blocks or repeats the other.
 */
async function eveningRun(ctx: Context & { mode: "live" }): Promise<NextResponse> {
  if (!isSyncDay(ctx.today) || !EVENING_HOURS.includes(Number(ctx.time.slice(0, 2)))) return NextResponse.json({ ok: true, skipped: "not the evening hour" });
  const since = zonedToUtc(ctx.today, "00:00", ctx.settings.timezone).toISOString();
  const runs = await ctx.store.agentRuns.since(since).catch(() => []);
  // A run you started by hand today counts: the work is the same.
  const ranToday = (task: string) => runs.some((r) => r.task === task && r.status !== "failed");

  let resumes = "not set up";
  if (resumeSyncReady() && !ranToday(RESUME_SYNC_TASK)) {
    const res = await runResumeSync(ctx, { trigger: "schedule", honorPause: true, persist: ctx.store });
    resumes = "missing" in res ? res.missing : res.headline;
    if ("missing" in res && res.missing === "failed") await audit(ctx.store, { actor: "system", action: "cron.evening", target: "resume-sync", detail: "resume sync failed", outcome: "error" });
    // A change is worth knowing about tonight: the PDF you send is now behind the design.
    if (!("missing" in res) && (res.report.updated.length > 0 || needsYou(res.report)) && ctx.settings.outboundEnabled) {
      const n = res.report.updated.length;
      await sendToAll(ctx.store, {
        title: n > 0 ? `${n} resume${n === 1 ? "" : "s"} updated from Figma` : "Resume sync needs a look",
        body: n > 0 ? "The text is in Notion and Ask Atlas. Re-export the PDF and attach it to the row." : "A resume changed in both Figma and Notion, or a frame could not be read.",
        url: "/roles",
      }).catch(() => undefined);
    }
  } else if (resumeSyncReady()) resumes = "already ran today";

  if (ranToday(MENTOR_TASK.evening)) return NextResponse.json({ ok: true, resumes, mentor: "already ran today" });
  const res = await runMentor(ctx, "evening", { trigger: "schedule", honorPause: true, persist: ctx.store });
  const failed = "missing" in res && res.missing === "failed";
  if (!("missing" in res) && res.insights.length > 0 && ctx.settings.outboundEnabled) {
    await sendToAll(ctx.store, { title: `Mentor: ${res.insights[0]!.title}`.slice(0, 120), body: "Your evening review is in Atlas.", url: "/growth" }).catch(() => undefined);
  }
  if (failed) await audit(ctx.store, { actor: "system", action: "cron.evening", target: "mentor", detail: "mentor failed", outcome: "error" });
  return NextResponse.json({ ok: !failed, resumes, mentor: "missing" in res ? res.missing : `${res.insights.length} insights` });
}
