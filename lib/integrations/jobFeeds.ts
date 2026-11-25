import { wrongLevel } from "@/lib/domain/careerAgent";
import { workplaceOf } from "@/lib/domain/workplace";
import "server-only";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { RawJob } from "@/lib/domain/careerAgent";
import type { JobWatch } from "@/lib/domain/types";
import { UTAH_LIST_TAG } from "@/lib/domain/jobSources";
import { suggestedUtah } from "@/lib/domain/utahSeed";
import { safeFetchJson, safeFetchText } from "@/lib/security/safeFetch";
import { env } from "@/lib/env";
import { cleanTitle, safeLink } from "./rss";
import { allBoardJobs, scanBoards } from "./jobBoards";

// The Career Agent's job sources: only public feeds and APIs whose terms allow reading
// them. LinkedIn, Indeed, Glassdoor, Wellfound, YC and Dice have no
// public feed and forbid scraping, so Atlas links to saved searches for those instead
// (savedSearches in lib/domain/careerAgent.ts). Every feed is untrusted text: only plain
// text is kept, links must be http(s), and nothing is rendered as HTML.
//
//   Remote OK        public JSON API (its terms: link back to the listing, name the source)
//   We Work Remotely category RSS feeds
//   Jobicy           public JSON API of remote jobs open to the USA (its terms: credit Jobicy
//                    and link to the listing; read at most a few times a day)
//   Hacker News      the monthly "Who is hiring?" thread, through the public Algolia
//                    HN API
//   Himalayas        public JSON search API, U.S. full-time, one search per target title
//                    (its terms: credit Himalayas, link to the listing, don't pass jobs on)
//   Remotive         public JSON API, three tech categories (its terms: credit Remotive and
//                    link to the listing; jobs arrive 24 hours late)
//   Company boards   your watchlist on Greenhouse, Lever, Ashby, SmartRecruiters, Workable,
//                    Recruitee, BambooHR and ApplicantPro (lib/integrations/jobBoards.ts)
//   Utah companies   the Utah tech companies in lib/domain/utahSeed.ts, on the same boards,
//                    for the market record only (never your matches)

export const REMOTE_BOARDS: ReadonlySet<string> = new Set(["Remote OK", "We Work Remotely", "Jobicy", "Himalayas", "Remotive"]);
const TIMEOUT = 8000;

const strip = (html: string, max = 800) =>
  cleanTitle(
    html
      .replace(/<(br|p|li|h\d)[^>]*>/gi, " · ")
      .replace(/<[^>]+>/g, " ")
      .slice(0, max * 3),
  ).slice(0, max);

