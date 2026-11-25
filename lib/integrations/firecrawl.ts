import "server-only";
import { z } from "zod";
import { mayRead } from "@/lib/domain/postingFacts";
import { env } from "@/lib/env";
import { BlockedRequestError, HttpError, safeFetchJson } from "@/lib/security/safeFetch";

// Firecrawl, read-only. Atlas uses it for two things: reading the full posting of a job you
// gave a 👍 (lib/agents/postingReader.ts), and once a month a web search per target role,
// whose result snippets the Career Mentor reads to describe the role (lib/agents/roleDescriptions.ts).
//
// - One adapter, one host (api.firecrawl.dev, on the allowlist), through safeFetch.
// - `mayRead` decides which pages may be read at all. LinkedIn, Indeed, Glassdoor and the
//   other sites whose terms forbid automated reading are refused here, before any request.
// - `proxy: "basic"`: Firecrawl's default ("auto") retries a blocked page through proxies
//   built to get past bot protection. A site that blocks the read is left unread instead.
// - Firecrawl applies the site's robots.txt itself.
// - The page text is untrusted. It is returned as plain text, capped, for rules to read
//   (lib/domain/postingFacts.ts). It is never rendered as HTML or given to an AI model.
// - The key (FIRECRAWL_API_KEY, Vercel) is never logged, echoed in an error or sent to
//   the browser. The free plan has 1,000 credits a month; the budget is in postingFacts.ts.
// - A search asks for web results only, with no page scraping: titles, links and the
//   search engine's snippets. Snippets are untrusted text, cleaned and capped here.

const API = "https://api.firecrawl.dev/v2";
/** A posting is a few thousand words. Anything longer is another kind of page. */
const MAX_TEXT = 40_000;
const TIMEOUT_MS = 25_000;

export type ReadProblem = "not_configured" | "refused" | "bad_key" | "out_of_credits" | "rate_limited" | "not_readable" | "unavailable";

/** What to tell the owner. Fixed text: nothing from Firecrawl's reply or the page is echoed. */
export const READ_HELP: Record<ReadProblem, string> = {
  not_configured: "Firecrawl is not set up yet: add FIRECRAWL_API_KEY in Vercel, then redeploy.",
  refused: "Atlas does not read that site.",
  bad_key: "Firecrawl refused the key. Check FIRECRAWL_API_KEY in Vercel and redeploy.",
  out_of_credits: "Firecrawl's free pages for this month are used up. Reading starts again next month.",
  rate_limited: "Firecrawl is rate-limiting requests. The next run will try again.",
  not_readable: "the page could not be read (it may block automated reading, or it is gone)",
  unavailable: "Firecrawl could not be reached. The next run will try again.",
};

/** Problems worth another try later. The rest are settled: the kit says so and is not read again. */
export const RETRY_LATER: ReadonlySet<ReadProblem> = new Set(["not_configured", "bad_key", "out_of_credits", "rate_limited", "unavailable"]);

export type PageRead = { ok: true; text: string; title: string } | { ok: false; problem: ReadProblem };

/** Reads one page. Swapped in tests, which must not reach the network. */
export type PageReader = (url: string) => Promise<PageRead>;

