// The tech job market, read broadly: every U.S. tech posting the Scout sees, not only your roles.
//
// A layered pipeline (raw -> cleaned -> summarized):
//   raw       what the feeds and boards return (RawJob), never stored
//   cleaned   tech_postings: one row per job after duplicates across sources are merged,
//             labeled with a role family, a seniority, a work mode, a region and yearly pay
//   summary   market_daily: one row per day, role family, seniority and region, kept for good
//
// Your target roles do not gate what is recorded here: they become a filter when the market is
// shown. Senior roles are recorded too, because they are a large share of the market. The
// your-roles pipeline (market.ts, market_postings) is unchanged and still feeds the Analyst.
//
// A sample, not a census: the sources lean toward remote boards and the companies you watch.
// Every view of this data should say how many postings and which sources it rests on.
//
// Pure: rows in, rows out. No I/O.

import { isFullTime, parsePay, type RawJob } from "./careerAgent";
import { addDays } from "./dates";
import { extractSkills } from "./skills";
import type { LocalDate } from "./types";
import { PLACE_PATTERNS } from "./workplace";
import { sourceGroup } from "./jobSources";
import { statesOf, utahCityOf } from "./places";
import { certsIn, yearsAsked } from "./requirements";

export const FAMILIES = ["software", "ai-ml", "data", "devops-cloud", "security", "solutions", "product", "it-support"] as const;
export type Family = (typeof FAMILIES)[number];
export const FAMILY_LABEL: Record<Family, string> = {
  software: "Software engineering",
  "ai-ml": "AI and machine learning",
  data: "Data",
  "devops-cloud": "DevOps, cloud and infrastructure",
  security: "Security",
  solutions: "Solutions and sales engineering",
  product: "Product and program",
  "it-support": "IT and support",
};

export const SENIORITIES = ["intern", "junior", "mid", "senior", "staff+", "manager", "unstated"] as const;
export type Seniority = (typeof SENIORITIES)[number];
export const SENIORITY_LABEL: Record<Seniority, string> = { intern: "Intern", junior: "Junior", mid: "Mid", senior: "Senior", "staff+": "Staff, principal, lead", manager: "Manager and above", unstated: "Level not in title" };

export type Mode = "remote" | "hybrid" | "onsite" | "unstated";
/**
 * Where a job is open: "utah", elsewhere in the U.S. ("us"), or "global": a remote job open beyond
 * the U.S. that still includes it (worldwide, the Americas, or the U.S. and other countries). Global
 * is the International tab (owner's choice, 23 Nov 2026); jobs open only outside the U.S. are not kept.
 */
export type Region = "utah" | "us" | "global" | "unstated";

/** Most postings one run records, so one huge board cannot fill the database. */
export const MAX_TECH_ROWS = 4000;
/** How long a posting the Scout no longer sees is kept. The daily summary is kept for good. */
export const TECH_KEEP_DAYS = 60;
/** A posting counts as active while it was seen in the last 7 days. */
export const ACTIVE_DAYS = 7;
/** Yearly pay outside this range is a parsing mistake, not a salary. */
const PAY_BOUNDS = { min: 20_000, max: 1_000_000 } as const;
const HOURS_A_YEAR = 2080;

const lower = (s: string) => ` ${s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9+#.]+/g, " ").replace(/\s+/g, " ").trim()} `;

// Checked against a live audit of 700 board titles on 22 Nov 2026 (test/techMarket.test.ts keeps
// the cases it turned up).

// Engineering of other kinds, and jobs that are never tech: out, whatever else the title says.
const HARD_NOT_TECH = / (mechanical|civil|electrical|chemical|structural|manufacturing|process engineer|hvac|industrial|biomedical|aerospace|field service|maintenance|construction|nurse|nursing|physician|pharmacist|warehouse|notary|attorney|paralegal) /;

// Solutions and sales engineering is read next: "sales engineer" is tech, "sales" alone is not.
const SOLUTIONS = / (solutions?|sales|pre ?sales|forward deployed|customer|field|technical account|partner) (engineer|architect)s? | solutions? (consultant|engineering) | (implementations?|integrations?) (engineer|consultant|specialist)s? | technical (account|customer) manager /;

