import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { parseResearch } from "@/lib/domain/briefResearch";
import { readyJobs, RESEARCH_LIMITS, type ReadyJob } from "@/lib/domain/companyResearch";
import { addDays } from "@/lib/domain/dates";
import { maxYearsOf } from "@/lib/domain/levelPolicy";
import { parsePacket } from "@/lib/domain/pitch";
import { topFive } from "@/lib/domain/scoutFocus";
import type { AgentRunEvent } from "@/lib/domain/types";
import { env } from "@/lib/env";
import { sweepAboveLevel } from "@/lib/levelSweep";
import { runCompanyResearch } from "./companyResearch";
import { runWeeklyStrategist } from "./weeklyStrategist";
import { runFollowUp } from "./followUp";
import { FOLLOWUP_LIMITS, nightPicks } from "@/lib/domain/followUpAgent";
import { strategistDue } from "@/lib/domain/weeklyPlan";
import { isPaused, logRun, NO_MODEL } from "./log";
import { pitchRunId, runPitch } from "./pitch";
import { tracer } from "./trace";

// The night shift (24 Nov 2026): while you sleep, Atlas prepares the jobs you should apply to
// first. For each of today's top picks, in order, it runs the Researcher and then the
// Tailor, so you wake up to jobs that are researched and tailored.
//
// A workflow, not an agent: the order is fixed in code; the two agents it runs do the judging.
// It spends only what is left of the day's AI calls (the cap resets at midnight, so nothing is
// taken from tomorrow), stops before the function's time limit, and picks up where it left off
// at the next call (it is called a few times each night). Display-only: it writes research and
// tailoring inside Atlas and sends nothing.

export const NIGHT_TASK = "Night shift: prepare tomorrow's applications";
/** The hours on your clock when it may run. */
export const NIGHT_HOURS: readonly number[] = [22, 23];
/** Jobs it prepares in one night, at most. */
export const NIGHT_MAX_JOBS = 3;
/** One agent run needs about this long; a run is not started with less left. */
const RUN_MS = 100_000;

export interface NightResult {
  researched: string[];
  tailored: string[];
  /** Jobs above your level cleared from the Apply Queue and Good fits. */
  cleared: number;
  /** Sunday night: the Weekly Strategist proposed next week's plan. */
  planned: boolean;
  /** Waiting follow-ups the Nudger rewrote. */
  followUps: number;
  /** Why it stopped, in plain words. */
  stopped: string;
}

/** What is prepared for each of today's picks: read by the morning card, and by the night shift to skip what is done. */
export async function loadReady(ctx: Pick<Context, "store" | "settings" | "today">): Promise<ReadyJob[]> {
  const [kits, matches, perfect] = await Promise.all([ctx.store.approvals.list().catch(() => []), ctx.store.jobMatches.since(addDays(ctx.today, -60)).catch(() => []), ctx.store.jobMatches.perfect().catch(() => [])]);
  const pending = kits.filter((k) => k.kind === "application" && k.status === "pending");
  const picks = topFive(pending, matches, ctx.today, new Set(perfect.map((m) => m.id)), maxYearsOf(ctx.settings));
  if (picks.length === 0) return [];
  const [briefs, runs] = await Promise.all([ctx.store.applyBriefs.forKits(picks.map((p) => p.kitId)).catch(() => new Map<string, { data: unknown; researchedAt: string }>()), Promise.all(picks.map((p) => ctx.store.agentRunState.get(pitchRunId(p.kitId)).catch(() => null)))]);
  const researched = new Set(picks.filter((p) => parseResearch(briefs.get(p.kitId)?.data)?.by === "agent").map((p) => p.kitId));
  const pitched = new Map<string, { proven: number; of: number }>();
  picks.forEach((p, i) => {
    const packet = runs[i]?.status === "done" ? parsePacket(runs[i]!.state.answer) : null;
    if (packet) pitched.set(p.kitId, { proven: packet.map.filter((m) => m.status === "proven").length, of: packet.map.length });
  });
  return readyJobs(picks, researched, pitched);
}

