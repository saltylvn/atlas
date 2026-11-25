// The tech job market at a glance: what the Market page shows, computed from the cleaned layer
// (tech_postings) and the daily summary (market_daily).
//
// Rules a data scientist would hold it to:
//   - Every figure carries its sample size, and a figure under MIN_SAMPLE says it is small.
//   - Medians are computed from postings, never averaged from other medians.
//   - A trend needs history: a change is shown only when there is a day to compare with.
//   - It is a sample of what the Scout reads, not the whole market, and says so.
//
// Pure: rows in, view model out.

import { addDays } from "./dates";
import { sourceGroup } from "./jobSources";
import { ACTIVE_DAYS, FAMILIES, FAMILY_LABEL, SENIORITIES, SENIORITY_LABEL, type DailyRow, type Family, type Mode, type Seniority, type TechPosting } from "./techMarket";
import type { LocalDate } from "./types";

/** Under this many postings, a figure is shown as a small sample. */
export const MIN_SAMPLE = 20;
/**
 * In shares and medians, one company counts at most this many postings. A watched company's
 * whole board is read, so without a cap three large employers set the "market" pay and levels
 * (on 22 Nov 2026, three companies were 71% of the sample). Counts of postings stay uncapped.
 */
export const COMPANY_CAP = 25;

/** Each company's first COMPANY_CAP postings, in a stable order, so a re-render gives the same figures. */
export function capPerCompany(postings: readonly TechPosting[], cap = COMPANY_CAP): TechPosting[] {
  const seen = new Map<string, number>();
  return [...postings]
    .sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
    .filter((p) => {
      if (p.company === "Unknown company") return true;
      const c = (seen.get(p.company) ?? 0) + 1;
      seen.set(p.company, c);
      return c <= cap;
    });
}
/** A skill needs this many mentions in the current week to be called rising. */
const MIN_SKILL = 8;

/**
 * Which jobs a view is about (owner's design, 22-23 Nov 2026): "utah" is local Utah jobs (on-site or
 * hybrid, in Utah), "remote" is remote jobs open only in the U.S., "intl" is remote jobs open beyond
 * the U.S. that hire people in it (worldwide, the Americas, the U.S. and other countries), "all" is
 * everything. Utah local, Remote U.S. and International do not overlap.
 */
export type RegionFilter = "all" | "utah" | "remote" | "intl";

export interface Stat {
  value: number | null;
  n: number;
  small: boolean;
}

export interface FamilyTrend {
  family: Family;
  label: string;
  /** One of your target roles is in this family. */
  yours: boolean;
  /** Active postings per day, oldest first. */
  series: { day: LocalDate; active: number }[];
  latest: number;
  /** Change against 7 days earlier, or null with no history that far back. */
  change: number | null;
}

export interface PayRow<K extends string> {
  key: K;
  label: string;
  median: number;
  n: number;
  small: boolean;
}

export interface Share<K extends string> {
  key: K;
  label: string;
  n: number;
  share: number;
}

export interface SkillRow {
  skill: string;
  now: number;
  shareNow: number;
  shareBefore: number;
  /** Percentage points. */
  change: number;
}

export interface MarketSnapshot {
  day: LocalDate;
  region: RegionFilter;
  /** Active postings the snapshot rests on. */
  sample: number;
  /** Active postings after the per-company cap: the base of every share and median. */
  capped: number;
  /** Postings with text, the base of skill shares. */
  skillBase: number;
  sources: { name: string; n: number }[];
  active: Stat & { change: number | null };
  added7: number;
  gone7: number;
  remoteShare: Stat;
  hybridShare: Stat;
  /** Companies with an active posting in this view. */
  companyCount: number;
  payMedian: Stat;
  utah: number;
  trends: FamilyTrend[];
  payByFamily: PayRow<Family>[];
  payByLevel: PayRow<Seniority>[];
  levels: Share<Seniority>[];
  modes: Share<Mode>[];
  rising: SkillRow[];
  topSkills: { skill: string; n: number; share: number }[];
  companies: { company: string; n: number }[];
  /** Days of summary history behind the trends. */
  historyDays: number;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
};
const mid = (p: TechPosting) => (p.payMin !== null && p.payMax !== null ? (p.payMin + p.payMax) / 2 : null);
const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole);
export const inScope = (p: Pick<TechPosting, "region" | "mode">, f: RegionFilter): boolean =>
  f === "all" ? true : f === "remote" ? p.mode === "remote" && p.region !== "global" : f === "intl" ? p.mode === "remote" && p.region === "global" : p.region === "utah" && p.mode !== "remote";
