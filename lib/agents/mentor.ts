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
import { roleFitBrief } from "@/lib/domain/roleFit";
import { acceptInsights, eligible, mentorHeadline, recentForModel, MUST_SAY, observe, rulesInsights, WORTH_SAYING, type MentorInput, type MentorInsight, type MentorSlot, type NewInsight } from "@/lib/domain/mentor";
import { payPrefs, searchGoal } from "@/lib/domain/searchProfile";
import { extractSkills } from "@/lib/domain/skills";
import type { AgentRunEvent, Settings } from "@/lib/domain/types";
import { careerPrefs } from "./career";
import { isPaused, logRun, NO_MODEL } from "./log";
import { runRolesReview } from "./mentorRoles";
import { activeLessons } from "@/lib/domain/agentState";
import { gradeInsight, lessonsText, proofPlan, REWRITE_SLOTS } from "@/lib/domain/gapPlan";
import { maxYearsOf } from "@/lib/domain/levelPolicy";
import { tracer } from "./trace";
import { inYourLists } from "@/lib/domain/people";

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

/** Planned applications a day. The Career Mentor measures you against it. */
export function dailyPlan(s: Settings): number {
  return s.careerDailyFullTime ?? 3;
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

/** Everything the Career Mentor looks at. Each read fails on its own: a missing source narrows the review, it does not stop it. */
export async function mentorInput(ctx: Context, slot: MentorSlot): Promise<MentorInput> {
  const { store, settings, today } = ctx;
  const [applications, approvals, matches, market, resumeRows, prior, perfect, contacts] = await Promise.all([
    store.applications.list().catch(() => []),
    store.approvals.list().catch(() => []),
    store.jobMatches.since(addDays(today, -14)).catch(() => []),
    store.market.latestReport().catch(() => null),
    store.knowledge.bySource("resume", 200).catch(() => null),
    store.mentor.since(addDays(today, -14)).catch(() => []),
    // The jobs you marked Perfect fit, however long ago, and the people a referral could come from.
    store.jobMatches.perfect().catch(() => []),
    store.contacts
      .list()
      .then((all) => all.filter(inYourLists))
      .catch(() => []),
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
    perfect,
    contacts,
    proof: proofPlan(settings.careerProof),
    maxYears: maxYearsOf(settings),
  };
}

/** The lessons your results taught (agent memory, Step 3), for the model to read. Empty when none or unreadable. */
async function lessonsMaterial(ctx: Context): Promise<{ name: string; text: string }[]> {
  const all = await ctx.store.agentMemory.list("mentor").catch(() => []);
  const live = activeLessons(all, "mentor", ctx.today);
  return live.length ? [{ name: "Lessons from your results", text: lessonsText(live) }] : [];
}

// The same search every Career desk agent works from (lib/domain/searchProfile.ts): level, pay, place and team.
const goalOf = (ctx: Context, input: MentorInput) => `${searchGoal(payPrefs(ctx.settings))} Target roles in priority order: ${input.roles.slice(0, 5).join(", ")}. Plan: ${input.plan} applications a day.`;

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
        // Every review also reads the role fit study, so advice about roles and gaps matches it.
        const materials = [
          { name: "Role fit study", text: roleFitBrief() },
          ...(slot === "evening" && input.linkedin ? [{ name: "LinkedIn profile text", text: scrubPhones(scrub(input.linkedin)).slice(0, 1500) }] : []),
          ...(await lessonsMaterial(ctx)),
        ];
        // What you were told lately, and what you did about it, in your words (Action Taken notes,
        // up to 30 days back): the model builds the next step on those instead of repeating them.
        const recent = recentForModel(input.prior, ctx.today);
        const res = await t.step(
          "Judge what matters most",
          () => structuredWithin(wait, MentorOut, mentorTask(slot, goalOf(ctx, input), `${longDate(ctx.today)} ${ctx.today.slice(0, 4)}`), mentorData(worth.slice(0, 10), recent, materials)),
          (r) => (r.ok ? `${aiName()} proposed ${r.value.insights.length}` : `rules ranking (${whyNoAnswer(r)})`),
        );
        usage = res.usage ?? null;
        if (res.ok) {
          let accepted = acceptInsights(input, worth, res.value.insights, materials.map((m) => m.text));
          const dropped = res.value.insights.length - accepted.length;
          if (dropped > 0) t.note("Check each insight against its evidence", `${dropped} dropped: it cited something it was not shown, or a number that is not in its evidence`, false);
          // Draft -> critique -> refine (Step 3): the rules grade each piece of advice; advice below
          // the bar gets one rewrite with the notes, in two slots a day. A rewrite is kept only where it passes.
          const done = [...recent.flatMap((r) => (r.youDid ? [r.youDid] : [])), ...input.prior.filter((p) => p.status === "done").map((p) => p.action)];
          const weak = accepted.map((i) => ({ i, g: gradeInsight(i, done) })).filter((x) => !x.g.pass);
          t.note("Grade the advice", weak.length ? `${weak.length} of ${accepted.length} below the bar: ${[...new Set(weak.flatMap((w) => w.g.notes))].join(" ").slice(0, 200)}` : `${accepted.length} of ${accepted.length} pass`, weak.length === 0);
          if (weak.length && REWRITE_SLOTS.has(slot)) {
            const again = modelWait(aiCap(ctx, MODEL_WAIT_MS), ctx.deadline, Date.now(), AFTER_SPECIALIST_MS);
            const gate2 = await takeAiCallWithin(ctx.store, ctx.settings, `mentor-rewrite:${slot}`, again);
            if (!gate2.allowed) t.note("Rewrite the advice below the bar", `kept as drafted: ${gate2.why}`);
            else {
              const critique = weak.map((w) => `"${w.i.title}": ${w.g.notes.join(" ")}`).join("\n");
              const res2 = await t.step(
                "Rewrite the advice below the bar",
                () => structuredWithin(again, MentorOut, `${mentorTask(slot, goalOf(ctx, input), `${longDate(ctx.today)} ${ctx.today.slice(0, 4)}`)}\nA reviewer sent back this draft. Fix exactly these and keep what already passed:\n${critique}`, mentorData(worth.slice(0, 10), recent, materials)),
                (r) => (r.ok ? `${aiName()} rewrote ${r.value.insights.length}` : `kept as drafted (${whyNoAnswer(r)})`),
              );
              if (res2.ok) {
                const redo = acceptInsights(input, worth, res2.value.insights, materials.map((m) => m.text)).filter((i) => gradeInsight(i, done).pass);
                accepted = accepted.map((i) => (gradeInsight(i, done).pass ? i : (redo.find((r) => r.key === i.key) ?? i)));
                t.note("Grade the rewrite", `${accepted.filter((i) => gradeInsight(i, done).pass).length} of ${accepted.length} pass now`);
              }
            }
          }
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
