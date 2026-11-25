// The apply brief: what to know before you apply to one job in your Apply Queue, from the data
// Atlas already holds (owner's request, 23 Nov 2026: apply with confidence, perspective and
// insight into the role, the company and its hiring). Pure: rules and counts, no model, no I/O.
//
//   the role      its level and family, the skills it names (yours or not), the years and
//                 certifications it asks, its pay against the market for that family and level
//   the company   its open tech roles now, new postings week by week (growing or slowing),
//                 which kinds of roles it hires, where, and its pay range
//   people        someone you know there, for a referral
//   the steps     a checklist from research to the follow-up
//
// Every number comes from the Scout's postings (tech_postings), the kit and your settings.
// The team and the hiring manager come later, from public pages (PR 3 of the plan).

import { daysBetween, addDays } from "./dates";
import { FAMILY_LABEL, familyOf, SENIORITY_LABEL, seniorityOf, type Family, type Seniority, type TechPosting } from "./techMarket";
import type { LocalDate } from "./types";

/** The Scout's postings this far back feed the brief. */
export const BRIEF_DAYS = 60;
/** Weeks shown in the company's hiring trend. */
export const TREND_WEEKS = 8;
/** A company counts at most this many times in a market median, so one big hirer cannot set it. */
const COMPANY_CAP = 25;
/** Fewer postings than this make no market median. */
const MIN_FOR_MEDIAN = 5;

export interface BriefInput {
  job: { title: string; company: string; role: string; payText: string; skills?: string[] };
  /** The apply kit's lines ("Asks for: 3+ years of experience", "Skills it names: ..."). */
  kitDetail: string;
  /** Tech postings seen in the last BRIEF_DAYS days, every company. */
  postings: readonly TechPosting[];
  today: LocalDate;
  /** Skills you list as yours (Settings), and the ones your resumes name, when known. */
  mySkills: readonly string[];
  resumeSkills?: readonly string[] | null;
  /** Someone you know at the company, by name. */
  contact?: string | null;
  /** Your answer bank: written of total, and whether your fixed answers are set. */
  answers: { written: number; total: number; fixedSet: boolean };
}

export interface ApplyBrief {
  role: {
    level: string;
    family: string | null;
    asks: string[];
    have: string[];
    missing: string[];
    years: string;
    certs: string[];
    pay: { posted: string; marketMedian: number | null; marketN: number; vsMarket: "above" | "near" | "below" | null };
  };
  company: {
    name: string;
    /** Tech postings seen in the last 7 days. */
    openNow: number;
    /** New postings per week, oldest first, TREND_WEEKS long. */
    weekly: number[];
    trend: "growing" | "steady" | "slowing" | "new to Atlas" | "no data";
    /** Days of Scout data behind the trend (it began on 22 Nov 2026). */
    dataDays: number;
    /** The kinds of roles it posts most, with counts. */
    hiring: { label: string; n: number }[];
    remoteShare: number | null;
    utah: number;
    payRange: { min: number; max: number } | null;
  };
  contact: string | null;
  steps: { label: string; done: boolean; how: string }[];
}

