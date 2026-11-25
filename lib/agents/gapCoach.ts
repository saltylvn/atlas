import "server-only";
import { takeAiCallWithin } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import { proofTask, ProofBriefOut } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { addDays } from "@/lib/domain/dates";
import { assign, briefOk, lessonCandidates, lessonsToSave, nextProof, proofPlan, rankGaps, rulesBrief, type RankedGap } from "@/lib/domain/gapPlan";
import type { MarketPosting } from "@/lib/domain/market";
import { findings, funnel, type Finding } from "@/lib/domain/outcomes";
import type { PortfolioRepo, SkillEvidence } from "@/lib/domain/portfolio";
import type { Application } from "@/lib/domain/types";
import type { Tracer } from "./trace";

// Step 3 of the agent plan, run by the Analyst once a day (lib/agents/analyst.ts):
//  1. the funnel's findings, for the report and for memory;
//  2. your top role's gaps, ranked, and one proof project at a time (closed when GitHub shows it);
//  3. lessons: funnel findings and your Action Taken notes, kept while results confirm them.
// A workflow with one judged step (the brief), not an agent: the order is fixed.
// Each part fails on its own and is recorded on the trace; none fails the Analyst's run.

const BRIEF_WAIT_MS = 12_000;

export interface GapCoachInput {
  postings: readonly MarketPosting[];
  repos: readonly PortfolioRepo[];
  evidence: ReadonlyMap<string, SkillEvidence>;
  applications: readonly Application[];
  topRole: string;
}

export interface GapCoachResult {
  findings: Finding[];
  gaps: RankedGap[];
}

async function briefFor(ctx: Context, t: Tracer, gap: RankedGap, role: string, repos: readonly PortfolioRepo[]): Promise<{ text: string; writer: "model" | "rules" }> {
  const rules = { text: rulesBrief(gap.skill, role), writer: "rules" as const };
  const gate = await takeAiCallWithin(ctx.store, ctx.settings, "proof-brief", BRIEF_WAIT_MS);
  if (!gate.allowed) {
    t.note("Write the proof project brief", `rules brief: ${gate.why}`);
    return rules;
  }
  const data = JSON.stringify({ skill: gap.skill, role, askedIn: `${Math.round(gap.share * 100)}% of ${gap.postings} postings`, theirProjects: repos.slice(0, 6).map((r) => ({ name: r.name, skills: r.skills.slice(0, 8) })) });
  const res = await t.step("Write the proof project brief", () => structuredWithin(BRIEF_WAIT_MS, ProofBriefOut, proofTask(), data), (r) => (r.ok ? `written by ${aiName()}` : `rules brief (${whyNoAnswer(r)})`));
  if (res.ok && briefOk(res.value.brief, gap.skill)) return { text: res.value.brief.trim(), writer: "model" };
  if (res.ok) t.note("Check the brief", "it did not name the skill, ran long or had a link: the rules' brief is used", false);
  return rules;
}

export async function runGapCoach(ctx: Context, t: Tracer, persist: Store, input: GapCoachInput): Promise<GapCoachResult> {
  const found = findings(funnel([...input.applications], ctx.today));
  t.note("Read the funnel", found.map((f) => f.id).join(", ") || "nothing to say yet");

  const gaps = rankGaps(input.postings, input.topRole, input.evidence);
  t.note("Rank your gaps", gaps.length ? `${input.topRole}: ${gaps.map((g) => `${g.skill} ${Math.round(g.share * 100)}%`).join(", ")}` : `${input.topRole}: too few postings, or nothing missing`);

  try {
    const step = nextProof(proofPlan(ctx.settings.careerProof), gaps, input.repos, ctx.today);
    if (step.kind === "closed") {
      await persist.settings.update({ careerProof: step.plan });
      t.note("Check your proof project", `closed: ${step.closed.skill}, shown by ${step.closed.repo}`);
    } else if (step.kind === "assign") {
      const brief = await briefFor(ctx, t, step.gap, input.topRole, input.repos);
      await persist.settings.update({ careerProof: assign(step.plan, step.gap, input.topRole, brief, ctx.today) });
      t.note("Assign a proof project", `${step.gap.skill} (${Math.round(step.gap.share * 100)}% of postings), brief by ${brief.writer === "model" ? aiName() : "rules"}`);
    } else t.note("Check your proof project", step.kind === "keep" ? `${step.plan.current!.skill}: open, no repo shows it yet` : "no gap to assign");
  } catch (err) {
    t.note("Check your proof project", `not saved: ${(err as Error).message?.slice(0, 160) ?? "unknown error"}`, false);
  }

  try {
    const [existing, insights] = await Promise.all([persist.agentMemory.list("mentor"), ctx.store.mentor.since(addDays(ctx.today, -30)).catch(() => [])]);
    const { add, confirm } = lessonsToSave(existing, lessonCandidates(found, insights, ctx.today), ctx.today);
    for (const row of add) await persist.agentMemory.add(row);
    for (const c of confirm) await persist.agentMemory.confirm(c.id, c.expiresOn);
    t.note("Remember what your results say", `${add.length} new lessons, ${confirm.length} confirmed`);
  } catch (err) {
    t.note("Remember what your results say", `not saved: ${(err as Error).message?.slice(0, 160) ?? "unknown error"}`, false);
  }
  return { findings: found, gaps };
}
