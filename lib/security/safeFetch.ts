import "server-only";

// Every outbound HTTP request the server makes goes through here.
// - Only https, only hosts on the allowlist (no SSRF into private networks).
// - No redirects followed blindly: a redirect must also land on the allowlist, and a
//   request that carries a token or a body never follows one to another origin.
// - Hard timeout and response-size cap, so a slow or huge feed cannot stall a page.
// - No cookies or credentials are ever attached.

export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  // news feeds (the Atlas plan's sources; Reuters, AP and Anthropic through Google News)
  "news.google.com",
  "techcrunch.com",
  "www.theverge.com",
  "feeds.arstechnica.com",
  "thehill.com",
  "moxie.foxnews.com",
  "www.washingtonexaminer.com",
  "thedispatch.com",
  "feeds.a.dj.com",
  // public job feeds (Career Agent)
  "remoteok.com",
  "weworkremotely.com",
  "hn.algolia.com",
  // public job boards
  "boards-api.greenhouse.io",
  "api.lever.co",
  "api.ashbyhq.com",
  // weather
  "api.open-meteo.com",
  // calendar (secret iCal address)
  "calendar.google.com",
  // Notion (the Resumes database in Atlas HQ: read, plus the one block Atlas owns on each resume page)
  "api.notion.com",
  // Figma (read-only: the resume frames), only when FIGMA_TOKEN is set
  "api.figma.com",
  // GitHub (read-only: your own repositories, as evidence of what you have built), only when GITHUB_USER is set
  "api.github.com",
  // Jobicy: remote jobs, public JSON API (its terms: credit Jobicy and link to the listing)
  "jobicy.com",
  // Google OAuth token exchange and Gmail (read-only)
  "oauth2.googleapis.com",
  "gmail.googleapis.com",
  // Google Gemini API (lib/ai/gemini.ts), only when GEMINI_API_KEY is set
  "generativelanguage.googleapis.com",
]);

export class BlockedRequestError extends Error {}

export class HttpError extends Error {
  constructor(
    readonly host: string,
    readonly status: number,
    /** The API's own error code and a short message ("INVALID_ARGUMENT: ..."), when asked for. Never the request. */
    readonly detail?: string,
    /** How long the API asked to wait before trying again (Retry-After or Google's RetryInfo). */
    readonly retryAfterMs?: number,
  ) {
    super(`${host} answered ${status}`);
  }
}

const ERROR_BODY_BYTES = 4_096;

/** The first `max` bytes of a body, then the rest is cancelled: an error page cannot be large. */
async function readCapped(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks)).slice(0, max);
}

/** A Google-style error body ({ error: { status, message, details: [RetryInfo] } }), cut to what is safe and useful. */
export function readErrorBody(text: string): { detail?: string; retryAfterMs?: number } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {};
  }
  const e = (json as { error?: { status?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  if (!e || typeof e !== "object") return {};
  const code = typeof e.status === "string" ? e.status.replace(/[^A-Z_]/g, "").slice(0, 40) : "";
  // One line, no control characters, short: enough to say what was wrong.
  const message = typeof e.message === "string" ? e.message.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";
  const retry = Array.isArray(e.details)
    ? e.details.map((d) => (d && typeof d === "object" ? (d as { retryDelay?: unknown }).retryDelay : undefined)).find((v): v is string => typeof v === "string")
    : undefined;
  const seconds = retry ? Number.parseFloat(retry) : Number.NaN;
  const detail = [code, message].filter(Boolean).join(": ");
  return { ...(detail ? { detail } : {}), ...(Number.isFinite(seconds) && seconds >= 0 ? { retryAfterMs: Math.min(120_000, Math.round(seconds * 1000)) } : {}) };
}

export function assertAllowed(raw: string, extraHosts: readonly string[] = []): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedRequestError("Not a URL");
  }
  if (url.protocol !== "https:") throw new BlockedRequestError("Only https is allowed");
  if (url.username || url.password) throw new BlockedRequestError("Credentials in URL");
  const host = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host) && !extraHosts.includes(host)) {
    throw new BlockedRequestError(`Host not on the allowlist: ${host}`);
  }
  return url;
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
  /** Next.js data cache lifetime in seconds. */
  revalidate?: number;
  /** Hosts trusted by server configuration (e.g. the CALENDAR_ICS_URL host), never user input. */
  extraHosts?: readonly string[];
  /** PATCH and DELETE are used by one caller: the resume sync's own block in Notion. */
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: string;
  /** Extra request headers (e.g. an OAuth bearer token). Requests with headers are never cached. */
  headers?: Record<string, string>;
  /** Cancels the request early (the timeout still applies). */
  signal?: AbortSignal;
  /** On an error status, read the API's own error code, message and retry delay into the HttpError. */
  errorDetail?: boolean;
}

export async function safeFetchText(raw: string, opts: SafeFetchOptions = {}): Promise<string> {
  const { timeoutMs = 6000, maxBytes = 2_000_000, accept = "*/*", revalidate = 900, extraHosts = [], method = "GET", body, headers = {}, signal, errorDetail = false } = opts;
  // Anything authenticated or state-changing bypasses the shared data cache.
  const private_ = method !== "GET" || Object.keys(headers).length > 0;
  let url = assertAllowed(raw, extraHosts);

  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(url, {
      method,
      body,
      redirect: "manual",
      signal: signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs),
      headers: { accept, "user-agent": "AtlasOptim/1.0 (personal dashboard)", ...headers },
      credentials: "omit",
      ...(private_ ? { cache: "no-store" as const } : { next: { revalidate } }),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Redirect without location from ${url.hostname}`);
      const next = assertAllowed(new URL(location, url).toString(), extraHosts);
      // A request that carries headers (a token) or a body never follows a redirect to
      // another origin: the token would travel with it, even to a host on the allowlist.
      if (private_ && next.origin !== url.origin) throw new BlockedRequestError(`Redirect from ${url.hostname} to ${next.hostname} refused: this request carries credentials`);
      url = next;
      continue;
    }
    if (!res.ok) {
      if (!errorDetail) throw new HttpError(url.hostname, res.status);
      const text = await readCapped(res, ERROR_BODY_BYTES).catch(() => "");
      const { detail, retryAfterMs } = readErrorBody(text);
      const header = Number(res.headers.get("retry-after"));
      throw new HttpError(url.hostname, res.status, detail, retryAfterMs ?? (Number.isFinite(header) && header >= 0 ? Math.min(120_000, header * 1000) : undefined));
    }
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw new Error(`${url.hostname} response too large`);
    const reader = res.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(`${url.hostname} response too large`);
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
  throw new Error("Too many redirects");
}

export async function safeFetchJson<T = unknown>(raw: string, opts: SafeFetchOptions = {}): Promise<T> {
  return JSON.parse(await safeFetchText(raw, { accept: "application/json", ...opts })) as T;
}

/**
 * First-paint budgets for feeds that render on a page. A feed that misses its budget
 * is treated as unavailable for this render (the page says so) instead of holding
 * the whole page. Cached responses return in milliseconds, so this only bites cold.
 */
export const FEED_TIMEOUT_MS = { weather: 2500, news: 3500, calendar: 4000 } as const;
