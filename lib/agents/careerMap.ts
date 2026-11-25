import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCallPaced } from "@/lib/ai/budget";
import { AFTER_WORDING_MS } from "@/lib/domain/deadline";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import { careerStepsData, careerStepsTask } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { OEWS_FOR_TYPE, oewsId } from "@/lib/domain/benchmarks";
import { buildCareerMap, CareerStepsOut, checkSteps, MAP_DAYS, pathFacts, RUNG_LABEL, type CareerMap } from "@/lib/domain/careerMap";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { pipelineConfig } from "@/lib/domain/dataPipeline";
import { addDays } from "@/lib/domain/dates";
import { ENG_TYPES, type EngType } from "@/lib/domain/engTypes";
import { familyOf, type Family } from "@/lib/domain/techMarket";
import type { AgentRunEvent } from "@/lib/domain/types";
import { careerPrefs } from "./career";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Career Map: a weekly job of the Career Mentor bot (Monday's evening run, or Update now).
//   1. facts   rules build the map from the last 60 days of tech postings: for each engineering
//              type, its three most common specialties, each a ladder of rungs with pay, years,
//              skills, certifications and employers (lib/domain/careerMap.ts)
//   2. steps   the model (Gemini, free tier) writes the steps up each path, one call per type
//   3. check   a step that writes a number not in the facts, or a link, is dropped; the rules'
//              step for that move stands
// Display-only: it saves the week's snapshot (career_maps) and changes nothing else. The model
// sees counts, pay, skill names and certification names, never posting text.

export const CAREER_MAP_TASK = "Mentor: career map";
const MODEL_WAIT_MS = 25_000;

/** The official median pay (BLS OEWS) for the occupation closest to each type, from stored benchmarks. */
async function govPay(store: Store, today: string): Promise<Partial<Record<EngType, CareerMap["types"][number]["gov"]>>> {
  const points = await store.benchmarks.since(addDays(today, -1100)).catch(() => []);
  const latest = (id: string) => points.filter((p) => p.seriesId === id).sort((a, b) => b.period.localeCompare(a.period))[0] ?? null;
  return Object.fromEntries(
    ENG_TYPES.map((t) => {
      const { occupation, code } = OEWS_FOR_TYPE[t];
      const us = latest(oewsId(code, false));
      const ut = latest(oewsId(code, true));
      return [t, us || ut ? { occupation, us: us?.value ?? null, utah: ut?.value ?? null, year: (us ?? ut)!.period.slice(0, 4) } : null];
    }),
  );
}

export async function runCareerMap(ctx: Context, opts: { trigger: AgentRunEvent["trigger"]; persist: Store }): Promise<{ map: CareerMap; headline: string } | AgentMissing> {
  const agent = "mentor" as const;
  const runId = randomUUID();
  if (await isPaused(ctx, agent)) {
    await logRun(ctx, { runId, agent, task: CAREER_MAP_TASK, status: "skipped", trigger: opts.trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "the Career Mentor is paused in Mission Control" };
  }
  await logRun(ctx, { runId, agent, task: CAREER_MAP_TASK, status: "started", trigger: opts.trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const [postings, gov] = await Promise.all([ctx.store.techMarket.since(addDays(ctx.today, -MAP_DAYS)), govPay(ctx.store, ctx.today)]);
    const yourFamilies = new Set(careerPrefs(ctx.settings).roles.flatMap((r) => [r.name, ...r.titles].map(familyOf).filter((f): f is Family => f !== null)));
    const map = buildCareerMap({ postings, day: ctx.today, now: ctx.now.toISOString(), yourFamilies, companyCap: pipelineConfig(ctx.settings.dataPipeline).companyCap, gov });
    const paths = map.types.reduce((n, ty) => n + ty.paths.length, 0);
    t.note("Facts", `${map.jobs} jobs over ${MAP_DAYS} days; ${paths} paths across 5 types`, map.jobs > 0);
    if (map.jobs === 0) {
      await logRun(ctx, { runId, agent, task: CAREER_MAP_TASK, status: "skipped", trigger: opts.trigger, detail: "No tech postings stored yet", ...NO_MODEL, ...t.finish() });
      return { missing: "skipped", why: "no tech postings stored yet; the Scout records them at each 2-hour sync" };
    }

    // One model call per type. A type the model cannot do keeps the rules' steps.
    let modelTypes = 0;
    let dropped = 0;
    let why = "";
    for (const ty of map.types) {
      if (!ty.paths.length) continue;
      // The evening run's agents share the per-minute AI limit; a scheduled run waits for the minute to turn.
      const gate = await takeAiCallPaced(ctx, "career-map", MODEL_WAIT_MS + AFTER_WORDING_MS);
      if (gate.waitedMs > 0) t.note(`Wait for the AI limit (${ty.label})`, `waited ${Math.round(gate.waitedMs / 1000)} s for the per-minute AI limit`, gate.allowed);
      if (!gate.allowed) {
        why = gate.why;
        break;
      }
      const facts = pathFacts(ty);
      const moves = ty.paths.map((p) => ({ id: p.id, name: p.name, moves: p.steps.filter((s) => p.rungs.find((r) => r.level === s.to)!.jobs > 0).map((s) => `${RUNG_LABEL[s.from]} to ${RUNG_LABEL[s.to]}`) }));
      const res = await t.step(
        `Steps for ${ty.label}`,
        () => structuredWithin(MODEL_WAIT_MS, CareerStepsOut, careerStepsTask(ty.label), careerStepsData(facts, moves)),
        (r) => (r.ok ? `${aiName()} wrote steps for ${r.value.paths.length} paths` : whyNoAnswer(r)),
      );
      if (!res.ok) {
        why = whyNoAnswer(res);
        continue;
      }
      let usedModel = false;
      ty.paths = ty.paths.map((p) => {
        const drafted = res.value.paths.find((x) => x.id === p.id);
        if (!drafted) return p;
        const checked = checkSteps(p, drafted.steps, facts);
        dropped += checked.dropped;
        if (checked.steps.some((s) => s.writer === "model")) usedModel = true;
        return { ...p, steps: checked.steps };
      });
      if (usedModel) modelTypes++;
    }
    map.writer = modelTypes === 0 ? "rules" : modelTypes === map.types.filter((ty) => ty.paths.length).length ? "model" : "mixed";
    t.note("Check every number against the facts", `${dropped} steps dropped; rules' steps stand where the model's did not pass`, true);

    await t.step("Save this week's map", () => opts.persist.careerMaps.save(map.week, map), () => `week of ${map.week}`);
    const headline = `Career map for the week of ${map.week}: ${paths} paths from ${map.jobs.toLocaleString()} jobs, steps by ${map.writer === "rules" ? "rules" : aiName()}${map.writer === "mixed" ? " and rules" : ""}${why && map.writer !== "model" ? ` (${why})` : ""}`;
    await logRun(ctx, { runId, agent, task: CAREER_MAP_TASK, status: "succeeded", trigger: opts.trigger, detail: headline.slice(0, 300), ...NO_MODEL, ...t.finish() });
    return { map, headline };
  } catch (err) {
    const w = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: CAREER_MAP_TASK, status: "failed", trigger: opts.trigger, detail: w, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why: w };
  }
}
