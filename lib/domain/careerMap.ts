// The Career Map (owner's design, 23 Nov 2026): for each of the five engineering types, the three
// most common specialties in the job data, each laid out as a ladder (Junior -> Mid -> Senior ->
// Staff/Lead) with what each rung pays, asks for and who hires for it, and the steps to climb.
//
// Facts from rules, here; the steps' wording from the Career Mentor's model (lib/agents/careerMap.ts),
// checked against these facts (checkSteps). Rebuilt weekly and kept as a snapshot per week
// (career_maps), so the page can say what changed. Pure: postings in, map out.

import { z } from "zod";
import { addDays } from "./dates";
import { SPECIALTIES, specialtyOf } from "./engEvidence";
import { ENG_TYPE_INFO, ENG_TYPES, engTypeOf, type EngType } from "./engTypes";
import { capPerCompany, MIN_SAMPLE } from "./marketSnapshot";
import type { Family, TechPosting } from "./techMarket";
import type { LocalDate } from "./types";

export const RUNGS = ["junior", "mid", "senior", "staff+"] as const;
export type RungLevel = (typeof RUNGS)[number];
export const RUNG_LABEL: Record<RungLevel, string> = { junior: "Junior", mid: "Mid", senior: "Senior", "staff+": "Staff and lead" };
/** The map reads every stored job seen in this many days: more data per rung than the 7-day market view. */
export const MAP_DAYS = 60;
/** Paths per engineering type. */
export const PATHS_PER_TYPE = 3;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
};
const quantile = (xs: number[], q: number) => {
  if (xs.length < 4) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]!);
};
const top = <T extends string>(counts: Map<T, number>, base: number, k: number) =>
  [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, k)
    .map(([name, n]) => ({ name, n, share: base ? n / base : 0 }));

const Share = z.object({ name: z.string().max(80), n: z.number().int().min(0), share: z.number().min(0).max(1) });
const RungSchema = z.object({
  level: z.enum(RUNGS),
  jobs: z.number().int().min(0),
  payMedian: z.number().nullable(),
  payLow: z.number().nullable(),
  payHigh: z.number().nullable(),
  payN: z.number().int().min(0),
  yearsMedian: z.number().nullable(),
  yearsN: z.number().int().min(0),
  /** Postings at this rung that came with a description: the base of skill and certification shares. */
  textBase: z.number().int().min(0),
  skills: z.array(Share).max(8),
  /** Skills asked for clearly more often here than at the rung below. */
  newSkills: z.array(z.object({ name: z.string().max(80), share: z.number(), before: z.number() })).max(4),
  certs: z.array(Share).max(4),
  companies: z.array(Share).max(4),
  remoteShare: z.number().min(0).max(1),
  small: z.boolean(),
  /** Jobs placed on this rung by the years they ask for, because the title states no level. */
  fromYears: z.number().int().min(0).default(0),
});
export type Rung = z.infer<typeof RungSchema>;

/**
 * A job's rung: the level its title states, or, when it states none, the years it asks for
 * (0-2 junior, 3-4 mid, 5-7 senior, 8+ staff and lead). Null when neither says.
 */
export function rungFor(p: Pick<TechPosting, "seniority" | "yearsMin">): { level: RungLevel; byYears: boolean } | null {
  if ((RUNGS as readonly string[]).includes(p.seniority)) return { level: p.seniority as RungLevel, byYears: false };
  if (p.seniority !== "unstated" || !p.yearsMin) return null;
  const y = p.yearsMin;
  return { level: y <= 2 ? "junior" : y <= 4 ? "mid" : y <= 7 ? "senior" : "staff+", byYears: true };
}

const StepItem = z.object({ title: z.string().min(3).max(90), why: z.string().min(3).max(260) });
const StepSchema = z.object({ from: z.enum(RUNGS), to: z.enum(RUNGS), items: z.array(StepItem).max(3), writer: z.enum(["model", "rules"]) });
export type Step = z.infer<typeof StepSchema>;

const PathSchema = z.object({
  id: z.string().max(80),
  type: z.enum(ENG_TYPES),
  name: z.string().max(80),
  jobs: z.number().int().min(0),
  share: z.number().min(0).max(1),
  /** Jobs with no level in the title and no years asked, and manager titles: counted in the path, on no rung. */
  unstated: z.number().int().min(0),
  managers: z.number().int().min(0),
  payMedian: z.number().nullable(),
  payN: z.number().int().min(0),
  yours: z.boolean(),
  rungs: z.array(RungSchema).max(4),
  steps: z.array(StepSchema).max(3),
});
export type CareerPath = z.infer<typeof PathSchema>;

