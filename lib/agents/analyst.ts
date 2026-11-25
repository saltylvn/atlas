import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCallWithin } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import type { Usage } from "@/lib/ai/models";
import { marketTask, MarketOut } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing, StandardReport } from "@/lib/domain/chiefOfStaff";
import { addDays } from "@/lib/domain/dates";
import { AFTER_SPECIALIST_MS, aiCap, modelWait } from "@/lib/domain/deadline";
import { MARKET_KEEP_DAYS, MARKET_WINDOW_DAYS, marketReport, numbersGrounded, rulesSummary, type MarketSummary, type StoredMarketReport } from "@/lib/domain/market";
import { skillEvidence, isShown } from "@/lib/domain/portfolio";
import { outlookToStore, roleOutlook } from "@/lib/domain/roleOutlook";
import { extractSkills } from "@/lib/domain/skills";
import { skillSnapshot } from "@/lib/domain/skillStats";
import { candidatesBeyond } from "@/lib/domain/targetRoles";
import type { AgentRunEvent } from "@/lib/domain/types";
import { careerPrefs } from "./career";
import { isPaused, logRun, NO_MODEL } from "./log";
import { runGapCoach } from "./gapCoach";
import { judgeTitles } from "./lensJudge";
import { tracer } from "./trace";

// The Analyst: stage 2 of the Career desk. Once a day it reads the Scout's postings and
// computes the market report: demand and pay for each of your roles, the skills asked
// for most, where you fit best and your gaps. Facts from data, prose from AI: the model
// may word the report, and its wording is used only if every number in it is one the
// rules computed. Otherwise the rules' own wording is shown. It writes market_reports
// and, from Step 3, the proof project in Settings and lessons in agent memory (lib/agents/gapCoach.ts).

export const ANALYST_TASK = "Daily market report";

export interface AnalystResult {
  report: StandardReport;
  stored: StoredMarketReport;
}

export interface AnalystOptions {
  trigger: AgentRunEvent["trigger"];
  honorPause: boolean;
  persist: Store;
  /** Reuse today's report when there is one (scheduled runs). Run Now always recomputes. */
  reuseToday?: boolean;
}

