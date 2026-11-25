// Step 1 of the agent plan (23 Nov 2026): the Scout focuses on jobs Tyler can win.
// The live feed had 3 junior Software Engineer postings in 557, and 10 of 11 judged
// applications were rejected by a screen within days. So the Scout now:
//
//   levelFromYears  reads the level from the years a posting asks for, when its title states none
//   boardCheck      knows how to ask a company's own job board whether a queued job is still open
//   topFive         picks the five queued jobs to apply to today, by rules, with the reasons
//
// Pure. The Scout and the Apply page call these; nothing here reads or writes anything.

import { yearsAsked } from "./requirements";
import { titleLevel, type TitleLevel } from "./careerAgent";
import { daysBetween } from "./dates";
import { levelOf } from "./outcomes";
import { levelVerdict, MAX_YEARS_DEFAULT, type LevelVerdict } from "./levelPolicy";
import type { Approval, JobMatch, LocalDate } from "./types";

/** At or above this many years asked, a posting with no level in its title is a senior role. */
export const SENIOR_YEARS = 5;

/**
 * The level a posting reads as: its title's, or when the title states none, the years it asks
 * for (0-2 early, 3-4 mid, 5+ senior). Null when neither says.
 */
export function levelFromYears(title: string, text: string): TitleLevel {
  const fromTitle = titleLevel(title);
  if (fromTitle) return fromTitle;
  const years = text ? yearsAsked(text) : null;
  if (years === null) return null;
  return years <= 2 ? "early" : years < SENIOR_YEARS ? "mid" : "upper";
}

/** True when a posting with no level in its title asks for senior years: it is not one to apply to now. */
export const seniorByYears = (title: string, text: string): boolean => !titleLevel(title) && levelFromYears(title, text) === "upper";

// ---------------------------------------------------------------------------
// Still open?

/**
 * The public API address that answers whether a job page is still up, for the boards whose
 * job pages map to one: Greenhouse and Lever. Null for any other link (it is not checked).
 */
export function boardCheck(url: string): { board: "greenhouse" | "lever"; api: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean);
  if (/(^|\.)greenhouse\.io$/.test(u.hostname)) {
    // boards.greenhouse.io/{board}/jobs/{id} or job-boards.greenhouse.io/{board}/jobs/{id}
    const i = parts.indexOf("jobs");
    const board = i > 0 ? parts[i - 1] : null;
    const id = parts[i + 1] ?? u.searchParams.get("gh_jid");
    if (board && id && /^\d+$/.test(id)) return { board: "greenhouse", api: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}` };
    return null;
  }
  if (u.hostname === "jobs.lever.co" && parts.length >= 2 && /^[0-9a-f-]{36}$/i.test(parts[1]!)) {
    return { board: "lever", api: `https://api.lever.co/v0/postings/${encodeURIComponent(parts[0]!)}/${parts[1]}` };
  }
  return null;
}

/** What one check means: a 404 or 410 says the job is gone; anything else is not proof, so it stays. */
export const closedBy = (status: number | null): boolean => status === 404 || status === 410;

// ---------------------------------------------------------------------------
// Apply to these 5 today

export interface TopPick {
  kitId: string;
  title: string;
  url: string;
  score: number;
  /** Why it made the list, in a few words each. */
  why: string[];
}

export const TOP_N = 5;

export interface QueuedLevel {
  kitId: string;
  title: string;
  verdict: LevelVerdict;
}

/**
 * Each queued job against your level (lib/domain/levelPolicy.ts): its title, and the years its
 * kit says the posting asks for once the posting has been read.
 */
export function queueLevels(kits: readonly Approval[], matches: readonly JobMatch[], maxYears: number = MAX_YEARS_DEFAULT): QueuedLevel[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  return kits
    .filter((k) => k.kind === "application" && k.status === "pending")
    .map((k) => ({ kitId: k.id, title: k.title, verdict: levelVerdict((k.matchId ? byId.get(k.matchId)?.title : undefined) ?? k.title, k.detail, maxYears) }));
}

/**
 * The five queued jobs to apply to today, by rules: the match's own fit score, plus the most for a
 * Perfect fit (always first), plus the level you aim at (junior, associate, I), plus freshness (a posting a few
 * days old gets read; a month-old one rarely does), minus a senior read from its years. Jobs
 * with no match behind them (saved by hand) come after, newest first.
 */
export function topFive(kits: readonly Approval[], matches: readonly JobMatch[], today: LocalDate, perfect: ReadonlySet<string> = new Set(), maxYears: number = MAX_YEARS_DEFAULT): TopPick[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const picks: TopPick[] = [];
  for (const k of kits) {
    if (k.kind !== "application" || k.status !== "pending") continue;
    const m = k.matchId ? byId.get(k.matchId) : undefined;
    // Above your level (a senior title, or more years asked than your limit): never one to apply to today.
    const verdict = levelVerdict(m?.title ?? k.title, k.detail, maxYears);
    if (verdict.fit === "above") continue;
    const why: string[] = [];
    let score = m?.score ?? 0;
    if (k.matchId && perfect.has(k.matchId)) {
      score += 100;
      why.push("you marked it a Perfect fit");
    }
    const level = levelOf(m?.title ?? k.title);
    if (level === "early") {
      score += 20;
      why.push("entry level");
    } else if (level === "senior") score -= 40;
    // Years the posting asks for, once it has been read: within your limit ranks up; unknown says to check.
    if (verdict.years !== null) {
      score += 10;
      why.push(`asks for ${verdict.years} year${verdict.years === 1 ? "" : "s"}`);
    } else if (verdict.fit === "check") why.push("check the years asked");
    const posted = m?.postedAt ? m.postedAt.slice(0, 10) : null;
    if (posted) {
      const age = daysBetween(posted, today);
      if (age <= 3) {
        score += 15;
        why.push(`posted ${age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}`);
      } else if (age > 21) score -= 15;
    }
    if (m?.payText && /\$\s?\d/.test(m.payText)) why.push(m.payText);
    if (/^Referral: /m.test(k.detail)) why.push("you know someone there");
    const waited = daysBetween(k.createdAt.slice(0, 10), today);
    if (waited >= 5) why.push(`waiting ${waited} days`);
    picks.push({ kitId: k.id, title: k.title, url: k.url, score, why });
  }
  return picks.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, TOP_N);
}
