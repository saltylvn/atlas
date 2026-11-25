// The evidence behind the five engineering types (owner's request, 23 Nov 2026: "data backed, with
// the stats that support the most common categories"). Over the last 30 days of one tab's jobs:
// how much of the tech market each type holds, in how many companies and sources it shows up,
// whether it is growing, and the specialties inside it, read from job titles by rules.
//
// Pure: postings in, evidence out. No AI here; the AI check of the labels is typeCheck.ts.

import { addDays } from "./dates";
import { ENG_TYPE_INFO, ENG_TYPES, engTypeOf, type EngType } from "./engTypes";
import { sourceGroup } from "./jobSources";
import type { TechPosting } from "./techMarket";
import type { LocalDate } from "./types";

export const EVIDENCE_DAYS = 30;

const lower = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim()} `;

/** Specialties inside each type, checked in order; the first match wins, the last is the catch-all. */
export const SPECIALTIES: Record<EngType, readonly [string, RegExp][]> = {
  software: [
    ["Mobile", / (ios|android|mobile|react native|flutter) /],
    ["Embedded and firmware", / (embedded|firmware|kernel|driver|drivers|rtos) /],
    ["Full stack", / full ?stack /],
    ["Front end", / (front ?end|frontend|ui engineer|ui developer|web developer|react|angular|vue) /],
    ["Back end", / (back ?end|backend|api|server|distributed|java|golang|go|python|ruby|rails|node|.net|c#|scala|elixir|php|c\+\+|rust) /],
    ["General software", / /],
  ],
  "data-ai": [
    ["Machine learning and AI", / (machine learning|ml|ai|llm|genai|deep learning|computer vision|nlp|mlops|applied scientist|research scientist|research engineer) /],
    ["Data engineering", / (data engineer|data engineering|etl|data platform|analytics engineer|pipeline|pipelines|data architect) /],
    ["Data science", / (data scientist|data science) /],
    ["Analytics and BI", / (analyst|analytics|business intelligence|bi|tableau|power bi|looker) /],
    ["Databases", / (database|dba) /],
    ["Other data", / /],
  ],
  "cloud-devops": [
    ["Site reliability", / (site reliability|sre|reliability) /],
    ["Platform", / platform /],
    ["DevOps", / (devops|release|build engineer|ci cd) /],
    ["Cloud", / (cloud|aws|azure|gcp) /],
    ["Networks and systems", / (network|networks|systems engineer|infrastructure|noc|linux|systems) /],
    ["Other infrastructure", / /],
  ],
  security: [
    ["Application security", / (appsec|application security|product security|software security) /],
    ["Cloud and infrastructure security", / (cloud security|infrastructure security|network security|platform security) /],
    ["Security operations", / (soc|threat|incident|detection|security analyst|security operations|vulnerability|penetration|pentest|pentester|red team) /],
    ["Identity and access", / (iam|identity|access) /],
    ["Governance and compliance", / (grc|compliance|governance|risk|audit) /],
    ["General security", / /],
  ],
  "solutions-it": [
    ["Implementation and integration", / (implementation|implementations|integration|integrations|onboarding) /],
    ["Solutions and sales engineering", / (solutions?|sales|pre ?sales|forward deployed|customer engineer|field engineer|partner engineer|technical account) /],
    ["IT support", / (help ?desk|service desk|desktop support|it support|technical support|support engineer|support specialist|technician) /],
    ["Systems and IT administration", / (administrator|sysadmin|it manager|it analyst|business systems|systems analyst|salesforce|it specialist) /],
    ["Other IT", / /],
  ],
};

/** The specialty a title names within its type. */
export function specialtyOf(type: EngType, title: string): string {
  const t = lower(title);
  return SPECIALTIES[type].find(([, re]) => re.test(t))![0];
}

export interface TypeEvidence {
  type: EngType;
  label: string;
  /** Jobs seen in the window. */
  jobs: number;
  /** Share of all tech jobs in the window (engineering and product). */
  share: number;
  companies: number;
  /** Distinct sources it was listed by (company boards counted as one). */
  sources: number;
  /** Jobs first seen in the last 14 days, and in the 14 before: is it growing? */
  newRecent: number;
  newBefore: number;
  specialties: { name: string; n: number; share: number }[];
}

export interface Evidence {
  days: number;
  tech: number;
  engineering: number;
  /** Share of tech jobs the five types cover together. */
  coverage: number;
  product: number;
  types: TypeEvidence[];
  /** The biggest type is at least this many times the smallest: how lopsided the market is. */
  spread: number | null;
}

/** The evidence for one tab, from its postings (already in scope) seen in the last 30 days. */
export function engEvidence(postings: readonly TechPosting[], day: LocalDate): Evidence {
  const from = addDays(day, -(EVIDENCE_DAYS - 1));
  const recentFrom = addDays(day, -13);
  const beforeFrom = addDays(day, -27);
  const seen = postings.filter((p) => p.lastSeen >= from && p.firstSeen <= day);
  const byType = new Map<EngType, TechPosting[]>(ENG_TYPES.map((t) => [t, []]));
  let product = 0;
  for (const p of seen) {
    const t = engTypeOf(p.family);
    if (t) byType.get(t)!.push(p);
    else product++;
  }
  const tech = seen.length;
  const engineering = tech - product;
  const types = ENG_TYPES.map((type): TypeEvidence => {
    const ps = byType.get(type)!;
    const spec = new Map<string, number>();
    for (const p of ps) {
      const s = specialtyOf(type, p.title);
      spec.set(s, (spec.get(s) ?? 0) + 1);
    }
    return {
      type,
      label: ENG_TYPE_INFO[type].label,
      jobs: ps.length,
      share: tech ? ps.length / tech : 0,
      companies: new Set(ps.filter((p) => p.company !== "Unknown company").map((p) => p.company)).size,
      sources: new Set(ps.flatMap((p) => p.sources.map(sourceGroup))).size,
      newRecent: ps.filter((p) => p.firstSeen >= recentFrom).length,
      newBefore: ps.filter((p) => p.firstSeen >= beforeFrom && p.firstSeen < recentFrom).length,
      specialties: [...spec.entries()]
        .map(([name, n]) => ({ name, n, share: n / ps.length }))
        .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
        .slice(0, 4),
    };
  }).sort((a, b) => b.jobs - a.jobs || ENG_TYPES.indexOf(a.type) - ENG_TYPES.indexOf(b.type));
  const smallest = types.at(-1)!.jobs;
  return { days: EVIDENCE_DAYS, tech, engineering, coverage: tech ? engineering / tech : 0, product, types, spread: smallest > 0 ? types[0]!.jobs / smallest : null };
}
