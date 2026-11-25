import "server-only";
import { takeAiCallWithin } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import { lensJudgeTask, LensJudgeOut } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { addDays } from "@/lib/domain/dates";
import { lensJudgments, mergeJudgments, titlesToJudge } from "@/lib/domain/roleLens";
import type { Tracer } from "./trace";

// Six roles, part 3 (24 Nov 2026): once a day, Gemini sorts up to 40 job titles the title rules
// could not place into your six roles or Other. Rules pick the titles (common first, only in
// families that could be one of your roles); the model answers from a fixed list; an answer for a
// title it was not asked about is ignored. Answers are kept per bare title in Settings, so each
// title costs one judgment ever. One AI call a day at most; with no model, Other stays Other.
// A workflow step run by the Analyst, not an agent.

const WAIT_MS = 15_000;

export async function judgeTitles(ctx: Context, t: Tracer, persist: Store): Promise<void> {
  const prev = lensJudgments(ctx.settings.lensJudged);
  if (prev.day === ctx.today) return t.note("Sort unclear job titles into your six roles", "already done today");
  const postings = await ctx.store.techMarket.since(addDays(ctx.today, -29)).catch(() => []);
  const asked = titlesToJudge(postings, prev.titles);
  if (!asked.length) return t.note("Sort unclear job titles into your six roles", "no unplaced titles to judge");
  const gate = await takeAiCallWithin(ctx.store, ctx.settings, "lens-judge", WAIT_MS);
  if (!gate.allowed) return t.note("Sort unclear job titles into your six roles", `left in Other: ${gate.why}`);
  const res = await t.step("Sort unclear job titles into your six roles", () => structuredWithin(WAIT_MS, LensJudgeOut, lensJudgeTask(), JSON.stringify({ titles: asked })), (r) => (r.ok ? `${aiName()} sorted ${r.value.titles.length} of ${asked.length}` : `left in Other (${whyNoAnswer(r)})`));
  if (!res.ok) return;
  const next = mergeJudgments(prev, asked, res.value.titles, ctx.today);
  const placed = res.value.titles.filter((a) => a.lens !== "other").length;
  await persist.settings.update({ lensJudged: next });
  t.note("Keep the judgments", `${Object.keys(next.titles).length - Object.keys(prev.titles).length} new, ${placed} placed in one of your roles`);
}
