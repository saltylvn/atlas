import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCallWithin } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import type { Usage } from "@/lib/ai/models";
import { RoleProfileOut, roleProfileData, roleProfileTask } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { addDays } from "@/lib/domain/dates";
import { AFTER_SPECIALIST_MS, aiCap, modelWait } from "@/lib/domain/deadline";
import { withoutPrivate } from "@/lib/domain/roleOutlook";
import { acceptProfile, profileWeek, roleCards, roleFacts, topRoles, type RoleCard, type RoleProfileText } from "@/lib/domain/roleProfile";
import { payPrefs, searchGoal } from "@/lib/domain/searchProfile";
import type { AgentRunEvent } from "@/lib/domain/types";
import { careerPrefs } from "./career";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Career Mentor's weekly profile of your top five roles, for the Target Roles page.
//
// Facts from rules, wording from the model:
//   - the Analyst's outlook gives each role its facts (demand, pay, skills asked, what you
//     can show, your gaps);
//   - the model (Gemini) is given those facts for one role and writes what the role does,
//     its tempo, a project to build and the gap to close first;
//   - what it writes is checked against the facts (acceptProfile). Text that adds a number,
//     names a gap the role does not have, or carries a link or markup is dropped, and the
//     card keeps showing the facts alone.
// One model call per role, so five a week. It writes only role_profiles, and never changes
// your roles or anything outside Atlas.

export const ROLE_PROFILES_TASK = "Mentor: target role profiles";
// Inside a run, the run's deadline still cuts this (modelWait).
const MODEL_WAIT_MS = 20_000;

export interface RoleProfilesOptions {
  trigger: AgentRunEvent["trigger"];
  honorPause: boolean;
  /** The store that may write profiles: the owner-scoped service store live, the demo store in demo mode. */
  persist: Store;
  /** Write this week's profiles again even where one exists (you pressed Update). */
  rewrite?: boolean;
  /** Swapped in tests, which must not reach a model. */
  write?: (card: RoleCard, facts: string[], waitMs: number) => Promise<{ text: RoleProfileText | null; usage: Usage | null; why: string }>;
}

export interface RoleProfilesResult {
  /** Roles whose profile was written this run, kept from earlier this week, and still waiting (with the reason). */
  written: string[];
  kept: string[];
  waiting: { role: string; why: string }[];
  headline: string;
}

export async function runRoleProfiles(ctx: Context, opts: RoleProfilesOptions): Promise<RoleProfilesResult | AgentMissing> {
  const agent = "mentor" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  if (opts.honorPause && (await isPaused(ctx, agent))) return { missing: "skipped", why: "paused in Mission Control" };

  const [market, repos, existing] = await Promise.all([ctx.store.market.latestReport().catch(() => null), ctx.store.portfolio.list().catch(() => []), ctx.store.roleProfiles.recent(40).catch(() => [])]);
  // A report older than three days describes a market that has moved on.
  const outlook = market && market.forDate >= addDays(ctx.today, -3) ? market.report.outlook : undefined;
  const roles = careerPrefs(ctx.settings).roles.map((r) => r.name);
  if (!outlook || outlook.length === 0) return { written: [], kept: [], waiting: topRoles(roles).map((role) => ({ role, why: "no market report yet" })), headline: "No role outlook yet: the Analyst computes it with the next market report." };

  await logRun(ctx, { runId, agent, task: ROLE_PROFILES_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  const used: Usage[] = [];
  try {
    const week = profileWeek(ctx.today);
    // Names of private repositories are not sent to the model.
    const cards = roleCards(roles, withoutPrivate(outlook, new Set(repos.filter((r) => r.isPrivate).map((r) => r.name))), []);
    const goal = searchGoal(payPrefs(ctx.settings));
    const out: RoleProfilesResult = { written: [], kept: [], waiting: [], headline: "" };

    for (const card of cards) {
      if (!opts.rewrite && existing.some((p) => p.role === card.role && p.forWeek === week)) {
        out.kept.push(card.role);
        continue;
      }
      const facts = roleFacts(card);
      if (facts.length === 0) {
        out.waiting.push({ role: card.role, why: "too few postings to describe it" });
        continue;
      }
      const wait = modelWait(aiCap(ctx, MODEL_WAIT_MS), ctx.deadline, Date.now(), AFTER_SPECIALIST_MS);
      const res = await t.step(`Describe ${card.role}`.slice(0, 80), () => (opts.write ?? writeWithModel(ctx, goal))(card, facts, wait), (r) => (r.text ? `written by ${aiName()} and checked against ${facts.length} facts` : `not written: ${r.why}`));
      if (res.usage) used.push(res.usage);
      if (!res.text) {
        out.waiting.push({ role: card.role, why: res.why });
        continue;
      }
      await persist.roleProfiles.save({ role: card.role, forWeek: week, ...res.text, postings: card.outlook?.postings ?? 0, facts: facts.map((f) => f.slice(0, 600)), writer: "model" });
      out.written.push(card.role);
    }

    const n = (k: number, word: string) => `${k} ${word}`;
    out.headline = `Role profiles for the week of ${week}: ${n(out.written.length, "written")}, ${n(out.kept.length, "kept")}, ${n(out.waiting.length, "waiting")}.`;
    const usage = used.at(-1);
    await logRun(ctx, {
      runId,
      agent,
      task: ROLE_PROFILES_TASK,
      status: "succeeded",
      trigger,
      // Counts and role names only: the profile text stays in its own table.
      detail: `${out.headline.replace(/\.$/, "")}${out.waiting.length ? ` Waiting: ${out.waiting.map((w) => `${w.role} (${w.why})`).join("; ")}` : ""}`.slice(0, 480),
      ...(usage ? { model: usage.model, inputTokens: used.reduce((a, u) => a + u.inputTokens, 0), outputTokens: used.reduce((a, u) => a + u.outputTokens, 0), costUsd: used.reduce((a, u) => a + u.costUsd, 0) } : NO_MODEL),
      ...t.finish(),
    });
    return out;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: ROLE_PROFILES_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}

/** One role, one model call: gated by the AI budget, then checked against the role's facts. */
function writeWithModel(ctx: Context, goal: string): NonNullable<RoleProfilesOptions["write"]> {
  return async (card, facts, waitMs) => {
    const gate = await takeAiCallWithin(ctx.store, ctx.settings, "mentor:role-profile", waitMs);
    // The budget's wording speaks of a drafter; here nothing is drafted without the model.
    if (!gate.allowed) return { text: null, usage: null, why: gate.why.replace(/, so the offline drafter ran\.?$/, ".") };
    const res = await structuredWithin(waitMs, RoleProfileOut, roleProfileTask(goal), roleProfileData({ role: card.role, facts, asks: card.asks.map((a) => a.skill), gaps: card.gaps.map((g) => g.skill) }));
    if (!res.ok) return { text: null, usage: res.usage ?? null, why: whyNoAnswer(res) };
    const text = acceptProfile(res.value, card);
    return { text, usage: res.usage ?? null, why: text ? "" : "the text added a number, a gap or a skill that is not in the facts, so it was not kept" };
  };
}
