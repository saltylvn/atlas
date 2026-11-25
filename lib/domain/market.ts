// The Career desk, stages 1 and 2: the Scout's observations and the Analyst's report.
//
//   Scout     turns the raw postings from the public feeds into market observations: one
//             row per full-time posting that is one of your roles, with its pay, location
//             and the skills it asks for. It records; it does not judge. Unlike the
//             Applications Agent's matches, a posting is kept even when it pays under your
//             floor or sits in the wrong city, because that is still what the market looks
//             like. Contract, freelance and part-time postings are not recorded: Atlas
//             looks at full-time roles only.
//   Analyst   reads those rows and computes the market report: demand and pay per role,
//             the skills asked for most, where you fit best, and your gaps, ranked.
//             Every number here is arithmetic over the Scout's rows. A model may word
//             the report afterwards (lib/agents/analyst.ts); it may not add a number.
//
// Pure: rows in, report out.

import { isFullTime, parsePay, roleFor, whereFits, type RawJob } from "./careerAgent";
import { addDays } from "./dates";
import type { RoleOutlook } from "./roleOutlook";
import { extractSkills, skillDemand, skillGaps } from "./skills";
import type { TargetRole } from "./targetRoles";
import type { LocalDate, PayUnit } from "./types";

/** One posting the Scout saw. */
export interface MarketPosting {
  id: string;
  /** Stable identity of the posting (source + id or url); unique per owner. */
  key: string;
  title: string;
  company: string;
  source: string;
  url: string;
  location: string;
  /** Which of your target roles the title is. */
  role: string;
  /** remote and salt-lake are places you can work; other is everywhere else. */
  place: "remote" | "salt-lake" | "other";
  /** Pay as posted, or null when the posting does not say. */
  payMin: number | null;
  payMax: number | null;
  payUnit: PayUnit;
  skills: string[];
  postedAt: string | null;
  /** The first and the latest day the Scout saw it. */
  firstSeen: LocalDate;
  lastSeen: LocalDate;
  createdAt: string;
}

export type NewMarketPosting = Omit<MarketPosting, "id" | "createdAt">;

/** How far back the report looks, and how long the Scout keeps a posting it no longer sees. */
export const MARKET_WINDOW_DAYS = 30;
export const MARKET_KEEP_DAYS = 120;

/** Raw postings to observations. A posting that is not one of your roles, or not full-time, is not recorded. */
export function observePostings(raws: readonly RawJob[], roles: TargetRole[], remoteBoards: ReadonlySet<string>, today: LocalDate): NewMarketPosting[] {
  const out = new Map<string, NewMarketPosting>();
  for (const r of raws) {
    const role = roleFor(r.title, roles);
    if (!role || !r.key || r.url.length > 600 || !isFullTime(r)) continue;
    const pay = parsePay(`${r.title} ${r.text}`, { min: r.salaryMin, max: r.salaryMax });
    out.set(r.key.slice(0, 600), {
      key: r.key.slice(0, 600),
      title: r.title.slice(0, 200),
      company: (r.company || "Unknown company").slice(0, 160),
      source: r.source.slice(0, 80),
      url: r.url,
      location: r.location.slice(0, 200),
      role: role.name.slice(0, 80),
      place: whereFits(r.location, remoteBoards.has(r.source)) ?? "other",
      payMin: pay ? Math.round(pay.min) : null,
      payMax: pay ? Math.round(pay.max) : null,
      payUnit: pay?.unit ?? "",
      skills: extractSkills(`${r.title} ${r.text}`).slice(0, 30),
      postedAt: r.postedAt,
      firstSeen: today,
      lastSeen: today,
    });
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// The Analyst's report

export interface SkillShare {
  skill: string;
  /** Share of this role's postings that ask for it, 0 to 1. */
  share: number;
  have: boolean;
}

export interface RoleMarket {
  role: string;
  /** Postings seen in the last 30 days, the last 7, and the 7 before that. */
  postings: number;
  thisWeek: number;
  lastWeek: number;
  trend: "up" | "down" | "flat";
  /** Share you could work: remote or Salt Lake. */
  reachable: number;
  /** Full-time postings that state pay, and their median midpoint in USD a year. */
  payListed: number;
  payMedian: number | null;
  topSkills: SkillShare[];
  /** How much of what this role asks for you already have: 0 to 1, weighted by how often each skill is asked. */
  coverage: number;
  topCompanies: string[];
}

export interface MarketGap {
  skill: string;
  /** Share of all your roles' postings that ask for it. */
  share: number;
  /** The roles that ask for it, most often first. */
  roles: string[];
}

export interface MarketReport {
  forDate: LocalDate;
  windowDays: number;
  /** Postings in the window across your roles, and how many sources they came from. */
  total: number;
  sources: number;
  /** Your roles in your priority order; a role with no postings is still listed. */
  roles: RoleMarket[];
  /** Where you fit best right now, or null when there is too little data to say. */
  bestFit: { role: string; coverage: number; postings: number } | null;
  /** Skills the market asks for that you have not marked as yours, most asked first. */
  gaps: MarketGap[];
  /** The report as plain sentences: what a reader, or a model wording it, is given. */
  facts: string[];
  /**
   * How qualified you are for each role, your own and the candidate roles next to them,
   * measured against your GitHub projects and resumes (lib/domain/roleOutlook.ts). The
   * Career Mentor reads this to propose your role order. Absent on reports from before it existed.
   */
  outlook?: RoleOutlook[];
  /** What the outlook was measured against. */
  evidence?: { projects: number; skillsShown: number };
  /** What your own applications say (lib/domain/outcomes.ts `findings`), most telling first. Added in Step 3. */
  funnel?: string[];
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2)) : null;
};
const money = (n: number) => `$${Math.round(n / 1000)}k`;

