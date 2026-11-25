// Your six roles as the job market's categories (owner's request, 23 Nov 2026): every tech
// job Atlas records falls into one of Software, Automation, Workflow, Solutions, Agentic or
// Forward Deployed Engineer, or into Other. Rules first, from the title; Gemini judges the
// titles the rules cannot place (part 3, lib/agents/lensJudge.ts). Pure.
//
// The rules read the title only, at any level: a Senior Software Engineer is still market
// demand for Software Engineers. (Your own matches leave senior titles out; this does not.)

import { ROLE_OPTIONS } from "./targetRoles";
import { addDays } from "./dates";
import { FAMILY_LABEL, type TechPosting } from "./techMarket";
import type { LocalDate } from "./types";

export const LENSES = ["software", "automation", "workflow", "solutions", "agentic", "fde"] as const;
export type Lens = (typeof LENSES)[number];
export type LensOrOther = Lens | "other";

export const LENS_LABEL: Record<LensOrOther, string> = {
  software: "Software Engineer",
  automation: "Automation Engineer",
  workflow: "Workflow Engineer",
  solutions: "Solutions Engineer",
  agentic: "Agentic Engineer",
  fde: "Forward Deployed Engineer",
  other: "Other tech roles",
};

/** The target role each lens stands for (lib/domain/targetRoles.ts): its titles and excluded words. */
const LENS_ROLE: Record<Lens, string> = {
  software: "Software Engineer 1",
  automation: "AI Automation Engineer",
  workflow: "AI Workflow Engineer",
  solutions: "AI Solutions Engineer",
  agentic: "Agentic Software Engineer",
  fde: "AI Forward Deployed Engineer",
};

/** The lens of one of your target roles ("Software Engineer 1" is software), or null for any other name. */
export function lensForRole(roleName: string): Lens | null {
  return LENSES.find((l) => LENS_ROLE[l] === roleName) ?? null;
}

/** Titles a Software Engineer lens also counts: the everyday names for the same work. */
const SOFTWARE_EXTRA = ["software developer", "full stack engineer", "fullstack engineer", "full stack developer", "backend engineer", "back end engineer", "frontend engineer", "front end engineer", "web developer", "application developer", "product engineer"];

const norm = (s: string) => ` ${s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9+]+/g, " ").trim()} `;

const RULES: { lens: Lens; titles: string[]; exclude: string[] }[] = LENSES.map((lens) => {
  const role = ROLE_OPTIONS.find((r) => r.name === LENS_ROLE[lens]);
  const titles = [...(role?.titles ?? []), ...(lens === "software" ? SOFTWARE_EXTRA : [])];
  return { lens, titles: titles.map(norm), exclude: (role?.exclude ?? []).map(norm) };
});

/**
 * The lens a job title falls under, by rules: the longest matching title phrase wins
 * ("workflow automation engineer" over "automation engineer"), and a lens's excluded words
 * keep a title out of it. Null when no rule places it: Other, until Gemini judges it.
 */
export function lensOf(title: string): Lens | null {
  const t = norm(title);
  let best: Lens | null = null;
  let bestLen = 0;
  for (const r of RULES) {
    if (r.exclude.some((x) => t.includes(x))) continue;
    for (const p of r.titles) if (p.length > bestLen && t.includes(p)) {
      best = r.lens;
      bestLen = p.length;
    }
  }
  return best;
}

export interface LensCompany {
  company: string;
  jobs: number;
  /** Jobs at this company by lens, largest first. */
  by: { lens: Lens; jobs: number }[];
}

export interface LensRow {
  lens: LensOrOther;
  label: string;
  /** Jobs seen in the last 30 days. */
  jobs30: number;
  /** Jobs seen in the last 7 days. */
  jobs7: number;
  /** New in the last 14 days, and in the 14 before: the trend. */
  new14: number;
  prev14: number;
  /** Share of all tech jobs seen in 30 days. */
  share: number;
  where: { utah: number; us: number; global: number; unstated: number };
  companies: { company: string; jobs: number }[];
  /** For Other only: its five biggest role families, each with its most common titles. */
  categories?: { label: string; jobs: number; titles: string[] }[];
  /** For your six roles: pay by level, skills, years and certifications (part 2). */
  profile?: LensProfile;
  /** Jobs placed here by Gemini's judgment of the title, not by the title rules (part 3). */
  byAi: number;
}

export interface LensStats {
  total30: number;
  rows: LensRow[];
  /** Companies hiring most for your six roles (Other left out), most jobs first. */
  topCompanies: LensCompany[];
  /** Titles Gemini has judged so far. */
  judgedTitles: number;
}

const TOP = 15;

/**
 * What the Other tech roles are: their five biggest role families (Data, Security, Product,
 * ...), each with its three most common titles, level words left off so "Senior Data
 * Engineer" and "Data Engineer" count as one.
 */
