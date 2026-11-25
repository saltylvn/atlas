import "server-only";
import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { safeFetchJson, safeFetchText } from "@/lib/security/safeFetch";
import { parsePay } from "@/lib/domain/careerAgent";
import { scorePosting } from "@/lib/domain/jobs";
import { extractSkills } from "@/lib/domain/skills";
import { certsIn, yearsAsked } from "@/lib/domain/requirements";
import { createTtlCache } from "@/lib/domain/ttlCache";
import type { JobPosting, JobWatch } from "@/lib/domain/types";

// Public, unauthenticated job-board APIs. Read-only: Atlas never applies anywhere.
const greenhouse = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      absolute_url: z.string(),
      updated_at: z.string().optional(),
      location: z.object({ name: z.string() }).partial().optional(),
      /** Only with ?content=true: the description as escaped HTML. */
      content: z.string().optional(),
    }),
  ),
});
const lever = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string(),
    createdAt: z.number().optional(),
    categories: z.object({ location: z.string().optional(), commitment: z.string().optional() }).partial().optional(),
    descriptionPlain: z.string().optional(),
    additionalPlain: z.string().optional(),
    workplaceType: z.string().optional(),
    salaryRange: z.object({ min: z.number().nullable().optional(), max: z.number().nullable().optional(), currency: z.string().nullable().optional(), interval: z.string().nullable().optional() }).nullable().optional(),
  }),
);
const ashby = z.object({
  jobs: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      jobUrl: z.string(),
      location: z.string().optional(),
      isRemote: z.boolean().optional().nullable(),
      publishedAt: z.string().optional(),
      descriptionPlain: z.string().optional().nullable(),
      workplaceType: z.string().optional().nullable(),
      employmentType: z.string().optional().nullable(),
      compensation: z
        .object({
          summaryComponents: z
            .array(z.object({ compensationType: z.string().optional(), interval: z.string().optional().nullable(), currencyCode: z.string().optional().nullable(), minValue: z.number().nullable().optional(), maxValue: z.number().nullable().optional() }).passthrough())
            .optional()
            .nullable(),
        })
        .passthrough()
        .optional()
        .nullable(),
    }),
  ),
});

// SmartRecruiters' public Posting API (the one career sites use). No link in the list: a
// posting's page is jobs.smartrecruiters.com/{company}/{id}.
const smartrecruiters = z.object({
  content: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      releasedDate: z.string().optional(),
      company: z.object({ identifier: z.string() }).partial().optional(),
      location: z.object({ fullLocation: z.string(), city: z.string(), region: z.string(), remote: z.boolean() }).partial().optional(),
    }),
  ),
});
// Workable's public jobs widget feed, the one its embeddable careers widget reads.
const workable = z.object({
  jobs: z.array(
    z.object({
      shortcode: z.string(),
      title: z.string(),
      url: z.string(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      telecommuting: z.boolean().optional(),
      published_on: z.string().optional(),
    }),
  ),
});
// Recruitee's public Careers Site API, on the company's own subdomain.
const recruitee = z.object({
  offers: z.array(
    z.object({
      id: z.number(),
      title: z.string(),
      careers_url: z.string(),
      location: z.string().optional().nullable(),
      remote: z.boolean().optional().nullable(),
      published_at: z.string().optional().nullable(),
    }),
  ),
});

// BambooHR's careers list, the JSON its hosted careers page loads, on the company's own subdomain.
// The posting's page is {slug}.bamboohr.com/careers/{id}. BambooHR is popular with Utah companies.
const bamboohr = z.object({
  result: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      jobOpeningName: z.string(),
      employmentStatusLabel: z.string().nullable().optional(),
      location: z.object({ city: z.string().nullable().optional(), state: z.string().nullable().optional() }).nullable().optional(),
      isRemote: z.boolean().nullable().optional(),
    }),
  ),
});
// ApplicantPro (a Utah-made hiring system) publishes an RSS feed per employer for its careers
// widget. Items have a title, link, description and sometimes a salary; no location field.
const applicantproItem = z.object({ title: z.coerce.string(), link: z.coerce.string(), description: z.coerce.string().optional(), salary: z.coerce.string().optional(), pubDate: z.coerce.string().optional() });
const rss = new XMLParser({ ignoreAttributes: true, processEntities: true, htmlEntities: true });