/** Fewer postings than this and a role's numbers are noise, not a trend. */
export const MIN_POSTINGS = 3;

export function marketReport(postings: readonly MarketPosting[], roles: TargetRole[], have: readonly string[], today: LocalDate, minSalary = 0): MarketReport {
  const since = addDays(today, -MARKET_WINDOW_DAYS);
  const week = addDays(today, -7);
  const prior = addDays(today, -14);
  const recent = postings.filter((p) => p.lastSeen >= since && roles.some((r) => r.name === p.role));
  const mine = new Set(have.map((h) => h.toLowerCase()));

  const perRole: RoleMarket[] = roles.map((role) => {
    const rows = recent.filter((p) => p.role === role.name);
    const thisWeek = rows.filter((p) => p.firstSeen >= week).length;
    const lastWeek = rows.filter((p) => p.firstSeen >= prior && p.firstSeen < week).length;
    const counts = new Map<string, number>();
    for (const p of rows) for (const s of new Set(p.skills)) counts.set(s, (counts.get(s) ?? 0) + 1);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const asked = ranked.reduce((n, [, c]) => n + c, 0);
    const covered = ranked.filter(([s]) => mine.has(s.toLowerCase())).reduce((n, [, c]) => n + c, 0);
    const pays = rows.filter((p) => p.payUnit === "year" && p.payMin !== null && p.payMax !== null).map((p) => (p.payMin! + p.payMax!) / 2);
    const companies = new Map<string, number>();
    for (const p of rows) if (p.company !== "Unknown company") companies.set(p.company, (companies.get(p.company) ?? 0) + 1);
    return {
      role: role.name,
      postings: rows.length,
      thisWeek,
      lastWeek,
      // A change only counts as a trend with enough postings behind it.
      trend: thisWeek + lastWeek < 6 ? "flat" : thisWeek >= lastWeek * 1.3 ? "up" : thisWeek <= lastWeek * 0.7 ? "down" : "flat",
      reachable: rows.length ? rows.filter((p) => p.place !== "other").length / rows.length : 0,
      payListed: pays.length,
      payMedian: median(pays),
      topSkills: ranked.slice(0, 8).map(([skill, c]) => ({ skill, share: c / rows.length, have: mine.has(skill.toLowerCase()) })),
      coverage: asked ? covered / asked : 0,
      topCompanies: [...companies.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([c]) => c),
    };
  });

  // Best fit: what you already cover, counted only where there is real demand you can reach.
  // With no skills marked there is nothing to measure against, so no fit is named.
  const fit = perRole
    .filter((r) => r.postings >= MIN_POSTINGS && r.topSkills.length > 0 && r.coverage > 0)
    .map((r) => ({ r, score: r.coverage * (0.5 + 0.5 * Math.min(1, r.postings / 20)) * (0.6 + 0.4 * r.reachable) * (r.payMedian !== null && r.payMedian < minSalary ? 0.7 : 1) }))
    .sort((a, b) => b.score - a.score)[0];

  const demand = skillDemand(recent, roles, have);
  // A "gap" only means something against skills you have marked. With none marked, every skill would be one.
  const gaps: MarketGap[] = mine.size === 0 ? [] : skillGaps(demand, 6).map((g) => ({ skill: g.skill, share: recent.length ? g.count / recent.length : 0, roles: g.roles.slice(0, 3) }));

  const facts: string[] = [];
  if (recent.length === 0) facts.push("The Scout has recorded no postings for your roles yet.");
  else {
    facts.push(`${recent.length} postings for your ${roles.length} roles in the last ${MARKET_WINDOW_DAYS} days, from ${new Set(recent.map((p) => p.source)).size} sources.`);
    for (const r of perRole.filter((x) => x.postings > 0).sort((a, b) => b.postings - a.postings).slice(0, 4)) {
      facts.push(
        [
          `${r.role}: ${r.postings} postings, ${r.thisWeek} new this week${r.trend === "flat" ? "" : ` (${r.trend} from ${r.lastWeek} the week before)`}`,
          `${pct(r.reachable)} remote or Salt Lake`,
          r.payMedian !== null ? `median posted pay ${money(r.payMedian)} across ${r.payListed} that state it` : "",
          r.topSkills.length ? `most asked: ${r.topSkills.slice(0, 4).map((s) => `${s.skill} ${pct(s.share)}`).join(", ")}` : "",
          mine.size ? `you cover ${pct(r.coverage)} of what it asks` : "",
        ]
          .filter(Boolean)
          .join("; ") + ".",
      );
    }
    if (fit) facts.push(`Best fit right now: ${fit.r.role}. You cover ${pct(fit.r.coverage)} of the skills its ${fit.r.postings} postings ask for.`);
    if (mine.size === 0) facts.push("You have not marked any skills as yours, so where you fit and what you lack cannot be measured yet.");
    else if (gaps.length) facts.push(`Gaps, most asked first: ${gaps.slice(0, 4).map((g) => `${g.skill} (${pct(g.share)} of postings)`).join(", ")}.`);
    else if (demand.length) facts.push("No gaps: you have marked every skill these postings ask for most.");
  }

  return {
    forDate: today,
    windowDays: MARKET_WINDOW_DAYS,
    total: recent.length,
    sources: new Set(recent.map((p) => p.source)).size,
    roles: perRole,
    bestFit: fit ? { role: fit.r.role, coverage: fit.r.coverage, postings: fit.r.postings } : null,
    gaps,
    facts,
  };
}

