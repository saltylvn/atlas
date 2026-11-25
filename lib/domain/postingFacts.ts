// What Atlas keeps from a job posting it reads for you. Pure.
//
// When you give a job a 👍 its apply kit waits in an apply queue. Atlas then reads the
// full posting (lib/integrations/firecrawl.ts) and adds a few facts to the kit: the
// experience it asks for, the skills it names, the pay it states, where the work is done,
// and anything to watch for. You see them before you decide to apply.
//
// A posting is untrusted text from the web. Only facts these rules find are kept: numbers,
// skill names from Atlas's own list, and a few fixed phrases. None of the posting's own
// sentences are stored, shown or given to an AI model, so nothing written in a posting
// can act as an instruction to Atlas or to a model.

import { parsePay } from "./careerAgent";
import { extractSkills, SKILLS } from "./skills";
import type { LocalDate, ReadUsage } from "./types";

// ---------------------------------------------------------------------------
// Which pages may be read

/**
 * Sites Atlas never reads. The first eight have no public feed and their terms forbid
 * automated reading (docs/CAREER-DESK.md); jobs from them come in through "Save a job".
 * Hacker News is here because its postings arrive whole through the public API already.
 */
export const NEVER_READ: readonly string[] = ["linkedin.com", "indeed.com", "glassdoor.com", "wellfound.com", "workatastartup.com", "dice.com", "welcometothejungle.com", "siliconslopes.com", "news.ycombinator.com"];

export type MayRead = { ok: true; host: string } | { ok: false; why: string };

/** Whether a posting's page may be read at all: a public https page, on a site that allows it. */
export function mayRead(raw: string): MayRead {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, why: "not a link" };
  }
  if (url.protocol !== "https:") return { ok: false, why: "not an https link" };
  if (url.username || url.password) return { ok: false, why: "a link with credentials" };
  const host = url.hostname.toLowerCase();
  // A public site has a dotted name. Bare names and addresses are somebody's private network.
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.includes(":") || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, why: "not a public site" };
  if (NEVER_READ.some((d) => host === d || host.endsWith(`.${d}`))) return { ok: false, why: "its site does not allow automated reading" };
  return { ok: true, host };
}

// ---------------------------------------------------------------------------
// The facts

export interface PostingFacts {
  /** The most experience it asks for, as "5+ years" or "3–5 years"; "" when it does not say. */
  years: string;
  /** The lower number of that, or null. */
  yearsMin: number | null;
  /** Skills it names, from Atlas's own list (lib/domain/skills.ts). */
  skills: string[];
  /** Pay as it states it ("$95k–$120k"), or "". */
  pay: string;
  /** "Remote", "Hybrid", "Hybrid, 3 days a week in the office", "On-site", or "". */
  arrangement: string;
  /** Things to check before applying, each a fixed phrase. */
  watch: string[];
  /** The team it names ("Platform"), or "". Added 23 Nov 2026 for the apply brief. */
  team: string;
  /** Who the role reports to, as a title ("VP of Engineering"), or "". */
  reportsTo: string;
}

/** Years that are about experience have one of these words close by; "8 years ago" does not. */
const ABOUT_EXPERIENCE = /experience|\bexp\b|background|professional|industry|working (with|in|as|on)|building|developing|in a similar role|hands[- ]on/i;
const YEARS = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|—|to)\s*(\d{1,2})\s*\+?\s*)?(?:years?|yrs?)\b/gi;

function yearsAsked(text: string): { years: string; yearsMin: number | null } {
  let best: { min: number; max: number | null } | null = null;
  for (const m of text.matchAll(YEARS)) {
    const at = m.index ?? 0;
    const after = text.slice(at + m[0].length, at + m[0].length + 70);
    if (/^\s*(ago|old)\b/i.test(after)) continue;
    // "5+ years in solutions architecture", "3 years as a developer": the field follows directly.
    const inAField = /^\s*(in|as|with|building|working|developing|designing|delivering|leading|managing)\b/i.test(after);
    if (!inAField && !ABOUT_EXPERIENCE.test(`${text.slice(Math.max(0, at - 40), at)} ${after}`)) continue;
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : null;
    if (!Number.isFinite(min) || min < 1 || min > 25 || (max !== null && (max <= min || max > 30))) continue;
    // A posting can ask for "5+ years in software, 2+ with LLMs": the larger one decides whether you qualify.
    if (!best || min > best.min) best = { min, max };
  }
  if (!best) return { years: "", yearsMin: null };
  return { years: best.max ? `${best.min}–${best.max} years` : `${best.min}+ years`, yearsMin: best.min };
}

const PAY_WORDS = /salary|compensation|pay range|base pay|pay band|annual pay|\bote\b/gi;

