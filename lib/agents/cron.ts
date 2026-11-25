import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import type { Context } from "@/lib/context";
import { isSyncDay, scheduledSlot } from "@/lib/domain/briefSchedule";
import { addDays, localDate, localTime, zonedToUtc } from "@/lib/domain/dates";
import { SCHEDULED_LIMIT_MS } from "@/lib/domain/deadline";
import { sendToAll } from "@/lib/push";
import { env, mode } from "@/lib/env";
import { ownerServiceStore, ownerUserId, serviceReady } from "@/lib/owner";
import { syncNotion } from "@/lib/connections/notion";
import { bearerMatches } from "@/lib/security/bearer";
import { noteRefusedToken } from "@/lib/security/refusedToken";
import { runChiefOfStaff } from "./chiefOfStaff";
import { runQa } from "./qa";
import { NIGHT_HOURS, runNightShift } from "./nightShift";
import { logEvalRun } from "./evals";
import { logRun } from "./log";
import { MENTOR_TASK, runMentor } from "./mentor";
import { isResumeSyncDay, weeklyResumeNotice } from "@/lib/domain/resumeSync";
import { RESUME_SYNC_TASK, resumeSyncReady, runResumeSync } from "./resumeSync";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { isProfileDay } from "@/lib/domain/roleProfile";
import { ROLE_PROFILES_TASK, runRoleProfiles } from "./roleProfiles";
import { runRoleDescriptions } from "./roleDescriptions";
import { BENCHMARK_TASK, runBenchmarks } from "./benchmarks";
import { runTypeCheck, TYPE_CHECK_TASK } from "./typeCheck";
import { CAREER_MAP_TASK, runCareerMap } from "./careerMap";

// The scheduler. Vercel Cron calls /api/cron/morning and /api/cron/afternoon with
// `Authorization: Bearer $CRON_SECRET`, early enough that each brief is ready by
// 9:00 AM and 2:00 PM Mountain time. Weekend Mode and pause switches are applied here.
// A call with a missing or wrong token answers 401 and is counted for the audit trail.

