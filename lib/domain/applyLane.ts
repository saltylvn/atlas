// The Career page's Good fits and Apply Queue. Pure.
//
// You apply to every job yourself, on your MacBook, with Atlas Autofill in Safari (since
// 23 Nov 2026: the Apply bot that submitted forms for you was removed). A 👍 on a good fit
// puts the job in the Apply Queue; you apply on the company's site and mark it submitted.

import type { Application, Approval, JobMatch } from "./types";

/** The queue a 👍 sends a job to. */
export const APPLY_QUEUE = "Apply Queue";

/** The scorecard's split by who applied: Atlas (the Apply bot, before it was removed) or you. */
export interface MethodSplit {
  atlas: { sent: number; answered: number };
  you: { sent: number; answered: number };
}

/** All time: applications sent and how many got any answer, by method. Saved jobs are not sent. */
export function byMethod(apps: readonly Pick<Application, "tier" | "status">[]): MethodSplit {
  const count = (tier: Application["tier"]) => {
    const sent = apps.filter((a) => a.tier === tier && a.status !== "saved");
    return { sent: sent.length, answered: sent.filter((a) => a.status !== "applied").length };
  };
  return { atlas: count("auto"), you: count("semi") };
}

/**
 * A queue's order: jobs you marked Perfect fit first, then the longest-waiting. `perfect` holds
 * the ids of the matches marked so.
 */
export function perfectFirst<T extends Pick<Approval, "matchId" | "createdAt">>(kits: readonly T[], perfect: ReadonlySet<string>): T[] {
  const top = (k: T) => (k.matchId && perfect.has(k.matchId) ? 0 : 1);
  return [...kits].sort((a, b) => top(a) - top(b) || a.createdAt.localeCompare(b.createdAt));
}

/** The Career page anchor of the Good fits list. */
export const FITS_ID = "fits";

/** The Good fits list: every job you have not decided on, best fit first. */
export function openFits<T extends Pick<JobMatch, "rating" | "status" | "score">>(matches: readonly T[]): T[] {
  return matches.filter((m) => m.rating === 0 && m.status === "new").sort((a, b) => b.score - a.score);
}

/** What a list that is waiting on you says, so it reads as an alert: "13 jobs to take action on". */
export const actionLabel = (n: number): string => `${n} job${n === 1 ? "" : "s"} to take action on`;
