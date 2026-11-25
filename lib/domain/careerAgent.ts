// The Applications Agent, part 5a: job matching. Pure: the runner
// (lib/agents/career.ts) fetches the public feeds and passes everything in.
//
// Each brief gets up to 10 matches, in one list, never shown before (the 2:00 PM matches never
// repeat the morning's, nor any earlier day's). What you are looking for is in
// lib/domain/searchProfile.ts (set by you on 18 Nov 2026). A posting is a match when:
//   - its title is one of your target roles (lib/domain/targetRoles.ts), junior to mid
//     level. Senior, staff, principal, lead, manager, director and above are out. Junior,
//     Associate, "Engineer I" and "Engineer II" rank higher; "Engineer III" and a
//     Specialist title with no base pay posted rank lower;
//   - it is a full-time role. Contract, freelance, part-time and hourly postings are
//     left out (since 18 Nov 2026 Atlas looks for full-time roles only);
//   - you could work it from Salt Lake City (lib/domain/workplace.ts): a Utah company that is
//     remote or hybrid, a remote role open to the U.S., or an office within a 45-minute
//     drive. The brief shows them in that order;
//   - its pay, when posted, reaches your salary floor ($100k unless Settings says
//     otherwise). No posted pay is fine: it is marked "salary not listed". A figure that
//     includes variable pay (OTE, commission, bonus) is marked so, and the base is used
//     when stated;
//   - it is fresh: posted in the last 30 days.
// Ranking: freshest first (the last 24-48 hours get far more responses), then role
// priority, place, pay that reaches your target ($120k), level, and your thumbs up/down
// on earlier matches. Two signs a posting is not for you rank it down: pay that starts far
// above your target (a senior role under a plain title) and a specialty you do not build in.

import { contactForCompany } from "./career";
import { isDemoOnly } from "./careerDirection";
import type { Scorecard } from "./careerPrep";
import { extractSkills, type PortfolioProject } from "./skills";
import type { StandardReport } from "./chiefOfStaff";
import { SEARCH_DEFAULTS, thousands } from "./searchProfile";
import type { TargetRole } from "./targetRoles";
import type { BriefSlot, Contact, JobMatch, PayUnit } from "./types";
import { byTier, tierOfStored, TIER_SHORT, workplaceOf, type PlaceTier, type Workplace } from "./workplace";
import { levelFromYears } from "./scoutFocus";
import { aboveLevel, MAX_YEARS_DEFAULT } from "./levelPolicy";

export { whereFits, type Where } from "./workplace";

/** A posting as a feed gives it, before matching. */
export interface RawJob {
  key: string;
  source: string;
  title: string;
  company: string;
  url: string;
  location: string;
  /** Plain text from the listing (first few hundred characters), for full-time and pay hints. */
  text: string;
  postedAt: string | null;
  /** Pay the feed states in fields (Remote OK), in USD per year. */
  salaryMin?: number;
  salaryMax?: number;
  /** Skills the source already read from a full description (job boards with details). */
  skills?: string[];
  /** Years of experience and certifications the full description asks for (lib/domain/requirements.ts). */
  yearsMin?: number;
  certs?: string[];
}

export interface CareerPrefs {
  roles: TargetRole[];
  /** Posted pay below this rules a posting out. 0 means no floor. */
  minSalary: number;
  /** The base pay you are aiming at: a posting that reaches it ranks higher. Defaults to $120k. */
  targetSalary?: number;
  /** The most years of experience a posting may ask for (lib/domain/levelPolicy.ts). Defaults to 2. */
  maxYears?: number;
}

export interface Pay {
  min: number;
  max: number;
  unit: PayUnit;
  text: string;
  /**
   * What the figure covers, when the posting says. "base" is base pay alone. "variable"
   * means the figure includes commission, bonus or other variable pay (OTE) and the
   * posting states no base, so the base could be lower than the figure.
   */
  basis?: "base" | "variable";
}

// ---------------------------------------------------------------------------
// Title, level, full-time

const norm = (s: string) => ` ${s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9+]+/g, " ").trim()} `;
// "Staff+" and "Principal+" are written with a plus on some boards.
const TOO_SENIOR = / (staff\+?|principal\+?|distinguished|lead|head|director|vp|vice president|manager|chief|cto|architect manager) /;
const NOT_A_FIT = / (intern|internship|interviewer|qa|quality|test automation|sdet|tester|teacher|instructor|tutor|trainer|recruiter|marketing|sales representative|account executive) /;