/** Repairs UTF-8 text that was decoded as Latin-1 upstream ("â" for an em dash). */
export function fixMojibake(s: string): string {
  if (!/[ÂÃâ][\u0080-\u00bf]/.test(s)) return s;
  try {
    const fixed = Buffer.from(s, "latin1").toString("utf8");
    return fixed.includes("\ufffd") ? s : fixed;
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// Remote OK

const RemoteOk = z.array(
  z
    .object({
      id: z.union([z.string(), z.number()]).optional(),
      date: z.string().optional(),
      company: z.string().optional(),
      position: z.string().optional(),
      tags: z.array(z.string()).optional(),
      location: z.string().optional(),
      salary_min: z.number().optional(),
      salary_max: z.number().optional(),
      url: z.string().optional(),
      description: z.string().optional(),
    })
    .passthrough(),
);

export function parseRemoteOk(data: unknown): RawJob[] {
  const rows = RemoteOk.safeParse(data);
  if (!rows.success) return [];
  return rows.data.flatMap((j) => {
    const url = safeLink(j.url ?? "");
    if (!j.id || !j.position || !url) return [];
    // Remote OK's tags are loose (an engineering role can be tagged "medical"); only the
    // employment-type ones are kept.
    const tags = (j.tags ?? []).filter((t) => /contract|part[ -]?time|freelance|full[ -]?time/i.test(t)).join(" ");
    return [
      {
        key: `remoteok:${j.id}`,
        source: "Remote OK",
        title: cleanTitle(fixMojibake(j.position)).slice(0, 160),
        company: cleanTitle(fixMojibake(j.company ?? "")).slice(0, 120),
        url,
        location: cleanTitle(j.location ?? "").slice(0, 120),
        text: `${tags} ${strip(j.description ?? "", 2000)}`.trim(),
        postedAt: j.date && !Number.isNaN(Date.parse(j.date)) ? new Date(j.date).toISOString() : null,
        salaryMin: j.salary_min || undefined,
        salaryMax: j.salary_max || undefined,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Jobicy

const text = z.union([z.string(), z.number()]).transform(String);
const Jobicy = z.object({
  jobs: z.array(
    z
      .object({
        id: text.optional(),
        url: z.string().optional(),
        jobTitle: z.string().optional(),
        companyName: z.string().optional(),
        jobType: z.union([z.array(z.string()), z.string()]).optional(),
        jobGeo: z.string().optional(),
        jobExcerpt: z.string().optional(),
        jobDescription: z.string().optional(),
        pubDate: z.string().optional(),
        salaryMin: text.optional(),
        salaryMax: text.optional(),
        salaryCurrency: z.string().optional(),
        salaryPeriod: z.string().optional(),
      })
      .passthrough(),
  ),
});

export function parseJobicy(data: unknown): RawJob[] {
  const rows = Jobicy.safeParse(data);
  if (!rows.success) return [];
  return rows.data.jobs.flatMap((j) => {
    const url = safeLink(j.url ?? "");
    if (!j.id || !j.jobTitle || !url) return [];
    const types = (Array.isArray(j.jobType) ? j.jobType : [j.jobType ?? ""]).join(" ");
    // Pay counts only when it is stated in US dollars a year; anything else is left to the text.
    const yearlyUsd = (j.salaryCurrency ?? "").toUpperCase() === "USD" && /^year/i.test(j.salaryPeriod ?? "");
    const min = yearlyUsd ? Number(j.salaryMin) : NaN;
    const max = yearlyUsd ? Number(j.salaryMax) : NaN;
    return [
      {
        key: `jobicy:${j.id}`,
        source: "Jobicy",
        title: cleanTitle(fixMojibake(j.jobTitle)).slice(0, 160),
        company: cleanTitle(fixMojibake(j.companyName ?? "")).slice(0, 120),
        url,
        location: cleanTitle(j.jobGeo ?? "").slice(0, 120),
        text: `${types} ${strip(j.jobDescription || j.jobExcerpt || "", 2000)}`.trim(),
        postedAt: j.pubDate && !Number.isNaN(Date.parse(j.pubDate)) ? new Date(j.pubDate).toISOString() : null,
        salaryMin: Number.isFinite(min) && min > 0 ? min : undefined,
        salaryMax: Number.isFinite(max) && max > 0 ? max : Number.isFinite(min) && min > 0 ? min : undefined,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Adzuna: a large U.S. aggregator. Free key, personal research: its terms ask that Adzuna be
// credited wherever its salary or vacancy data appears. A salary Adzuna estimated
// (salary_is_predicted) is not posted pay, so it is left out.

export const ADZUNA_QUERIES = ["software engineer", "junior software engineer", "data engineer", "devops engineer", "solutions engineer"] as const;

export const adzunaKeys = (): { id: string; key: string } | null => {
  const e = env();
  return e.ADZUNA_APP_ID && e.ADZUNA_APP_KEY ? { id: e.ADZUNA_APP_ID, key: e.ADZUNA_APP_KEY } : null;
};

export function adzunaUrl(what: string, k: { id: string; key: string }): string {
  return `https://api.adzuna.com/v1/api/jobs/us/search/1?app_id=${encodeURIComponent(k.id)}&app_key=${encodeURIComponent(k.key)}&results_per_page=50&what=${encodeURIComponent(what)}&max_days_old=7&sort_by=date&content-type=application/json`;
}

const Adzuna = z.object({
  results: z.array(
    z
      .object({
        id: z.union([z.string(), z.number()]),
        title: z.string().optional(),
        redirect_url: z.string().optional(),
        description: z.string().optional(),
        created: z.string().optional(),
        company: z.object({ display_name: z.string().optional() }).partial().optional(),
        location: z.object({ display_name: z.string().optional(), area: z.array(z.string()).optional() }).partial().optional(),
        salary_min: z.number().optional().nullable(),
        salary_max: z.number().optional().nullable(),
        salary_is_predicted: z.union([z.string(), z.number()]).optional(),
        contract_time: z.string().optional().nullable(),
        contract_type: z.string().optional().nullable(),
      })
      .passthrough(),
  ),
});

export function parseAdzuna(data: unknown): RawJob[] {
  const rows = Adzuna.safeParse(data);
  if (!rows.success) return [];
  return rows.data.results.flatMap((j) => {
    const url = safeLink(j.redirect_url ?? "");
    if (!j.title || !url) return [];
    const predicted = String(j.salary_is_predicted ?? "0") === "1";
    const min = predicted ? NaN : Number(j.salary_min);
    const max = predicted ? NaN : Number(j.salary_max);
    const area = j.location?.area ?? [];
    const place = j.location?.display_name ?? "";
    // "US, Utah, Salt Lake County" reads as a U.S. place even when the display name is a county.
    const location = [place, area.length > 1 ? `${area[1]}, US` : area[0] === "US" ? "US" : ""].filter(Boolean).join(" · ");
    const date = Date.parse(j.created ?? "");
    return [
      {
        key: `adzuna:${j.id}`,
        source: "Adzuna",
        title: cleanTitle(fixMojibake(j.title)).slice(0, 160),
        company: cleanTitle(fixMojibake(j.company?.display_name ?? "")).slice(0, 120),
        url,
        location: cleanTitle(location).slice(0, 120),
        // "full_time permanent", "contract": kept in the text, where the contract and part-time rules look.
        text: `${(j.contract_time ?? "").replace(/_/g, " ")} ${j.contract_type ?? ""} ${strip(j.description ?? "", 1500)}`.trim(),
        postedAt: Number.isNaN(date) ? null : new Date(date).toISOString(),
        salaryMin: Number.isFinite(min) && min > 0 ? min : undefined,
        salaryMax: Number.isFinite(max) && max > 0 ? max : Number.isFinite(min) && min > 0 ? min : undefined,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Himalayas: the search endpoint, one query per target title, U.S. and full-time only.

const num = z.union([z.number(), z.string()]).optional().nullable();
const Himalayas = z.object({
  jobs: z.array(
    z
      .object({
        guid: z.string().optional(),
        title: z.string().optional(),
        companyName: z.string().optional(),
        applicationLink: z.string().optional(),
        employmentType: z.string().optional(),
        excerpt: z.string().optional(),
        description: z.string().optional(),
        minSalary: num,
        maxSalary: num,
        currency: z.string().optional().nullable(),
        salaryPeriod: z.string().optional().nullable(),
        locationRestrictions: z.array(z.string()).optional().nullable(),
        pubDate: num,
      })
      .passthrough(),
  ),
});

/** How many target titles get their own Himalayas search each run. */
export const HIMALAYAS_QUERIES = 6;

export function himalayasUrl(title: string): string {
  return `https://himalayas.app/jobs/api/search?q=${encodeURIComponent(title)}&country=US&employment_type=${encodeURIComponent("Full Time")}&sort=recent`;
}

export function parseHimalayas(data: unknown): RawJob[] {
  const rows = Himalayas.safeParse(data);
  if (!rows.success) return [];
  return rows.data.jobs.flatMap((j) => {
    const url = safeLink(j.applicationLink ?? j.guid ?? "");
    if (!j.title || !url) return [];
    const yearlyUsd = (j.currency ?? "").toUpperCase() === "USD" && /^annual|^year/i.test(j.salaryPeriod ?? "");
    const min = yearlyUsd ? Number(j.minSalary) : NaN;
    const max = yearlyUsd ? Number(j.maxSalary) : NaN;
    const places = j.locationRestrictions ?? [];
    const location = places.length === 0 ? "Worldwide" : places.includes("United States") && places.length > 3 ? "United States and other countries" : places.slice(0, 3).join(", ");
    const seconds = Number(j.pubDate);
    return [
      {
        key: `himalayas:${url}`,
        source: "Himalayas",
        title: cleanTitle(fixMojibake(j.title)).slice(0, 160),
        company: cleanTitle(fixMojibake(j.companyName ?? "")).slice(0, 120),
        url,
        location: cleanTitle(location).slice(0, 120),
        text: `${j.employmentType ?? ""} ${strip(j.description || j.excerpt || "", 2000)}`.trim(),
        postedAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null,
        salaryMin: Number.isFinite(min) && min > 0 ? min : undefined,
        salaryMax: Number.isFinite(max) && max > 0 ? max : Number.isFinite(min) && min > 0 ? min : undefined,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Remotive: three tech categories. Jobs arrive 24 hours late by Remotive's own rule.

export const REMOTIVE_CATEGORIES = ["software-development", "devops", "artificial-intelligence"] as const;

const Remotive = z.object({
  jobs: z.array(
    z
      .object({
        id: z.union([z.number(), z.string()]),
        url: z.string().optional(),
        title: z.string().optional(),
        company_name: z.string().optional(),
        job_type: z.string().optional(),
        candidate_required_location: z.string().optional(),
        publication_date: z.string().optional(),
        description: z.string().optional(),
      })
      .passthrough(),
  ),
});

export function parseRemotive(data: unknown): RawJob[] {
  const rows = Remotive.safeParse(data);
  if (!rows.success) return [];
  return rows.data.jobs.flatMap((j) => {
    const url = safeLink(j.url ?? "");
    if (!j.title || !url) return [];
    const date = Date.parse(j.publication_date ? `${j.publication_date}Z` : "");
    return [
      {
        key: `remotive:${j.id}`,
        source: "Remotive",
        title: cleanTitle(fixMojibake(j.title)).slice(0, 160),
        company: cleanTitle(fixMojibake(j.company_name ?? "")).slice(0, 120),
        url,
        location: cleanTitle(j.candidate_required_location ?? "").slice(0, 120),
        // "full_time", "contract", "part_time": kept in the text, where the contract and part-time rules look.
        text: `${(j.job_type ?? "").replace(/_/g, " ")} ${strip(j.description ?? "", 2000)}`.trim(),
        postedAt: Number.isNaN(date) ? null : new Date(date).toISOString(),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// We Work Remotely

const WWR_CATEGORIES = ["remote-programming-jobs", "remote-full-stack-programming-jobs", "remote-back-end-programming-jobs", "remote-devops-sysadmin-jobs"];
const xml = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true });

export function parseWwr(text: string): RawJob[] {
  let doc: { rss?: { channel?: { item?: unknown } } };
  try {
    doc = xml.parse(text) as typeof doc;
  } catch {
    return [];
  }
  const items = doc.rss?.channel?.item;
  const list = (Array.isArray(items) ? items : items ? [items] : []) as Record<string, unknown>[];
  return list.flatMap((i) => {
    const full = cleanTitle(String(i.title ?? ""));
    const url = safeLink(String(i.link ?? i.guid ?? ""));
    if (!full || !url) return [];
    const colon = full.indexOf(":");
    const date = Date.parse(String(i.pubDate ?? ""));
    return [
      {
        key: `wwr:${url}`,
        source: "We Work Remotely",
        company: colon > 0 ? full.slice(0, colon).trim().slice(0, 120) : "",
        title: (colon > 0 ? full.slice(colon + 1) : full).replace(/\s+Job Title:.*$/i, "").trim().slice(0, 160),
        url,
        location: cleanTitle(String(i.region ?? "")).slice(0, 120),
        text: strip(String(i.description ?? ""), 2000),
        postedAt: Number.isNaN(date) ? null : new Date(date).toISOString(),
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Hacker News (Algolia API)

const HnSearch = z.object({ hits: z.array(z.object({ objectID: z.string(), title: z.string().optional(), created_at: z.string() })) });
interface HnItem {
  id: number;
  created_at?: string;
  text?: string | null;
  children?: HnItem[];
}

/** One posting per top-level comment. The first line is "Company | Role | Location | ...". */
export function parseHnThread(thread: HnItem): RawJob[] {
  return (thread.children ?? []).flatMap((c) => {
    if (!c.text) return [];
    const body = strip(c.text, 2000);
    const first = cleanTitle(c.text.split(/<p>|\n/i)[0] ?? "");
    if (!first) return [];
    const parts = first.split("|").map((p) => p.trim());
    return [
      {
        key: `hn:${c.id}`,
        source: "HN Who's Hiring",
        company: (parts[0] ?? "").slice(0, 120),
        title: (parts.length > 1 ? parts.slice(1).join(" | ") : first).slice(0, 160),
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        location: first.slice(0, 160),
        text: body,
        postedAt: c.created_at && !Number.isNaN(Date.parse(c.created_at)) ? new Date(c.created_at).toISOString() : null,
      },
    ];
  });
}

/**
 * The thread is posted on the first weekday of each month by the `whoishiring` account. Search
 * that account's stories only: on 19 Nov 2026 another user posted a joke thread with the same
 * title prefix (1 comment), and a title-only search picked it over the real one (380).
 */
export const HN_SEARCH = "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=5";

/** The newest real "Who is hiring?" thread among the account's posts (it also posts "Who wants to be hired?"). */
export function pickHiringThread(hits: readonly { objectID: string; title?: string }[], query: string): string | null {
  return hits.find((h) => (h.title ?? "").toLowerCase().startsWith(query.toLowerCase().replace(/"/g, "")))?.objectID ?? null;
}

async function hnThread(query: string): Promise<RawJob[]> {
  const search = HnSearch.parse(await safeFetchJson(HN_SEARCH, { revalidate: 3600, timeoutMs: TIMEOUT }));
  const id = pickHiringThread(search.hits, query);
  const latest = id ? { objectID: id } : null;
  if (!latest) return [];
  const item = await safeFetchJson<HnItem>(`https://hn.algolia.com/api/v1/items/${encodeURIComponent(latest.objectID)}`, { revalidate: 3600, timeoutMs: TIMEOUT, maxBytes: 8_000_000 });
  return parseHnThread(item);
}

// ---------------------------------------------------------------------------
// All sources

export interface FeedResult {
  jobs: RawJob[];
  /** Every job on the watched boards, unfiltered, for the market-wide record. */
  boardAll?: RawJob[];
  /** Utah-list boards that answered and that were asked, when the list was read. */
  utahList?: { read: number; of: number };
  failed: string[];
  sourceCount: number;
}

/**
 * Broad searches so the market-wide record is not only your titles: one per role family.
 * Himalayas searches are capped at HIMALAYAS_QUERIES + this many a run, each cached six hours.
 */
export const HIMALAYAS_FAMILY_QUERIES = ["software engineer", "data engineer", "devops engineer", "security engineer"] as const;

/** Searches for the level Tyler aims at (Step 1, 23 Nov 2026): the feeds hold few entry-level roles unless asked for them. */
export const ENTRY_LEVEL_QUERIES = ["junior software engineer", "associate software engineer", "software engineer i", "new grad software engineer"] as const;

export async function fetchJobFeeds(watches: JobWatch[], roleTitles: string[], opts: { details?: boolean; skip?: readonly string[]; adzuna?: boolean } = {}): Promise<FeedResult> {
  // Sources you turned off on the Data Pipeline page are not read at all.
  const off = new Set(opts.skip ?? []);
  const sources: { name: string; run: () => Promise<RawJob[]> }[] = [
    { name: "Remote OK", run: async () => parseRemoteOk(await safeFetchJson("https://remoteok.com/api", { revalidate: 1800, timeoutMs: TIMEOUT, maxBytes: 5_000_000 })) },
    ...WWR_CATEGORIES.map((c) => ({
      name: "We Work Remotely",
      run: async () => parseWwr(await safeFetchText(`https://weworkremotely.com/categories/${c}.rss`, { revalidate: 1800, timeoutMs: TIMEOUT, maxBytes: 4_000_000 })),
    })),
    // Jobicy asks to be read sparingly: one request, cached for six hours.
    { name: "Jobicy", run: async () => parseJobicy(await safeFetchJson("https://jobicy.com/api/v2/remote-jobs?count=100&geo=usa&industry=dev", { revalidate: 21_600, timeoutMs: TIMEOUT, maxBytes: 6_000_000 })) },
    { name: "HN Who's Hiring", run: () => hnThread("Ask HN: Who is hiring?") },
    // Himalayas and Remotive refresh about once a day: each request is cached for six hours.
    ...[...new Set([...roleTitles.map((t) => t.trim()).filter(Boolean).slice(0, HIMALAYAS_QUERIES), ...HIMALAYAS_FAMILY_QUERIES, ...ENTRY_LEVEL_QUERIES].map((t) => t.toLowerCase()))].map((title) => ({
      name: "Himalayas",
      run: async () => parseHimalayas(await safeFetchJson(himalayasUrl(title), { revalidate: 21_600, timeoutMs: TIMEOUT, maxBytes: 4_000_000 })),
    })),
    ...REMOTIVE_CATEGORIES.map((c) => ({
      name: "Remotive",
      run: async () => parseRemotive(await safeFetchJson(`https://remotive.com/api/remote-jobs?category=${c}`, { revalidate: 21_600, timeoutMs: TIMEOUT, maxBytes: 8_000_000 })),
    })),
    // Adzuna: the free key, 4 searches a day, at the first sync only (owner's choice). Never cached by
    // Next: the key is in the URL, which safeFetch never logs.
    ...(opts.adzuna && adzunaKeys()
      ? ADZUNA_QUERIES.map((q) => ({ name: "Adzuna", run: async () => parseAdzuna(await safeFetchJson(adzunaUrl(q, adzunaKeys()!), { revalidate: 0, timeoutMs: TIMEOUT, maxBytes: 4_000_000 })) }))
      : []),
  ];
  if (watches.length && !off.has("Company boards")) {
    sources.push({
      name: "Company boards",
      run: async () =>
        // Only roles at your level, in a place you can work: the rest would be dropped later anyway.
        (await scanBoards(watches, roleTitles, ["Remote", "Salt Lake", "Utah"], (title, location) => !wrongLevel(title) && workplaceOf(location, "", false) !== null)).postings.map((p) => ({
          key: p.id,
          source: `${p.company} careers`,
          title: p.title,
          company: p.company,
          url: p.url,
          location: p.location,
          text: "",
          postedAt: p.updatedAt,
        })),
    });
  }
  const live = sources.filter((s) => !off.has(s.name));
  const results = await Promise.allSettled(live.map((s) => s.run()));
  const jobs: RawJob[] = [];
  const failed = new Set<string>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") jobs.push(...r.value);
    else failed.add(live[i]!.name);
  });
  const seen = new Set<string>();
  // The boards were just read by the scan above, so these come from its cache.
  const boards = watches.length && !off.has("Company boards") ? await allBoardJobs(watches, opts.details ?? false).catch(() => []) : [];
  // The Utah list: market only, so it goes into boardAll and never into jobs (your matches).
  // A company you watch is left out here; it was read above as a company board.
  const utah = off.has("Utah companies") ? [] : suggestedUtah(watches).map((c, i) => ({ id: `utah-${i}`, company: c.company, board: c.board, slug: c.slug, createdAt: "" }));
  const utahBoards = utah.length ? await allBoardJobs(utah, opts.details ?? false).catch(() => []) : [];
  const toRaw = (b: (typeof boards)[number], source: string): RawJob[] =>
    b.jobs.map((j) => ({ key: `${b.board}:${j.id}`, source, title: j.title, company: b.company, url: j.url, location: j.location, text: j.hint ?? "", postedAt: j.updatedAt, ...(j.payMin && j.payMax ? { salaryMin: j.payMin, salaryMax: j.payMax } : {}), ...(j.skills?.length ? { skills: j.skills } : {}), ...(j.yearsMin ? { yearsMin: j.yearsMin } : {}), ...(j.certs?.length ? { certs: j.certs } : {}) }));
  const boardAll: RawJob[] = [...boards.flatMap((b) => toRaw(b, `${b.company} careers`)), ...utahBoards.flatMap((b) => toRaw(b, `${b.company} careers${UTAH_LIST_TAG}`))];
  if (utah.length && !utahBoards.length) failed.add("Utah companies");
  return {
    jobs: jobs.filter((j) => (seen.has(j.key) ? false : (seen.add(j.key), true))),
    boardAll,
    ...(utah.length ? { utahList: { read: utahBoards.length, of: utah.length } } : {}),
    failed: [...failed],
    sourceCount: new Set(live.map((s) => s.name)).size + (utah.length ? 1 : 0),
  };
}
