// The board finder: from a company's name (and website, when you give it), find its public job
// board so the Scout can read it free. Rules first, Firecrawl last:
//   1. guess   try the company's name and domain as board names on the eight job-board systems ($0)
//   2. map     Firecrawl lists the website's pages to find the careers page (1 credit)
//   3. read    Firecrawl reads that one page's HTML, and the board's link is found in it (1 credit)
// Nothing is watched until you press Watch. Pure: no I/O here.

import type { JobBoard } from "./types";

export interface FoundBoard {
  board: JobBoard;
  slug: string;
  /** How it was found. */
  via: "guess" | "careers page";
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** "https://www.acme.io/careers" -> "acme.io". Null when it is not a web address. */
export function domainOf(website: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(website.trim()) ? website.trim() : `https://${website.trim()}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

const STOP = new Set(["inc", "llc", "ltd", "corp", "corporation", "co", "company", "the", "technologies", "technology", "labs", "software", "group", "hq"]);

/**
 * Board names worth trying, most likely first: "Lucid Software" -> lucidsoftware, lucid,
 * lucid-software; "acme.io" -> acme. At most five, each a valid board slug.
 */
export function candidateSlugs(company: string, domain: string | null): string[] {
  const words = company.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").split(" ").filter(Boolean);
  const core = words.filter((w) => !STOP.has(w));
  const fromDomain = domain ? domain.split(".")[0]! : "";
  const out = [words.join(""), core.join(""), core[0] ?? "", core.join("-"), fromDomain, words.join("-")];
  return [...new Set(out.filter((s) => SLUG.test(s)))].slice(0, 5);
}

// Where each job board lives in a page's HTML: a link, an iframe or a script. Order matters:
// the more specific pattern first.
const PATTERNS: readonly [JobBoard, RegExp][] = [
  ["greenhouse", /boards\.greenhouse\.io\/embed\/job_board(?:\/js)?\?for=([a-z0-9-]+)/gi],
  ["greenhouse", /(?:job-boards|boards)(?:\.eu)?\.greenhouse\.io\/([a-z0-9-]+)/gi],
  ["greenhouse", /boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9-]+)/gi],
  ["lever", /jobs\.(?:eu\.)?lever\.co\/([a-z0-9-]+)/gi],
  ["ashby", /jobs\.ashbyhq\.com\/([a-z0-9-]+)/gi],
  ["smartrecruiters", /(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9-]+)/gi],
  ["workable", /apply\.workable\.com\/([a-z0-9-]+)/gi],
  ["recruitee", /\/\/([a-z0-9-]+)\.recruitee\.com/gi],
  ["bamboohr", /\/\/([a-z0-9-]+)\.bamboohr\.com\/(?:careers|jobs)/gi],
  ["applicantpro", /\/\/([a-z0-9-]+)\.applicantpro\.com/gi],
];
const NOT_A_SLUG = new Set(["embed", "api", "v1", "jobs", "job_board", "widget", "careers", "oauth", "static", "assets", "j", "en", "us"]);

/** The job boards a careers page links to, embeds or loads, most mentioned first. */
export function boardsInHtml(html: string): FoundBoard[] {
  const counts = new Map<string, { b: FoundBoard; n: number }>();
  for (const [board, re] of PATTERNS) {
    for (const m of html.matchAll(re)) {
      const slug = (m[1] ?? "").toLowerCase();
      if (!SLUG.test(slug) || NOT_A_SLUG.has(slug)) continue;
      const k = `${board}:${slug}`;
      const c = counts.get(k) ?? { b: { board, slug, via: "careers page" as const }, n: 0 };
      c.n++;
      counts.set(k, c);
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map((c) => c.b).slice(0, 3);
}

/** The page most likely to be the careers page, from a site's map. */
export function pickCareersPage(links: readonly string[], domain: string): string | null {
  const score = (u: string) => {
    let s = 0;
    const p = u.toLowerCase();
    if (!p.includes(domain)) return -1;
    if (/\/careers\/?$|\/jobs\/?$/.test(p)) s += 5;
    if (/careers|jobs|join|work-with-us|open-positions|opportunities/.test(p)) s += 3;
    if (/blog|news|press|\/job\/|\/careers\/.+\/.+/.test(p)) s -= 2;
    return s - p.length / 200;
  };
  const best = [...links].map((u) => ({ u, s: score(u) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0];
  return best?.u ?? null;
}

/** What the finder reports for one board it found: its size, and where its jobs are. */
export interface BoardCheck extends FoundBoard {
  jobs: number;
  us: number;
  utah: number;
}