/** A key pasted into Vercel can carry a line break, a space or quotes. A Firecrawl key holds none. */
export const cleanFirecrawlKey = (raw: string | undefined): string => (raw ?? "").replace(/[\s"'`]+/g, "");

export const firecrawlConfigured = (): boolean => cleanFirecrawlKey(env().FIRECRAWL_API_KEY).length >= 20;

const Scraped = z.object({
  success: z.boolean(),
  data: z
    .object({
      markdown: z.string().optional(),
      metadata: z.object({ title: z.union([z.string(), z.array(z.string())]).optional(), statusCode: z.number().optional() }).partial().optional(),
    })
    .optional(),
});

/** Markdown as plain text: links keep their words, images and markup go, control characters go. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]{0,400}>/g, " ")
    .replace(/[`*_#>|]+/g, " ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);
}

/** What Firecrawl is asked for: the main content as markdown, no proxy escalation, nothing interactive. */
export const scrapeBody = (url: string) => ({ url, formats: ["markdown"], onlyMainContent: true, proxy: "basic", removeBase64Images: true, blockAds: true, timeout: TIMEOUT_MS - 5_000 });

/** Firecrawl's reply to a scrape, as the page's text or the reason there is none. */
export function readScrape(json: unknown): PageRead {
  const p = Scraped.safeParse(json);
  if (!p.success || !p.data.success || !p.data.data) return { ok: false, problem: "not_readable" };
  const status = p.data.data.metadata?.statusCode;
  if (status !== undefined && (status < 200 || status >= 300)) return { ok: false, problem: "not_readable" };
  const text = plainText(p.data.data.markdown ?? "");
  // A real posting is more than a line. Less is a cookie wall, a login page or an error.
  if (text.length < 200) return { ok: false, problem: "not_readable" };
  const title = p.data.data.metadata?.title;
  return { ok: true, text, title: plainText(Array.isArray(title) ? (title[0] ?? "") : (title ?? "")).slice(0, 200) };
}

/** Reads one public page through Firecrawl. Never throws: a failure comes back as its reason. */
export const readPage: PageReader = async (url) => {
  const key = cleanFirecrawlKey(env().FIRECRAWL_API_KEY);
  if (key.length < 20) return { ok: false, problem: "not_configured" };
  if (!mayRead(url).ok) return { ok: false, problem: "refused" };
  try {
    const json = await safeFetchJson(`${API}/scrape`, {
      method: "POST",
      body: JSON.stringify(scrapeBody(url)),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      timeoutMs: TIMEOUT_MS,
      maxBytes: 3_000_000,
    });
    return readScrape(json);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401) return { ok: false, problem: "bad_key" };
      if (err.status === 402) return { ok: false, problem: "out_of_credits" };
      if (err.status === 429) return { ok: false, problem: "rate_limited" };
      // 403: robots.txt or the site refuses. 404 and 410: the posting is gone. 400 and 422: not a page it can read.
      if ([400, 403, 404, 410, 422].includes(err.status)) return { ok: false, problem: "not_readable" };
    }
    if (err instanceof BlockedRequestError) return { ok: false, problem: "refused" };
    return { ok: false, problem: "unavailable" };
  }
};

// ---------------------------------------------------------------------------
// Search: web results only, never scraped

export interface WebResult {
  title: string;
  url: string;
  /** The search engine's snippet for the page, as plain text. */
  snippet: string;
}

export type SearchRead = { ok: true; results: WebResult[] } | { ok: false; problem: ReadProblem };

/** Searches the web. Swapped in tests, which must not reach the network. */
export type WebSearcher = (query: string, limit: number) => Promise<SearchRead>;

const Searched = z.object({
  success: z.boolean(),
  data: z.object({ web: z.array(z.object({ url: z.string(), title: z.string().optional(), description: z.string().optional() }).passthrough()).optional() }).passthrough().optional(),
});

/** Firecrawl's reply to a search, as clean results: https links only, plain text, capped, one per site. */
export function readSearch(json: unknown, limit: number): SearchRead {
  const p = Searched.safeParse(json);
  if (!p.success || !p.data.success) return { ok: false, problem: "not_readable" };
  const seen = new Set<string>();
  const results: WebResult[] = [];
  for (const r of p.data.data?.web ?? []) {
    let host = "";
    try {
      const u = new URL(r.url);
      if (u.protocol !== "https:" || u.username || u.password) continue;
      host = u.hostname.replace(/^www\./, "");
    } catch {
      continue;
    }
    if (seen.has(host)) continue;
    const snippet = plainText(r.description ?? "").replace(/\s+/g, " ").slice(0, 400);
    if (snippet.length < 40) continue;
    seen.add(host);
    results.push({ title: plainText(r.title ?? host).replace(/\s+/g, " ").slice(0, 160) || host, url: r.url.slice(0, 500), snippet });
    if (results.length >= limit) break;
  }
  return { ok: true, results };
}

