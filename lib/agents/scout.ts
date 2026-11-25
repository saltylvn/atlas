import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing, StandardReport } from "@/lib/domain/chiefOfStaff";
import { addDays, zonedToUtc } from "@/lib/domain/dates";
import { MARKET_WINDOW_DAYS, observePostings } from "@/lib/domain/market";
import { candidatesBeyond } from "@/lib/domain/targetRoles";
import type { AgentRunEvent, LocalDate } from "@/lib/domain/types";
import type { RawJob } from "@/lib/domain/careerAgent";
import { ACTIVE_DAYS, dailySummary, observeTech, TECH_KEEP_DAYS, type RunQuality } from "@/lib/domain/techMarket";
import { DETAIL_LABEL, pipelineConfig } from "@/lib/domain/dataPipeline";
import { fetchJobFeeds, REMOTE_BOARDS, type FeedResult } from "@/lib/integrations/jobFeeds";
import { careerPrefs } from "./career";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Scout: stage 1 of the Career desk. At every 2-hour sync it reads the public job
// feeds and your company watchlist, keeps the postings that are one of your roles or one
// of the candidate roles next to them, and records them: title, company, pay, place and
// the skills each asks for. The candidate roles are recorded so the Analyst can measure
// them; they are never shown to you as matches. It reports counts and failures to the
// Chief of Staff and has no opinion about any of it.
// Rules only, no model call: $0 a run. The only table it writes is market_postings.

export const SCOUT_TASK = "Record the job market";

export interface ScoutResult {
  report: StandardReport;
  /** Postings recorded this run, how many of them were new, and how many are in the 30-day window. */
  recorded: number;
  added: number;
  inWindow: number;
}

export interface ScoutOptions {
  trigger: AgentRunEvent["trigger"];
  honorPause: boolean;
  /** The store that may write postings: the owner-scoped service store live, the demo store in demo mode. */
  persist: Store;
}

/**
 * The market-wide record: the cleaned layer, then today's summary computed again from it (so a
 * second run the same day gives the same summary), then the run's data-quality record.
 */
export async function recordTechMarket(persist: Store, raws: RawJob[], today: LocalDate): Promise<{ added: number; pruned: number; quality: RunQuality }> {
  const { rows, quality } = observeTech(raws, REMOTE_BOARDS, today);
  const added = await persist.techMarket.record(rows);
  const pruned = await persist.techMarket.prune(addDays(today, -TECH_KEEP_DAYS));
  const recent = await persist.techMarket.since(addDays(today, -ACTIVE_DAYS));
  await persist.techMarket.saveDaily(today, dailySummary(recent, today));
  await persist.techMarket.saveQuality(quality);
  return { added, pruned, quality };
}

/**
 * True when no Scout run has succeeded yet today: the run that reads Greenhouse boards with
 * descriptions (once a day, the owner's choice). On a read error it says yes: one heavier read
 * is better than a day without details.
 */
export async function firstRunToday(ctx: Pick<Context, "store" | "today" | "settings">): Promise<boolean> {
  try {
    const since = zonedToUtc(ctx.today, "00:00", ctx.settings.timezone).toISOString();
    return !(await ctx.store.agentRuns.since(since)).some((r) => r.agent === "scout" && r.task === SCOUT_TASK && r.status === "succeeded");
  } catch {
    return true;
  }
}