// You are looking for a junior to mid level or associate role, not a senior one (18 Nov
// 2026). A senior title is still one of your roles (the Scout records it as the market,
// and an application to one is tracked), so it is not ruled out in roleFor: it is left
// out of the day's matches in candidates().
const SENIOR = / (senior|sr|snr|leadership) /;

// A project, program, implementation or delivery manager runs work, not people: one of your
// roles is AI Project Manager (20 Nov 2026), so "manager" in those titles is not a level.
const RUNS_WORK = / (project|program|implementation|delivery) manager /g;
const tooSenior = (t: string): boolean => TOO_SENIOR.test(t.replace(RUNS_WORK, " $1 "));

/** True for a title above your level (senior, staff, a people manager) or plainly not your kind of role (an intern, a recruiter). */
export const wrongLevel = (title: string): boolean => {
  const t = norm(title);
  return SENIOR.test(t) || tooSenior(t) || NOT_A_FIT.test(t);
};

/** True for a staff, principal, lead, director or people-manager title (a project or program manager is not one). */
export const tooSeniorTitle = (title: string): boolean => tooSenior(norm(title));

/** True for a senior title: one of your roles, above the level you are looking for. */
export const isSenior = (title: string): boolean => SENIOR.test(norm(title));

// A specialty in the title that your resumes do not cover: hardware and low-level systems,
// games, and native mobile apps. You build web software, integrations, automation and AI
// agents. Such a title is still a match (some are worth a look), but it ranks well below
// the rest.
const OFF_STACK = / (embedded|firmware|robotics|hardware|fpga|asic|kernel|compiler|compilers|graphics|gameplay|game|games|ios|android) /;

/** True when a title names a specialty outside what you build. */
export const isOffStack = (title: string): boolean => OFF_STACK.test(norm(title));

/**
 * A posting whose lowest posted pay is this many times your target is almost always a
 * senior role under a plain title ("Solutions Architect, $220k–$245k"). It ranks lower.
 */
export const SENIOR_PAY_FACTOR = 1.5;

/** True when the bottom of the posted base pay sits far above the figure you are aiming at. */
export function paysLikeSenior(pay: Pay | null, target: number): boolean {
  if (!pay || target <= 0 || pay.basis === "variable") return false;
  return pay.min >= (pay.unit === "hour" ? (target * SENIOR_PAY_FACTOR) / 2080 : target * SENIOR_PAY_FACTOR);
}

// Level words that do not rule a title out but move it up or down the list. You aim at
// junior and associate roles (23 Nov 2026): Junior, Associate, Entry level, New grad and
// Engineer I rank first. Engineer II is mid level: neither up nor down. Engineer III and
// above usually asks for more years than you have. A Specialist title usually posts lower pay.
const EARLY_LEVEL = / (engineer|developer|architect|consultant) (i|1) | (level|grade) (i|1) | (l1|ic1) | (junior|jr|associate|entry level|early career|new grad|graduate) /;
const MID_LEVEL = / (engineer|developer|architect|consultant) (ii|2) | (level|grade) (ii|2) | (l2|ic2) /;
const UPPER_LEVEL = / (engineer|developer|architect|consultant) (iii|iv|v|3|4|5) | (level|grade) (iii|iv|v|3|4|5) /;
const LOW_TITLE = / specialist /;
/** Titles that usually pay less: a match with no pay posted says so, so you ask. */
const ASK_ABOUT_PAY = / (associate|specialist|junior) /;

export type TitleLevel = "early" | "mid" | "low" | "upper" | null;

/** How a title's level reads: "early" for Junior, Associate, Entry level, level I; "mid" for level II; "upper" for level III and above; "low" for Specialist. */
export function titleLevel(title: string): TitleLevel {
  const t = norm(title);
  if (LOW_TITLE.test(t)) return "low";
  if (EARLY_LEVEL.test(t)) return "early";
  if (MID_LEVEL.test(t)) return "mid";
  return UPPER_LEVEL.test(t) ? "upper" : null;
}

const GENERIC_ROLE = (r: TargetRole) => norm(r.name) === " software engineer ";

/**
 * Your role this title matches. Specific roles win over the generic Software Engineer
 * ("Forward-Deployed Product Engineer" is an FDE role); otherwise your order decides.
 */
