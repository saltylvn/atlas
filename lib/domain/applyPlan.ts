// The Applications Agent: today's picks.
//
// A small daily plan keeps the day's list short enough to finish.
// Pure: matches in, picks out.

import type { Application, JobMatch, LocalDate } from "./types";
import { daysBetween } from "./dates";
import { ON_DEMAND_SLOT } from "./moreMatches";

export interface DayPicks {
  /** Planned applications today, and how many you have sent. */
  plan: number;
  sent: number;
  /** The jobs to act on now: the best new matches, at most what is left of the plan. */
  picks: JobMatch[];
}

/** How many days a match stays a candidate for the day's list. */
const FRESH_DAYS = 3;

export function todaysPicks(matches: readonly JobMatch[], applications: readonly Application[], today: LocalDate, plan: number): DayPicks {
  const sent = applications.filter((a) => a.appliedOn === today && a.status !== "saved").length;
  const seen = new Set<string>();
  const picks = matches
    // The plan is drawn from your briefs. What a search you started found has its own list to review.
    .filter((m) => m.shownSlot !== ON_DEMAND_SLOT && m.status === "new" && m.rating >= 0 && daysBetween(m.shownOn, today) <= FRESH_DAYS)
    // What you liked first, then the agent's score, then the newest.
    .sort((a, b) => b.rating - a.rating || b.score - a.score || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .filter((m) => {
      const company = m.company.toLowerCase();
      if (seen.has(company)) return false;
      seen.add(company);
      return true;
    })
    .slice(0, Math.max(0, plan - sent));
  return { plan, sent, picks };
}

/** A job you saved yourself is keyed by its link, so saving it twice does nothing. */
export function savedJobKey(url: string): string {
  try {
    const u = new URL(url);
    return `saved:${u.hostname}${u.pathname}`.replace(/\/$/, "").toLowerCase().slice(0, 600);
  } catch {
    return `saved:${url}`.slice(0, 600);
  }
}