export const CareerMapSchema = z.object({
  week: z.string().max(10),
  at: z.string().max(40),
  days: z.number().int(),
  jobs: z.number().int().min(0),
  writer: z.enum(["model", "rules", "mixed"]),
  types: z.array(
    z.object({
      type: z.enum(ENG_TYPES),
      label: z.string().max(80),
      jobs: z.number().int().min(0),
      paths: z.array(PathSchema).max(PATHS_PER_TYPE),
      /** Official median pay for the closest occupation (BLS OEWS), when read. */
      gov: z.object({ occupation: z.string().max(80), us: z.number().nullable(), utah: z.number().nullable(), year: z.string().max(4).nullable() }).nullable(),
    }),
  ),
});
export type CareerMap = z.infer<typeof CareerMapSchema>;

/** The Monday a day's week starts on: the key a weekly snapshot is stored under. */
export function weekOf(day: LocalDate): LocalDate {
  const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/** The specialties that can be a path: every one but the type's catch-all ("General software"). */
const catchAll = (type: EngType) => SPECIALTIES[type].at(-1)![0];

/** Every skill's share at a rung, not only the top ones: what "new at the next rung" compares with. */
type Below = { shares: Map<string, number>; base: number };

function rungOf(level: RungLevel, ps: readonly TechPosting[], below: Below | null, cap: number | undefined): { rung: Rung; full: Below } {
  const capped = capPerCompany(ps, cap);
  const pay = capped.flatMap((p) => (p.payMin !== null && p.payMax !== null ? [(p.payMin + p.payMax) / 2] : []));
  const years = capped.flatMap((p) => (p.yearsMin ? [p.yearsMin] : []));
  const withText = capped.filter((p) => p.skills.length > 0);
  const skills = new Map<string, number>();
  const certs = new Map<string, number>();
  for (const p of withText) {
    for (const s of new Set(p.skills)) skills.set(s, (skills.get(s) ?? 0) + 1);
    for (const c of new Set(p.certs ?? [])) certs.set(c, (certs.get(c) ?? 0) + 1);
  }
  const companies = new Map<string, number>();
  for (const p of ps) if (p.company !== "Unknown company") companies.set(p.company, (companies.get(p.company) ?? 0) + 1);
  const shares = top(skills, withText.length, 8);
  const full: Below = { shares: new Map([...skills.entries()].map(([k, n]) => [k, n / Math.max(1, withText.length)])), base: withText.length };
  // A skill is "new at this rung" when 10+ points more of its postings ask for it than below,
  // and both rungs rest on enough postings to say so.
  const newSkills =
    below && below.base >= 5 && withText.length >= 5
      ? shares
          .map((s) => ({ name: s.name, share: s.share, before: below.shares.get(s.name) ?? 0 }))
          .filter((s) => s.share - s.before >= 0.1)
          .sort((a, b) => b.share - b.before - (a.share - a.before))
          .slice(0, 4)
      : [];
  const rung: Rung = {
    level,
    jobs: ps.length,
    payMedian: median(pay),
    payLow: quantile(pay, 0.25),
    payHigh: quantile(pay, 0.75),
    payN: pay.length,
    yearsMedian: median(years),
    yearsN: years.length,
    textBase: withText.length,
    skills: shares,
    newSkills,
    certs: top(certs, withText.length, 4).filter((c) => c.n >= 2),
    companies: top(companies, ps.length, 4),
    remoteShare: capped.length ? capped.filter((p) => p.mode === "remote").length / capped.length : 0,
    small: capped.length < MIN_SAMPLE,
    fromYears: ps.filter((p) => rungFor(p)?.byYears).length,
  };
  return { rung, full };
}

const usdK = (n: number) => `$${Math.round(n / 1000)}k`;
const pctS = (x: number) => `${Math.round(x * 100)}%`;

/** Steps written by rules from the facts: the fallback when the model is off or its draft fails the check. */
export function rulesSteps(rungs: readonly Rung[]): Step[] {
  const out: Step[] = [];
  for (let i = 1; i < rungs.length; i++) {
    const a = rungs[i - 1]!;
    const b = rungs[i]!;
    const items: Step["items"] = [];
    for (const s of b.newSkills.slice(0, 2)) items.push({ title: `Learn ${s.name}`, why: `Asked in ${pctS(s.share)} of ${RUNG_LABEL[b.level]} postings with a description, against ${pctS(s.before)} at ${RUNG_LABEL[a.level]}.` });
    if (b.yearsMedian && b.yearsN >= 3) items.push({ title: `Build toward ${b.yearsMedian} years of experience`, why: `${RUNG_LABEL[b.level]} postings that state years ask a median of ${b.yearsMedian} (${b.yearsN} postings).` });
    const cert = b.certs[0];
    if (items.length < 3 && cert && cert.share >= 0.1) items.push({ title: `Consider ${cert.name}`, why: `Named in ${pctS(cert.share)} of ${RUNG_LABEL[b.level]} postings with a description.` });
    if (items.length === 0 && b.skills[0]) items.push({ title: `Go deeper in ${b.skills[0].name}`, why: `The skill ${RUNG_LABEL[b.level]} postings ask for most (${pctS(b.skills[0].share)}).` });
    out.push({ from: a.level, to: b.level, items: items.slice(0, 3), writer: "rules" });
  }
  return out;
}

/**
 * The map: for each type, its three most common specialties (by jobs seen in MAP_DAYS), each with
 * a rung per level the titles state. Paths whose role family is one of yours are marked.
 */
export function buildCareerMap(input: {
  postings: readonly TechPosting[];
  day: LocalDate;
  now: string;
  yourFamilies?: ReadonlySet<Family>;
  companyCap?: number;
  gov?: Partial<Record<EngType, CareerMap["types"][number]["gov"]>>;
}): CareerMap {
  const from = addDays(input.day, -(MAP_DAYS - 1));
  const seen = input.postings.filter((p) => p.lastSeen >= from && p.firstSeen <= input.day);
  const yours = input.yourFamilies ?? new Set<Family>();
  const types = ENG_TYPES.map((type) => {
    const ofType = seen.filter((p) => engTypeOf(p.family) === type);
    const bySpec = new Map<string, TechPosting[]>();
    for (const p of ofType) {
      const s = specialtyOf(type, p.title);
      bySpec.set(s, [...(bySpec.get(s) ?? []), p]);
    }
    // The three biggest named specialties; the catch-all only when fewer than three have jobs.
    const ranked = [...bySpec.entries()].sort((a, b) => Number(a[0] === catchAll(type)) - Number(b[0] === catchAll(type)) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const paths = ranked.slice(0, PATHS_PER_TYPE).map(([name, ps]): CareerPath => {
      const rungs: Rung[] = [];
      let below: Below | null = null;
      for (const level of RUNGS) {
        const r = rungOf(level, ps.filter((p) => rungFor(p)?.level === level), below, input.companyCap);
        rungs.push(r.rung);
        below = r.full;
      }
      const pay = capPerCompany(ps, input.companyCap).flatMap((p) => (p.payMin !== null && p.payMax !== null ? [(p.payMin + p.payMax) / 2] : []));
      return {
        id: `${type}:${slug(name)}`,
        type,
        name,
        jobs: ps.length,
        share: ofType.length ? ps.length / ofType.length : 0,
        unstated: ps.filter((p) => p.seniority !== "manager" && rungFor(p) === null).length,
        managers: ps.filter((p) => p.seniority === "manager").length,
        payMedian: median(pay),
        payN: pay.length,
        yours: ps.some((p) => yours.has(p.family)),
        rungs,
        steps: rulesSteps(rungs),
      };
    });
    return { type, label: ENG_TYPE_INFO[type].label, jobs: ofType.length, paths, gov: input.gov?.[type] ?? null };
  });
  return { week: weekOf(input.day), at: input.now, days: MAP_DAYS, jobs: seen.length, writer: "rules", types };
}

// ---- the model's steps, and the check they must pass ----

/** One type's facts for the model: every number it may write, keyed. */
export function pathFacts(t: CareerMap["types"][number]): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const p of t.paths) {
    out.push({ key: `${p.id}.jobs`, value: `${p.jobs} jobs, ${pctS(p.share)} of ${t.label}` });
    for (const r of p.rungs) {
      const k = `${p.id}.${r.level}`;
      out.push({ key: `${k}.jobs`, value: `${r.jobs} ${RUNG_LABEL[r.level]} jobs` });
      if (r.payMedian) out.push({ key: `${k}.pay`, value: `median ${usdK(r.payMedian)}${r.payLow && r.payHigh ? `, middle half ${usdK(r.payLow)} to ${usdK(r.payHigh)}` : ""} (${r.payN} state pay)` });
      if (r.yearsMedian) out.push({ key: `${k}.years`, value: `median ${r.yearsMedian} years asked (${r.yearsN} postings)` });
      if (r.skills.length) out.push({ key: `${k}.skills`, value: r.skills.slice(0, 6).map((s) => `${s.name} ${pctS(s.share)}`).join(", ") });
      if (r.newSkills.length) out.push({ key: `${k}.new`, value: r.newSkills.map((s) => `${s.name} ${pctS(s.share)} vs ${pctS(s.before)} below`).join(", ") });
      if (r.certs.length) out.push({ key: `${k}.certs`, value: r.certs.map((c) => `${c.name} ${pctS(c.share)}`).join(", ") });
    }
  }
  if (t.gov?.us) out.push({ key: `${t.type}.gov`, value: `${t.gov.occupation}: official median ${usdK(t.gov.us)} U.S.${t.gov.utah ? `, ${usdK(t.gov.utah)} Utah` : ""}` });
  return out;
}

