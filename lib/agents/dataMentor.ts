import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCall } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import { dataMentorData, dataMentorTask } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { addDays } from "@/lib/domain/dates";
import { checkAdvice, mentorFacts, MentorOut, pipelineConfig, rulesAdvice, setupSteps, type MentorReview, type SetupInput, type StepId } from "@/lib/domain/dataPipeline";
import { env } from "@/lib/env";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Data Mentor: a job of the Career Mentor bot. On the Data Pipeline page, "Review my pipeline" or
// "Ask about this step" runs it once. An evaluator loop:
//   1. draft    the model writes up to 4 pieces of advice from the pipeline's facts
//   2. critique rules keep advice that cites known facts and writes no number they lack
//   3. refine   when the check dropped anything, one more model call with the problems listed
// When the model is off, over its daily limit, slow or wrong, the rules write the advice.
// Display-only: the review is saved for the page and changes no setting.

export const DATA_MENTOR_TASK = "Data mentor review";
const MODEL_WAIT_MS = 20_000;

/** What the mentor reads: settings, the watchlist size, the latest run's quality, keys set, and counts. Numbers only. */
export async function mentorInput(ctx: Context): Promise<SetupInput & { sources: { name: string; read: number; tech: number; withPay: number }[]; stored: number; historyDays: number }> {
  const [watches, quality, size] = await Promise.all([
    ctx.store.watches.list().catch(() => []),
    ctx.store.techMarket.quality(addDays(ctx.today, -14)).catch(() => []),
    ctx.store.techMarket.size().catch(() => ({ postings: 0, days: 0 })),
  ]);
  const latest = [...quality].sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
  const keys = env();
  return {
    config: pipelineConfig(ctx.settings.dataPipeline),
    watchCount: watches.length,
    quality: latest,
    keys: { bls: Boolean(keys.BLS_API_KEY), fred: Boolean(keys.FRED_API_KEY), adzuna: Boolean(keys.ADZUNA_APP_ID && keys.ADZUNA_APP_KEY) },
    sources: (latest?.sources ?? []).map((s) => ({ name: s.source, read: s.read, tech: s.tech, withPay: s.withPay })),
    stored: size.postings,
    historyDays: size.days,
  };
}

export async function runDataMentor(ctx: Context, opts: { focus: StepId | null; trigger: "owner" | "run-now" }): Promise<{ review: MentorReview; headline: string } | AgentMissing> {
  const agent = "mentor" as const;
  const runId = randomUUID();
  if (await isPaused(ctx, agent)) {
    await logRun(ctx, { runId, agent, task: DATA_MENTOR_TASK, status: "skipped", trigger: opts.trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "the Career Mentor is paused in Mission Control" };
  }
  await logRun(ctx, { runId, agent, task: DATA_MENTOR_TASK, status: "started", trigger: opts.trigger, detail: opts.focus ?? "", ...NO_MODEL });
  const t = tracer();
  try {
    const input = await t.step("Read the pipeline's numbers", () => mentorInput(ctx), (i) => `${i.watchCount} companies watched, ${i.quality?.recorded ?? 0} postings in the last run`);
    const steps = setupSteps(input);
    const facts = mentorFacts(input);
    const rules = rulesAdvice(input, facts).filter((a) => !opts.focus || a.step === opts.focus);
    let review: MentorReview = { at: ctx.now.toISOString(), writer: "rules", focus: opts.focus, advice: rules, dropped: 0 };

    const draft = async (critique: string[]) => {
      const gate = await takeAiCall(ctx.store, ctx.settings, "data-mentor");
      if (!gate.allowed) return { ok: false as const, why: gate.why };
      const res = await structuredWithin(MODEL_WAIT_MS, MentorOut, dataMentorTask(opts.focus), dataMentorData(facts, steps, critique));
      return res.ok ? { ok: true as const, advice: res.value.advice } : { ok: false as const, why: whyNoAnswer(res) };
    };

    const first = await t.step("Draft advice", () => draft([]), (r) => (r.ok ? `${aiName()} drafted ${r.advice.length}` : `rules advice (${r.why})`));
    if (first.ok) {
      let checked = checkAdvice(first.advice, facts);
      t.note("Check every number against the facts", `${checked.kept.length} kept, ${checked.dropped.length} dropped`, checked.dropped.length === 0);
      let dropped = checked.dropped.length;
      if (checked.dropped.length > 0) {
        const problems = checked.dropped.map((a) => `"${a.title}": cites a fact that is not in the list, or writes a number its cited facts do not contain.`);
        const second = await t.step("Refine what the check dropped", () => draft(problems), (r) => (r.ok ? `${aiName()} revised ${r.advice.length}` : `kept the first draft's passing advice (${r.why})`));
        if (second.ok) {
          const again = checkAdvice(second.advice, facts);
          if (again.kept.length >= checked.kept.length) {
            checked = again;
            dropped = again.dropped.length;
          }
        }
      }
      const kept = checked.kept.filter((a) => !opts.focus || !a.step || a.step === opts.focus);
      if (kept.length > 0) review = { ...review, writer: "model", advice: kept.slice(0, 4), dropped };
    }

    // Saved on your settings, so the page shows the last review. The rest of the settings is untouched.
    const config = pipelineConfig(ctx.settings.dataPipeline);
    await t.step("Save the review", () => ctx.store.settings.update({ dataPipeline: { ...config, review } }), () => `${review.advice.length} pieces of advice`);
    const headline = review.advice.length ? `${review.advice.length} pieces of advice (${review.writer === "model" ? aiName() : "rules"}): ${review.advice[0]!.title}` : "Nothing to change: the pipeline meets every floor.";
    await logRun(ctx, { runId, agent, task: DATA_MENTOR_TASK, status: "succeeded", trigger: opts.trigger, detail: headline.slice(0, 300), ...NO_MODEL, ...t.finish() });
    return { review, headline };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: DATA_MENTOR_TASK, status: "failed", trigger: opts.trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
