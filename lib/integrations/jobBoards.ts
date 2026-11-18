import "server-only";
import { z } from "zod";
import { safeFetchJson } from "@/lib/security/safeFetch";
import { scorePosting } from "@/lib/domain/jobs";
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
    }),
  ),
});
const lever = z.array(
  z.object({
    id: z.string(),
    text: z.string(),
    hostedUrl: z.string(),
    createdAt: z.number().optional(),
    categories: z.object({ location: z.string().optional() }).partial().optional(),
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
    }),
  ),
});

export interface Raw {
  id: string;
  title: string;
  url: string;
  location: string;
  updatedAt: string | null;
}

export function boardUrl(w: Pick<JobWatch, "board" | "slug">): string {
  const slug = encodeURIComponent(w.slug);
  switch (w.board) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
    case "lever":
      return `https://api.lever.co/v0/postings/${slug}?mode=json`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${slug}`;
  }
}

export function normalize(board: JobWatch["board"], data: unknown): Raw[] {
  switch (board) {
    case "greenhouse": {
      const p = greenhouse.safeParse(data);
      return p.success
        ? p.data.jobs.map((j) => ({ id: String(j.id), title: j.title, url: j.absolute_url, location: j.location?.name ?? "", updatedAt: j.updated_at ?? null }))
        : [];
    }
    case "lever": {
      const p = lever.safeParse(data);
      return p.success
        ? p.data.map((j) => ({ id: j.id, title: j.text, url: j.hostedUrl, location: j.categories?.location ?? "", updatedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null }))
        : [];
    }
    case "ashby": {
      const p = ashby.safeParse(data);
      return p.success
        ? p.data.jobs.map((j) => ({ id: j.id, title: j.title, url: j.jobUrl, location: [j.location, j.isRemote ? "Remote" : ""].filter(Boolean).join(" · "), updatedAt: j.publishedAt ?? null }))
        : [];
    }
  }
}

/** Field caps for cached postings, so a huge board costs kilobytes, not megabytes, in memory. */
export const TRIM = { maxJobs: 2000, title: 160, location: 120, url: 500, id: 80 } as const;

/** Keeps only http(s) postings with short fields; drops everything else from the board payload. */
export function trimRaw(raw: Raw[]): Raw[] {
  const out: Raw[] = [];
  for (const j of raw) {
    if (out.length >= TRIM.maxJobs) break;
    if (!/^https?:\/\//.test(j.url) || j.url.length > TRIM.url) continue;
    out.push({ id: j.id.slice(0, TRIM.id), title: j.title.slice(0, TRIM.title), url: j.url, location: j.location.slice(0, TRIM.location), updatedAt: j.updatedAt ? j.updatedAt.slice(0, 40) : null });
  }
  return out;
}

/** Normalized, trimmed postings per board, kept for 45 minutes per server instance. */
export const BOARD_TTL_MS = 45 * 60_000;
const boardCache = createTtlCache<Raw[]>({ ttlMs: BOARD_TTL_MS, maxEntries: 60 });

export function boardCacheKey(w: Pick<JobWatch, "board" | "slug">): string {
  return `${w.board}:${w.slug}`;
}

async function loadBoard(w: JobWatch): Promise<Raw[]> {
  return boardCache.getOrLoad(boardCacheKey(w), async () =>
    // revalidate 0: skip Next's data cache (2 MB limit); the trimmed result is cached above instead.
    trimRaw(normalize(w.board, await safeFetchJson(boardUrl(w), { revalidate: 0, maxBytes: 20_000_000, timeoutMs: 10_000 }))),
  );
}

export interface ScanResult {
  postings: JobPosting[];
  failed: string[];
  scanned: number;
}

export async function scanBoards(watches: JobWatch[], keywords: string[], locations: string[]): Promise<ScanResult> {
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
      const m = scorePosting(j.title, j.location, keywords, locations);
      if (m.score === 0) continue;
      postings.push({ id: `${r.value.w.board}:${j.id}`, company: r.value.w.company, title: j.title.slice(0, 160), location: j.location.slice(0, 120), url: j.url, board: r.value.w.board, updatedAt: j.updatedAt, score: m.score, matched: m.matched });
    }
  });
  postings.sort((a, b) => b.score - a.score || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  return { postings: postings.slice(0, 60), failed, scanned };
}
