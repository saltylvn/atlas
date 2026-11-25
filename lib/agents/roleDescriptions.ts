import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCallWithin } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import type { Usage } from "@/lib/ai/models";
import { RoleDescriptionOut, roleDescriptionData, roleDescriptionTask } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { addDays } from "@/lib/domain/dates";
import { AFTER_SPECIALIST_MS, aiCap, modelWait } from "@/lib/domain/deadline";
import { countReads, readsLeft } from "@/lib/domain/postingFacts";
import { acceptDescription, descriptionMonth, descriptionQuery, descriptionsDue, SEARCH_CREDITS, SEARCH_RESULTS, type RoleDescription } from "@/lib/domain/roleDescription";
import { withoutPrivate } from "@/lib/domain/roleOutlook";
import { roleCards, roleFacts, topRoles } from "@/lib/domain/roleProfile";
import type { AgentRunEvent } from "@/lib/domain/types";
import { firecrawlConfigured, READ_HELP, searchWeb, type WebResult, type WebSearcher } from "@/lib/integrations/firecrawl";
import { careerPrefs } from "./career";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Career Mentor's monthly description of each target role, for the Target Roles page.
//
// For each role still without this month's description:
//   1. search   Firecrawl, one web search built from the role's name alone (nothing about
//               you), result snippets only, 2 credits from the shared monthly budget;
//   2. write    Gemini, given the Analyst's facts for the role and the numbered snippets as
//               fenced, untrusted data; no tools, no browsing;
//   3. check    acceptDescription: no links or markup, every number found in the facts or
//               snippets, 1 to 3 real sources. A failed check keeps nothing.
// Runs with the Monday profiles, so it does its work on the first Monday of a month and
// finds nothing due the rest of the month. It writes only role_descriptions.

export const ROLE_DESCRIPTIONS_TASK = "Mentor: target role descriptions";
const MODEL_WAIT_MS = 20_000;

export interface RoleDescriptionsOptions {
  trigger: AgentRunEvent["trigger"];
  honorPause: boolean;
  persist: Store;
  /** Swapped in tests, which must not reach the network or a model. */
  search?: WebSearcher;
  write?: (role: string, facts: string[], results: WebResult[], waitMs: number) => Promise<{ value: { description: string; sources: number[] } | null; usage: Usage | null; why: string }>;
}

export interface RoleDescriptionsResult {
  written: string[];
  kept: string[];
  waiting: { role: string; why: string }[];
  headline: string;
}