export function roleFor(title: string, roles: TargetRole[]): TargetRole | null {
  const t = norm(title);
  if (tooSenior(t) || NOT_A_FIT.test(t)) return null;
  // The longest matching title phrase wins ("workflow automation engineer" over
  // "automation engineer"); ties go to your order.
  // A role's excluded words keep the title out of it ("Workflow Software Engineer" is not Software Engineer 1).
  const best = (r: TargetRole) => (r.exclude?.some((x) => t.includes(norm(x))) ? 0 : Math.max(0, ...r.titles.filter((p) => t.includes(norm(p))).map((p) => norm(p).length)));
  const pickFrom = (list: TargetRole[]) => list.reduce<TargetRole | null>((top, r) => (best(r) > (top ? best(top) : 0) ? r : top), null);
  return pickFrom(roles.filter((r) => !GENERIC_ROLE(r))) ?? pickFrom(roles.filter(GENERIC_ROLE));
}

/** For "Role | Location | Type | Pay" style titles (Hacker News), the segment naming the role. */
export function displayTitle(title: string, role: TargetRole): string {
  if (!title.includes("|")) return title;
  const parts = title.split("|").map((p) => p.trim());
  return parts.find((p) => role.titles.some((t) => norm(p).includes(norm(t)))) ?? parts[0] ?? title;
}

// Atlas looks for full-time roles only (18 Nov 2026). These words mark a posting as
// contract, freelance, part-time or hourly work instead.
const NOT_FULL_TIME = /\b(contract|contractor|freelance|freelancer|part[- ]time|hourly|per hour|\/ ?hr|1099|fractional|short[- ]term|project[- ]based)\b/i;
const FULL_TIME = /\bfull[- ]time\b/i;

/**
 * False when a posting reads as contract, freelance, part-time or hourly work; such a
 * posting is neither matched nor recorded. A posting that says full-time counts as
 * full-time, unless its title says contract.
 */
export function isFullTime(raw: Pick<RawJob, "title" | "text">): boolean {
  const t = `${raw.title} ${raw.text}`;
  if (!NOT_FULL_TIME.test(t) || FULL_TIME.test(raw.title)) return true;
  return FULL_TIME.test(t) && !/\bcontract\b/i.test(raw.title);
}

// ---------------------------------------------------------------------------
// Pay

const num = (s: string, k: string | undefined) => {
  const n = Number(s.replace(/,/g, ""));
  return k && /k/i.test(k) ? n * 1000 : n;
};

type PayFigure = Pay & { at: number; end: number };

/** The first USD pay figure in the text, and where it sits: "$120k-$150k", "$120,000 – $150,000 per year", "$60/hr", "$60-80 per hour". */
function payAt(text: string): PayFigure | null {
  const m =/\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k)?\s*(?:-|–|—|to)\s*\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k)?(\s*(?:\/|per)\s*(?:hr|hour|h)\b)?/i.exec(text);
  const single = m ? null : /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s?(k)?(\s*(?:\/|per)\s*(?:hr|hour|h)\b)?/i.exec(text);
  const hit = m ?? single;
  if (!hit) return null;
  // "$1M seed round", "$2B valuation": money, not pay.
  if (/^\s?(m|mm|b|bn|million|billion)\b/i.test(text.slice(hit.index + hit[0].length))) return null;
  let min: number, max: number, hourly: boolean;
  if (m) {
    const k = m[4] ?? m[2];
    min = num(m[1]!, m[2] ?? (m[4] && Number(m[1]!.replace(/,/g, "")) < 1000 ? k : undefined));
    max = num(m[3]!, m[4]);
    hourly = Boolean(m[5]);
    // "$60-80" with no unit reads as hourly; tiny or odd ranges are not pay.
    if (!hourly && max < 1000) {
      if (max < 15 || max > 500) return null;
      hourly = true;
    }
  } else {
    min = max = num(single![1]!, single![2]);
    hourly = Boolean(single![3]);
    // A lone dollar figure is pay only when it says /hr or looks like a salary.
    if (!hourly && max < 20_000) return null;
  }
  if (hourly && (max < 10 || max > 1000)) return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return null;
  if (min > max) [min, max] = [max, min];
  const unit: PayUnit = hourly ? "hour" : "year";
  const label = hourly ? `$${min}${max !== min ? `–${max}` : ""}/hr` : `$${Math.round(min / 1000)}k${max !== min ? `–$${Math.round(max / 1000)}k` : ""}`;
  return { min, max, unit, text: label, at: hit.index, end: hit.index + hit[0].length };
}