/** A title without its level words or what follows a comma or dash: "Senior Data Engineer, Ads" is "Data Engineer". */
export function bareTitle(t: string): string {
  // Level words lead a title and numerals end it: "Member of Technical Staff" keeps its "Staff".
  return t
    .replace(/[,(–—-].*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^((senior|sr\.?|staff|principal|lead|junior|jr\.?|associate)\s+)+/i, "")
    .replace(/\s+(i{1,3}|iv|[1-4])$/i, "")
    .trim();
}

/** The key a judged title is stored under: its bare form, lowercased. */
export const titleKey = (t: string): string => bareTitle(t).toLowerCase().slice(0, 80);

function otherCategories(jobs: readonly TechPosting[]): { label: string; jobs: number; titles: string[] }[] {
  const byFamily = new Map<string, TechPosting[]>();
  for (const p of jobs) byFamily.set(p.family, [...(byFamily.get(p.family) ?? []), p]);
  return [...byFamily]
    .map(([family, list]) => {
      const titles = new Map<string, number>();
      for (const p of list) {
        const t = bareTitle(p.title);
        if (t) titles.set(t, (titles.get(t) ?? 0) + 1);
      }
      const top = [...titles].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([t]) => t);
      return { label: FAMILY_LABEL[family as keyof typeof FAMILY_LABEL] ?? family, jobs: list.length, titles: top };
    })
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 5);
}

// ---------------------------------------------------------------------------
// Part 2: what each role asks for (pay by level, skills, years, certifications). Rules.

export const PROFILE_LEVELS = ["junior", "mid", "senior", "staff+"] as const;
export type ProfileLevel = (typeof PROFILE_LEVELS)[number];
export const PROFILE_LEVEL_LABEL: Record<ProfileLevel, string> = { junior: "Junior, associate or intern", mid: "Mid", senior: "Senior", "staff+": "Staff, principal or lead" };

export interface LensProfile {
  /** Median yearly pay (midpoint of the posted range) by level, with how many postings state it. */
  pay: { level: ProfileLevel; median: number | null; n: number }[];
  /** The skills asked most, as a share of the postings that name any skill. */
  skills: { skill: string; share: number }[];
  skillsFrom: number;
  /** Years of experience asked, among postings whose description states it. */
  years: { "0-2": number; "3-4": number; "5+": number; stated: number };
  /** Certifications named, most often first. */
  certs: { name: string; n: number }[];
  /** Postings whose description was read (they state years or name a certification). */
  certsFrom: number;
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
};

export function lensProfile(jobs: readonly TechPosting[]): LensProfile {
  const levelOf = (p: TechPosting): ProfileLevel | null => (p.seniority === "intern" || p.seniority === "junior" ? "junior" : p.seniority === "mid" || p.seniority === "senior" || p.seniority === "staff+" ? p.seniority : null);
  const pay = PROFILE_LEVELS.map((level) => {
    const mids = jobs.filter((p) => levelOf(p) === level && p.payMin != null).map((p) => ((p.payMin ?? 0) + (p.payMax ?? p.payMin ?? 0)) / 2);
    return { level, median: median(mids), n: mids.length };
  });
  const withSkills = jobs.filter((p) => p.skills.length > 0);
  const counts = new Map<string, number>();
  for (const p of withSkills) for (const s of new Set(p.skills)) counts.set(s, (counts.get(s) ?? 0) + 1);
  const skills = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([skill, n]) => ({ skill, share: n / withSkills.length }));
  const years = { "0-2": 0, "3-4": 0, "5+": 0, stated: 0 };
  for (const p of jobs) {
    if (p.yearsMin == null) continue;
    years.stated++;
    years[p.yearsMin <= 2 ? "0-2" : p.yearsMin <= 4 ? "3-4" : "5+"]++;
  }
  const certCounts = new Map<string, number>();
  for (const p of jobs) for (const c of p.certs ?? []) certCounts.set(c, (certCounts.get(c) ?? 0) + 1);
  const certs = [...certCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([name, n]) => ({ name, n }));
  return { pay, skills, skillsFrom: withSkills.length, years, certs, certsFrom: jobs.filter((p) => p.yearsMin != null || (p.certs?.length ?? 0) > 0).length };
}

// ---------------------------------------------------------------------------
// Part 3: Gemini judges the titles the rules cannot place (lib/agents/lensJudge.ts). Rules pick
// which, the model answers from a fixed list, and the answers are kept per bare title.

/** Families whose unplaced titles may still be one of your six roles: only these are judged. */
export const JUDGED_FAMILIES = new Set(["software", "ai-ml", "solutions", "devops-cloud"]);
export const JUDGE_BATCH = 40;
export const JUDGED_KEEP = 600;

export interface LensJudgments {
  /** The day the last batch was judged: once a day. */
  day: string;
  /** Bare title (titleKey) -> its lens or "other". Newest last; at most JUDGED_KEEP. */
  titles: Record<string, LensOrOther>;
}