/**
 * A summary row's count for a view: the summary keeps remote counts per region, so local Utah is
 * active minus remote there, Remote U.S. is remote outside "global", and International is remote in it.
 * Summary rows from before 23 Nov 2026 have no "global" region: their worldwide jobs count in Remote U.S.
 */
const dailyCount = (r: DailyRow, f: RegionFilter) =>
  f === "all" ? r.active : f === "remote" ? (r.region === "global" ? 0 : r.remote) : f === "intl" ? (r.region === "global" ? r.remote : 0) : r.region === "utah" ? r.active - r.remote : 0;

/** A tab's active postings: in its scope, seen in the last 7 days. */
export function activeInView(postings: readonly TechPosting[], day: LocalDate, region: RegionFilter): TechPosting[] {
  const from = addDays(day, -(ACTIVE_DAYS - 1));
  return postings.filter((p) => inScope(p, region) && p.lastSeen >= from && p.firstSeen <= day);
}

const MODE_LABEL: Record<Mode, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site", unstated: "Not stated" };

function payRows<K extends string>(groups: Map<K, number[]>, label: (k: K) => string): PayRow<K>[] {
  return [...groups.entries()]
    .flatMap(([key, xs]) => {
      const m = median(xs);
      return m === null ? [] : [{ key, label: label(key), median: m, n: xs.length, small: xs.length < MIN_SAMPLE }];
    })
    .sort((a, b) => b.median - a.median);
}