function payStated(text: string): string {
  // Pay is read next to the words that introduce it, so a "$5,000 stipend" elsewhere is not
  // taken for it. A posting says "compensation" more than once, often before the figure:
  // each mention is tried, up to a few, until one has a figure beside it.
  let tried = 0;
  for (const m of text.matchAll(PAY_WORDS)) {
    if (++tried > 12) break;
    const at = m.index ?? 0;
    const pay = parsePay(text.slice(Math.max(0, at - 40), at + 320));
    if (pay) return pay.text.slice(0, 40);
  }
  return parsePay(text.slice(0, 600))?.text.slice(0, 40) ?? "";
}

const DAYS_IN_OFFICE = /\b(\d|one|two|three|four)\s+days?\s+(?:a|per|each)\s+week\s+(?:in|at|on)[- ]?(?:the |our )?(?:office|site)\b|\bin[- ]office\s+(\d|one|two|three|four)\s+days\b/i;
const DIGIT: Record<string, string> = { one: "1", two: "2", three: "3", four: "4" };
// "Hybrid" is said of clouds and search too: only the phrases about where you work count.
const HYBRID = /\bhybrid (role|position|work|working|schedule|setup|arrangement|workplace|model)\b|\bhybrid[- ]remote\b|\b(role|position|job) is hybrid\b|\bhybrid\b[^.]{0,30}\boffice\b/i;
const REMOTE = /\b(fully|100%|completely) remote\b|\bremote[- ]first\b|\bwork from anywhere\b|\b(role|position|job) is (fully )?remote\b|\bremote (role|position)\b/i;
const ONSITE = /\b(on[- ]?site|in[- ]office|in[- ]person)\b/i;

function arrangementStated(text: string): string {
  const days = DAYS_IN_OFFICE.exec(text);
  const n = days ? (days[1] ?? days[2] ?? "").toLowerCase() : "";
  if (days || HYBRID.test(text)) return n ? `Hybrid, ${DIGIT[n] ?? n} day${(DIGIT[n] ?? n) === "1" ? "" : "s"} a week in the office` : "Hybrid";
  if (REMOTE.test(text)) return "Remote";
  return ONSITE.test(text) ? "On-site" : "";
}

function watchFor(text: string, yearsMin: number | null): string[] {
  const out: string[] = [];
  // You are looking for a junior to mid level role (lib/domain/searchProfile.ts).
  if (yearsMin !== null && yearsMin >= 5) out.push("asks for more experience than a junior to mid level role usually does");
  if (/security clearance|secret clearance|\bts\/sci\b|public trust clearance|active clearance/i.test(text)) out.push("a security clearance");
  if (/must be a u\.?s\.? citizen|u\.?s\.? citizen(ship)?\b[^.]{0,40}\b(required|only)\b|\b(requires?|required)\b[^.]{0,30}u\.?s\.? citizenship/i.test(text)) out.push("U.S. citizenship required");
  const travel = /\btravel\b[^.%]{0,50}?(\d{1,3})\s?%/i.exec(text);
  if (travel && Number(travel[1]) >= 10 && Number(travel[1]) <= 100) out.push(`travel up to ${Number(travel[1])}%`);
  if (/(bachelor'?s|b\.?s\.?|degree)( degree)? in computer science[^.]{0,60}\brequired\b|\brequired\b[^.]{0,60}degree in computer science/i.test(text)) out.push("a computer science degree required");
  return out;
}

// The team and the manager, as a posting names them. The text is untrusted: only a few plain
// words are taken (letters, &, / and -), at most a short phrase, and never a whole sentence.
const PHRASE = "[A-Za-z][A-Za-z&/-]*(?: (?:of|and|for|&|[A-Za-z][A-Za-z&/-]*)){0,5}";
const TEAM = new RegExp(`\\b(?:join|joining|part of|member of|on) (?:our|the) (${PHRASE}?) team\\b`, "i");
const REPORTS = new RegExp(`\\breport(?:s|ing)? (?:directly )?(?:in)?to (?:the |our |a |an )?(${PHRASE})`, "i");
/** Words that describe a team rather than name it, and what follows a title but is not part of it. */
const NOT_A_NAME = /^(great|amazing|growing|talented|world[- ]class|small|fast[- ]growing|awesome|passionate|dedicated|global|wider|broader|engineering and product)$/i;
const TITLE_END = /\b(who|that|and you|to|in|on|with|as|while|within|at|for the|you)\b.*$/i;
const ROLEISH = /\b(head|director|manager|lead|vp|vice president|cto|ceo|chief|founder|principal|senior|staff|engineer|officer|president)\b/i;

const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Of|And|For)\b/g, (w) => w.toLowerCase());

function teamNamed(text: string): string {
  const name = TEAM.exec(text)?.[1]?.trim() ?? "";
  if (!name || NOT_A_NAME.test(name) || name.split(" ").length > 4) return "";
  return titleCase(name).slice(0, 40);
}

function managerNamed(text: string): string {
  const raw = REPORTS.exec(text)?.[1]?.replace(TITLE_END, "").trim() ?? "";
  // A title, not "the team" or "a manager of the company's choosing".
  // A plain "a manager" or "the lead" names nobody; a title does ("Head of Data", "CTO").
  if (!raw || !ROLEISH.test(raw) || raw.split(" ").length > 6 || /^(manager|lead|leader|engineer|director|senior|staff|principal|supervisor)$/i.test(raw)) return "";
  return titleCase(raw).replace(/\bVp\b/, "VP").replace(/\bCto\b/, "CTO").replace(/\bCeo\b/, "CEO").slice(0, 60);
}