const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|labs?|technologies|technology|group)\b\.?/g, " ")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim()} `;

/** The same company, however a source writes its name ("Acme, Inc." and "acme"). */
export const sameCompany = (a: string, b: string): boolean => norm(a).trim() !== "" && norm(a) === norm(b);

const mid = (p: Pick<TechPosting, "payMin" | "payMax">): number | null => {
  const lo = p.payMin ?? p.payMax;
  const hi = p.payMax ?? p.payMin;
  return lo && hi ? Math.round((lo + hi) / 2) : null;
};

/** The median of each posting's mid pay, each company counted at most COMPANY_CAP times. */
export function marketMedian(postings: readonly TechPosting[], family: Family, level: Seniority): { median: number | null; n: number } {
  const per = new Map<string, number>();
  const mids: number[] = [];
  for (const p of postings) {
    if (p.family !== family || p.seniority !== level) continue;
    const m = mid(p);
    if (m === null) continue;
    const c = norm(p.company);
    const seen = per.get(c) ?? 0;
    if (seen >= COMPANY_CAP) continue;
    per.set(c, seen + 1);
    mids.push(m);
  }
  if (mids.length < MIN_FOR_MEDIAN) return { median: null, n: mids.length };
  mids.sort((a, b) => a - b);
  const h = Math.floor(mids.length / 2);
  return { median: mids.length % 2 ? mids[h]! : Math.round((mids[h - 1]! + mids[h]!) / 2), n: mids.length };
}

/** Yearly pay a posted text states ("$110k–$130k", "$55/hr"), as its middle, or null. */
export function postedMid(text: string): number | null {
  const nums = [...text.matchAll(/\$\s?(\d{1,3}(?:[.,]\d{1,3})?)\s*(k)?/gi)].map((m) => {
    const v = Number(m[1]!.replace(/,/g, ""));
    return m[2] ? v * 1000 : v;
  });
  if (!nums.length) return null;
  const hourly = /\/\s?h(ou)?r|per hour|hourly/i.test(text);
  const yearly = nums.map((v) => (hourly ? v * 2080 : v < 1000 ? v * 1000 : v));
  const lo = Math.min(...yearly);
  const hi = Math.max(...yearly);
  return lo >= 20_000 && hi <= 1_000_000 ? Math.round((lo + hi) / 2) : null;
}

/** New postings per week for one company, oldest first, ending today. */
function weeklyNew(company: readonly TechPosting[], today: LocalDate): number[] {
  const out = Array.from({ length: TREND_WEEKS }, () => 0);
  for (const p of company) {
    const ago = daysBetween(p.firstSeen, today);
    const w = Math.floor(ago / 7);
    if (ago >= 0 && w < TREND_WEEKS) out[TREND_WEEKS - 1 - w]! += 1;
  }
  return out;
}

function trendOf(weekly: number[], dataDays: number): ApplyBrief["company"]["trend"] {
  const total = weekly.reduce((a, b) => a + b, 0);
  if (total === 0) return "no data";
  // Less than two weeks of Scout data: too little to call a direction.
  if (dataDays < 14) return "new to Atlas";
  const recent = weekly.slice(-2).reduce((a, b) => a + b, 0);
  const before = weekly.slice(-4, -2).reduce((a, b) => a + b, 0);
  if (recent >= before * 1.5 && recent - before >= 2) return "growing";
  if (before >= recent * 1.5 && before - recent >= 2) return "slowing";
  return "steady";
}

const lower = (xs: readonly string[]) => new Set(xs.map((x) => x.toLowerCase()));

/** The brief for one job in your Apply Queue. */
export function applyBrief(input: BriefInput): ApplyBrief {
  const { job, postings, today } = input;
  const family = familyOf(job.title) ?? familyOf(job.role);
  const level = seniorityOf(job.title);

  // The role
  const fromKit = (re: RegExp) => re.exec(input.kitDetail)?.[1]?.trim() ?? "";
  const kitSkills = fromKit(/^Skills it names: (.+)$/m)
    .split(/,\s*/)
    .filter(Boolean);
  const asks = [...new Set([...(job.skills ?? []), ...kitSkills])].slice(0, 15);
  const mine = lower(input.mySkills);
  const onResume = input.resumeSkills ? lower(input.resumeSkills) : null;
  const have = asks.filter((s) => mine.has(s.toLowerCase()) || onResume?.has(s.toLowerCase()));
  const own = postings.find((p) => sameCompany(p.company, job.company) && p.title.trim().toLowerCase() === job.title.trim().toLowerCase());
  const years = fromKit(/^Asks for: (.{1,60}) of experience$/m) || (own?.yearsMin ? `${own.yearsMin}+ years` : "");
  const market = family ? marketMedian(postings, family, level) : { median: null, n: 0 };
  const posted = (own ? mid(own) : null) ?? postedMid(job.payText);
  const vsMarket = posted && market.median ? (posted >= market.median * 1.1 ? "above" : posted <= market.median * 0.9 ? "below" : "near") : null;

  // The company
  const theirs = postings.filter((p) => sameCompany(p.company, job.company));
  const openNow = theirs.filter((p) => daysBetween(p.lastSeen, today) <= 6).length;
  const firstDay = postings.reduce<LocalDate | null>((d, p) => (!d || p.firstSeen < d ? p.firstSeen : d), null);
  const dataDays = firstDay ? daysBetween(firstDay, today) + 1 : 0;
  const weekly = weeklyNew(theirs, today);
  const byFamily = new Map<Family, number>();
  for (const p of theirs) byFamily.set(p.family, (byFamily.get(p.family) ?? 0) + 1);
  const hiring = [...byFamily.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([f, n]) => ({ label: FAMILY_LABEL[f], n }));
  const withMode = theirs.filter((p) => p.mode !== "unstated");
  const pays = theirs.flatMap((p) => [p.payMin, p.payMax]).filter((n): n is number => typeof n === "number");

  // The steps, from research to the follow-up
  const steps: ApplyBrief["steps"] = [
    { label: "Read this brief and the posting", done: false, how: "Know the level, the skills it names and how the company is hiring before you write a word." },
    { label: `Use your ${job.role} resume`, done: false, how: "Open it from this job; lead with the skills you have from the list above." },
    { label: "Answers ready", done: input.answers.written >= input.answers.total && input.answers.fixedSet, how: `${input.answers.written} of ${input.answers.total} answers written${input.answers.fixedSet ? "" : "; set your fixed answers on Setup"}. Autofill fills them on the form.` },
    ...(input.contact ? [{ label: `Ask ${input.contact} for a referral`, done: false, how: "A short note before you apply: a referral is the strongest way in." }] : []),
    { label: "Apply on their site with Atlas Autofill", done: false, how: "Open the posting in Safari, press the A, then Fill or Help me apply. Review every answer, then submit yourself." },
    { label: "Mark it submitted", done: false, how: "Press I submitted it here, or Mark submitted in the extension." },
    { label: "Follow up in a week", done: false, how: "Atlas drafts the follow-up in this queue when the application is quiet for 7 days." },
  ];

  return {
    role: {
      level: SENIORITY_LABEL[level],
      family: family ? FAMILY_LABEL[family] : null,
      asks,
      have,
      missing: asks.filter((s) => !have.includes(s)),
      years,
      certs: own?.certs ?? [],
      pay: { posted: job.payText, marketMedian: market.median, marketN: market.n, vsMarket },
    },
    company: {
      name: job.company,
      openNow,
      weekly,
      trend: trendOf(weekly, dataDays),
      dataDays,
      hiring,
      remoteShare: withMode.length ? Math.round((withMode.filter((p) => p.mode === "remote").length / withMode.length) * 100) : null,
      utah: theirs.filter((p) => p.region === "utah").length,
      payRange: pays.length ? { min: Math.min(...pays), max: Math.max(...pays) } : null,
    },
    contact: input.contact ?? null,
    steps,
  };
}

/** The window the brief reads: the first day of BRIEF_DAYS. */
export const briefSince = (today: LocalDate): LocalDate => addDays(today, -BRIEF_DAYS);