export function lensJudgments(raw: unknown): LensJudgments {
  const r = raw as Partial<LensJudgments> | null | undefined;
  const ok = new Set<string>([...LENSES, "other"]);
  const titles: Record<string, LensOrOther> = {};
  if (r && typeof r.titles === "object" && r.titles) for (const [k, v] of Object.entries(r.titles)) if (typeof v === "string" && ok.has(v)) titles[k] = v as LensOrOther;
  return { day: typeof r?.day === "string" ? r.day : "", titles };
}

/** The lens of a posting: the title rules first, then Gemini's judgment of its bare title, else Other. */
export function lensWithJudged(title: string, judged: Readonly<Record<string, LensOrOther>> = {}): { lens: LensOrOther; by: "rules" | "ai" } {
  const l = lensOf(title);
  if (l) return { lens: l, by: "rules" };
  const j = judged[titleKey(title)];
  return j ? { lens: j, by: "ai" } : { lens: "other", by: "rules" };
}

/** The unplaced titles worth judging next: in a family that could be one of your roles, not judged yet, most common first. */
export function titlesToJudge(postings: readonly Pick<TechPosting, "title" | "family">[], judged: Readonly<Record<string, LensOrOther>>, max = JUDGE_BATCH): string[] {
  const counts = new Map<string, { title: string; n: number }>();
  for (const p of postings) {
    if (!JUDGED_FAMILIES.has(p.family) || lensOf(p.title)) continue;
    const k = titleKey(p.title);
    if (!k || k in judged) continue;
    const e = counts.get(k) ?? { title: bareTitle(p.title), n: 0 };
    e.n++;
    counts.set(k, e);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.title.localeCompare(b.title)).slice(0, max).map((e) => e.title);
}

/** Keeps only answers for titles that were asked, with a lens from the list; adds them, newest last, capped. */
export function mergeJudgments(prev: LensJudgments, asked: readonly string[], answers: readonly { title: string; lens: string }[], today: LocalDate): LensJudgments {
  const askedKeys = new Set(asked.map(titleKey));
  const ok = new Set<string>([...LENSES, "other"]);
  const titles = { ...prev.titles };
  for (const a of answers) {
    const k = titleKey(a.title);
    if (askedKeys.has(k) && ok.has(a.lens)) {
      delete titles[k];
      titles[k] = a.lens as LensOrOther;
    }
  }
  const keys = Object.keys(titles);
  for (const k of keys.slice(0, Math.max(0, keys.length - JUDGED_KEEP))) delete titles[k];
  return { day: today, titles };
}

/** The six lenses (and Other) over the last 30 days of stored postings. */
export function lensStats(postings: readonly TechPosting[], today: LocalDate, judged: Readonly<Record<string, LensOrOther>> = {}): LensStats {
  const d30 = addDays(today, -29);
  const d7 = addDays(today, -6);
  const d14 = addDays(today, -13);
  const d28 = addDays(today, -27);
  const recent = postings.filter((p) => p.lastSeen >= d30);
  const labeled = recent.map((p) => ({ p, ...lensWithJudged(p.title, judged) }));

  const rows: LensRow[] = [...LENSES, "other" as const].map((lens) => {
    const placed = labeled.filter((x) => x.lens === lens);
    const mine = placed.map((x) => x.p);
    const byCompany = new Map<string, number>();
    for (const p of mine) byCompany.set(p.company, (byCompany.get(p.company) ?? 0) + 1);
    const where = { utah: 0, us: 0, global: 0, unstated: 0 };
    for (const p of mine) where[p.region as keyof typeof where] = (where[p.region as keyof typeof where] ?? 0) + 1;
    return {
      lens,
      label: LENS_LABEL[lens],
      jobs30: mine.length,
      jobs7: mine.filter((p) => p.lastSeen >= d7).length,
      new14: mine.filter((p) => p.firstSeen >= d14).length,
      prev14: mine.filter((p) => p.firstSeen >= d28 && p.firstSeen < d14).length,
      share: recent.length ? mine.length / recent.length : 0,
      where,
      companies: [...byCompany].map(([company, jobs]) => ({ company, jobs })).sort((a, b) => b.jobs - a.jobs || a.company.localeCompare(b.company)).slice(0, 5),
      byAi: placed.filter((x) => x.by === "ai").length,
      ...(lens === "other" ? { categories: otherCategories(mine) } : { profile: lensProfile(mine) }),
    };
  });

  const byCo = new Map<string, Map<Lens, number>>();
  for (const { p, lens } of labeled) {
    if (lens === "other") continue;
    const m = byCo.get(p.company) ?? new Map<Lens, number>();
    m.set(lens, (m.get(lens) ?? 0) + 1);
    byCo.set(p.company, m);
  }
  const topCompanies = [...byCo]
    .map(([company, m]) => {
      const by = [...m].map(([lens, jobs]) => ({ lens, jobs })).sort((a, b) => b.jobs - a.jobs);
      return { company, jobs: by.reduce((n, x) => n + x.jobs, 0), by };
    })
    .sort((a, b) => b.jobs - a.jobs || a.company.localeCompare(b.company))
    .slice(0, TOP);

  return { total30: recent.length, rows, topCompanies, judgedTitles: Object.keys(judged).length };
}
