// The five types of tech engineer the Market page groups jobs into (owner's choice, 23 Nov 2026):
// fixed groups of the Scout's role families, the same on every tab and every day, so they compare
// over time. Product and program roles are tech jobs but not engineering, and are counted apart.
//
// Pure: postings in, one card per type out. Every figure carries its sample size.

import { capPerCompany, MIN_SAMPLE } from "./marketSnapshot";
import { FAMILY_LABEL, SENIORITY_LABEL, type Family, type Seniority, type TechPosting } from "./techMarket";

export const ENG_TYPES = ["software", "data-ai", "cloud-devops", "security", "solutions-it"] as const;
export type EngType = (typeof ENG_TYPES)[number];

export const ENG_TYPE_INFO: Record<EngType, { label: string; families: readonly Family[]; what: string }> = {
  software: { label: "Software engineering", families: ["software"], what: "Back end, front end, full stack, mobile, embedded" },
  "data-ai": { label: "Data and AI/ML", families: ["data", "ai-ml"], what: "Data engineering and science, analytics, machine learning, AI" },
  "cloud-devops": { label: "Cloud, DevOps and infrastructure", families: ["devops-cloud"], what: "DevOps, SRE, platform, cloud, networks, systems" },
  security: { label: "Security", families: ["security"], what: "Application, cloud and network security, identity, SOC" },
  "solutions-it": { label: "Solutions and IT", families: ["solutions", "it-support"], what: "Solutions, sales and implementation engineering; IT and support" },
};

/** The engineering type a role family belongs to, or null for product and program roles. */
export function engTypeOf(family: Family): EngType | null {
  return ENG_TYPES.find((t) => ENG_TYPE_INFO[t].families.includes(family)) ?? null;
}

export interface EngTypeCard {
  type: EngType;
  label: string;
  what: string;
  /** The role families it is made of, as labeled elsewhere on the page. */
  families: string[];
  /** Active postings (not capped). */
  jobs: number;
  /** Share of the view's engineering jobs. */
  share: number;
  /** Median yearly pay from postings that state it, per-company cap applied; null with none. */
  payMedian: number | null;
  payN: number;
  remoteShare: number;
  /** Postings the shares rest on, after the per-company cap. */
  base: number;
  small: boolean;
  topSkills: { skill: string; share: number }[];
  topCompanies: { company: string; n: number }[];
  /** The level stated most often, when any is stated. */
  topLevel: string | null;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
};

/**
 * One card per engineering type, biggest first, from the view's active postings (already filtered
 * to its tab and to the last 7 days), plus the product and program count left out.
 */
export function engTypeCards(active: readonly TechPosting[], companyCap?: number): { cards: EngTypeCard[]; notEngineering: number; engineering: number } {
  const byType = new Map<EngType, TechPosting[]>(ENG_TYPES.map((t) => [t, []]));
  let notEngineering = 0;
  for (const p of active) {
    const t = engTypeOf(p.family);
    if (t) byType.get(t)!.push(p);
    else notEngineering++;
  }
  const engineering = active.length - notEngineering;
  const cards = ENG_TYPES.map((type): EngTypeCard => {
    const all = byType.get(type)!;
    const capped = capPerCompany(all, companyCap);
    const pay = capped.flatMap((p) => (p.payMin !== null && p.payMax !== null ? [(p.payMin + p.payMax) / 2] : []));
    const withText = capped.filter((p) => p.skills.length);
    const skills = new Map<string, number>();
    for (const p of withText) for (const s of new Set(p.skills)) skills.set(s, (skills.get(s) ?? 0) + 1);
    const companies = new Map<string, number>();
    for (const p of all) if (p.company !== "Unknown company") companies.set(p.company, (companies.get(p.company) ?? 0) + 1);
    const levels = new Map<string, number>();
    for (const p of capped) if (p.seniority !== "unstated") levels.set(p.seniority, (levels.get(p.seniority) ?? 0) + 1);
    const top = [...levels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] as Seniority | undefined;
    const topLevel = top ? SENIORITY_LABEL[top] : null;
    const info = ENG_TYPE_INFO[type];
    return {
      type,
      label: info.label,
      what: info.what,
      families: info.families.map((f) => FAMILY_LABEL[f]),
      jobs: all.length,
      share: engineering ? all.length / engineering : 0,
      payMedian: median(pay),
      payN: pay.length,
      remoteShare: capped.length ? capped.filter((p) => p.mode === "remote").length / capped.length : 0,
      base: capped.length,
      small: capped.length < MIN_SAMPLE,
      topSkills: [...skills.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([skill, n]) => ({ skill, share: n / withText.length })),
      topCompanies: [...companies.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([company, n]) => ({ company, n })),
      topLevel,
    };
  }).sort((a, b) => b.jobs - a.jobs || ENG_TYPES.indexOf(a.type) - ENG_TYPES.indexOf(b.type));
  return { cards, notEngineering, engineering };
}
