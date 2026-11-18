import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import { SLOT_LABEL } from "@/lib/domain/briefSchedule";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { newsAgentReport, shownIn, type NewsAgentResult } from "@/lib/domain/newsAgent";
import { NEWS_TOPICS, type AgentRunEvent, type BriefSlot } from "@/lib/domain/types";
import { FEEDS, getNews, LEAN } from "@/lib/integrations/news";
import { isPaused, logRun, NO_MODEL } from "./log";
import { NO_TRACE, tracer, type Tracer } from "./trace";

// The News Agent at run time: read every allowlisted feed (read-only, cached 30 minutes),
// then hand the pure picker the headlines and what the morning already showed. Rules
// only, no model call, so every run costs $0.

/** The agent's work without logging. Today's live preview uses this directly. */
export async function newsAgentWork(ctx: Context, slot: BriefSlot, t: Tracer = NO_TRACE): Promise<NewsAgentResult> {
  const offline = ctx.mode === "demo" && process.env.ATLAS_OFFLINE === "1";
  const [news, earlier] = await Promise.all([
    t.step(
      "Read the allowlisted feeds",
      () => (offline ? Promise.resolve({ items: [], failed: [] }) : getNews(NEWS_TOPICS)),
      (n) => `${n.items.length} headlines from ${offline ? 0 : FEEDS.length} feeds${n.failed.length ? `; ${n.failed.length} failed: ${n.failed.join(", ")}` : ""}`,
    ),
    slot === "afternoon" ? t.step("Load what the morning brief showed", () => ctx.store.briefs.forDate(ctx.today), (b) => `${b.filter((x) => x.slot === "morning").length} morning brief`) : Promise.resolve([]),
  ]);
  return t.step("Group the same story, rank and pick 3 per area", () => pickStories(), (r) => r.report.headline);

  function pickStories() {
    return newsAgentReport({
      slot,
      now: ctx.now,
      items: news.items,
      failedFeeds: news.failed,
      feedCount: offline ? 0 : FEEDS.length,
      lean: LEAN,
      shown: shownIn(earlier.filter((b) => b.slot === "morning").map((b) => b.report)),
    });
  }
}

export interface NewsRunOptions {
  trigger: AgentRunEvent["trigger"];
  /** Scheduled and Chief of Staff runs honor Pause; the agent's own Run Now does not. */
  honorPause: boolean;
}

/** One logged News Agent run. Never throws: a failure comes back as `missing`. */
export async function runNewsAgent(ctx: Context, slot: BriefSlot, opts: NewsRunOptions): Promise<NewsAgentResult | AgentMissing> {
  const agent = "news" as const;
  const runId = randomUUID();
  const task = `News for the ${SLOT_LABEL[slot]}`;
  const { trigger } = opts;

  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }

  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const result = await newsAgentWork(ctx, slot, t);
    const failed = result.report.errors[0] ?? "";
    if (result.allFailed) {
      await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: failed, ...NO_MODEL, ...t.finish() });
    } else {
      const detail = [result.report.headline.replace(/\.$/, ""), failed].filter(Boolean).join(" · ");
      await logRun(ctx, { runId, agent, task, status: "succeeded", trigger, detail, ...NO_MODEL, ...t.finish() });
    }
    return result;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