export const CareerStepsOut = z.object({
  paths: z
    .array(z.object({ id: z.string().max(80), steps: z.array(z.object({ from: z.enum(RUNGS), to: z.enum(RUNGS), items: z.array(StepItem).max(3) })).max(3) }))
    .max(PATHS_PER_TYPE + 2),
});

/** Number-like tokens ("$150k", "45%", "5"), normalized, so a draft can be checked against the facts. */
export function numbersIn(s: string): string[] {
  return [...s.matchAll(/\$?\d[\d,]*(?:\.\d+)?\s?(?:k|%)?/gi)].map((m) => m[0].replace(/[$,\s]/g, "").toLowerCase());
}

/**
 * A model-written step item passes when every number in it appears in the facts, it has no link or
 * markup, and it is about a move the path has. Otherwise it is dropped and the rules' step stands.
 */
export function checkSteps(path: CareerPath, drafted: { from: RungLevel; to: RungLevel; items: { title: string; why: string }[] }[], facts: readonly { value: string }[]): { steps: Step[]; dropped: number } {
  const allowed = new Set(facts.flatMap((f) => numbersIn(f.value)));
  let dropped = 0;
  const steps = path.steps.map((rules): Step => {
    const d = drafted.find((x) => x.from === rules.from && x.to === rules.to);
    if (!d) return rules;
    const kept = d.items.filter((it) => {
      const text = `${it.title} ${it.why}`;
      const ok = !/https?:|www\.|[<>*#`[\]]/.test(text) && numbersIn(text).every((n) => allowed.has(n));
      if (!ok) dropped++;
      return ok;
    });
    return kept.length ? { from: rules.from, to: rules.to, items: kept.slice(0, 3), writer: "model" } : rules;
  });
  return { steps, dropped };
}

// ---- what changed since last week ----

export interface MapChange {
  pathId: string;
  path: string;
  text: string;
}

/** Changes worth a line: a path new to the top three, a rung's median pay moving 5% or more, a new top skill. */
export function mapChanges(prev: CareerMap | null, cur: CareerMap): MapChange[] {
  if (!prev) return [];
  const before = new Map(prev.types.flatMap((t) => t.paths.map((p) => [p.id, p] as const)));
  const out: MapChange[] = [];
  for (const t of cur.types) {
    for (const p of t.paths) {
      const old = before.get(p.id);
      if (!old) {
        out.push({ pathId: p.id, path: p.name, text: `New in the top three for ${t.label} (${p.jobs} jobs).` });
        continue;
      }
      for (const r of p.rungs) {
        const o = old.rungs.find((x) => x.level === r.level);
        if (o?.payMedian && r.payMedian && o.payN >= 5 && r.payN >= 5) {
          const ch = (r.payMedian - o.payMedian) / o.payMedian;
          if (Math.abs(ch) >= 0.05) out.push({ pathId: p.id, path: p.name, text: `${RUNG_LABEL[r.level]} median pay ${ch > 0 ? "up" : "down"} ${pctS(Math.abs(ch))}: ${usdK(o.payMedian)} to ${usdK(r.payMedian)}.` });
        }
        const lead = r.skills[0]?.name;
        if (lead && o?.skills[0] && o.skills[0].name !== lead && r.textBase >= 10) out.push({ pathId: p.id, path: p.name, text: `${RUNG_LABEL[r.level]}: ${lead} is now the skill asked for most (was ${o.skills[0].name}).` });
      }
    }
  }
  return out.slice(0, 12);
}

/** A stored snapshot, or null when it does not parse (an older shape). */
export function parseMap(data: unknown): CareerMap | null {
  const p = CareerMapSchema.safeParse(data);
  return p.success ? p.data : null;
}
