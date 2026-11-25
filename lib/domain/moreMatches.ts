// "Find more good fits": job matches the Applications Agent finds when you ask, between briefs.
//
// A brief brings up to 10 matches twice a day. When you have time to review more, you
// press a button: the agent searches the same feeds again, with the same rules, and adds
// up to 10 postings that fit and have never been shown. They belong to no brief, so they
// are stored under their own slot: no brief counts them as its own or shows them again,
// and they wait on the Career page until you rate them.
//
// Pure: matches in, the review list out. The run is in lib/agents/career.ts.

import { daysBetween } from "./dates";
import type { JobMatch, LocalDate } from "./types";
import { TIER_ORDER, tierOfStored } from "./workplace";

/** The slot of a match found on demand. It is not a brief's slot, so no brief counts it. */
export const ON_DEMAND_SLOT = "on-demand";

/** How many matches one press asks for: enough to judge at once, on top of the briefs' 20 a day. */
export const MORE_COUNT = 5;

/** Of each five jobs, a seat kept for a Utah posting when there is one, as each brief does. */
export const MORE_LOCAL_SEATS = 1;

/** The button's words. */
export const MORE_BUTTON = "Find more jobs to apply for";

/** How many days a found match waits for your review before it leaves the list. */
export const REVIEW_DAYS = 3;

/** Where the button and the review list are: a section of the Career page. */
export const MORE_JOBS_ID = "more-jobs";
export const MORE_JOBS_HREF = `/career#${MORE_JOBS_ID}`;

// The database's shown_slot column allows only the three brief slots. No brief ever writes
// "saturday" for a match (the Saturday brief has none), so that value stores on-demand
// matches, and only the database adapter knows: everywhere else the slot is "on-demand".
// A migration can give it its own value later; nothing else would change.
const STORED_AS = "saturday";

/** The slot as the database stores it. */
export const slotToRow = (slot: string): string => (slot === ON_DEMAND_SLOT ? STORED_AS : slot);

/** The slot as Atlas reads it back from the database. */
export const slotFromRow = (slot: string): string => (slot === STORED_AS ? ON_DEMAND_SLOT : slot);

/** How a match came to you, in words: "in the morning brief", or "when you asked for more". */
export const shownHow = (slot: string): string => (slot === ON_DEMAND_SLOT ? "when you asked for more" : `in the ${slot} brief`);

/**
 * The found matches still waiting on you: found on demand in the last few days and not
 * yet rated or queued. In the brief's order: Utah remote or hybrid, then remote, then
 * offices nearby; best first within each. Today's picks (applyPlan.ts) are drawn from the
 * briefs only, so nothing here is also listed there.
 */
export function toReview(matches: readonly JobMatch[], today: LocalDate): JobMatch[] {
  const rank = (m: JobMatch) => TIER_ORDER.indexOf(tierOfStored(m.location));
  return matches
    .filter((m) => m.shownSlot === ON_DEMAND_SLOT && m.status === "new" && m.rating === 0 && daysBetween(m.shownOn, today) <= REVIEW_DAYS)
    .sort((a, b) => rank(a) - rank(b) || b.score - a.score || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}

/** What one press of "Find more good fits" did, agent by agent. */
export interface DeskSearch {
  /** New postings the Scout recorded, or null when it could not run. */
  scout: number | null;
  /** The Analyst's market report: recomputed, kept because nothing new was recorded, or not produced. */
  analyst: "updated" | "kept" | "failed";
  /** Good fits the Applications Agent added. */
  found: number;
  allFailed: boolean;
}

/** What the button says back: what each Career desk agent did, in the order they ran. */
export function deskMessage(d: DeskSearch): { ok: boolean; text: string } {
  if (d.allFailed) return { ok: false, text: "No job feed could be read just now. Try again in a few minutes." };
  const s = (n: number) => (n === 1 ? "" : "s");
  const scout = d.scout === null ? "Scout could not run." : d.scout === 0 ? "Scout found no new postings." : `Scout recorded ${d.scout} new posting${s(d.scout)}.`;
  const analyst = d.analyst === "updated" ? "Analyst updated the market report." : d.analyst === "kept" ? "Analyst's report from today still stands." : "Analyst could not update the report.";
  const none = "Applications found no new good fits: every posting that fits has been shown. The feeds bring new postings about every half hour.";
  const picked = d.found === 0 ? none : `Applications added ${d.found} new good fit${s(d.found)}, below.`;
  return { ok: true, text: `${scout} ${analyst} ${picked}` };
}