export async function runNightShift(ctx: Context, opts: { trigger: AgentRunEvent["trigger"]; persist: Store; honorPause: boolean }): Promise<NightResult | AgentMissing> {
  const runId = randomUUID();
  const { persist, trigger } = opts;
  // The Applications bot's Pause stops the agents it runs, at night too.
  if (opts.honorPause && (await isPaused(ctx, "career"))) {
    await logRun(ctx, { runId, agent: "career", task: NIGHT_TASK, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }
  await logRun(ctx, { runId, agent: "career", task: NIGHT_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  const end = ctx.deadline ?? Date.now() + 240_000;
  const out: NightResult = { researched: [], tailored: [], cleared: 0, planned: false, followUps: 0, stopped: "" };
  try {
    // First, by rules: jobs above your level leave the Apply Queue and Good fits, so no agent spends a call on one.
    const swept = await t.step("Clear jobs above your level from the Apply Queue and Good fits", () => sweepAboveLevel(persist, ctx.settings, ctx.today, ctx.now, "system"), (s) => `${s.queue.length} from the queue, ${s.fits.length} from Good fits`);
    out.cleared = swept.queue.length + swept.fits.length;
    // Sunday night, once: the Weekly Strategist proposes next week's plan, waiting for your approval in the morning.
    if (strategistDue(ctx.settings.weeklyPlan, ctx.today) && end - Date.now() >= RUN_MS + 20_000) {
      const plan = await t.step("Plan next week (Planner)", () => runWeeklyStrategist(ctx, { persist, trigger: "schedule", deadline: Math.min(Date.now() + RUN_MS, end - 20_000) }), (r) => `${r.plan.moves.length} moves by ${r.writer}, waiting for your approval`);
      out.planned = !plan.kept;
    }
    const ready = await t.step("Find today's picks and what is already prepared", () => loadReady(ctx), (r) => `${r.length} picks; ${r.filter((j) => j.researched).length} researched, ${r.filter((j) => j.pitch).length} tailored`);
    const todo = ready.filter((j) => !j.researched || !j.pitch).slice(0, NIGHT_MAX_JOBS);
    if (ready.length === 0) out.stopped = "nothing is in the Apply Queue at your level";
    else if (todo.length === 0) out.stopped = "today's picks are already prepared";
    const kits = todo.length ? await persist.approvals.list() : [];
    for (const job of todo) {
      const left = async () => env().ATLAS_AI_DAILY_LIMIT - (await ctx.store.aiUsage.countToday().catch(() => env().ATLAS_AI_DAILY_LIMIT));
      if ((await left()) < RESEARCH_LIMITS.calls) {
        out.stopped = "today's AI calls are used up; the rest wait for tomorrow night";
        break;
      }
      if (end - Date.now() < RUN_MS + 20_000) {
        out.stopped = "out of time this run; the next run tonight carries on";
        break;
      }
      const kit = kits.find((k) => k.id === job.kitId);
      const match = kit?.matchId ? await persist.jobMatches.get(kit.matchId).catch(() => null) : null;
      if (!kit) continue;
      if (!job.researched && match) {
        const r = await t.step(`Research ${match.company}`, () => runCompanyResearch(ctx, { kit, match }, { persist, trigger: "schedule", deadline: Math.min(Date.now() + RUN_MS, end - 20_000) }), (x) => `by ${x.writer}${x.research?.about?.length ? `, ${x.research.about.length} lines on what it does` : ""}`);
        if (r.writer === "model") out.researched.push(match.company);
      }
      if (!job.pitch && end - Date.now() >= RUN_MS + 20_000 && (await left()) >= 6) {
        const p = await t.step(`Tailor ${job.title}`, () => runPitch(ctx, { kit, match }, { persist, deadline: Math.min(Date.now() + RUN_MS, end - 20_000) }), (x) => (x.packet ? `${x.packet.map.filter((m) => m.status === "proven").length} of ${x.packet.map.length} must-haves proven, by ${x.writer}` : x.why));
        if (p.packet && p.writer === "model") out.tailored.push(job.title);
      }
    }
    // Then the follow-ups waiting in your Apply Queue: the agent rewrites the oldest, two a night.
    if (!out.stopped || out.stopped === "today's picks are already prepared" || out.stopped === "nothing is in the Apply Queue at your level") {
      const written = new Set((await persist.agentRunState.recent("followup", 100).catch(() => [])).map((r) => r.runId.replace(/^followup:/, "")));
      const approvals = await persist.approvals.list().catch(() => []);
      for (const approvalId of nightPicks(approvals, written)) {
        const left = env().ATLAS_AI_DAILY_LIMIT - (await ctx.store.aiUsage.countToday().catch(() => env().ATLAS_AI_DAILY_LIMIT));
        if (left < FOLLOWUP_LIMITS.calls || end - Date.now() < RUN_MS + 20_000) break;
        const approval = approvals.find((a) => a.id === approvalId)!;
        const app = approval.applicationId ? await persist.applications.get(approval.applicationId).catch(() => null) : null;
        if (!app) continue;
        const r = await t.step(`Rewrite the follow-up to ${app.company}`, () => runFollowUp(ctx, { approval, app }, { persist, trigger: "schedule", deadline: Math.min(Date.now() + RUN_MS, end - 20_000) }), (x) => `by ${x.writer}${x.person ? `, to ${x.person.split(" ")[0]}` : ""}`);
        if (r.writer === "model") out.followUps++;
      }
    }
    if (!out.stopped) out.stopped = "done";
    const detail = `${out.cleared} above your level cleared, ${out.planned ? "next week planned, " : ""}${out.researched.length} researched, ${out.tailored.length} tailored, ${out.followUps} follow-ups rewritten: ${out.stopped}`;
    await logRun(ctx, { runId, agent: "career", task: NIGHT_TASK, status: "succeeded", trigger, detail, ...NO_MODEL, ...t.finish() });
    return out;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent: "career", task: NIGHT_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