export async function handleCron(request: NextRequest, wanted: "morning" | "afternoon" | "evening" | "qa" | "night"): Promise<NextResponse> {
  if (!bearerMatches(request.headers.get("authorization"), env().CRON_SECRET)) {
    noteRefusedToken(`/api/cron/${wanted}`, request.headers.get("authorization"));
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
  if (wanted === "night") {
    // The night shift: only in its hours on your clock (the scheduler calls in the UTC hours for both sides of daylight saving).
    if (!NIGHT_HOURS.includes(Number(ctx.time.slice(0, 2)))) return NextResponse.json({ ok: true, skipped: "not the night hours" });
    const res = await runNightShift(ctx, { trigger: "schedule", persist: store, honorPause: true });
    const failed = "missing" in res && res.missing === "failed";
    await audit(store, { actor: "system", action: "cron.night", target: "night-shift", detail: "missing" in res ? res.missing : `${res.researched.length} researched, ${res.tailored.length} tailored: ${res.stopped}`.slice(0, 200), outcome: failed ? "error" : "success" });
    return NextResponse.json({ ok: !failed, night: "missing" in res ? res.missing : res.stopped });
  }
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

/** The Career Mentor's evening hours on the owner's clock. The scheduler's timing is approximate, so any of them counts. */
export const EVENING_HOURS: readonly number[] = [17, 18, 19];

/**
 * The evening run, Monday to Saturday, once, about 6 PM: first the Applications Agent's
 * resume sync (Figma to Notion), then the Career Mentor's evening review, so the Career Mentor sees
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
  // Once a week, on Monday: Figma's free plan allows only a handful of file reads a month.
  if (resumeSyncReady() && !isResumeSyncDay(ctx.today)) resumes = "runs on Mondays";
  else if (resumeSyncReady() && !ranToday(RESUME_SYNC_TASK)) {
    const res = await runResumeSync(ctx, { trigger: "schedule", honorPause: true, persist: ctx.store });
    resumes = "missing" in res ? res.missing : res.headline;
    if ("missing" in res && res.missing === "failed") await audit(ctx.store, { actor: "system", action: "cron.evening", target: "resume-sync", detail: "resume sync failed", outcome: "error" });
    // Every Monday you are told how the weekly update went, changed or not.
    if (ctx.settings.outboundEnabled) await sendToAll(ctx.store, weeklyResumeNotice("missing" in res ? null : res.report, "missing" in res ? res.why : "")).catch(() => undefined);
  } else if (resumeSyncReady()) resumes = "already ran today";

  let mentor = "already ran today";
  let failed = false;
  if (!ranToday(MENTOR_TASK.evening)) {
    const res = await runMentor(ctx, "evening", { trigger: "schedule", honorPause: true, persist: ctx.store });
    failed = "missing" in res && res.missing === "failed";
    if (!("missing" in res) && res.insights.length > 0 && ctx.settings.outboundEnabled) {
      await sendToAll(ctx.store, { title: `Career Mentor: ${res.insights[0]!.title}`.slice(0, 120), body: "Your evening review is in Atlas.", url: "/growth" }).catch(() => undefined);
    }
    if (failed) await audit(ctx.store, { actor: "system", action: "cron.evening", target: "mentor", detail: "mentor failed", outcome: "error" });
    mentor = "missing" in res ? res.missing : `${res.insights.length} insights`;
  }

  // Once a week, on Monday, after the review: the Career Mentor describes your five roles for
  // the Target Roles page. It runs last, so it never takes the review's time, and a failure
  // here does not fail the evening run.
  let profiles = "runs on Mondays";
  if (isProfileDay(ctx.today)) {
    if (ranToday(ROLE_PROFILES_TASK)) profiles = "already ran today";
    else {
      const p = await runRoleProfiles(ctx, { trigger: "schedule", honorPause: true, persist: ctx.store }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" }));
      profiles = "missing" in p ? p.missing : p.headline;
      // Once a month, on the first Monday: what each role is about, from postings and a web search.
      const d = await runRoleDescriptions(ctx, { trigger: "schedule", honorPause: true, persist: ctx.store }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" }));
      profiles += ` ${"missing" in d ? `Descriptions: ${d.missing}.` : d.headline}`;
    }
  }
  // Once a week, on Monday (or any evening while none is stored yet): the national benchmarks.
  // Last, so a slow government API never takes the review's time; a failure here is logged and
  // does not fail the evening run.
  let benchmarks = "runs on Mondays";
  const stored = await ctx.store.benchmarks.since(addDays(ctx.today, -150)).catch(() => []);
  if (ranToday(BENCHMARK_TASK)) benchmarks = "already ran today";
  else if (isResumeSyncDay(ctx.today) || stored.length === 0) {
    const b = await runBenchmarks(ctx, { trigger: "schedule", honorPause: true, persist: ctx.store }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" }));
    benchmarks = "missing" in b ? b.missing : b.headline;
  }
  // Daily, last: an AI second opinion on 40 jobs' engineering-type labels (one model call, display-only).
  let typeCheck = "already ran today";
  if (!ranToday(TYPE_CHECK_TASK)) {
    const c = await runTypeCheck(ctx, { trigger: "schedule" }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" }));
    typeCheck = "missing" in c ? c.missing : c.headline;
  }
  // Weekly, on Monday (or any evening while none is stored): the Career Map, after the benchmarks
  // so its official pay figures are this week's. Five model calls at most; a failure is logged only.
  let careerMap = "runs on Mondays";
  if (ranToday(CAREER_MAP_TASK)) careerMap = "already ran today";
  else if (isResumeSyncDay(ctx.today) || (await ctx.store.careerMaps.latest(1).catch(() => [])).length === 0) {
    const m = await runCareerMap(ctx, { trigger: "schedule", persist: ctx.store }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" }));
    careerMap = "missing" in m ? m.missing : m.headline;
  }
  return NextResponse.json({ ok: !failed, resumes, mentor, profiles, benchmarks, typeCheck, careerMap });
}
