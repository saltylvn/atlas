// The Applications Agent: today's picks, in two tracks.
//
// Full-time is the goal; gigs build the portfolio. Each track has a small daily plan, so
// the day's list is short enough to finish, and gigs cannot crowd out the job hunt.
// Pure: matches in, picks out.

import type { Application, JobMatch, JobType, LocalDate } from "./types";
import { daysBetween } from "./dates";

export interface TrackPicks {
  type: JobType;
  label: "Full-time" | "Gigs";
  /** Planned applications today, and how many you have sent. */
  plan: number;
  sent: number;
  /** The jobs to act on now: the best new matches, at most what is left of the plan. */
  picks: JobMatch[];
}

/** How many days a match stays a candidate for the day's list. */
const FRESH_DAYS = 3;

export function todaysPicks(matches: readonly JobMatch[], applications: readonly Application[], today: LocalDate, plan: { fullTime: number; gigs: number }): TrackPicks[] {
  const track = (type: JobType, label: TrackPicks["label"], planned: number): TrackPicks => {
    const sent = applications.filter((a) => a.type === type && a.appliedOn === today && a.status !== "saved").length;
    const seen = new Set<string>();
    const picks = matches
      .filter((m) => m.type === type && m.status === "new" && m.rating >= 0 && daysBetween(m.shownOn, today) <= FRESH_DAYS)
      // What you liked first, then the agent's score, then the newest.
      .sort((a, b) => b.rating - a.rating || b.score - a.score || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
      .filter((m) => {
        const company = m.company.toLowerCase();
        if (seen.has(company)) return false;
        seen.add(company);
        return true;
      })
      .slice(0, Math.max(0, planned - sent));
    return { type, label, plan: planned, sent, picks };
  };
  return [track("full-time", "Full-time", plan.fullTime), track("gig", "Gigs", plan.gigs)];
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