// What a figure covers, read from the words right next to it (career direction, 18 Nov
// 2026: check whether a posted number is base pay or includes variable).
const VARIABLE_WORDS = "ote|on[- ]target earnings?|total (?:target )?(?:comp|compensation|cash)|target (?:comp|compensation|earnings)";
/** Before a figure: "OTE $140k", "total compensation of $150k". */
const VARIABLE_BEFORE = new RegExp(`\\b(?:${VARIABLE_WORDS})\\b`, "gi");
const BASE_BEFORE = /\bbase\b/gi;
/** After a figure: "$140k OTE", "$150k including commission". */
const VARIABLE_AFTER = new RegExp(`\\b(?:${VARIABLE_WORDS})\\b|\\b(?:including|incl|inclusive of)\\b\\.? (?:\\w+ )?(?:commission|bonus|variable|incentives?)\\b`, "i");
/** After a figure: "$95k base", "$95k + commission", "$95,000 plus annual bonus": the variable pay comes on top. */
const BASE_AFTER = /\bbase\b|(?:\+|\bplus\b|\bwith\b) ?(?:\w+ )?(?:commission|bonus|variable|incentives?)\b/i;
/** Words at the end of a stretch that introduce the next figure: "…, OTE $140k", "… base salary of $95k". */
const NEXT_LABEL = new RegExp(`\\b(?:${VARIABLE_WORDS}|base(?: salary| pay)?)\\b[^a-z$]*(?:(?:of|is|up to|from|range)[^a-z$]*)?$`, "i");

function basisAt(text: string, at: number, end: number): Pay["basis"] {
  // Before: only the words since the previous figure. The nearest word wins, so in
  // "$95k base, OTE $140k" the second figure is the OTE one.
  const before = (/[^$\d]*$/.exec(text.slice(Math.max(0, at - 40), at)) ?? [""])[0];
  const last = (re: RegExp) => [...before.matchAll(re)].reduce((i, m) => Math.max(i, m.index ?? -1), -1);
  const baseBefore = last(BASE_BEFORE);
  const variableBefore = last(VARIABLE_BEFORE);
  if (baseBefore >= 0 || variableBefore >= 0) return baseBefore > variableBefore ? "base" : "variable";
  // After: only the words up to the next figure, without the label that introduces it.
  const reach = text.slice(end, end + 48);
  const upToNext = (/^[^$]*/.exec(reach) ?? [""])[0];
  const after = upToNext.length < reach.length ? upToNext.replace(NEXT_LABEL, "") : upToNext;
  const baseAfter = after.search(BASE_AFTER);
  const variableAfter = after.search(VARIABLE_AFTER);
  if (baseAfter < 0 && variableAfter < 0) return undefined;
  return variableAfter < 0 || (baseAfter >= 0 && baseAfter < variableAfter) ? "base" : "variable";
}

const figure = (p: PayFigure): Pay => ({ min: p.min, max: p.max, unit: p.unit, text: p.text });

/**
 * Reads posted USD pay, and what it covers when the posting says. A figure that includes
 * variable pay (OTE, commission, bonus) is not your salary: when the posting also states
 * the base, the base is returned; otherwise the figure is returned marked as variable.
 */
export function parsePay(text: string, fields?: { min?: number; max?: number }): Pay | null {
  if (fields?.min || fields?.max) {
    const min = fields.min || fields.max!;
    const max = fields.max || fields.min!;
    return { min, max, unit: "year", text: `$${Math.round(min / 1000)}k${max !== min ? `–$${Math.round(max / 1000)}k` : ""}` };
  }
  const first = payAt(text);
  if (!first) return null;
  const basis = basisAt(text, first.at, first.end);
  if (basis === "base") return { ...figure(first), basis, text: `${first.text} base` };
  if (basis !== "variable") return figure(first);
  // The figure includes variable pay. Look a few figures further for the base.
  let from = first.end;
  for (let i = 0; i < 3; i++) {
    const next = payAt(text.slice(from));
    if (!next) break;
    if (basisAt(text, from + next.at, from + next.end) === "base") return { ...figure(next), basis: "base", text: `${next.text} base` };
    from += next.end;
  }
  return { ...figure(first), basis, text: `${first.text}, includes variable pay` };
}

