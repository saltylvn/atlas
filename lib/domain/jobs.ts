// Scores public job postings against your target keywords and locations,
// and summarizes the application pipeline (the career tracker) for the brief.

import type { CareerSnapshot, LocalDate } from "./types";

export interface MatchResult {
  score: number;
  matched: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();

/**
 * 70 points for the best title keyword hit (full phrase), up to 30 for location.
 * A posting with no title match scores 0, whatever its location.
 */
export function scorePosting(
  title: string,
  location: string,
  keywords: string[],
  locations: string[],
): MatchResult {
  const t = ` ${norm(title)} `;
  const matched = keywords.filter((k) => norm(k) && t.includes(` ${norm(k)} `));
  if (matched.length === 0) return { score: 0, matched: [] };

  let score = 70;
  const senior = /\b(senior|staff|principal|lead|sr)\b/.test(t);
  if (senior) score += 5;

  const loc = norm(location);
  const wantsRemote = locations.some((l) => norm(l) === "remote");
  const locHit = locations.find((l) => norm(l) && loc.includes(norm(l)));
  if (locHit) {
    matched.push(locHit);
    score += 25;
  } else if (wantsRemote && /\b(anywhere|distributed)\b/.test(loc)) {
    score += 20;
  }
  return { score: Math.min(100, score), matched };
}

export const ACTIVE_STAGES = ["Applied", "Reply", "Interview 1", "Interview 2", "Interview 3", "Interview 4", "Offer"];

export interface PipelineSummary {
  active: number;
  interviewing: number;
  offers: number;
  closed: number;
  byStage: { stage: string; count: number }[];
  upcomingInterviews: CareerSnapshot["interviews"];
  followUps: CareerSnapshot["applications"];
}

export function summarizePipeline(
  snapshot: CareerSnapshot,
  now: Date,
  today: LocalDate,
): PipelineSummary {
  const counts = new Map<string, number>();
  for (const a of snapshot.applications) counts.set(a.stage, (counts.get(a.stage) ?? 0) + 1);
  const count = (pred: (s: string) => boolean) =>
    [...counts.entries()].filter(([s]) => pred(s)).reduce((n, [, c]) => n + c, 0);

  const upcomingInterviews = snapshot.interviews
    .filter((i) => !/^cancel/i.test(i.status) && new Date(i.end || i.start) >= now)
    .sort((a, b) => a.start.localeCompare(b.start));

  const followUps = snapshot.applications
    .filter((a) => a.nextAction && a.nextActionDue && a.nextActionDue.slice(0, 10) <= today)
    .filter((a) => ACTIVE_STAGES.includes(a.stage));

  return {
    active: count((s) => ACTIVE_STAGES.includes(s)),
    interviewing: count((s) => s.startsWith("Interview")),
    offers: count((s) => s === "Offer"),
    closed: count((s) => s === "Rejected" || s === "Withdrawn"),
    byStage: [...counts.entries()]
      .map(([stage, c]) => ({ stage, count: c }))
      .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage)),
    upcomingInterviews,
    followUps,
  };
}

const ORDER = ["Draft", ...ACTIVE_STAGES, "On Hold", "Rejected", "Withdrawn"];
function stageOrder(stage: string): number {
  const i = ORDER.indexOf(stage);
  return i === -1 ? ORDER.length : i;
}
