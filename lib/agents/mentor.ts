import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCallWithin } from "@/lib/ai/budget";
import { aiConfigured, aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import type { Usage } from "@/lib/ai/models";
import { mentorData, mentorTask, MentorOut } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { ANSWER_BANK } from "@/lib/domain/careerPrep";
import type { AgentMissing, StandardReport } from "@/lib/domain/chiefOfStaff";
import { addDays, longDate } from "@/lib/domain/dates";
import { AFTER_SPECIALIST_MS, aiCap, modelWait } from "@/lib/domain/deadline";
import { scrub, scrubPhones } from "@/lib/domain/knowledge";
import { resumeName } from "@/lib/domain/jobFit";
import { acceptInsights, eligible, mentorHeadline, MUST_SAY, observe, rulesInsights, WORTH_SAYING, type MentorInput, type MentorInsight, type MentorSlot, type NewInsight } from "@/lib/domain/mentor";
import { extractSkills } from "@/lib/domain/skills";
import type { AgentRunEvent, Settings } from "@/lib/domain/types";
import { careerPrefs } from "./career";
import { isPaused, logRun, NO_MODEL } from "./log";
import { runRolesReview } from "./mentorRoles";
import { tracer } from "./trace";

// The Mentor: stage 4 of the Career desk. Three times a day it gathers what the other
// agents and you have produced, lets the rules in lib/domain/mentor.ts turn that into
// observations, and asks the model one question: which of these matters most right now,
// and what should be done about it today? Whatever the model writes is checked against
// the observations before it is kept. With no model, the rules' own top observations
// are shown. It reads widely and writes one table, mentor_insights. It edits nothing.

/** How long a run waits for the model before using the rules' ranking. Runs share a 60-second request with other work. */
// Inside a brief or the evening run, the run's deadline still cuts this (modelWait).
const MODEL_WAIT_MS = 24_000;

export const MENTOR_TASK: Record<MentorSlot, string> = { morning: "Mentor: morning priority", midday: "Mentor: midday check", evening: "Mentor: evening review" };

/** Planned applications a day. The Mentor measures you against these. */
export function dailyPlan(s: Settings): { fullTime: number; gigs: number } {
  return { fullTime: s.careerDailyFullTime ?? 3, gigs: s.careerDailyGigs ?? 1 };
}

export interface MentorResult {
  report: StandardReport;
  insights: MentorInsight[];
  /** How many of this run's insights updated an older open one (a refresh only). */
  updated: number;
}

export interface MentorOptions {
  trigger: AgentRunEvent["trigger"];
  honorPause: boolean;
  persist: Store;
  /** A review you asked for with fresh data: may update what was said today (see `eligible`). */
  refresh?: boolean;
}

/** Everything the Mentor looks at. Each read fails on its own: a missing source narrows the review, it does not stop it. */
export async function mentorInput(ctx: Context, slot: MentorSlot): Promise<MentorInput> {
  const { store, settings, today } = ctx;
  const [applications, approvals, matches, market, resumeRows, prior] = await Promise.all([
    store.applications.list().catch(() => []),
    store.approvals.list().catch(() => []),
    store.jobMatches.since(addDays(today, -14)).catch(() => []),
    store.market.latestReport().catch(() => null),
    store.knowledge.bySource("resume", 200).catch(() => null),
    store.mentor.since(addDays(today, -14)).catch(() => []),
  ]);
  const saved = settings.careerAnswers ?? {};
  return {
    today,
    slot,
    roles: careerPrefs(settings).roles.map((r) => r.name),
    applications,
    approvals,
    matches,
    // A report older than three days describes a market that has moved on.
    market: market && market.forDate >= addDays(today, -3) ? market.report : null,
    skills: settings.careerSkills ?? [],
    resumes: resumeRows ? { names: [...new Set(resumeRows.map((r) => resumeName(r.title)))], skills: extractSkills(resumeRows.map((r) => r.content).join("\n")) } : null,
    answersWritten: ANSWER_BANK.filter((q) => (saved[q.id] ?? "").trim().length > 0).length,
    answersTotal: ANSWER_BANK.length,
    linkedin: settings.linkedinProfile ?? "",
    plan: dailyPlan(settings),
    prior,
  };
}

const goalOf = (ctx: Context, input: MentorInput) =>
  `A full-time engineering role${(ctx.settings.careerMinSalary ?? 0) > 0 ? ` paying at least $${Math.round((ctx.settings.careerMinSalary ?? 0) / 1000)}k a year` : ""}. Target roles in priority order: ${input.roles.slice(0, 5).join(", ")}. Side goal: freelance gigs to build a portfolio, about one application in five. Plan: ${input.plan.fullTime} full-time applications a day.`;

export async function runMentor(ctx: Context, slot: MentorSlot, opts: MentorOptions): Promise<MentorResult | AgentMissing> {
  const agent = "mentor" as const;
  const runId = randomUUID();
  const task = MENTOR_TASK[slot];
  const { trigger, persist } = opts;
  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }
  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  let usage: Usage | null = null;
  try {
    const input = await t.step("Gather your pipeline, the market report, resumes and profile", () => mentorInput(ctx, slot), (i) => `${i.applications.length} applications, ${i.matches.length} recent matches, market report ${i.market ? "current" : "missing or stale"}, ${i.resumes?.names.length ?? 0} resumes indexed, LinkedIn text ${i.linkedin ? "present" : "missing"}`);
    const observations = observe(input);
    const pool = eligible(input, observations, { refresh: opts.refresh, rejudge: opts.refresh && aiConfigured() && ctx.settings.aiEnabled && ctx.settings.outboundEnabled });
    const worth = pool.filter((o) => o.weight >= WORTH_SAYING);
    t.note("Observe, then set aside what was already said or dismissed", `${observations.length} observations, ${pool.length} not said before, ${worth.length} worth raising`);

    let insights: NewInsight[] = rulesInsights(input, pool);
    if (worth.length > 0) {
      // Inside a brief, the wait is cut to the time the run has left.
      const wait = modelWait(aiCap(ctx, MODEL_WAIT_MS), ctx.deadline, Date.now(), AFTER_SPECIALIST_MS);
      const gate = await takeAiCallWithin(ctx.store, ctx.settings, `mentor:${slot}`, wait);
      if (!gate.allowed) t.note("Judge what matters most", `rules ranking: ${gate.why}`);
      else {
        // The evening review may read your own words for a wording critique. Contact details are stripped first.
        const materials = slot === "evening" && input.linkedin ? [{ name: "LinkedIn profile text", text: scrubPhones(scrub(input.linkedin)).slice(0, 1500) }] : [];
        const recent = input.prior.slice(0, 6).map((i) => ({ date: i.forDate, slot: i.slot, title: i.title, status: i.status }));
        const res = await t.step(
          "Judge what matters most",
          () => structuredWithin(wait, MentorOut, mentorTask(slot, goalOf(ctx, input), `${longDate(ctx.today)} ${ctx.today.slice(0, 4)}`), mentorData(worth.slice(0, 10), recent, materials)),
          (r) => (r.ok ? `${aiName()} proposed ${r.value.insights.length}` : `rules ranking (${whyNoAnswer(r)})`),
        );
        usage = res.usage ?? null;
        if (res.ok) {
          const accepted = acceptInsights(input, worth, res.value.insights, materials.map((m) => m.text));
          const dropped = res.value.insights.length - accepted.length;
          if (dropped > 0) t.note("Check each insight against its evidence", `${dropped} dropped: it cited something it was not shown, or a number that is not in its evidence`, false);
          // The model chose silence: respected, unless something serious is on the table.
          if (accepted.length > 0) insights = accepted;
          else if (res.value.insights.length === 0) insights = rulesInsights(input, pool.filter((o) => o.weight >= MUST_SAY));
        }
      }
    }
    // A refresh never saves a copy of what is already open: same subject, numbers and writer.
    if (opts.refresh) insights = insights.filter((n) => !input.prior.some((p) => p.status === "new" && p.key === n.key && p.metric === n.metric && p.writer === n.writer));
    const saved = insights.length ? await t.step("Save the insights", () => persist.mentor.add(insights), (rows) => `${rows.length} saved`) : [];
    // A refresh's new insight stands in for an older open one on the same subject.
    const older = opts.refresh ? input.prior.filter((i) => i.status === "new" && saved.some((s) => s.key === i.key && s.id !== i.id)) : [];
    if (older.length) await t.step("Replace the older insights it updates", () => Promise.all(older.map((i) => persist.mentor.setStatus(i.id, "replaced"))), () => `${older.length} replaced`);
    // Once a day, with the morning priority (or whenever you ask): should your role order
    // change? It logs its own run and never fails this one.
    if (slot === "morning" || trigger !== "schedule") {
      await t.step("Review your target roles", () => runRolesReview(ctx, { trigger, honorPause: false, persist, slot }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" })), (r) => ("missing" in r ? `${r.missing}: ${r.why}` : r.headline));
    }
    const headline = mentorHeadline(slot, saved);
    const report: StandardReport = { agent, headline, details: saved.map((i) => `${i.title}. Do today: ${i.action}`), needsApproval: [], errors: [] };
    await logRun(ctx, {
      runId,
      agent,
      task,
      status: "succeeded",
      trigger,
      // Counts and areas only: the insight text stays in its own table.
      detail: saved.length ? `${saved.length} insight${saved.length === 1 ? "" : "s"} (${saved.map((i) => i.area).join(", ")}), by ${saved[0]!.writer === "model" ? aiName() : "rules"}` : "nothing new worth raising",
      ...(usage ? { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } : NO_MODEL),
      ...t.finish(),
    });
    return { report, insights: saved, updated: saved.filter((s) => older.some((o) => o.key === s.key)).length };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