/** What a match shows for pay. An Associate, Junior or Specialist title with no base posted says so: those usually pay less, so ask. */
export function payLabel(title: string, pay: Pay | null): string {
  if (pay) return pay.text.slice(0, 40);
  const low = ASK_ABOUT_PAY.exec(norm(title));
  return low ? `salary not listed · ${low[1]![0]!.toUpperCase()}${low[1]!.slice(1)} title` : "salary not listed";
}

/**
 * Posted pay below your salary floor rules a posting out; no posted pay never does. Pay
 * posted by the hour is compared as a full-time year (2,080 hours).
 */
export function payFits(pay: Pay | null, prefs: Pick<CareerPrefs, "minSalary">): boolean {
  if (!pay) return true;
  return pay.max >= (pay.unit === "hour" ? prefs.minSalary / 2080 : prefs.minSalary);
}

/**
 * True when the top of the posted pay reaches the figure you are aiming at. You negotiate
 * toward the top of a range, so "$100k–$125k" reaches $120k. A figure that includes
 * variable pay proves nothing about the base, so it never counts.
 */
export function reachesTarget(pay: Pay | null, target: number): boolean {
  if (!pay || target <= 0 || pay.basis === "variable") return false;
  return pay.max >= (pay.unit === "hour" ? target / 2080 : target);
}

/**
 * Whether a stored match's pay reaches your target, read back from its pay label.
 * Undefined when the match states no pay, or only a figure that includes variable pay.
 */
export function targetFromLabel(payText: string, target: number): "reaches" | "below" | undefined {
  if (target <= 0 || /includes variable pay/i.test(payText)) return undefined;
  const pay = parsePay(payText);
  return !pay ? undefined : reachesTarget(pay, target) ? "reaches" : "below";
}

// ---------------------------------------------------------------------------
// Ranking

const HOUR = 3_600_000;

export interface Candidate extends RawJob {
  role: TargetRole;
  /** Where it is worked, and how that fits where you live. */
  place: Workplace;
  pay: Pay | null;
  score: number;
}

/**
 * What your earlier thumbs say, per role, company and source. A Perfect fit counts double
 * (its rating is 2), and the skills its posting asks for are kept: a later posting that asks
 * for the same ones is more like the jobs you most want.
 */
export interface Taste {
  role: Map<string, number>;
  company: Map<string, number>;
  source: Map<string, number>;
  /** Skills your Perfect fit postings ask for, and in how many of them. */
  skills: Map<string, number>;
}

export function tasteFrom(rated: Pick<JobMatch, "role" | "company" | "source" | "rating" | "skills">[]): Taste {
  const t: Taste = { role: new Map(), company: new Map(), source: new Map(), skills: new Map() };
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k.toLowerCase(), (m.get(k.toLowerCase()) ?? 0) + v);
  for (const r of rated) {
    if (!r.rating) continue;
    add(t.role, r.role, r.rating);
    add(t.company, r.company, r.rating);
    add(t.source, r.source, r.rating);
    if (r.rating >= 2) for (const s of new Set(r.skills ?? [])) add(t.skills, s, 1);
  }
  return t;
}

/** How much a posting that shares skills with your Perfect fits gains, at most. */
export const PERFECT_LIKE_MAX = 12;

/**
 * What a posting gains for asking for the skills your Perfect fit postings ask for: 3 for
 * each shared skill, up to 12. Nothing when you have marked none.
 */
