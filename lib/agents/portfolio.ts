import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing, StandardReport } from "@/lib/domain/chiefOfStaff";
import { portfolioFrom } from "@/lib/domain/portfolio";
import type { AgentRunEvent } from "@/lib/domain/types";
import { GithubError, githubConfigured, githubHasToken, githubUser, readGithubRepos } from "@/lib/integrations/github";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Scout's second job: once a day, read your own GitHub repositories and record what
// each one is built with and which skills it demonstrates. The Analyst uses that as
// evidence when it measures how qualified you are for a role; the Career Mentor reads the
// Analyst's numbers. Like everything the Scout does, it records and has no opinion.
//
// Read-only. For each repository: its description, topics, languages, the start of the
// README and its dependency files. No other source is read, nothing is sent to a model,
// and the only table written is portfolio_repos. Rules only: $0 a run.

export const PORTFOLIO_TASK = "Read your GitHub projects";

export interface PortfolioResult {
  report: StandardReport;
  repos: number;
}

export interface PortfolioOptions {
  trigger: AgentRunEvent["trigger"];
  honorPause: boolean;
  /** The store that may write the project list: the service store live. */
  persist: Store;
  /** Read again even when today's read is already on record (Run Now). */
  force?: boolean;
}

export const portfolioReady = (): boolean => githubConfigured();

export async function scanPortfolio(ctx: Context, opts: PortfolioOptions): Promise<PortfolioResult | AgentMissing> {
  const agent = "scout" as const;
  const runId = randomUUID();
  const task = PORTFOLIO_TASK;
  const { trigger, persist } = opts;
  if (ctx.mode !== "live" || !portfolioReady()) return { missing: "skipped", why: "GitHub is not set up yet: add GITHUB_USER (your login) in Vercel, then redeploy." };
  // Once a day is plenty: projects change far more slowly than the job market.
  if (!opts.force && (await persist.portfolio.list().catch(() => [])).some((r) => r.checkedOn === ctx.today)) return { missing: "skipped", why: "already read today" };
  if (opts.honorPause && (await isPaused(ctx, agent))) return { missing: "skipped", why: "paused in Mission Control" };

  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const raws = await t.step("Read your repositories from GitHub", () => readGithubRepos(), (r) => `${r.length} repositories${githubHasToken() ? ", private ones included" : ", public only (no token)"}`);
    const rows = portfolioFrom(raws, githubUser(), ctx.today);
    t.note("Work out each project's stack and skills", `${rows.length} projects, ${new Set(rows.flatMap((r) => r.skills)).size} distinct skills shown`);
    await t.step("Record them", () => persist.portfolio.replace(rows));
    const skills = new Set(rows.flatMap((r) => r.skills)).size;
    const headline = rows.length ? `${rows.length} GitHub project${rows.length === 1 ? "" : "s"} read, showing ${skills} skill${skills === 1 ? "" : "s"}.` : "No GitHub projects to read yet.";
    // Counts only: repository names stay in their own table.
    await logRun(ctx, { runId, agent, task, status: "succeeded", trigger, detail: headline.replace(/\.$/, ""), ...NO_MODEL, ...t.finish() });
    return { report: { agent, headline, details: [], needsApproval: [], errors: [] }, repos: rows.length };
  } catch (err) {
    // Fixed text only: nothing from GitHub's reply is echoed.
    const why = err instanceof GithubError ? err.message : "The GitHub read failed unexpectedly. The next run will try again.";
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
