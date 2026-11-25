import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCall } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import { typeCheckData, typeCheckTask } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { pipelineConfig } from "@/lib/domain/dataPipeline";
import { ENG_TYPE_INFO, ENG_TYPES } from "@/lib/domain/engTypes";
import { activeInView } from "@/lib/domain/marketSnapshot";
import { addDays } from "@/lib/domain/dates";
import { CHECK_MIN, checkItems, checkSample, compareLabels, TypeCheckOut, type TypeCheck } from "@/lib/domain/typeCheck";
import type { AgentRunEvent } from "@/lib/domain/types";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The type check: a job of the Career Mentor bot. An AI second opinion on the rules' engineering-type
// labels, on a sample of 40 of this week's jobs, in one model call:
//   1. sample   an even share of each label, in a stable order for the day (rules)
//   2. judge    the model labels each title on its own, without seeing the rules' label
//   3. compare  agreement overall and per type, and where they differ (rules)
// Display-only: no label changes. With no model, over the daily AI limit, or a bad answer, it
// says why and keeps the last check. It sees only titles and company names.

export const TYPE_CHECK_TASK = "Engineering type check";
const MODEL_WAIT_MS = 25_000;

const LABELS = [
  ...ENG_TYPES.map((t) => ({ id: t, name: ENG_TYPE_INFO[t].label, what: ENG_TYPE_INFO[t].what })),
  { id: "product", name: "Product and program", what: "Product managers, program and project managers, product and UX design" },
  { id: "not-tech", name: "Not a tech job", what: "Business, sales, recruiting, operations, or engineering outside software (mechanical, civil)" },
];

export async function runTypeCheck(ctx: Context, opts: { trigger: AgentRunEvent["trigger"] }): Promise<{ check: TypeCheck; headline: string } | AgentMissing> {
  const agent = "mentor" as const;
  const runId = randomUUID();
  if (await isPaused(ctx, agent)) {
    await logRun(ctx, { runId, agent, task: TYPE_CHECK_TASK, status: "skipped", trigger: opts.trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "the Career Mentor is paused in Mission Control" };
  }
  await logRun(ctx, { runId, agent, task: TYPE_CHECK_TASK, status: "started", trigger: opts.trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  const stop = async (why: string, status: "skipped" | "failed"): Promise<AgentMissing> => {
    await logRun(ctx, { runId, agent, task: TYPE_CHECK_TASK, status, trigger: opts.trigger, detail: why.slice(0, 300), ...NO_MODEL, ...t.finish() });
    return { missing: status, why };
  };
  try {
    const postings = await ctx.store.techMarket.since(addDays(ctx.today, -7));
    const sample = checkSample(activeInView(postings, ctx.today, "all"), ctx.today);
    t.note("Pick the sample", `${sample.length} of this week's jobs, an even share of each label`, true);
    if (sample.length < CHECK_MIN) return await stop(`too few jobs to check (${sample.length}; needs ${CHECK_MIN})`, "skipped");

    const gate = await takeAiCall(ctx.store, ctx.settings, "type-check");
    if (!gate.allowed) return await stop(gate.why, "skipped");
    const res = await t.step(
      "Ask the AI to label each title",
      () => structuredWithin(MODEL_WAIT_MS, TypeCheckOut, typeCheckTask(LABELS), typeCheckData(checkItems(sample))),
      (r) => (r.ok ? `${aiName()} labeled ${r.value.items.length}` : whyNoAnswer(r)),
    );
    if (!res.ok) return await stop(`no answer from ${aiName()}: ${whyNoAnswer(res)}`, "failed");

    const check = compareLabels(sample, res.value, ctx.now.toISOString(), aiName());
    t.note("Compare with the rules", `${check.agree} of ${check.judged} agree; ${check.disagreements.length} differences listed`, check.judged > 0);
    // Saved on your settings beside the Data Mentor's review; nothing else changes.
    const config = pipelineConfig(ctx.settings.dataPipeline);
    await t.step("Save the check", () => ctx.store.settings.update({ dataPipeline: { ...config, typeCheck: check } }), () => "saved");
    const headline = check.judged ? `${aiName()} agreed with the rules on ${check.agree} of ${check.judged} jobs (${Math.round((check.agree / check.judged) * 100)}%)` : `${aiName()} labeled none of the ${check.sample} jobs`;
    await logRun(ctx, { runId, agent, task: TYPE_CHECK_TASK, status: "succeeded", trigger: opts.trigger, detail: headline, ...NO_MODEL, ...t.finish() });
    return { check, headline };
  } catch (err) {
    return stop((err as Error).message?.slice(0, 300) || "unknown error", "failed");
  }
}
