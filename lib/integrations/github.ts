import "server-only";
import type { RawRepo } from "@/lib/domain/portfolio";
import { env } from "@/lib/env";
import { HttpError, safeFetchJson } from "@/lib/security/safeFetch";

// GitHub, read-only. Atlas reads your own repositories as evidence of what you have built:
// each one's description, topics, languages, the start of its README and its dependency
// files. It never reads other source files and never writes.
//
// GITHUB_USER is your login. With no token only public repositories are visible. To
// include private ones, add GITHUB_TOKEN: a fine-grained personal access token with
// read-only "Contents" and "Metadata" on the repositories you choose. Both live in
// Vercel. Every call goes through safeFetch (https, allowlisted host api.github.com,
// timeout, size cap). The token is never logged, echoed in an error, or sent to the browser.

const API = "https://api.github.com";
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const MANIFESTS = ["package.json", "requirements.txt", "pyproject.toml"];
/** Repositories read in one run: each costs about five requests. */
const MAX_READ = 12;

export type GithubProblem = "not_configured" | "bad_token" | "not_found" | "rate_limited" | "unavailable";

/** What to tell the owner. Fixed text: nothing from GitHub's reply is echoed. */
export const GITHUB_HELP: Record<GithubProblem, string> = {
  not_configured: "GitHub is not set up yet: add GITHUB_USER (your login) in Vercel, then redeploy.",
  bad_token: "GitHub refused the token. Create a new fine-grained token with read-only Contents and Metadata, and update GITHUB_TOKEN in Vercel.",
  not_found: "GitHub has no user by the name in GITHUB_USER.",
  rate_limited: "GitHub's request limit was reached. Add GITHUB_TOKEN in Vercel for a much higher limit; the next run will try again.",
  unavailable: "GitHub could not be reached. The next run will try again.",
};

export class GithubError extends Error {
  constructor(readonly problem: GithubProblem) {
    super(GITHUB_HELP[problem]);
  }
}

const clean = (raw: string | undefined) => (raw ?? "").replace(/[\s"'`]+/g, "");
export const githubUser = (): string => {
  const u = clean(env().GITHUB_USER);
  return LOGIN.test(u) ? u : "";
};
export const githubConfigured = () => Boolean(githubUser());
export const githubHasToken = () => clean(env().GITHUB_TOKEN).length >= 20;

async function get<T>(path: string): Promise<T> {
  const token = clean(env().GITHUB_TOKEN);
  try {
    return await safeFetchJson<T>(`${API}${path}`, {
      headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", ...(token.length >= 20 ? { authorization: `Bearer ${token}` } : {}) },
      accept: "application/vnd.github+json",
      timeoutMs: 8000,
      maxBytes: 1_500_000,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      if (err.status === 401) throw new GithubError("bad_token");
      if (err.status === 403 || err.status === 429) throw new GithubError("rate_limited");
      if (err.status === 404) throw new GithubError("not_found");
    }
    throw new GithubError("unavailable");
  }
}

/** A file that is not there is not an error. */
const optional = <T>(p: Promise<T>): Promise<T | null> =>
  p.catch((err) => {
    if (err instanceof GithubError && err.problem === "not_found") return null;
    throw err;
  });

const str = (v: unknown, max = 400) => (typeof v === "string" ? v.slice(0, max) : "");
const decode = (file: { content?: unknown; encoding?: unknown } | null, max: number): string =>
  file && file.encoding === "base64" && typeof file.content === "string" ? Buffer.from(file.content, "base64").toString("utf8").slice(0, max) : "";

interface ApiRepo {
  full_name?: unknown;
  name?: unknown;
  description?: unknown;
  html_url?: unknown;
  private?: unknown;
  fork?: unknown;
  archived?: unknown;
  pushed_at?: unknown;
  topics?: unknown;
  owner?: { login?: unknown };
}

/**
 * Your repositories, most recently pushed first, each with what describes it. With a
 * token, private repositories you own are included; without one, public ones only.
 */
export async function readGithubRepos(): Promise<RawRepo[]> {
  const login = githubUser();
  if (!login) throw new GithubError("not_configured");
  const list = githubHasToken()
    ? await get<ApiRepo[]>("/user/repos?affiliation=owner&sort=pushed&per_page=50")
    : await get<ApiRepo[]>(`/users/${login}/repos?type=owner&sort=pushed&per_page=50`);
  const mine = (Array.isArray(list) ? list : [])
    .filter((r) => str(r.owner?.login).toLowerCase() === login.toLowerCase() && REPO.test(str(r.name)) && r.fork !== true && r.archived !== true && str(r.name).toLowerCase() !== login.toLowerCase())
    .slice(0, MAX_READ);
  const out: RawRepo[] = [];
  // One repository at a time: about five small requests each, well inside GitHub's limits.
  for (const r of mine) {
    const base = `/repos/${login}/${str(r.name)}`;
    const [languages, readme, root] = await Promise.all([
      optional(get<Record<string, number>>(`${base}/languages`)),
      optional(get<{ content?: unknown; encoding?: unknown }>(`${base}/readme`)),
      optional(get<{ name?: unknown }[]>(`${base}/contents/`)),
    ]);
    const rootPaths = (Array.isArray(root) ? root : []).map((f) => str(f.name, 120)).filter(Boolean).slice(0, 80);
    const manifests: { path: string; text: string }[] = [];
    for (const path of MANIFESTS.filter((m) => rootPaths.includes(m))) {
      const file = await optional(get<{ content?: unknown; encoding?: unknown }>(`${base}/contents/${path}`));
      const text = decode(file, 60_000);
      if (text) manifests.push({ path, text });
    }
    out.push({
      fullName: str(r.full_name, 140),
      name: str(r.name, 100),
      description: str(r.description, 300),
      url: str(r.html_url, 300),
      isPrivate: r.private === true,
      fork: false,
      archived: false,
      pushedAt: str(r.pushed_at, 40) || null,
      topics: Array.isArray(r.topics) ? r.topics.filter((t): t is string => typeof t === "string").slice(0, 24) : [],
      languages: languages && typeof languages === "object" ? Object.fromEntries(Object.entries(languages).filter(([, b]) => typeof b === "number")) : {},
      readme: decode(readme, 4000),
      manifests,
      rootPaths,
    });
  }
  return out;
}