/** How the report is worded: by the model, or these rules when there is none. */
export interface MarketSummary {
  headline: string;
  points: string[];
  /** The one thing to do about it. */
  focus: string;
  writer: "model" | "rules";
}

export function rulesSummary(r: MarketReport): MarketSummary {
  if (r.total === 0) return { headline: "No market data yet", points: r.facts, focus: "The Scout records postings at every 2-hour sync; the first report follows.", writer: "rules" };
  const top = [...r.roles].sort((a, b) => b.postings - a.postings)[0]!;
  return {
    headline: r.bestFit ? `Best fit: ${r.bestFit.role}, where you cover ${pct(r.bestFit.coverage)} of what is asked` : `${r.total} postings for your roles; ${top.role} has the most (${top.postings})`,
    points: r.facts.slice(0, 5),
    focus: r.facts.some((f) => f.startsWith("You have not marked any skills")) ? "Tick the skills you have on the Growth page. It takes two minutes and turns this report into advice." : r.gaps[0] ? `Close the top gap: ${r.gaps[0].skill}, asked for in ${pct(r.gaps[0].share)} of postings.` : "Keep applying to your best-fit role while demand holds.",
    writer: "rules",
  };
}

/**
 * True when every number in `texts` also appears in `facts`. A model that words a report
 * may round nothing and add nothing: if it writes a figure the facts do not hold, its
 * wording is thrown away and the rules' wording is shown.
 */
export function numbersGrounded(texts: readonly string[], facts: readonly string[]): boolean {
  const nums = (s: string) => s.match(/\d+(?:[.,]\d+)*%?k?/g) ?? [];
  const known = new Set(facts.flatMap(nums).map((n) => n.replace(/[%k,]/g, "")));
  return texts.flatMap(nums).every((n) => known.has(n.replace(/[%k,]/g, "")));
}

/** A stored report: the numbers, how they were worded, and when. */
export interface StoredMarketReport {
  id: string;
  forDate: LocalDate;
  report: MarketReport;
  summary: MarketSummary;
  createdAt: string;
}