/**
 * Recruitee, BambooHR and ApplicantPro serve each company from its own subdomain; the slug is
 * checked before it becomes a host, and that one host is the only extra one the read may reach.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const SUBDOMAIN: Partial<Record<JobWatch["board"], string>> = { recruitee: "recruitee.com", bamboohr: "bamboohr.com", applicantpro: "applicantpro.com" };
export function boardHost(w: Pick<JobWatch, "board" | "slug">): string | null {
  const base = SUBDOMAIN[w.board];
  return base && SLUG.test(w.slug) ? `${w.slug}.${base}` : null;
}
export const recruiteeHost = (slug: string): string | null => boardHost({ board: "recruitee", slug });

/** "2026-11-18 16:23:32 UTC" and other date strings as ISO, or null. */
const iso = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const t = Date.parse(s.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

export interface Raw {
  id: string;
  title: string;
  url: string;
  location: string;
  updatedAt: string | null;
  /**
   * Details, when the board gave a description or pay: the skills it names, pay in U.S. dollars
   * a year, and a few words on work mode and job type ("remote full-time"). The description itself
   * is never kept: only what is read from it.
   */
  skills?: string[];
  payMin?: number;
  payMax?: number;
  hint?: string;
  /** Years of experience and certifications the description asks for. */
  yearsMin?: number;
  certs?: string[];
}

/** Greenhouse sends descriptions as escaped HTML: decode, then drop the tags. */
export function plainText(escapedHtml: string, max = 20_000): string {
  return escapedHtml
    .slice(0, max * 4)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<(br|p|li|h\d|div)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const HOURS_A_YEAR = 2080;

/** What a description gives: skills, and pay when the board has no pay field. */
function fromText(title: string, text: string, pay?: { min: number; max: number } | null): Pick<Raw, "skills" | "payMin" | "payMax" | "yearsMin" | "certs"> {
  if (!text) return pay ? { payMin: pay.min, payMax: pay.max } : {};
  const found = pay ?? (() => {
    const p = parsePay(`${title} ${text}`);
    if (!p) return null;
    const k = p.unit === "hour" ? HOURS_A_YEAR : 1;
    return { min: Math.round(p.min * k), max: Math.round(p.max * k) };
  })();
  const years = yearsAsked(text);
  const certs = certsIn(text);
  return { skills: extractSkills(`${title} ${text}`).slice(0, 30), ...(found ? { payMin: found.min, payMax: found.max } : {}), ...(years ? { yearsMin: years } : {}), ...(certs.length ? { certs } : {}) };
}

/** A structured pay range in U.S. dollars a year, or null. */
function yearly(min: number | null | undefined, max: number | null | undefined, currency: string | null | undefined, interval: string | null | undefined): { min: number; max: number } | null {
  if ((currency ?? "USD").toUpperCase() !== "USD") return null;
  const lo = min ?? max;
  const hi = max ?? min;
  if (!lo || !hi) return null;
  const i = (interval ?? "").toLowerCase();
  const k = /hour/.test(i) ? HOURS_A_YEAR : /year|annual|salary/.test(i) ? 1 : 0;
  return k ? { min: Math.round(lo * k), max: Math.round(hi * k) } : null;
}

export function boardUrl(w: Pick<JobWatch, "board" | "slug">): string {
  const slug = encodeURIComponent(w.slug);
  switch (w.board) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
    case "lever":
      return `https://api.lever.co/v0/postings/${slug}?mode=json`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;
    case "smartrecruiters":
      // U.S. postings only, newest 100: a large employer lists thousands worldwide.
      return `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100&country=us`;
    case "workable":
      return `https://apply.workable.com/api/v1/widget/accounts/${slug}`;
    case "recruitee":
      return `https://${boardHost(w) ?? "invalid.recruitee.com"}/api/offers/`;
    case "bamboohr":
      return `https://${boardHost(w) ?? "invalid.bamboohr.com"}/careers/list`;
    case "applicantpro":
      return `https://${boardHost(w) ?? "invalid.applicantpro.com"}/feeds/rsswidget.xml`;
  }
}

/** ApplicantPro's feed as postings; any subdomain answers, so a slug with no employer gives none. */
function applicantproJobs(data: unknown, slug: string): Raw[] {
  if (typeof data !== "string") return [];
  let doc: { rss?: { channel?: { item?: unknown } } };
  try {
    doc = rss.parse(data) as typeof doc;
  } catch {
    return [];
  }
  const items = doc.rss?.channel?.item;
  const host = `https://${slug}.applicantpro.com/`;
  return (Array.isArray(items) ? items : items ? [items] : []).flatMap((i) => {
    const p = applicantproItem.safeParse(i);
    if (!p.success || !p.data.link.startsWith(host)) return [];
    const j = p.data;
    const id = /\/jobs\/(\d+)/.exec(j.link)?.[1] ?? j.link;
    const pay = j.salary ? parsePay(j.salary) : null;
    const k = pay?.unit === "hour" ? HOURS_A_YEAR : 1;
    return [{ id, title: j.title.trim(), url: j.link, location: "", updatedAt: iso(j.pubDate), ...fromText(j.title, plainText(j.description ?? ""), pay ? { min: Math.round(pay.min * k), max: Math.round(pay.max * k) } : null) }];
  });
}

export function normalize(board: JobWatch["board"], data: unknown, slug = ""): Raw[] {
  switch (board) {
    case "greenhouse": {
      const p = greenhouse.safeParse(data);
      return p.success
        ? p.data.jobs.map((j) => ({ id: String(j.id), title: j.title, url: j.absolute_url, location: j.location?.name ?? "", updatedAt: j.updated_at ?? null, ...(j.content ? fromText(j.title, plainText(j.content)) : {}) }))
        : [];
    }
    case "lever": {
      const p = lever.safeParse(data);
      return p.success
        ? p.data.map((j) => {
            const pay = j.salaryRange ? yearly(j.salaryRange.min, j.salaryRange.max, j.salaryRange.currency, j.salaryRange.interval) : null;
            const hint = [j.workplaceType, j.categories?.commitment].filter(Boolean).join(" ");
            return { id: j.id, title: j.text, url: j.hostedUrl, location: j.categories?.location ?? "", updatedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null, ...fromText(j.text, `${j.descriptionPlain ?? ""} ${j.additionalPlain ?? ""}`.trim(), pay), ...(hint ? { hint } : {}) };
          })
        : [];
    }
    case "ashby": {
      const p = ashby.safeParse(data);
      return p.success
        ? p.data.jobs.map((j) => {
            const salary = (j.compensation?.summaryComponents ?? []).find((c) => c.compensationType === "Salary");
            const pay = salary ? yearly(salary.minValue, salary.maxValue, salary.currencyCode, salary.interval) : null;
            const hint = [j.workplaceType, j.employmentType].filter(Boolean).join(" ");
            return { id: j.id, title: j.title, url: j.jobUrl, location: [j.location, j.isRemote ? "Remote" : ""].filter(Boolean).join(" · "), updatedAt: j.publishedAt ?? null, ...fromText(j.title, j.descriptionPlain ?? "", pay), ...(hint ? { hint } : {}) };
          })
        : [];
    }
    case "smartrecruiters": {
      const p = smartrecruiters.safeParse(data);
      return p.success
        ? p.data.content.flatMap((j) => {
            const company = j.company?.identifier;
            if (!company) return [];
            const place = j.location?.fullLocation ?? [j.location?.city, j.location?.region].filter(Boolean).join(", ");
            return [{ id: j.id, title: j.name, url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${encodeURIComponent(j.id)}`, location: [place, j.location?.remote ? "Remote" : ""].filter(Boolean).join(" · "), updatedAt: iso(j.releasedDate) }];
          })
        : [];
    }
    case "workable": {
      const p = workable.safeParse(data);
      return p.success
        ? p.data.jobs.map((j) => ({ id: j.shortcode, title: j.title, url: j.url, location: [[j.city, j.state, j.country].filter(Boolean).join(", "), j.telecommuting ? "Remote" : ""].filter(Boolean).join(" · "), updatedAt: iso(j.published_on) }))
        : [];
    }
    case "recruitee": {
      const p = recruitee.safeParse(data);
      return p.success
        ? p.data.offers.map((j) => ({ id: String(j.id), title: j.title, url: j.careers_url, location: [j.location ?? "", j.remote ? "Remote" : ""].filter(Boolean).join(" · "), updatedAt: iso(j.published_at) }))
        : [];
    }
    case "bamboohr": {
      const p = bamboohr.safeParse(data);
      const host = boardHost({ board, slug });
      return p.success && host
        ? p.data.result.map((j) => {
            const place = [j.location?.city, j.location?.state].filter(Boolean).join(", ");
            return { id: String(j.id), title: j.jobOpeningName, url: `https://${host}/careers/${encodeURIComponent(String(j.id))}`, location: [place, j.isRemote ? "Remote" : ""].filter(Boolean).join(" · "), updatedAt: null, ...(j.employmentStatusLabel ? { hint: j.employmentStatusLabel } : {}) };
          })
        : [];
    }
    case "applicantpro":
      return applicantproJobs(data, slug);
  }
}

/** One board's payload: JSON, or the feed's text for ApplicantPro. Subdomain boards may reach only their own host. */
function readBoard(w: Pick<JobWatch, "board" | "slug">, url: string, timeoutMs: number): Promise<unknown> {
  const host = boardHost(w);
  const opts = { revalidate: 0, maxBytes: 25_000_000, timeoutMs, ...(host ? { extraHosts: [host] } : {}) };
  return w.board === "applicantpro" ? safeFetchText(url, { ...opts, accept: "application/rss+xml, application/xml" }) : safeFetchJson(url, opts);
}

/** Field caps for cached postings, so a huge board costs kilobytes, not megabytes, in memory. */
export const TRIM = { maxJobs: 2000, title: 160, location: 120, url: 500, id: 80 } as const;

/** Keeps only http(s) postings with short fields; drops everything else from the board payload. */
export function trimRaw(raw: Raw[]): Raw[] {
  const out: Raw[] = [];
  for (const j of raw) {
    if (out.length >= TRIM.maxJobs) break;
    if (!/^https?:\/\//.test(j.url) || j.url.length > TRIM.url) continue;
    out.push({
      id: j.id.slice(0, TRIM.id),
      title: j.title.slice(0, TRIM.title),
      url: j.url,
      location: j.location.slice(0, TRIM.location),
      updatedAt: j.updatedAt ? j.updatedAt.slice(0, 40) : null,
      ...(j.skills?.length ? { skills: j.skills.slice(0, 30) } : {}),
      ...(j.payMin && j.payMax ? { payMin: j.payMin, payMax: j.payMax } : {}),
      ...(j.hint ? { hint: j.hint.slice(0, 60) } : {}),
      ...(j.yearsMin ? { yearsMin: j.yearsMin } : {}),
      ...(j.certs?.length ? { certs: j.certs.slice(0, 10) } : {}),
    });
  }
  return out;
}

/** Normalized, trimmed postings per board, kept for 45 minutes per server instance. */
export const BOARD_TTL_MS = 45 * 60_000;
const boardCache = createTtlCache<Raw[]>({ ttlMs: BOARD_TTL_MS, maxEntries: 60 });

export function boardCacheKey(w: Pick<JobWatch, "board" | "slug">): string {
  return `${w.board}:${w.slug}`;
}

/**
 * Greenhouse sends descriptions only when asked (?content=true), and that makes a large board
 * about ten times bigger (Databricks: 0.8 MB to 9.8 MB). So they are asked for once a day, at the
 * first sync (owner's choice, 22 Nov 2026); the stored postings keep what was read until the next
 * day. Lever and Ashby send descriptions in the same response every time.
 */
export const detailUrl = (w: Pick<JobWatch, "board" | "slug">, details: boolean): string => (details && w.board === "greenhouse" ? `${boardUrl(w)}?content=true` : boardUrl(w));

async function loadBoard(w: JobWatch, details = false): Promise<Raw[]> {
  const withDetails = details && w.board === "greenhouse";
  return boardCache.getOrLoad(`${boardCacheKey(w)}${withDetails ? ":details" : ""}`, async () =>
    // revalidate 0: skip Next's data cache (2 MB limit); the trimmed result is cached above instead.
    trimRaw(normalize(w.board, await readBoard(w, detailUrl(w, details), withDetails ? 20_000 : 10_000), w.slug)),
  );
}

/**
 * Every job on one company's Greenhouse board, or null when there is no such board. The same
 * public API and cache as the watchlist. Used to find the employer's own posting of a job you
 * approved on a job site.
 */
export async function greenhouseBoard(slug: string): Promise<{ title: string; url: string; location: string }[] | null> {
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) return null;
  try {
    return (await loadBoard({ id: slug, company: slug, board: "greenhouse", slug, createdAt: "" })).map((j) => ({ title: j.title, url: j.url, location: j.location }));
  } catch {
    return null;
  }
}

export interface ScanResult {
  postings: JobPosting[];
  failed: string[];
  scanned: number;
}

/**
 * `keep` drops postings before the best 60 are chosen. Without it a big company's senior and
 * overseas roles, which score highest on the keywords, take every seat and are thrown away later.
 */
export async function scanBoards(watches: JobWatch[], keywords: string[], locations: string[], keep?: (title: string, location: string) => boolean): Promise<ScanResult> {
  const results = await Promise.allSettled(
    watches.map(async (w) => ({ w, raw: await loadBoard(w) })),
  );
  const postings: JobPosting[] = [];
  const failed: string[] = [];
  let scanned = 0;
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") {
      failed.push(watches[i]!.company);
      return;
    }
    scanned += r.value.raw.length;
    for (const j of r.value.raw) {
      if (!/^https?:\/\//.test(j.url)) continue;
      if (keep && !keep(j.title, j.location)) continue;
      const m = scorePosting(j.title, j.location, keywords, locations);
      if (m.score === 0) continue;
      postings.push({ id: `${r.value.w.board}:${j.id}`, company: r.value.w.company, title: j.title.slice(0, 160), location: j.location.slice(0, 120), url: j.url, board: r.value.w.board, updatedAt: j.updatedAt, score: m.score, matched: m.matched });
    }
  });
  postings.sort((a, b) => b.score - a.score || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return { postings: postings.slice(0, 60), failed, scanned };
}

/**
 * Every job on each watched board, unfiltered, for the market-wide record (techMarket.ts). Read
 * from the same 45-minute cache as scanBoards, so a sync that scans the boards fetches nothing more.
 */
export async function allBoardJobs(watches: JobWatch[], details = false): Promise<{ company: string; board: JobWatch["board"]; jobs: Raw[] }[]> {
  const results = await Promise.allSettled(watches.map(async (w) => ({ company: w.company, board: w.board, jobs: await loadBoard(w, details) })));
  return results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
}

/** One board read once, uncached, for the board finder: its jobs, or null when there is no such board. */
export async function probeBoard(w: Pick<JobWatch, "board" | "slug">): Promise<Raw[] | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(w.slug)) return null;
  try {
    const raw = normalize(w.board, await readBoard(w, boardUrl(w), 10_000), w.slug);
    return raw.length ? trimRaw(raw) : null;
  } catch {
    return null;
  }
}
