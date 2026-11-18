// The Career Agent, part 5a: job and gig matching. Pure: the runner
// (lib/agents/career.ts) fetches the public feeds and passes everything in.
//
// Each brief gets up to 10 full-time and 10 gig matches, never shown before (the 2:00 PM
// matches never repeat the morning's, nor any earlier day's). A posting is a match when:
//   - its title is one of your target roles (lib/domain/targetRoles.ts), entry to mid
//     level (staff, principal, lead, manager, director and above are out; senior is
//     kept but ranked lower; "Engineer I" and "Engineer II" rank higher; an Associate or
//     Specialist title with no base pay posted ranks lower, because those usually pay less);
//   - it is remote and open to the U.S., or hybrid/onsite in Salt Lake County;
//   - its pay, when posted, meets your pay floors (a yearly salary and an hourly rate, set in Settings; none by default).
//     No posted pay is fine: it is marked "salary not listed". A figure that includes
//     variable pay (OTE, commission, bonus) is marked so, and the base is used when stated;
//   - it is fresh: 30 days for full-time, 21 for gigs.
// Ranking: freshest first (the last 24-48 hours get far more responses), then role
// priority, remote, posted pay, and your thumbs up/down on earlier matches.

import { contactForCompany } from "./career";
import { isDemoOnly } from "./careerDirection";
import type { Scorecard } from "./careerPrep";
import type { PortfolioProject } from "./skills";
import type { StandardReport } from "./chiefOfStaff";
import type { TargetRole } from "./targetRoles";
import type { BriefSlot, Contact, JobMatch, JobType, PayUnit } from "./types";

/** A posting as a feed gives it, before matching. */
export interface RawJob {
  key: string;
  source: string;
  title: string;
  company: string;
  url: string;
  location: string;
  /** Plain text from the listing (first few hundred characters), for type and pay hints. */
  text: string;
  postedAt: string | null;
  /** Pay the feed states in fields (Remote OK), in USD per year. */
  salaryMin?: number;
  salaryMax?: number;
  /** "gig" when the feed itself is for contract work (a freelancer thread). */
  typeHint?: JobType;
}