export async function runRoleDescriptions(ctx: Context, opts: RoleDescriptionsOptions): Promise<RoleDescriptionsResult | AgentMissing> {
  const agent = "mentor" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  if (opts.honorPause && (await isPaused(ctx, agent))) return { missing: "skipped", why: "paused in Mission Control" };

  const roles = topRoles(careerPrefs(ctx.settings).roles.map((r) => r.name));
  const month = descriptionMonth(ctx.today);
  const existing = await ctx.store.roleDescriptions.recent(40).catch((): RoleDescription[] => []);
  const due = descriptionsDue(roles, existing, month);
  const kept = roles.filter((r) => !due.includes(r));
  if (due.length === 0) return { written: [], kept, waiting: [], headline: `Role descriptions for ${month}: all ${roles.length} written.` };
  if (!opts.search && !firecrawlConfigured()) return { written: [], kept, waiting: due.map((role) => ({ role, why: READ_HELP.not_configured })), headline: "Role descriptions wait for Firecrawl." };

  await logRun(ctx, { runId, agent, task: ROLE_DESCRIPTIONS_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  const used: Usage[] = [];
  try {
    const [market, repos] = await Promise.all([ctx.store.market.latestReport().catch(() => null), ctx.store.portfolio.list().catch(() => [])]);
    const outlook = market && market.forDate >= addDays(ctx.today, -7) ? market.report.outlook : undefined;
    // The facts are about the market, never about you: private project names are masked anyway.
    const cards = roleCards(due, outlook ? withoutPrivate(outlook, new Set(repos.filter((r) => r.isPrivate).map((r) => r.name))) : [], []);
    const out: RoleDescriptionsResult = { written: [], kept, waiting: [], headline: "" };
    let usage = (await persist.settings.get()).firecrawlUsage;

    for (const card of cards) {
      const budget = readsLeft(usage, ctx.today);
      if (budget.left < SEARCH_CREDITS) {
        out.waiting.push({ role: card.role, why: budget.why });
        continue;
      }
      const found = await t.step(`Search the web for ${card.role}`.slice(0, 80), () => (opts.search ?? searchWeb)(descriptionQuery(card.role), SEARCH_RESULTS), (r) => (r.ok ? `${r.results.length} results` : `no results: ${READ_HELP[r.problem]}`));
      // A search that reached Firecrawl costs credits whether or not it found anything useful.
      if (found.ok || found.problem === "not_readable") usage = countReads(usage, ctx.today, SEARCH_CREDITS);
      if (!found.ok || found.results.length < 2) {
        out.waiting.push({ role: card.role, why: found.ok ? "the search found too little about it" : READ_HELP[found.problem] });
        continue;
      }
      const facts = roleFacts(card).slice(0, 4);
      const wait = modelWait(aiCap(ctx, MODEL_WAIT_MS), ctx.deadline, Date.now(), AFTER_SPECIALIST_MS);
      const res = await t.step(`Describe ${card.role}`.slice(0, 80), () => (opts.write ?? writeWithModel(ctx))(card.role, facts, found.results, wait), (r) => (r.value ? `written by ${aiName()}` : `not written: ${r.why}`));
      if (res.usage) used.push(res.usage);
      const accepted = res.value ? acceptDescription(res.value, found.results, facts) : null;
      if (!accepted) {
        out.waiting.push({ role: card.role, why: res.value ? "the text had a link, markup, a number not in the sources, or no sources, so it was not kept" : res.why });
        continue;
      }
      await persist.roleDescriptions.save({ role: card.role, forMonth: month, ...accepted, postings: card.outlook?.postings ?? 0, searchedOn: ctx.today });
      out.written.push(card.role);
    }
    await persist.settings.update({ firecrawlUsage: usage });

    out.headline = `Role descriptions for ${month}: ${out.written.length} written, ${out.kept.length} kept, ${out.waiting.length} waiting.`;
    const last = used.at(-1);
    await logRun(ctx, {
      runId,
      agent,
      task: ROLE_DESCRIPTIONS_TASK,
      status: "succeeded",
      trigger,
      // Counts and role names only: the text stays in its own table.
      detail: `${out.headline.replace(/\.$/, "")}${out.waiting.length ? ` Waiting: ${out.waiting.map((w) => `${w.role} (${w.why})`).join("; ")}` : ""}`.slice(0, 480),
      ...(last ? { model: last.model, inputTokens: used.reduce((a, u) => a + u.inputTokens, 0), outputTokens: used.reduce((a, u) => a + u.outputTokens, 0), costUsd: used.reduce((a, u) => a + u.costUsd, 0) } : NO_MODEL),
      ...t.finish(),
    });
    return out;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: ROLE_DESCRIPTIONS_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}

/** One role, one model call, gated by the AI budget. The answer is checked by the caller. */
function writeWithModel(ctx: Context): NonNullable<RoleDescriptionsOptions["write"]> {
  return async (role, facts, results, waitMs) => {
    const gate = await takeAiCallWithin(ctx.store, ctx.settings, "mentor:role-description", waitMs);
    if (!gate.allowed) return { value: null, usage: null, why: gate.why.replace(/, so the offline drafter ran\.?$/, ".") };
    const res = await structuredWithin(waitMs, RoleDescriptionOut, roleDescriptionTask(), roleDescriptionData({ role, facts, results }));
    if (!res.ok) return { value: null, usage: res.usage ?? null, why: whyNoAnswer(res) };
    return { value: res.value, usage: res.usage ?? null, why: "" };
  };
}