export function marketSnapshot(input: { postings: readonly TechPosting[]; daily: readonly DailyRow[]; day: LocalDate; region?: RegionFilter; yourFamilies?: ReadonlySet<Family>; companyCap?: number }): MarketSnapshot {
  const { day } = input;
  const region = input.region ?? "all";
  const yours = input.yourFamilies ?? new Set<Family>();
  const from = addDays(day, -(ACTIVE_DAYS - 1));
  const all = input.postings.filter((p) => inScope(p, region));
  const active = all.filter((p) => p.lastSeen >= from && p.firstSeen <= day);
  const n = active.length;
  // Shares and medians: each company counted at most COMPANY_CAP times. Counts stay uncapped.
  const capped = capPerCompany(active, input.companyCap);
  const cn = capped.length;
  // Skill shares rest on postings that came with text: some boards (SmartRecruiters, Workable, Recruitee, BambooHR) give a title only.
  const withText = capped.filter((p) => p.skills.length > 0);

  // Sources: how many active postings each one listed.
  const bySource = new Map<string, number>();
  for (const p of active) for (const s of p.sources) bySource.set(sourceGroup(s), (bySource.get(sourceGroup(s)) ?? 0) + 1);

  // Trends from the summary: active per family per day.
  const daily = input.daily.filter((r) => r.day <= day && dailyCount(r, region) > 0);
  const days = [...new Set(daily.map((r) => r.day))].sort();
  const total = (d: LocalDate, fam?: Family) => daily.filter((r) => r.day === d && (!fam || r.family === fam)).reduce((s, r) => s + dailyCount(r, region), 0);
  const weekAgo = addDays(day, -ACTIVE_DAYS);
  const hasWeekAgo = days.includes(weekAgo);
  const trends: FamilyTrend[] = FAMILIES.map((family) => {
    const series = days.slice(-30).map((d) => ({ day: d, active: total(d, family) }));
    const latest = days.includes(day) ? total(day, family) : (series.at(-1)?.active ?? 0);
    return { family, label: FAMILY_LABEL[family], yours: yours.has(family), series, latest, change: hasWeekAgo ? latest - total(weekAgo, family) : null };
  }).sort((a, b) => Number(b.yours) - Number(a.yours) || b.latest - a.latest);
  const latestTotal = days.includes(day) ? total(day) : n;

  // Pay, from postings: medians are never averaged from other medians.
  const paid = capped.filter((p) => mid(p) !== null);
  const famPay = new Map<Family, number[]>();
  const levelPay = new Map<Seniority, number[]>();
  for (const p of paid) {
    famPay.set(p.family, [...(famPay.get(p.family) ?? []), mid(p)!]);
    if (p.seniority !== "unstated" && p.seniority !== "intern") levelPay.set(p.seniority, [...(levelPay.get(p.seniority) ?? []), mid(p)!]);
  }
  const levelOrder = (k: Seniority) => SENIORITIES.indexOf(k);

  const count = <K extends string>(keys: readonly K[], of: (p: TechPosting) => K, label: (k: K) => string): Share<K>[] =>
    keys.map((key) => {
      const c = capped.filter((p) => of(p) === key).length;
      return { key, label: label(key), n: c, share: share(c, cn) };
    });

  // Skills: share of this week's new postings against the three weeks before.
  const fresh = capPerCompany(all, input.companyCap).filter((p) => p.firstSeen >= from && p.firstSeen <= day);
  const before = capPerCompany(all, input.companyCap).filter((p) => p.firstSeen < from && p.firstSeen >= addDays(day, -(ACTIVE_DAYS * 4 - 1)));
  const tally = (ps: readonly TechPosting[]) => {
    const m = new Map<string, number>();
    for (const p of ps) for (const s of new Set(p.skills)) m.set(s, (m.get(s) ?? 0) + 1);
    return m;
  };
  const nowT = tally(fresh);
  const beforeT = tally(before);
  const rising: SkillRow[] =
    before.length >= MIN_SAMPLE && fresh.length >= MIN_SAMPLE
      ? [...nowT.entries()]
          .filter(([, c]) => c >= MIN_SKILL)
          .map(([skill, c]) => {
            const shareNow = share(c, fresh.length);
            const shareBefore = share(beforeT.get(skill) ?? 0, before.length);
            return { skill, now: c, shareNow, shareBefore, change: Math.round((shareNow - shareBefore) * 1000) / 10 };
          })
          .filter((r) => r.change > 0)
          .sort((a, b) => b.change - a.change)
          .slice(0, 8)
      : [];
  const activeSkills = tally(withText);
  const companies = new Map<string, number>();
  for (const p of active) if (p.company !== "Unknown company") companies.set(p.company, (companies.get(p.company) ?? 0) + 1);

  return {
    day,
    region,
    sample: n,
    sources: [...bySource.entries()].map(([name, c]) => ({ name, n: c })).sort((a, b) => b.n - a.n),
    active: { value: latestTotal, n, small: n < MIN_SAMPLE, change: hasWeekAgo ? latestTotal - total(weekAgo) : null },
    // From the postings, so each view counts only its own jobs: new this week, and last seen 7 to 13 days ago.
    added7: all.filter((p) => p.firstSeen > weekAgo && p.firstSeen <= day).length,
    gone7: all.filter((p) => p.lastSeen <= weekAgo && p.lastSeen >= addDays(day, -(ACTIVE_DAYS * 2 - 1))).length,
    hybridShare: { value: cn ? share(capped.filter((p) => p.mode === "hybrid").length, cn) : null, n: cn, small: cn < MIN_SAMPLE },
    companyCount: companies.size,
    remoteShare: { value: cn ? share(capped.filter((p) => p.mode === "remote").length, cn) : null, n: cn, small: cn < MIN_SAMPLE },
    payMedian: { value: median(paid.map((p) => mid(p)!)), n: paid.length, small: paid.length < MIN_SAMPLE },
    utah: active.filter((p) => p.region === "utah").length,
    trends,
    payByFamily: payRows(famPay, (k) => FAMILY_LABEL[k]),
    payByLevel: payRows(levelPay, (k) => SENIORITY_LABEL[k]).sort((a, b) => levelOrder(a.key) - levelOrder(b.key)),
    levels: count(SENIORITIES, (p) => p.seniority, (k) => SENIORITY_LABEL[k]).filter((s) => s.n > 0),
    modes: count(["remote", "hybrid", "onsite", "unstated"] as const, (p) => p.mode, (k) => MODE_LABEL[k]).filter((s) => s.n > 0),
    rising,
    topSkills: [...activeSkills.entries()].map(([skill, c]) => ({ skill, n: c, share: share(c, withText.length) })).sort((a, b) => b.n - a.n).slice(0, 10),
    capped: cn,
    skillBase: withText.length,
    companies: [...companies.entries()].map(([company, c]) => ({ company, n: c })).sort((a, b) => b.n - a.n || a.company.localeCompare(b.company)).slice(0, 10),
    historyDays: days.length,
  };
}