// Business roles at tech companies (sales, customer success, HR, marketing): out, even when the
// title names AI or software, unless it also names tech work itself ("Front End Developer - Marketing").
const BUSINESS = / (sales|account executive|account manager|account management|customer success|customer service|customer support|contact center|business development|bdr|sdr|recruiter|recruiting|talent|hr|human resources|people operations|marketing|accountant|accounting|payroll|legal|collections|executive assistant|communications|event|events|representative|onboarding specialist|revenue operations|demand generation|compensation|financial analyst) /;
const TECH_WORK = / (developer|engineer|engineering|programmer|scientist|data science|technical support) /;

// First match wins: the specific families before the general ones.
const FAMILY_RULES: readonly [Family, RegExp][] = [
  ["security", / (security|cybersecurity|cyber|appsec|infosec|soc|penetration|pentest|pentester|iam|identity and access|threat|vulnerability) /],
  ["product", / (product manager|product management|director of product|head of product|vp of product|product design|product owner|program manager|project manager|technical program|product designer|ux designer|ui designer|ux researcher|scrum master|delivery manager) /],
  // AI only when it is the job itself, not a topic: "ML Engineer" yes, "Software Engineer (AI)" is software.
  ["ai-ml", / (machine learning|deep learning|computer vision|nlp|mlops|applied scientist|research scientist|research engineer|(ml|ai|llm|genai|applied ai) (engineer|scientist|researcher|developer|architect|software engineer)s?) /],
  ["data", / (data engineer|data scientist|data science|data migration|product analyst|data analyst|data architect|data platform|analytics engineer|business intelligence|bi developer|bi analyst|bi engineer|etl|database administrator|database engineer|dba) /],
  ["devops-cloud", / (devops|site reliability|sre|platform engineer|cloud engineer|cloud architect|infrastructure engineer|infrastructure|kubernetes|systems engineer|network engineer|network operations|noc|release engineer|build engineer|production engineer) /],
  ["it-support", / (it support|help ?desk|service desk|desktop support|it technician|technical support|support engineer|it specialist|systems administrator|sysadmin|it administrator|it analyst|it manager|systems analyst|business systems|salesforce (developer|administrator|architect)|systems architect) /],
  ["software", / (software|developer|programmer|full ?stack|front ?end|back ?end|frontend|backend|web engineer|mobile engineer|ios|android|member of technical staff|embedded software|firmware|(java|python|golang|go|react|node|ruby|rails|.net|c#|c\+\+|typescript|javascript|rust|scala|kotlin|swift|php|elixir) (engineer|developer)) /],
  // Any other engineering title at this point is software work ("Director of Engineering").
  ["software", / (engineer|engineers|engineering) /],
];

/** The role family a title belongs to, or null when it is not a tech role. */
export function familyOf(title: string): Family | null {
  const t = lower(title);
  if (HARD_NOT_TECH.test(t)) return null;
  if (SOLUTIONS.test(t)) return "solutions";
  if (BUSINESS.test(t) && !TECH_WORK.test(t)) return null;
  return FAMILY_RULES.find(([, re]) => re.test(t))?.[0] ?? null;
}

const MANAGER = / (director|head of|vp|vice president|chief|cto|cio|ciso|(engineering|development|software|data|it|security|infrastructure|devops|platform) manager|senior manager|manager of|manager engineering) /;
const STAFF = / (staff|principal|distinguished|fellow|lead|tech lead) /;
const SENIOR = / (senior|sr|sr.|iii|level 3) /;
const MID = / (ii|mid|intermediate|level 2) /;
const JUNIOR = / (junior|jr|jr.|entry|entry level|associate|graduate|new grad|apprentice|level 1) /;
const INTERN = / (intern|internship|co op|coop) /;

/** The level a title states. Most titles state none, and that is recorded as such. */
export function seniorityOf(title: string): Seniority {
  const t = lower(title);
  if (INTERN.test(t)) return "intern";
  if (MANAGER.test(t) || t.startsWith(" manager ")) return "manager";
  if (STAFF.test(t)) return "staff+";
  if (SENIOR.test(t)) return "senior";
  if (MID.test(t)) return "mid";
  if (JUNIOR.test(t) || / engineer i$/.test(t.trimEnd())) return "junior";
  return "unstated";
}

const STATE_CODE = /,\s*([A-Z]{2})\b/;
/** Words that open a remote job to the whole country. */
const US_WIDE = /\b(us|usa|u\.s\.?|united states|anywhere|nationwide|north america|americas)\b/i;

/** Open worldwide or across a region that includes the U.S. */
const WORLDWIDE = /\b(worldwide|world ?wide|global|globally|international|anywhere in the world|any country|americas|north america)\b/i;
/** The U.S. by name (not "anywhere", which on a U.S. board means anywhere in the U.S.). */
const US_NAMED = /\b(us|usa|u\.s\.?|united states)\b/i;

/**
 * Utah, elsewhere in the U.S., global (open beyond the U.S., the U.S. included), or not stated.
 * Null for a posting open only outside the U.S. Rules, in order:
 *   a Utah city or "Utah" -> utah; a U.S. state code with nothing worldwide -> us;
 *   worldwide, global or the Americas -> global; the U.S. named with another country -> global;
 *   the U.S. or "anywhere" -> us; another country only -> null.
 */
export function regionOf(location: string, remoteBoard: boolean): Region | null {
  const l = location.trim();
  const { namesUtah, CITY_RES, US_OK, NOT_US, US_STATES } = PLACE_PATTERNS;
  if (namesUtah(l) || CITY_RES.some((c) => c.re.test(l))) return "utah";
  const state = STATE_CODE.exec(l)?.[1];
  const usState = Boolean(state && US_STATES.has(state));
  if (usState && !WORLDWIDE.test(l)) return "us";
  if (WORLDWIDE.test(l)) return "global";
  if (US_NAMED.test(l) && NOT_US.test(l)) return "global";
  if (US_OK.test(l) || usState) return "us";
  if (NOT_US.test(l)) return null;
  return remoteBoard ? "us" : "unstated";
}

/** Remote, hybrid or on-site, when the posting says. */
export function modeOf(location: string, text: string, remoteBoard: boolean): Mode {
  const { REMOTE, HYBRID, ONSITE } = PLACE_PATTERNS;
  const l = `${location} ${text.slice(0, 600)}`;
  if (HYBRID.test(location)) return "hybrid";
  if (REMOTE.test(location)) return "remote";
  if (ONSITE.test(location)) return "onsite";
  if (remoteBoard) return "remote";
  if (HYBRID.test(l)) return "hybrid";
  if (REMOTE.test(l)) return "remote";
  return "unstated";
}

/** Pay as U.S. dollars a year: hourly pay times 2,080 hours. Null when not stated or not believable. */
export function yearlyPay(raw: Pick<RawJob, "title" | "text" | "salaryMin" | "salaryMax">): { min: number; max: number } | null {
  const pay = parsePay(`${raw.title} ${raw.text}`, { min: raw.salaryMin, max: raw.salaryMax });
  if (!pay) return null;
  const k = pay.unit === "hour" ? HOURS_A_YEAR : 1;
  const min = Math.round(pay.min * k);
  const max = Math.round(pay.max * k);
  if (min < PAY_BOUNDS.min || max > PAY_BOUNDS.max || max < min) return null;
  return { min, max };
}

const COMPANY_NOISE = new Set(["inc", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "plc", "technologies", "technology", "labs"]);
const plain = (s: string) => lower(s).replace(/ \(?(remote|hybrid|onsite|on site|us|usa|united states)\)? /g, " ").replace(/\s+/g, " ").trim();

/**
 * The identity of a job across sources: the same company, title and region is one job, whichever
 * board listed it (entity resolution). A posting without a company keeps its source key instead,
 * so two unnamed postings are never merged.
 */
export function fingerprint(company: string, title: string, region: Region, sourceKey: string): string {
  const c = lower(company.replace(/\./g, " ")).trim().split(" ").filter((w) => w && !COMPANY_NOISE.has(w)).join(" ");
  if (!c || c === "unknown") return `key:${sourceKey}`.slice(0, 300);
  // Global shares the U.S. identity, so a job first stored as U.S. (before the International tab) is
  // updated in place rather than stored twice.
  return `${c}|${plain(title)}|${region === "global" ? "us" : region}`.slice(0, 300);
}

/** One tech job in the cleaned layer. */
export interface TechPosting {
  fingerprint: string;
  title: string;
  company: string;
  family: Family;
  seniority: Seniority;
  mode: Mode;
  region: Region;
  /** Yearly U.S. dollars, or null when the posting states none. */
  payMin: number | null;
  payMax: number | null;
  /** The Utah city the posting names (for the Utah map), or null. */
  city?: string | null;
  /** The U.S. states it names, by code: where an on-site job is, or which states a remote one is open to. */
  states?: string[];
  skills: string[];
  /** Years of experience the description asks for, or null (no description, or none stated). */
  yearsMin?: number | null;
  /** Certifications the description names (lib/domain/requirements.ts). */
  certs?: string[];
  /** Every source that listed it, first seen first (at most 10). */
  sources: string[];
  url: string;
  postedAt: string | null;
  firstSeen: LocalDate;
  lastSeen: LocalDate;
}

/** How one run went, source by source: the data-quality record for the pipeline view. */
export interface SourceQuality {
  source: string;
  read: number;
  /** Tech, full-time, in the U.S. */
  tech: number;
  withPay: number;
}
export interface RunQuality {
  day: LocalDate;
  read: number;
  notTech: number;
  notFullTime: number;
  outsideUs: number;
  tech: number;
  /** Tech postings that were the same job as another one this run. */
  duplicates: number;
  recorded: number;
  /** Over recorded postings. */
  withPay: number;
  withSkills: number;
  levelStated: number;
  capped: boolean;
  sources: SourceQuality[];
}

/** Normalized source name: company boards are one source, as in jobSources.ts. */
const sourceName = sourceGroup;

/** Raw postings to the cleaned layer, with duplicates merged and the run's quality counted. */
export function observeTech(raws: readonly RawJob[], remoteBoards: ReadonlySet<string>, today: LocalDate, cap = MAX_TECH_ROWS): { rows: TechPosting[]; quality: RunQuality } {
  const out = new Map<string, TechPosting>();
  const bySource = new Map<string, SourceQuality>();
  const q = { notTech: 0, notFullTime: 0, outsideUs: 0, tech: 0, duplicates: 0 };
  let capped = false;
  for (const r of raws) {
    const name = sourceName(r.source);
    const s = bySource.get(name) ?? { source: name, read: 0, tech: 0, withPay: 0 };
    bySource.set(name, s);
    s.read++;
    if (!r.title || !/^https:\/\//.test(r.url) || r.url.length > 600) continue;
    const family = familyOf(r.title);
    if (!family) {
      q.notTech++;
      continue;
    }
    if (!isFullTime(r)) {
      q.notFullTime++;
      continue;
    }
    const remoteBoard = remoteBoards.has(r.source);
    const region = regionOf(r.location, remoteBoard);
    if (!region) {
      q.outsideUs++;
      continue;
    }
    q.tech++;
    s.tech++;
    const pay = yearlyPay(r);
    if (pay) s.withPay++;
    // A job open worldwide is remote work, even when the board does not say "remote".
    const said = modeOf(r.location, r.text, remoteBoard);
    const mode = region === "global" && said === "unstated" ? "remote" : said;
    const remote = mode === "remote";
    const fp = fingerprint(r.company, r.title, region, r.key);
    const seen = out.get(fp);
    if (seen) {
      q.duplicates++;
      if (!seen.sources.includes(r.source.slice(0, 80)) && seen.sources.length < 10) seen.sources.push(r.source.slice(0, 80));
      if (seen.payMin === null && pay) Object.assign(seen, { payMin: pay.min, payMax: pay.max });
      continue;
    }
    if (out.size >= cap) {
      capped = true;
      continue;
    }
    out.set(fp, {
      fingerprint: fp,
      title: r.title.slice(0, 200),
      company: (r.company || "Unknown company").slice(0, 160),
      family,
      seniority: seniorityOf(r.title),
      mode,
      region,
      city: region === "utah" ? utahCityOf(r.location) : null,
      // A remote job that says it is open across the U.S. ("Remote - US", "Anywhere") is not limited to the offices it
      // also lists: it names no states, so the Remote USA map counts it as anywhere.
      states: remote && US_WIDE.test(r.location) ? [] : statesOf(r.location),
      payMin: pay?.min ?? null,
      payMax: pay?.max ?? null,
      skills: (r.skills?.length ? r.skills : extractSkills(`${r.title} ${r.text}`)).slice(0, 30),
      yearsMin: r.yearsMin ?? yearsAsked(r.text),
      certs: (r.certs?.length ? r.certs : certsIn(r.text)).slice(0, 10),
      sources: [r.source.slice(0, 80)],
      url: r.url,
      postedAt: r.postedAt,
      firstSeen: today,
      lastSeen: today,
    });
  }
  const rows = [...out.values()];
  return {
    rows,
    quality: {
      day: today,
      read: raws.length,
      ...q,
      recorded: rows.length,
      withPay: rows.filter((p) => p.payMin !== null).length,
      withSkills: rows.filter((p) => p.skills.length > 0).length,
      levelStated: rows.filter((p) => p.seniority !== "unstated").length,
      capped,
      sources: [...bySource.values()].sort((a, b) => b.read - a.read),
    },
  };
}

/** Merges a run's rows into what is stored: earliest first-seen, every source, today as last-seen. */
export function mergeTech(stored: TechPosting | undefined, row: TechPosting): TechPosting {
  if (!stored) return row;
  const sources = [...new Set([...stored.sources, ...row.sources])].slice(0, 10);
  // A titles-only read (later syncs of the day) keeps the pay and skills the morning's detailed read found.
  return {
    ...row,
    firstSeen: stored.firstSeen < row.firstSeen ? stored.firstSeen : row.firstSeen,
    sources,
    payMin: row.payMin ?? stored.payMin,
    payMax: row.payMax ?? stored.payMax,
    skills: row.skills?.length ? row.skills : (stored.skills ?? []),
    yearsMin: row.yearsMin ?? stored.yearsMin ?? null,
    certs: row.certs?.length ? row.certs : (stored.certs ?? []),
  };
}

/** One summary row: a day, a role family, a seniority and a region. */
export interface DailyRow {
  day: LocalDate;
  family: Family;
  seniority: Seniority;
  region: Region;
  /** Seen in the 7 days up to and including the day. */
  active: number;
  /** First seen on the day. */
  added: number;
  /** Last seen exactly 7 days before: they stopped appearing. */
  gone: number;
  remote: number;
  withPay: number;
  /** Median of each posting's pay midpoint, yearly U.S. dollars; null with no pay stated. */
  payMedian: number | null;
}

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2);
};

/** The summary for one day, computed again from the cleaned layer each run, so a re-run gives the same rows. */
export function dailySummary(postings: readonly TechPosting[], day: LocalDate): DailyRow[] {
  const from = addDays(day, -(ACTIVE_DAYS - 1));
  const goneDay = addDays(day, -ACTIVE_DAYS);
  const groups = new Map<string, { row: DailyRow; pay: number[] }>();
  for (const p of postings) {
    const active = p.lastSeen >= from && p.firstSeen <= day;
    const gone = p.lastSeen === goneDay;
    if (!active && !gone) continue;
    const k = `${p.family}|${p.seniority}|${p.region}`;
    const g = groups.get(k) ?? { row: { day, family: p.family, seniority: p.seniority, region: p.region, active: 0, added: 0, gone: 0, remote: 0, withPay: 0, payMedian: null }, pay: [] };
    groups.set(k, g);
    if (gone) {
      g.row.gone++;
      continue;
    }
    g.row.active++;
    if (p.firstSeen === day) g.row.added++;
    if (p.mode === "remote") g.row.remote++;
    if (p.payMin !== null && p.payMax !== null) {
      g.row.withPay++;
      g.pay.push((p.payMin + p.payMax) / 2);
    }
  }
  return [...groups.values()].map(({ row, pay }) => ({ ...row, payMedian: median(pay) })).sort((a, b) => a.family.localeCompare(b.family) || a.seniority.localeCompare(b.seniority) || a.region.localeCompare(b.region));
}