/** One web search through Firecrawl (2 credits per 10 results). Never throws: a failure comes back as its reason. */
export const searchWeb: WebSearcher = async (query, limit) => {
  const key = cleanFirecrawlKey(env().FIRECRAWL_API_KEY);
  if (key.length < 20) return { ok: false, problem: "not_configured" };
  try {
    const json = await safeFetchJson(`${API}/search`, {
      method: "POST",
      body: JSON.stringify({ query: query.slice(0, 200), limit: Math.min(Math.max(limit, 1), 10), sources: ["web"], country: "US" }),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      timeoutMs: TIMEOUT_MS,
      maxBytes: 500_000,
    });
    return readSearch(json, limit);
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401) return { ok: false, problem: "bad_key" };
      if (err.status === 402) return { ok: false, problem: "out_of_credits" };
      if (err.status === 429) return { ok: false, problem: "rate_limited" };
      if ([400, 422].includes(err.status)) return { ok: false, problem: "not_readable" };
    }
    if (err instanceof BlockedRequestError) return { ok: false, problem: "refused" };
    return { ok: false, problem: "unavailable" };
  }
};

// ---------------------------------------------------------------------------
// The board finder (lib/agents/boardFinder.ts): map a company's site to find its careers page
// (1 credit), then read that one page's HTML to find the job board it links to (1 credit).
// The HTML is untrusted: rules search it for job-board addresses, and nothing else reads it.

const problemOf = (err: unknown): ReadProblem => {
  if (err instanceof HttpError) {
    if (err.status === 401) return "bad_key";
    if (err.status === 402) return "out_of_credits";
    if (err.status === 429) return "rate_limited";
    if ([400, 403, 404, 410, 422].includes(err.status)) return "not_readable";
  }
  if (err instanceof BlockedRequestError) return "refused";
  return "unavailable";
};

const MapOut = z.object({ links: z.array(z.union([z.string(), z.object({ url: z.string() }).passthrough()])).optional() });
const HtmlOut = z.object({ data: z.object({ rawHtml: z.string().optional() }).passthrough().optional() });

export async function mapSite(url: string, search: string): Promise<{ ok: true; links: string[] } | { ok: false; problem: ReadProblem }> {
  const key = cleanFirecrawlKey(env().FIRECRAWL_API_KEY);
  if (key.length < 20) return { ok: false, problem: "not_configured" };
  if (!mayRead(url).ok) return { ok: false, problem: "refused" };
  try {
    const json = await safeFetchJson(`${API}/map`, {
      method: "POST",
      body: JSON.stringify({ url, search, limit: 30, includeSubdomains: true, ignoreQueryParameters: true }),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      timeoutMs: TIMEOUT_MS,
      maxBytes: 1_000_000,
    });
    const p = MapOut.safeParse(json);
    if (!p.success) return { ok: false, problem: "unavailable" };
    return { ok: true, links: (p.data.links ?? []).map((l) => (typeof l === "string" ? l : l.url)).filter((u) => /^https?:\/\//.test(u)).slice(0, 30) };
  } catch (err) {
    return { ok: false, problem: problemOf(err) };
  }
}

export async function readHtml(url: string): Promise<{ ok: true; html: string } | { ok: false; problem: ReadProblem }> {
  const key = cleanFirecrawlKey(env().FIRECRAWL_API_KEY);
  if (key.length < 20) return { ok: false, problem: "not_configured" };
  if (!mayRead(url).ok) return { ok: false, problem: "refused" };
  try {
    const json = await safeFetchJson(`${API}/scrape`, {
      method: "POST",
      body: JSON.stringify({ url, formats: ["rawHtml"], onlyMainContent: false, proxy: "basic", blockAds: true, timeout: TIMEOUT_MS - 5_000 }),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      timeoutMs: TIMEOUT_MS,
      maxBytes: 5_000_000,
    });
    const p = HtmlOut.safeParse(json);
    const html = p.success ? (p.data.data?.rawHtml ?? "") : "";
    return html ? { ok: true, html: html.slice(0, 2_000_000) } : { ok: false, problem: "not_readable" };
  } catch (err) {
    return { ok: false, problem: problemOf(err) };
  }
}