export async function runAnalyst(ctx: Context, opts: AnalystOptions): Promise<AnalystResult | AgentMissing> {
  const agent = "analyst" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task: ANALYST_TASK, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }
  const toReport = (s: StoredMarketReport): StandardReport => ({ agent, headline: s.summary.headline, details: [...s.summary.points, s.summary.focus], needsApproval: [], errors: [] });
  if (opts.reuseToday) {
    const latest = await ctx.store.market.latestReport().catch(() => null);
    if (latest?.forDate === ctx.today) return { report: toReport(latest), stored: latest };
  }
  await logRun(ctx, { runId, agent, task: ANALYST_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  let usage: Usage | null = null;
  try {
    const prefs = careerPrefs(ctx.settings);
    const postings = await t.step("Read the Scout's postings", () => ctx.store.market.since(addDays(ctx.today, -MARKET_KEEP_DAYS)), (p) => `${p.length} postings on record`);
    const report = marketReport(postings, prefs.roles, ctx.settings.careerSkills ?? [], ctx.today, prefs.minSalary);
    t.note("Compute demand, pay, fit and gaps", `${report.total} postings in ${report.windowDays} days; best fit ${report.bestFit?.role ?? "not enough data"}; ${report.gaps.length} gaps`);

    // For the Mentor: how qualified you are for each role, your own and the ones next to
    // them, measured against what you can show (GitHub projects and resumes), not only
    // what you ticked. Arithmetic over the Scout's rows; a missing source narrows it.
    const [repos, resumeRows, applications] = await Promise.all([
      ctx.store.portfolio.list().catch(() => []),
      ctx.store.knowledge.bySource("resume", 200).catch(() => []),
      ctx.store.applications.list().catch(() => []),
    ]);
    const evidence = skillEvidence(repos, extractSkills(resumeRows.map((r) => r.content).join("\n")), ctx.settings.careerSkills ?? []);
    const outlook = roleOutlook(postings, prefs.roles, candidatesBeyond(prefs.roles), evidence, applications, ctx.today, prefs.minSalary);
    report.outlook = outlookToStore(outlook);
    report.evidence = { projects: repos.length, skillsShown: [...evidence.values()].filter(isShown).length };
    t.note("Measure each role against your projects and resumes", `${repos.length} GitHub projects, ${report.evidence.skillsShown} skills shown; ${outlook.filter((o) => !o.thin).length} of ${outlook.length} roles have enough postings to judge`);

    // Step 3: what your applications say, your top role's gaps and one proof project, and
    // lessons for the Career Mentor. The funnel's findings join the facts the report is worded from.
    const coach = await runGapCoach(ctx, t, persist, { postings: postings.filter((p) => p.lastSeen >= addDays(ctx.today, -MARKET_WINDOW_DAYS)), repos, evidence, applications, topRole: prefs.roles[0]?.name ?? "" });
    const told = coach.findings.filter((f) => f.id !== "none-sent").map((f) => f.text);
    report.funnel = told;
    report.facts = [...report.facts, ...told.map((x) => `Your applications: ${x}`)];

    let summary: MarketSummary = rulesSummary(report);
    if (report.total > 0) {
      // Inside a brief, the wait is cut to the time the run has left.
      const wait = modelWait(aiCap(ctx, 18_000), ctx.deadline, Date.now(), AFTER_SPECIALIST_MS);
      const gate = await takeAiCallWithin(ctx.store, ctx.settings, "market-report", wait);
      if (!gate.allowed) t.note("Word the report", `rules wording: ${gate.why}`);
      else {
        const res = await t.step("Word the report", () => structuredWithin(wait, MarketOut, marketTask(), JSON.stringify({ facts: report.facts })), (r) => (r.ok ? `worded by ${aiName()}` : `rules wording (${whyNoAnswer(r)})`));
        usage = res.usage ?? null;
        if (res.ok) {
          // The model may word the facts. It may not add a figure.
          if (numbersGrounded([res.value.headline, ...res.value.points, res.value.focus], report.facts)) summary = { ...res.value, writer: "model" };
          else t.note("Check the wording against the numbers", "a figure was not in the report: the rules' wording is shown", false);
        }
      }
    }
    const stored = await t.step("Save the report", () => persist.market.saveReport({ forDate: ctx.today, report, summary }));
    // The day's skill counts per role, logged so Target Roles can average them over weeks.
    // A failure here is recorded on the run and does not undo the report.
    try {
      const since = addDays(ctx.today, -MARKET_WINDOW_DAYS);
      const searches = await ctx.store.jobMatches.since(since).catch(() => []);
      const rows = skillSnapshot({ boards: postings.filter((p) => p.lastSeen >= since), searches, roles: prefs.roles.map((r) => r.name), day: ctx.today, windowDays: MARKET_WINDOW_DAYS });
      await persist.roleSkills.save(rows);
      t.note("Log the skills each role asks for", rows.map((r) => `${r.role} ${r.postings}`).join(", "));
    } catch (err) {
      t.note("Log the skills each role asks for", `not saved: ${(err as Error).message?.slice(0, 160) ?? "unknown error"}`, false);
    }
    // Six roles, part 3: once a day, Gemini sorts the job titles the rules could not place.
    // A failure is recorded on the run and does not undo the report.
    await judgeTitles(ctx, t, persist).catch((err: Error) => t.note("Sort unclear job titles into your six roles", `not saved: ${err.message?.slice(0, 160) ?? "unknown error"}`, false));
    await logRun(ctx, {
      runId,
      agent,
      task: ANALYST_TASK,
      status: "succeeded",
      trigger,
      detail: `${report.total} postings, best fit ${report.bestFit?.role ?? "unknown"}, ${report.gaps.length} gaps, worded by ${summary.writer === "model" ? aiName() : "rules"}`,
      ...(usage ? { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } : NO_MODEL),
      ...t.finish(),
    });
    return { report: toReport(stored), stored };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: ANALYST_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