export interface CareerPrefs {
  roles: TargetRole[];
  minSalary: number;
  minRate: number;
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
// Title, level, type

const norm = (s: string) => ` ${s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9+]+/g, " ").trim()} `;
const TOO_SENIOR = / (staff|principal|distinguished|lead|head|director|vp|vice president|manager|chief|cto|architect manager) /;
const NOT_A_FIT = / (intern|internship|interviewer|qa|quality|test automation|sdet|tester|teacher|instructor|tutor|trainer|recruiter|marketing|sales representative|account executive) /;

// Level words that do not rule a title out but move it up or down the list (career
// direction, 18 Nov 2026): at entry to mid level, look for Engineer titles at level I or
// II; Associate and Specialist titles usually post lower pay.
const EARLY_LEVEL = / (engineer|developer|architect|consultant) (i|ii|1|2) | (level|grade) (i|ii|1|2) | (l1|l2|ic1|ic2) /;
const LOW_TITLE = / (associate|specialist) /;

export type TitleLevel = "early" | "low" | null;

/** How a title's level reads: "early" for level I or II, "low" for Associate or Specialist. */
export function titleLevel(title: string): TitleLevel {
  const t = norm(title);
  if (LOW_TITLE.test(t)) return "low";
  return EARLY_LEVEL.test(t) ? "early" : null;
}

const GENERIC_ROLE = (r: TargetRole) => norm(r.name) === " software engineer ";

/**
 * Your role this title matches. Specific roles win over the generic Software Engineer
 * ("Forward-Deployed Product Engineer" is an FDE role); otherwise your order decides.
 */
export function roleFor(title: string, roles: TargetRole[]): TargetRole | null {
  const t = norm(title);
  if (TOO_SENIOR.test(t) || NOT_A_FIT.test(t)) return null;
  // The longest matching title phrase wins ("workflow automation engineer" over
  // "automation engineer"); ties go to your order.
  const best = (r: TargetRole) => Math.max(0, ...r.titles.filter((p) => t.includes(norm(p))).map((p) => norm(p).length));
  const pickFrom = (list: TargetRole[]) => list.reduce<TargetRole | null>((top, r) => (best(r) > (top ? best(top) : 0) ? r : top), null);
  return pickFrom(roles.filter((r) => !GENERIC_ROLE(r))) ?? pickFrom(roles.filter(GENERIC_ROLE));
}

/** For "Role | Location | Type | Pay" style titles (Hacker News), the segment naming the role. */
export function displayTitle(title: string, role: TargetRole): string {
  if (!title.includes("|")) return title;
  const parts = title.split("|").map((p) => p.trim());
  return parts.find((p) => role.titles.some((t) => norm(p).includes(norm(t)))) ?? parts[0] ?? title;
}

const GIG = /\b(contract|contractor|freelance|freelancer|part[- ]time|hourly|per hour|\/ ?hr|1099|fractional|short[- ]term|project[- ]based)\b/i;
const FULL_TIME = /\bfull[- ]time\b/i;

export function jobType(raw: Pick<RawJob, "title" | "text" | "typeHint">): JobType {
  if (raw.typeHint) return raw.typeHint;
  const t = `${raw.title} ${raw.text}`;
  return GIG.test(t) && !FULL_TIME.test(raw.title) && !(FULL_TIME.test(t) && !/\bcontract\b/i.test(raw.title)) ? "gig" : "full-time";
}

// ---------------------------------------------------------------------------
// Location

const SALT_LAKE = /\b(salt lake|slc|herriman|sandy|draper|west jordan|south jordan|murray|riverton|taylorsville|west valley|millcreek|holladay|cottonwood heights|midvale|bluffdale|lehi)\b/i;
const REMOTE = /\b(remote|anywhere|distributed|work from home|wfh)\b/i;
const US_OK = /\b(us|usa|u\.s\.|united states|americas|north america|worldwide|global|anywhere)\b/i;
const NOT_US = /\b(europe|european|eu|eea|emea|dach|nordics|uk|united kingdom|germany|france|spain|netherlands|poland|india|latam|latin america|apac|asia|australia|canada|brazil|mexico|philippines|africa|cet|gmt\+)\b/i;

export type Where = "remote" | "salt-lake" | null;

/**
 * Remote and open to the U.S., or in Salt Lake County. Remote-only boards (Remote OK, We
 * Work Remotely) often leave the location blank or say "Anywhere": that counts as remote.
 */
export function whereFits(location: string, remoteBoard: boolean): Where {
  const l = location.trim();
  if (SALT_LAKE.test(l)) return "salt-lake";
  if (remoteBoard && (l === "" || US_OK.test(l))) return "remote";
  if (REMOTE.test(l) || remoteBoard) {
    if (NOT_US.test(l) && !US_OK.test(l)) return null;
    return "remote";
  }
  return null;
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

/** What a match shows for pay. An Associate or Specialist title with no base posted says so: those usually pay less. */
export function payLabel(title: string, pay: Pay | null): string {
  if (pay) return pay.text.slice(0, 40);
  const low = LOW_TITLE.exec(norm(title));
  return low ? `salary not listed · ${low[1] === "associate" ? "Associate" : "Specialist"} title` : "salary not listed";
}

/** Posted pay below your floor rules a posting out; no posted pay never does. */
export function payFits(pay: Pay | null, type: JobType, prefs: Pick<CareerPrefs, "minSalary" | "minRate">): boolean {
  if (!pay) return true;
  if (pay.unit === "hour") return pay.max >= (type === "gig" ? prefs.minRate : prefs.minSalary / 2080);
  return pay.max >= (type === "gig" ? prefs.minRate * 2080 : prefs.minSalary);
}

// ---------------------------------------------------------------------------
// Ranking

const HOUR = 3_600_000;

export interface Candidate extends RawJob {
  type: JobType;
  role: TargetRole;
  where: Exclude<Where, null>;
  pay: Pay | null;
  score: number;
}

/** What your earlier thumbs say, per role, company and source. */
export interface Taste {
  role: Map<string, number>;
  company: Map<string, number>;
  source: Map<string, number>;
}

export function tasteFrom(rated: Pick<JobMatch, "role" | "company" | "source" | "rating">[]): Taste {
  const t: Taste = { role: new Map(), company: new Map(), source: new Map() };
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k.toLowerCase(), (m.get(k.toLowerCase()) ?? 0) + v);
  for (const r of rated) {
    if (!r.rating) continue;
    add(t.role, r.role, r.rating);
    add(t.company, r.company, r.rating);
    add(t.source, r.source, r.rating);
  }
  return t;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function scoreCandidate(c: Omit<Candidate, "score">, roles: TargetRole[], taste: Taste, now: Date): number {
  const ageH = c.postedAt ? (now.getTime() - Date.parse(c.postedAt)) / HOUR : 96;
  const fresh = ageH <= 24 ? 50 : ageH <= 48 ? 40 : ageH <= 96 ? 28 : ageH <= 168 ? 18 : ageH <= 336 ? 8 : 2;
  const priority = 12 - Math.min(10, roles.findIndex((r) => r.name === c.role.name) * 2);
  const where = c.where === "remote" ? 8 : 5;
  // A figure that includes variable pay says less about your salary than a base figure does.
  const pay = c.pay ? (c.pay.basis === "variable" ? 2 : 5) : 0;
  const senior = / (senior|sr) /.test(norm(c.title)) ? -6 : 0;
  // Career direction (18 Nov 2026): at entry to mid level, Engineer I and II are the titles
  // to look for. Associate and Specialist titles usually pay less, so one with no base pay
  // posted ranks lower; a posted salary that clears your floor speaks for itself.
  const lvl = titleLevel(c.title);
  const level = lvl === "early" ? 4 : lvl === "low" && (!c.pay || c.pay.basis === "variable") ? -8 : 0;
  // Career direction (Fable): skip demo-only pre-sales; keep implementation and internal SE roles.
  const demoOnly = c.role.name === "Solutions Engineer" && isDemoOnly(c.title, c.text ?? "") ? -15 : 0;
  const liked = clamp((taste.role.get(c.role.name.toLowerCase()) ?? 0) * 2, -10, 10) + clamp((taste.company.get(c.company.toLowerCase()) ?? 0) * 5, -15, 15) + clamp(taste.source.get(c.source.toLowerCase()) ?? 0, -5, 5);
  return fresh + priority + where + pay + senior + level + demoOnly + liked;
}

/** Turns raw postings into ranked candidates; postings that don't fit are dropped. */
export function candidates(raws: RawJob[], prefs: CareerPrefs, taste: Taste, now: Date, remoteBoards: ReadonlySet<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const r of raws) {
    const role = roleFor(r.title, prefs.roles);
    if (!role) continue;
    const type = jobType(r);
    const ageDays = r.postedAt ? (now.getTime() - Date.parse(r.postedAt)) / (24 * HOUR) : 0;
    if (ageDays > (type === "gig" ? 21 : 30)) continue;
    const where = whereFits(r.location, remoteBoards.has(r.source));
    if (!where) continue;
    const pay = parsePay(`${r.title} ${r.text}`, { min: r.salaryMin, max: r.salaryMax });
    if (!payFits(pay, type, prefs)) continue;
    const c = { ...r, title: displayTitle(r.title, role), type, role, where, pay };
    out.push({ ...c, score: scoreCandidate(c, prefs.roles, taste, now) });
  }
  return out.sort((a, b) => b.score - a.score || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}

/** Up to `n` of a type, never seen before, one per company where possible. */
export function pick(cands: Candidate[], type: JobType, n: number, seen: ReadonlySet<string>): Candidate[] {
  const pool = cands.filter((c) => c.type === type && !seen.has(c.key));
  const chosen: Candidate[] = [];
  const companies = new Set<string>();
  for (const strict of [true, false]) {
    for (const c of pool) {
      if (chosen.length >= n) break;
      if (chosen.includes(c)) continue;
      const co = c.company.toLowerCase();
      if (strict && companies.has(co)) continue;
      chosen.push(c);
      companies.add(co);
    }
  }
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
}

export interface CareerSection {
  fullTime: BriefMatch[];
  gigs: BriefMatch[];
  /** Fridays: the week's job-search scorecard. Added in part 5b. */
  scorecard?: Scorecard;
}

export interface CareerAgentInput {
  slot: BriefSlot;
  /** Matches picked for this brief, already stored (so they have ids). */
  fullTime: JobMatch[];
  gigs: JobMatch[];
  contacts: Contact[];
  failedSources: string[];
  sourceCount: number;
  pendingApprovals: number;
  /** Applications logged and moved from job emails this run. */
  tracked?: { created: number; updated: number };
  /** Follow-ups queued this run for applications that went quiet. */
  followUps?: number;
  scorecard?: Scorecard;
  /** First weekday of the month: the portfolio project that closes the biggest skill gap. */
  project?: PortfolioProject | null;
}

export interface CareerAgentResult {
  section: CareerSection;
  report: StandardReport;
  allFailed: boolean;
}

export function toBriefMatch(m: JobMatch, contacts: Contact[]): BriefMatch {
  const who = contactForCompany(m.company, contacts);
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
  };
}

export function careerAgentReport(input: CareerAgentInput): CareerAgentResult {
  const fullTime = input.fullTime.map((m) => toBriefMatch(m, input.contacts));
  const gigs = input.gigs.map((m) => toBriefMatch(m, input.contacts));
  const allFailed = input.sourceCount > 0 && input.failedSources.length >= input.sourceCount;
  const errors = input.failedSources.length
    ? [allFailed ? "Every job source failed; no new matches this brief." : `${input.failedSources.length} job source${input.failedSources.length === 1 ? "" : "s"} failed: ${input.failedSources.join(", ")}`]
    : [];
  const referrals = [...fullTime, ...gigs].filter((m) => m.referral);
  return {
    allFailed,
    section: { fullTime, gigs, ...(input.scorecard ? { scorecard: input.scorecard } : {}) },
    report: {
      agent: "career",
      headline: `${fullTime.length} full-time and ${gigs.length} gig match${gigs.length === 1 ? "" : "es"}${input.slot === "afternoon" ? " new since the morning" : ""}.`,
      details: [
        ...fullTime.slice(0, 5).map((m) => `${m.role}: ${m.title} at ${m.company} (${m.payText}, ${m.source})`),
        ...(input.tracked && (input.tracked.created || input.tracked.updated)
          ? [`From your email: ${input.tracked.created} application${input.tracked.created === 1 ? "" : "s"} logged, ${input.tracked.updated} moved on the board.`]
          : []),
        ...(input.followUps ? [`${input.followUps} follow-up${input.followUps === 1 ? "" : "s"} drafted for applications quiet for a week; in the Approval Queue.`] : []),
        ...(input.scorecard
          ? [`This week: ${input.scorecard.sent} sent, ${input.scorecard.replies} replies, ${input.scorecard.interviews} interviews, ${input.scorecard.offers} offers (${input.scorecard.responseRate}% response rate overall).`]
          : []),
        ...(input.project ? [`Portfolio project this month (closes your ${input.project.skill} gap): ${input.project.title}. Details on the Growth page.`] : []),
        ...referrals.map((m) => `Referral: you know ${m.referral} at ${m.company}; ask before applying.`),
        ...(gigs.length < 10 ? [`Gigs: ${gigs.length} of 10 from public feeds; check the saved Upwork and Contra searches.`] : []),
      ],
      needsApproval: input.pendingApprovals ? [`${input.pendingApprovals} item${input.pendingApprovals === 1 ? "" : "s"} waiting in the Approval Queue`] : [],
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
  return [
    { site: "LinkedIn", url: `https://www.linkedin.com/jobs/search/?keywords=${q(or)}&f_TPR=r86400&f_WT=2`, note: "Your roles, remote, past 24 hours" },
    { site: "Indeed", url: `https://www.indeed.com/jobs?q=${q(names.map((n) => `"${n}"`).join(" or "))}&l=Remote&fromage=1`, note: "Your roles, remote, past day" },
    { site: "Glassdoor", url: `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${first}`, note: `${names[0] ?? "AI Engineer"}; change the role in the search` },
    { site: "Dice", url: `https://www.dice.com/jobs?q=${q(or)}&filters.postedDate=ONE`, note: "Your roles, past day" },
    { site: "Wellfound", url: "https://wellfound.com/jobs", note: "Startups; set role filters once in your profile" },
    { site: "YC Work at a Startup", url: "https://www.workatastartup.com/jobs", note: "YC startups" },
    { site: "Welcome to the Jungle", url: `https://www.welcometothejungle.com/en/jobs?query=${first}`, note: "Startups (formerly Otta)" },
    { site: "Silicon Slopes", url: "https://siliconslopes.com/jobs", note: "Utah tech, for Salt Lake hybrid roles" },
    { site: "Upwork", url: `https://www.upwork.com/nx/search/jobs/?q=${q("AI automation")}&sort=recency`, note: "Gigs, newest first" },
    { site: "Contra", url: "https://contra.com/discover", note: "Independent gigs" },
  ];
}