export async function runScout(ctx: Context, opts: ScoutOptions): Promise<ScoutResult | AgentMissing> {
  const agent = "scout" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task: SCOUT_TASK, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }
  await logRun(ctx, { runId, agent, task: SCOUT_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const roles = careerPrefs(ctx.settings).roles;
    // Your roles first: when a title fits one of yours and a candidate equally, yours wins.
    const watched = [...roles, ...candidatesBeyond(roles)];
    const watches = await ctx.store.watches.list().catch(() => []);
    // Demo mode run offline (tests, a laptop with no network) reads nothing, like the News Agent.
    const offline = ctx.mode === "demo" && process.env.ATLAS_OFFLINE === "1";
    // The first run of the day reads Greenhouse boards with descriptions; later runs, titles only.
    const config = pipelineConfig(ctx.settings.dataPipeline);
    const first = !offline && (await firstRunToday(ctx));
    const details = !offline && config.details !== "off" && (config.details === "every-sync" || first);
    const feeds = await t.step(
      "Read the job feeds",
      (): Promise<FeedResult> => (offline ? Promise.resolve({ jobs: [], failed: [], sourceCount: 0 }) : fetchJobFeeds(watches, watched.flatMap((r) => r.titles), { details, skip: config.sourcesOff, adzuna: first })),
      (f) => `${f.jobs.length} postings from ${f.sourceCount} sources${f.failed.length ? `; ${f.failed.length} failed: ${f.failed.join(", ")}` : ""}`,
    );
    t.note("Board details", details ? `Read with descriptions and pay (${DETAIL_LABEL[config.details].toLowerCase()})` : config.details === "off" ? "Off: titles only (Data Pipeline setting)" : "Titles only; descriptions were read at the first run today", true);
    if (feeds.utahList) t.note("Utah companies", `${feeds.utahList.read} of ${feeds.utahList.of} Utah company boards read, for the market record only`, true);
    if (config.sourcesOff.length) t.note("Sources turned off", config.sourcesOff.join(", "), true);
    const rows = observePostings(feeds.jobs, watched, REMOTE_BOARDS, ctx.today);
    const mine = new Set(roles.map((r) => r.name));
    const yours = rows.filter((r) => mine.has(r.role)).length;
    t.note("Keep the postings that are one of your roles, or a role next to them", `${yours} for your ${roles.length} roles and ${rows.length - yours} for ${watched.length - roles.length} candidate roles, of ${feeds.jobs.length} read`);
    const added = await t.step("Record them", () => persist.market.record(rows), (n) => `${n} new, ${rows.length - n} seen before`);
    // The tech market, read broadly. Its own step: if it fails, the your-roles record above stands.
    const broad = [...feeds.jobs.filter((j) => !/ careers$/.test(j.source)), ...(feeds.boardAll ?? [])];
    const market = await t
      .step(
        "Record the tech market",
        () => recordTechMarket(persist, broad, ctx.today),
        (m) => `${m.quality.recorded} tech postings (${m.added} new, ${m.quality.duplicates} duplicates merged, ${m.quality.notTech} not tech, ${m.quality.outsideUs} outside the U.S.); ${m.pruned} older than ${TECH_KEEP_DAYS} days removed`,
      )
      .catch((err: Error) => ({ error: (err.message ?? "unknown error").slice(0, 200) }));
    const inWindow = (await persist.market.since(addDays(ctx.today, -MARKET_WINDOW_DAYS)).catch(() => [])).filter((p) => mine.has(p.role)).length;
    const allFailed = feeds.sourceCount > 0 && feeds.failed.length >= feeds.sourceCount;
    const headline = allFailed ? "No job feed could be read this run." : `${added} new postings recorded (${inWindow} for your roles in the last ${MARKET_WINDOW_DAYS} days).`;
    const report: StandardReport = {
      agent,
      headline,
      details: [
        `${feeds.jobs.length} postings read from ${feeds.sourceCount} sources; ${yours} are one of your ${roles.length} roles, ${rows.length - yours} are roles next to them.`,
        ...("error" in market ? [] : [`Tech market: ${market.quality.recorded} U.S. tech postings recorded, ${market.added} new.`]),
      ],
      needsApproval: [],
      errors: [...(feeds.failed.length ? [`Job feeds that failed: ${feeds.failed.join(", ")}`] : []), ...("error" in market ? [`Tech market record failed: ${market.error}`] : [])],
    };
    await logRun(ctx, { runId, agent, task: SCOUT_TASK, status: allFailed ? "failed" : "succeeded", trigger, detail: [headline.replace(/\.$/, ""), report.errors[0] ?? ""].filter(Boolean).join(" · "), ...NO_MODEL, ...t.finish() });
    return { report, recorded: rows.length, added, inWindow };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: SCOUT_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
