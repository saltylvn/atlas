import "server-only";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import type { DeskSearch } from "@/lib/domain/moreMatches";
import { runAnalyst } from "./analyst";
import { findMoreMatches, type FeedReader, type MoreMatches } from "./career";
import { runScout } from "./scout";

// "Find more good fits": one press sets the Career desk to work, in its usual order.
//   1. Scout reads the job boards and feeds and records every posting that fits a role.
//   2. Analyst refreshes the market report, when the Scout recorded something new.
//   3. Applications picks up to 5 postings never shown before and lists them under Good fits.
// This is the orchestrator-worker pattern with a fixed plan: each worker logs its own run and
// trace, and one that fails does not stop the next. One pass per press: the feeds are cached
// for about half an hour, so a second pass at once would read the same postings.

export interface DeskSearchOptions {
  /** The store that may write postings, reports and matches: the owner-scoped service store live, the demo store in demo mode. */
  persist: Store;
  /** Swapped in tests, which must not reach the network or a model. */
  read?: FeedReader;
  scout?: typeof runScout;
  analyst?: typeof runAnalyst;
}

export interface DeskSearchResult {
  /** What each agent did, for the message under the button. */
  said: DeskSearch;
  more: MoreMatches | AgentMissing;
}

export async function runCareerDeskSearch(ctx: Context, opts: DeskSearchOptions): Promise<DeskSearchResult> {
  const { persist } = opts;
  const scouted = await (opts.scout ?? runScout)(ctx, { trigger: "owner", honorPause: false, persist }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" }));
  const added = "missing" in scouted ? null : scouted.added;

  // Nothing new recorded and today's report exists: it still stands, and no model is asked to word it again.
  const hadToday = (await ctx.store.market.latestReport().catch(() => null))?.forDate === ctx.today;
  const reuse = added === 0 && hadToday;
  const analysed = await (opts.analyst ?? runAnalyst)(ctx, { trigger: "owner", honorPause: false, persist, reuseToday: reuse }).catch((): AgentMissing => ({ missing: "failed", why: "unexpected error" }));

  const more = await findMoreMatches(ctx, { trigger: "owner", persist, ...(opts.read ? { read: opts.read } : {}) });
  const found = "missing" in more ? 0 : more.found.length;
  return {
    more,
    said: {
      scout: added,
      analyst: "missing" in analysed ? "failed" : reuse ? "kept" : "updated",
      found,
      allFailed: !("missing" in more) && more.allFailed,
    },
  };
}
