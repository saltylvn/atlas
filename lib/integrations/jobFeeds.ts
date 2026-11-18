import "server-only";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import type { RawJob } from "@/lib/domain/careerAgent";
import type { JobWatch } from "@/lib/domain/types";
import { safeFetchJson, safeFetchText } from "@/lib/security/safeFetch";
import { cleanTitle, safeLink } from "./rss";
import { scanBoards } from "./jobBoards";

// The Career Agent's job sources: only public feeds and APIs whose terms allow reading
// them. LinkedIn, Indeed, Glassdoor, Wellfound, YC, Dice, Upwork and Contra have no
// public feed and forbid scraping, so Atlas links to saved searches for those instead
// (savedSearches in lib/domain/careerAgent.ts). Every feed is untrusted text: only plain
// text is kept, links must be http(s), and nothing is rendered as HTML.
//
//   Remote OK        public JSON API (its terms: link back to the listing, name the source)
//   We Work Remotely category RSS feeds
//   Jobicy           public JSON API of remote jobs open to the USA (its terms: credit Jobicy
//                    and link to the listing; read at most a few times a day)
//   Hacker News      the monthly "Who is hiring?" and "Freelancer? Seeking freelancer?"
//                    threads, through the public Algolia HN API
//   Company boards   your watchlist on Greenhouse, Lever and Ashby (lib/integrations/jobBoards.ts)

export const REMOTE_BOARDS: ReadonlySet<string> = new Set(["Remote OK", "We Work Remotely", "Jobicy"]);
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
export function parseHnThread(thread: HnItem, gigs: boolean): RawJob[] {
  return (thread.children ?? []).flatMap((c) => {
    if (!c.text) return [];
    const body = strip(c.text, 2000);
    if (gigs && !/^\s*seeking freelancer/i.test(body)) return [];
    const first = cleanTitle(c.text.split(/<p>|\n/i)[0] ?? "").replace(/^seeking freelancer[:\s|-]*/i, "");
    if (!first) return [];
    const parts = first.split("|").map((p) => p.trim());
    return [
      {
        key: `hn:${c.id}`,
        source: gigs ? "HN Freelancer thread" : "HN Who's Hiring",
        company: (parts[0] ?? "").slice(0, 120),
        title: (parts.length > 1 ? parts.slice(1).join(" | ") : first).slice(0, 160),
        url: `https://news.ycombinator.com/item?id=${c.id}`,
        location: first.slice(0, 160),
        text: body,
        postedAt: c.created_at && !Number.isNaN(Date.parse(c.created_at)) ? new Date(c.created_at).toISOString() : null,
        ...(gigs ? { typeHint: "gig" as const } : {}),
      },
    ];
  });
}

async function hnThread(query: string, gigs: boolean): Promise<RawJob[]> {
  const search = HnSearch.parse(
    await safeFetchJson(`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=5`, { revalidate: 3600, timeoutMs: TIMEOUT }),
  );
  const latest = search.hits.find((h) => (h.title ?? "").toLowerCase().startsWith(query.toLowerCase().replace(/"/g, "")));
  if (!latest) return [];
  const item = await safeFetchJson<HnItem>(`https://hn.algolia.com/api/v1/items/${encodeURIComponent(latest.objectID)}`, { revalidate: 3600, timeoutMs: TIMEOUT, maxBytes: 8_000_000 });
  return parseHnThread(item, gigs);
}

// ---------------------------------------------------------------------------
// All sources

export interface FeedResult {
  jobs: RawJob[];
  failed: string[];
  sourceCount: number;
}

export async function fetchJobFeeds(watches: JobWatch[], roleTitles: string[]): Promise<FeedResult> {
  const sources: { name: string; run: () => Promise<RawJob[]> }[] = [
    { name: "Remote OK", run: async () => parseRemoteOk(await safeFetchJson("https://remoteok.com/api", { revalidate: 1800, timeoutMs: TIMEOUT, maxBytes: 5_000_000 })) },
    ...WWR_CATEGORIES.map((c) => ({
      name: "We Work Remotely",
      run: async () => parseWwr(await safeFetchText(`https://weworkremotely.com/categories/${c}.rss`, { revalidate: 1800, timeoutMs: TIMEOUT, maxBytes: 4_000_000 })),
    })),
    // Jobicy asks to be read sparingly: one request, cached for six hours.
    { name: "Jobicy", run: async () => parseJobicy(await safeFetchJson("https://jobicy.com/api/v2/remote-jobs?count=100&geo=usa&industry=dev", { revalidate: 21_600, timeoutMs: TIMEOUT, maxBytes: 6_000_000 })) },
    { name: "HN Who's Hiring", run: () => hnThread("Ask HN: Who is hiring?", false) },
    { name: "HN Freelancer thread", run: () => hnThread("Ask HN: Freelancer? Seeking freelancer?", true) },
  ];
  if (watches.length) {
    sources.push({
      name: "Company boards",
      run: async () =>
        (await scanBoards(watches, roleTitles, ["Remote", "Salt Lake", "Utah"])).postings.map((p) => ({
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
  const results = await Promise.allSettled(sources.map((s) => s.run()));
  const jobs: RawJob[] = [];
  const failed = new Set<string>();
  results.forEach((r, i) => {
    if (r.status === "fulfilled") jobs.push(...r.value);
    else failed.add(sources[i]!.name);
  });
  const seen = new Set<string>();
  return { jobs: jobs.filter((j) => (seen.has(j.key) ? false : (seen.add(j.key), true))), failed: [...failed], sourceCount: new Set(sources.map((s) => s.name)).size };
}