export function likePerfect(skills: readonly string[], taste: Pick<Taste, "skills">): number {
  if (taste.skills.size === 0) return 0;
  const shared = new Set(skills.map((s) => s.toLowerCase()).filter((s) => taste.skills.has(s))).size;
  return Math.min(PERFECT_LIKE_MAX, shared * 3);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * What a place adds to the score, in your order of preference: a Utah company you can
 * work for remotely, then one that is hybrid, then remote from anywhere in the U.S., then
 * an office inside the commute.
 */
const placeScore = (p: Workplace): number => (p.tier === "local-flex" ? (p.arrangement === "remote" ? 14 : 12) : p.tier === "remote" ? 8 : 5);

/** What a junior or associate title gains in the ranking, and what level III and above loses. */
export const EARLY_BONUS = 12;
export const UPPER_PENALTY = -15;

export function scoreCandidate(c: Omit<Candidate, "score">, roles: TargetRole[], taste: Taste, now: Date, targetSalary: number = SEARCH_DEFAULTS.salaryTarget): number {
  const ageH = c.postedAt ? (now.getTime() - Date.parse(c.postedAt)) / HOUR : 96;
  const fresh = ageH <= 24 ? 50 : ageH <= 48 ? 40 : ageH <= 96 ? 28 : ageH <= 168 ? 18 : ageH <= 336 ? 8 : 2;
  const priority = 12 - Math.min(10, roles.findIndex((r) => r.name === c.role.name) * 2);
  const place = placeScore(c.place);
  // Pay that reaches the figure you are aiming at counts most. A figure that includes
  // variable pay says less about your salary than a base figure does.
  const pay = !c.pay ? 0 : c.pay.basis === "variable" ? 2 : reachesTarget(c.pay, targetSalary) ? 8 : 4;
  // You aim at junior and associate roles (23 Nov 2026): Junior, Associate, Entry level and
  // Engineer I rank well ahead, Engineer II neither up nor down, III and above well behind.
  // A Specialist title usually pays less, so one with no base pay posted ranks lower; a
  // posted salary speaks for itself.
  // The title's level, or when it states none, the years the posting asks for (Step 1).
  const lvl = levelFromYears(c.title, c.text ?? "");
  const level = lvl === "early" ? EARLY_BONUS : lvl === "upper" ? UPPER_PENALTY : lvl === "low" && (!c.pay || c.pay.basis === "variable") ? -8 : 0;
  // Two signs a posting is not for you that its level words do not show: pay far above
  // your target (a senior role under a plain title), and a specialty you do not build in.
  const seniorPay = paysLikeSenior(c.pay, targetSalary) ? -8 : 0;
  const offStack = isOffStack(c.title) ? -12 : 0;
  // Career direction (Fable): skip demo-only pre-sales; keep implementation and internal SE roles.
  const demoOnly = c.role.name === "Solutions Engineer" && isDemoOnly(c.title, c.text ?? "") ? -15 : 0;
  const liked = clamp((taste.role.get(c.role.name.toLowerCase()) ?? 0) * 2, -10, 10) + clamp((taste.company.get(c.company.toLowerCase()) ?? 0) * 5, -15, 15) + clamp(taste.source.get(c.source.toLowerCase()) ?? 0, -5, 5);
  // More like the jobs you marked Perfect fit: the same skills asked for. Read only when you have marked one.
  const likeBest = taste.skills.size ? likePerfect(extractSkills(`${c.title} ${c.text ?? ""}`), taste) : 0;
  return fresh + priority + place + pay + level + seniorPay + offStack + demoOnly + liked + likeBest;
}

/** Turns raw postings into ranked candidates; postings that don't fit are dropped. */
export function candidates(raws: RawJob[], prefs: CareerPrefs, taste: Taste, now: Date, remoteBoards: ReadonlySet<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const r of raws) {
    const role = roleFor(r.title, prefs.roles);
    // Above your level (lib/domain/levelPolicy.ts): a senior or level III+ title, or more years asked than your limit.
    if (!role || !isFullTime(r) || aboveLevel(r.title, r.text ?? "", prefs.maxYears ?? MAX_YEARS_DEFAULT)) continue;
    const ageDays = r.postedAt ? (now.getTime() - Date.parse(r.postedAt)) / (24 * HOUR) : 0;
    if (ageDays > 30) continue;
    const place = workplaceOf(r.location, r.text, remoteBoards.has(r.source));
    if (!place) continue;
    const pay = parsePay(`${r.title} ${r.text}`, { min: r.salaryMin, max: r.salaryMax });
    if (!payFits(pay, prefs)) continue;
    const c = { ...r, title: displayTitle(r.title, role), role, place, pay };
    out.push({ ...c, score: scoreCandidate(c, prefs.roles, taste, now, prefs.targetSalary) });
  }
  return out.sort((a, b) => b.score - a.score || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}

/** How many postings are one of your roles but not full-time, so the run can say what it left out. */
export function notFullTimeCount(raws: readonly RawJob[], roles: TargetRole[]): number {
  return raws.filter((r) => roleFor(r.title, roles) !== null && !isFullTime(r)).length;
}

/** How many full-time postings are one of your roles at senior level, so the run can say what it left out. */
export function seniorCount(raws: readonly RawJob[], roles: TargetRole[], maxYears: number = MAX_YEARS_DEFAULT): number {
  return raws.filter((r) => roleFor(r.title, roles) !== null && isFullTime(r) && aboveLevel(r.title, r.text ?? "", maxYears)).length;
}

/**
 * Up to `n`, never seen before, one per company where possible. Up to `localSeats` of
 * them are kept for Utah postings (remote, hybrid or an office nearby) when there are any:
 * those are few, and a wave of fresh remote postings must not crowd them out.
 */
export function pick(cands: Candidate[], n: number, seen: ReadonlySet<string>, localSeats = 0): Candidate[] {
  const pool = cands.filter((c) => !seen.has(c.key));
  const chosen: Candidate[] = [];
  const companies = new Set<string>();
  const take = (from: Candidate[], limit: number, onePerCompany: boolean) => {
    for (const c of from) {
      if (chosen.length >= limit) break;
      if (chosen.includes(c)) continue;
      const co = c.company.toLowerCase();
      if (onePerCompany && companies.has(co)) continue;
      chosen.push(c);
      companies.add(co);
    }
  };
  take(pool.filter((c) => c.place.tier !== "remote"), Math.min(n, chosen.length + localSeats), true);
  take(pool, n, true);
  take(pool, n, false);
  return chosen;
}

// ---------------------------------------------------------------------------
// The report

export interface BriefMatch {
  /** The stored match id, so the thumbs in the brief can find it. */
  id: string;
  title: string;
  company: string;
  url: string;
  source: string;
  role: string;
  payText: string;
  location: string;
  postedAt: string | null;
  /** Someone you know there, for a referral. */
  referral?: string;
  /** Which of the brief's three place groups it belongs to. Absent on briefs saved before 18 Nov 2026. */
  tier?: PlaceTier;
  /** Whether its posted pay reaches the figure you are aiming at. Absent when no base pay is posted. */
  target?: "reaches" | "below";
}

export interface CareerSection {
  /**
   * This brief's matches, all full-time roles, in the order you asked for: Utah companies
   * that are remote or hybrid, then remote from anywhere in the U.S., then offices inside
   * the commute. Best first within each.
   */
  fullTime: BriefMatch[];
  /** Fridays: the week's job-search scorecard. Added in part 5b. */
  scorecard?: Scorecard;
}

export interface CareerAgentInput {
  slot: BriefSlot;
  /** Matches picked for this brief, already stored (so they have ids). */
  fullTime: JobMatch[];
  contacts: Contact[];
  failedSources: string[];
  sourceCount: number;
  pendingApprovals: number;
  /** Applications logged and moved from job emails this run. */
  tracked?: { created: number; updated: number };
  /** Follow-ups queued this run for applications that went quiet. */
  followUps?: number;
  /** The line for rejections you asked to hold for the brief (lib/domain/heardBack.ts). */
  held?: string | null;
  scorecard?: Scorecard;
  /** First weekday of the month: the portfolio project that closes the biggest skill gap. */
  project?: PortfolioProject | null;
  /** The base pay you are aiming at. Defaults to $120k. */
  targetSalary?: number;
}

export interface CareerAgentResult {
  section: CareerSection;
  report: StandardReport;
  allFailed: boolean;
}

export function toBriefMatch(m: JobMatch, contacts: Contact[], targetSalary: number = SEARCH_DEFAULTS.salaryTarget): BriefMatch {
  const who = contactForCompany(m.company, contacts);
  const target = targetFromLabel(m.payText, targetSalary);
  return {
    id: m.id,
    title: m.title,
    company: m.company,
    url: m.url,
    source: m.source,
    role: m.role,
    payText: m.payText,
    location: m.location,
    postedAt: m.postedAt,
    ...(who ? { referral: who.name } : {}),
    tier: tierOfStored(m.location),
    ...(target ? { target } : {}),
  };
}

export function careerAgentReport(input: CareerAgentInput): CareerAgentResult {
  const targetSalary = input.targetSalary ?? SEARCH_DEFAULTS.salaryTarget;
  // In the order you asked for; the order they came in (best first) holds within a group.
  const groups = byTier(input.fullTime.map((m) => toBriefMatch(m, input.contacts, targetSalary)));
  const fullTime = groups.flatMap((g) => g.matches);
  const places = groups.map((g) => `${g.matches.length} ${TIER_SHORT[g.tier]}`).join(", ");
  const reaching = fullTime.filter((m) => m.target === "reaches").length;
  const allFailed = input.sourceCount > 0 && input.failedSources.length >= input.sourceCount;
  const errors = input.failedSources.length
    ? [allFailed ? "Every job source failed; no new matches this brief." : `${input.failedSources.length} job source${input.failedSources.length === 1 ? "" : "s"} failed: ${input.failedSources.join(", ")}`]
    : [];
  const referrals = fullTime.filter((m) => m.referral);
  return {
    allFailed,
    section: { fullTime, ...(input.scorecard ? { scorecard: input.scorecard } : {}) },
    report: {
      agent: "career",
      headline: `${fullTime.length} full-time match${fullTime.length === 1 ? "" : "es"}${input.slot === "afternoon" ? " new since the morning" : ""}${places ? `: ${places}` : ""}.`,
      details: [
        ...fullTime.slice(0, 5).map((m) => `${m.role}: ${m.title} at ${m.company} (${[m.payText, m.location, m.source].filter(Boolean).join(", ")})`),
        ...(reaching ? [`${reaching} of ${fullTime.length} post pay that reaches your ${thousands(targetSalary)} target.`] : []),
        ...(input.tracked && (input.tracked.created || input.tracked.updated)
          ? [`From your email: ${input.tracked.created} application${input.tracked.created === 1 ? "" : "s"} logged, ${input.tracked.updated} moved on the board.`]
          : []),
        ...(input.held ? [input.held] : []),
        ...(input.followUps ? [`${input.followUps} follow-up${input.followUps === 1 ? "" : "s"} drafted for applications quiet for a week; in the Apply Queue.`] : []),
        ...(input.scorecard
          ? [`This week: ${input.scorecard.sent} sent, ${input.scorecard.replies} replies, ${input.scorecard.interviews} interviews, ${input.scorecard.offers} offers (${input.scorecard.responseRate}% response rate overall).`]
          : []),
        ...(input.project ? [`Portfolio project this month (closes your ${input.project.skill} gap): ${input.project.title}. Details on the Growth page.`] : []),
        ...referrals.map((m) => `Referral: you know ${m.referral} at ${m.company}; ask before applying.`),
      ],
      needsApproval: input.pendingApprovals ? [`${input.pendingApprovals} item${input.pendingApprovals === 1 ? "" : "s"} waiting in your apply queues`] : [],
      errors,
    },
  };
}

// ---------------------------------------------------------------------------
// Saved searches for sites with no public feed (their terms forbid scraping)

export interface SavedSearch {
  site: string;
  url: string;
  note: string;
}

export function savedSearches(roles: TargetRole[]): SavedSearch[] {
  const names = roles.map((r) => r.name.replace(/\+/g, "and"));
  const or = names.map((n) => `"${n}"`).join(" OR ");
  const q = encodeURIComponent;
  const first = q(names[0] ?? "AI Engineer");
  const indeed = q(names.map((n) => `"${n}"`).join(" or "));
  return [
    { site: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${q(or)}&f_TPR=r86400&f_WT=2`, note: "Your roles, remote, past 24 hours" },
    // Hybrid (3) and on-site (1) in the Salt Lake area: the jobs no public feed carries.
    { site: "LinkedIn · Salt Lake area", url: `https://www.linkedin.com/jobs/search/?keywords=${q(or)}&location=${q("Salt Lake City Metropolitan Area")}&f_TPR=r604800&f_WT=${q("1,3")}`, note: "Your roles, hybrid or on-site near Salt Lake, past week" },
    { site: "Indeed", url: `https://www.indeed.com/jobs?q=${indeed}&l=Remote&fromage=1`, note: "Your roles, remote, past day" },
    { site: "Indeed · near Salt Lake City", url: `https://www.indeed.com/jobs?q=${indeed}&l=${q(SEARCH_DEFAULTS.home)}&radius=25&fromage=7`, note: "Your roles within 25 miles of Salt Lake City, past week" },
    { site: "Glassdoor", url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${first}`, note: `${names[0] ?? "AI Engineer"}; change the role in the search` },
    { site: "Dice", url: `https://www.dice.com/jobs?q=${q(or)}&filters.postedDate=ONE`, note: "Your roles, past day" },
    { site: "Wellfound", url: "https://wellfound.com/jobs", note: "Startups; set role filters once in your profile" },
    { site: "YC Work at a Startup", url: "https://www.workatastartup.com/jobs", note: "YC startups" },
    { site: "Welcome to the Jungle", url: `https://www.welcometothejungle.com/en/jobs?query=${first}`, note: "Startups (formerly Otta)" },
    { site: "Silicon Slopes", url: "https://siliconslopes.com/jobs", note: "Utah tech, for Salt Lake hybrid roles" },
  ];
}