/** The facts in a posting's text. Text that says nothing these rules recognize gives empty facts. */
export function postingFacts(raw: string): PostingFacts {
  // Long enough for any real posting; a page that is mostly something else is cut off.
  const text = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").slice(0, 40_000);
  const { years, yearsMin } = yearsAsked(text);
  return { years, yearsMin, skills: extractSkills(text).slice(0, 10), pay: payStated(text), arrangement: arrangementStated(text), watch: watchFor(text, yearsMin), team: teamNamed(text), reportsTo: managerNamed(text) };
}

// ---------------------------------------------------------------------------
// The facts as lines in an apply kit

const HEAD = /^From the posting \(read \d{4}-\d{2}-\d{2}\)/m;
const NOT_READ = /^Posting not read: /m;
const SKILLS_LINE = /^Skills it names: (.+)$/m;

/** True when a kit already says what its posting holds, or that it could not be read: it is not read twice. */
export const postingHandled = (detail: string): boolean => HEAD.test(detail) || NOT_READ.test(detail);

/** True for the lines Atlas added from the posting, so the queue can set them apart. */
export const isPostingLine = (line: string): boolean => /^(From the posting \(read |Asks for: |Skills it names: |Pay it states: |Where: |Team: |Reports to: |Watch for: |Posting not read: )/.test(line);

/** The facts as the kit's lines. A posting with nothing to report still gets its heading, so it is not read again. */
export function postingLines(f: PostingFacts, today: LocalDate): string[] {
  const lines = [
    f.years ? `Asks for: ${f.years} of experience` : "",
    f.skills.length ? `Skills it names: ${f.skills.join(", ")}` : "",
    f.pay ? `Pay it states: ${f.pay}` : "",
    f.arrangement ? `Where: ${f.arrangement}` : "",
    f.team ? `Team: ${f.team}` : "",
    f.reportsTo ? `Reports to: ${f.reportsTo}` : "",
    f.watch.length ? `Watch for: ${f.watch.join("; ")}` : "",
  ].filter(Boolean);
  return [`From the posting (read ${today})${lines.length ? ":" : ": nothing Atlas reads as experience, skills, pay or place."}`, ...lines];
}

/** A kit's text with lines added, kept inside the 4,000 characters the database allows. */
export function withLines(detail: string, lines: readonly string[]): string {
  let out = detail;
  for (const line of lines) {
    const next = out ? `${out}\n${line}` : line;
    if (next.length > 4000) break;
    out = next;
  }
  return out;
}

/** Why a posting was not read, as a line in the kit, so it is not tried again. */
export const notReadLine = (why: string): string => `Posting not read: ${why.replace(/\s+/g, " ").slice(0, 120)}.`;

/** The skills a kit's posting names. Only names from Atlas's own list are returned, whatever the line holds. */
export function skillsFromKit(detail: string): string[] {
  const known = new Map(SKILLS.map((s) => [s.name.toLowerCase(), s.name]));
  const line = SKILLS_LINE.exec(detail)?.[1] ?? "";
  return [...new Set(line.split(",").map((s) => known.get(s.trim().toLowerCase())).filter((s): s is string => Boolean(s)))];
}

// ---------------------------------------------------------------------------
// The reading budget

/** Firecrawl's free plan: pages a month (checked 18 Nov 2026). One read is one page. */
export const FIRECRAWL_FREE_PAGES = 1000;

/** Atlas stops well before the free limit, and never reads many pages at once. */
export const READ_BUDGET = { monthly: 900, daily: 40, perRun: 5 } as const;

/** How many pages may still be read now, and why not when the answer is none. */
export function readsLeft(usage: ReadUsage | undefined, today: LocalDate): { left: number; why: string } {
  const month = today.slice(0, 7);
  const pages = usage?.month === month ? usage.pages : 0;
  const onDay = usage?.day === today ? usage.today : 0;
  if (pages >= READ_BUDGET.monthly) return { left: 0, why: `this month's reading budget is used up (${pages} of ${READ_BUDGET.monthly} pages; the free plan has ${FIRECRAWL_FREE_PAGES})` };
  if (onDay >= READ_BUDGET.daily) return { left: 0, why: `today's reading budget is used up (${onDay} of ${READ_BUDGET.daily} pages)` };
  return { left: Math.min(READ_BUDGET.monthly - pages, READ_BUDGET.daily - onDay), why: "" };
}

/** The usage after `n` more pages. A new month or day starts its own count. */
export function countReads(usage: ReadUsage | undefined, today: LocalDate, n: number): ReadUsage {
  const month = today.slice(0, 7);
  return { month, pages: (usage?.month === month ? usage.pages : 0) + n, day: today, today: (usage?.day === today ? usage.today : 0) + n };
}
