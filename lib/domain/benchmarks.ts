// National job-market benchmarks: public government statistics that put Atlas's own sample in
// context. Read once a week by the Scout (lib/agents/benchmarks.ts); shown on the Market page.
//
//   BLS JOLTS   job openings, hires and quits in the U.S. information sector (where most tech
//               jobs sit), monthly, about two months behind. The latest month is preliminary.
//   FRED        the Indeed software-development job-postings index (Indeed Hiring Lab), daily,
//               indexed to 100 on 1 Feb 2020. The closest public measure to what the Scout records.
//
// These answer "which way is the national tech market moving", not "how many jobs exist":
// different methods, different coverage. They are never added to Atlas's own counts.
//
// Pure: responses in, rows and summaries out.

import { z } from "zod";
import type { LocalDate } from "./types";

export type BenchmarkSource = "bls" | "fred";

export interface BenchmarkSeries {
  id: string;
  source: BenchmarkSource;
  label: string;
  /** How the value reads: "thousands" of jobs, a "percent" rate, or an "index". */
  unit: "thousands" | "percent" | "index" | "dollars";
  /** How often it is published. */
  frequency: "weekly" | "monthly" | "yearly";
  what: string;
}

export const SERIES: readonly BenchmarkSeries[] = [
  { id: "JTS510000000000000JOL", source: "bls", frequency: "monthly", label: "Job openings, information sector", unit: "thousands", what: "Open jobs on the last business day of the month, seasonally adjusted. Software publishing, data and web services, telecom and media." },
  { id: "JTS510000000000000JOR", source: "bls", frequency: "monthly", label: "Openings rate, information sector", unit: "percent", what: "Openings as a share of filled jobs plus openings." },
  { id: "JTS510000000000000HIL", source: "bls", frequency: "monthly", label: "Hires, information sector", unit: "thousands", what: "People hired during the month, seasonally adjusted." },
  { id: "JTS510000000000000QUL", source: "bls", frequency: "monthly", label: "Quits, information sector", unit: "thousands", what: "People who left by choice: a sign of how confident workers are." },
  { id: "JTS000000000000000JOL", source: "bls", frequency: "monthly", label: "Job openings, all U.S.", unit: "thousands", what: "Every industry, for context." },
  { id: "IHLIDXUSTPSOFTDEVE", source: "fred", frequency: "weekly", label: "Software development postings on Indeed", unit: "index", what: "Indeed Hiring Lab's index of software-development job postings, 100 = 1 February 2020." },
  // OEWS: official median yearly pay, U.S. and Utah, for the occupations that match your top roles
  // (chosen 22 Nov 2026). Solutions Engineer has no code of its own; Sales engineers is its match.
  { id: "OEUN000000000000041903113", source: "bls", frequency: "yearly", label: "Median pay, sales engineers (U.S.)", unit: "dollars", what: "BLS OEWS, May survey. The official occupation closest to Solutions Engineer." },
  { id: "OEUS490000000000041903113", source: "bls", frequency: "yearly", label: "Median pay, sales engineers (Utah)", unit: "dollars", what: "BLS OEWS, May survey, Utah." },
  { id: "OEUN000000000000015125213", source: "bls", frequency: "yearly", label: "Median pay, software developers (U.S.)", unit: "dollars", what: "BLS OEWS, May survey." },
  { id: "OEUS490000000000015125213", source: "bls", frequency: "yearly", label: "Median pay, software developers (Utah)", unit: "dollars", what: "BLS OEWS, May survey, Utah." },
  // Added 23 Nov 2026 for the Career Map: the official occupation closest to each other engineering type.
  { id: "OEUN000000000000015205113", source: "bls", frequency: "yearly", label: "Median pay, data scientists (U.S.)", unit: "dollars", what: "BLS OEWS, May survey. Closest to Data and AI/ML." },
  { id: "OEUS490000000000015205113", source: "bls", frequency: "yearly", label: "Median pay, data scientists (Utah)", unit: "dollars", what: "BLS OEWS, May survey, Utah." },
  { id: "OEUN000000000000015121213", source: "bls", frequency: "yearly", label: "Median pay, information security analysts (U.S.)", unit: "dollars", what: "BLS OEWS, May survey. Closest to Security." },
  { id: "OEUS490000000000015121213", source: "bls", frequency: "yearly", label: "Median pay, information security analysts (Utah)", unit: "dollars", what: "BLS OEWS, May survey, Utah." },
  { id: "OEUN000000000000015124413", source: "bls", frequency: "yearly", label: "Median pay, network and computer systems administrators (U.S.)", unit: "dollars", what: "BLS OEWS, May survey. Closest to Cloud, DevOps and infrastructure." },
  { id: "OEUS490000000000015124413", source: "bls", frequency: "yearly", label: "Median pay, network and computer systems administrators (Utah)", unit: "dollars", what: "BLS OEWS, May survey, Utah." },
];

/** The official occupation (BLS OEWS code) closest to each engineering type, for the Career Map. */
export const OEWS_FOR_TYPE: Record<"software" | "data-ai" | "cloud-devops" | "security" | "solutions-it", { occupation: string; code: string }> = {
  software: { occupation: "Software developers", code: "151252" },
  "data-ai": { occupation: "Data scientists", code: "152051" },
  "cloud-devops": { occupation: "Network and computer systems administrators", code: "151244" },
  security: { occupation: "Information security analysts", code: "151212" },
  "solutions-it": { occupation: "Sales engineers", code: "419031" },
};
export const oewsId = (code: string, utah: boolean) => `${utah ? "OEUS4900000" : "OEUN0000000"}000000${code}13`;

export const seriesById = (id: string) => SERIES.find((s) => s.id === id);

/** One observation: a series, the period it covers (first day), its value, and whether it is preliminary. */
export interface BenchmarkPoint {
  seriesId: string;
  period: LocalDate;
  value: number;
  preliminary: boolean;
}

// ---- BLS Public Data API v2 ----

const Bls = z.object({
  status: z.string(),
  message: z.array(z.string()).optional(),
  Results: z
    .object({
      series: z.array(
        z.object({
          seriesID: z.string(),
          data: z.array(z.object({ year: z.string(), period: z.string(), value: z.string(), footnotes: z.array(z.object({ code: z.string().optional() }).passthrough()).optional() }).passthrough()),
        }),
      ),
    })
    .optional(),
});

/** The request body: the key goes in the body, never the URL. */
export function blsRequest(key: string | undefined, now: Date): string {
  const year = now.getUTCFullYear();
  const ids = SERIES.filter((s) => s.source === "bls").map((s) => s.id);
  return JSON.stringify({ seriesid: ids, startyear: String(year - 2), endyear: String(year), ...(key ? { registrationkey: key } : {}) });
}

export function parseBls(data: unknown): { points: BenchmarkPoint[]; error: string | null } {
  const p = Bls.safeParse(data);
  if (!p.success) return { points: [], error: "unexpected response" };
  if (p.data.status !== "REQUEST_SUCCEEDED") return { points: [], error: (p.data.message ?? [p.data.status]).join("; ").slice(0, 200) };
  const known = new Set(SERIES.map((s) => s.id));
  const points = (p.data.Results?.series ?? []).flatMap((s) =>
    !known.has(s.seriesID)
      ? []
      : s.data.flatMap((d) => {
          // Monthly periods are M01..M12 (M13, an annual average of a monthly series, is left out);
          // a yearly series (OEWS) has one period, A01, stored as the year's first day.
          const yearly = seriesById(s.seriesID)?.frequency === "yearly";
          const m = yearly ? (d.period === "A01" ? ["", "01"] : null) : /^M(0[1-9]|1[0-2])$/.exec(d.period);
          const v = Number(d.value);
          if (!m || !/^\d{4}$/.test(d.year) || !Number.isFinite(v)) return [];
          return [{ seriesId: s.seriesID, period: `${d.year}-${m[1]}-01`, value: v, preliminary: (d.footnotes ?? []).some((f) => f.code === "P") }];
        }),
  );
  return { points, error: null };
}

// ---- FRED ----

const Fred = z.object({ observations: z.array(z.object({ date: z.string(), value: z.string() })) });

export function fredUrl(seriesId: string, key: string, now: Date): string {
  const start = new Date(now.getTime() - 2 * 366 * 86_400_000).toISOString().slice(0, 10);
  return `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=${start}`;
}

/** FRED observations; "." marks a missing value. A daily series is reduced to one value per week (its last). */
export function parseFred(seriesId: string, data: unknown): BenchmarkPoint[] {
  const p = Fred.safeParse(data);
  if (!p.success) return [];
  const byWeek = new Map<string, BenchmarkPoint>();
  for (const o of p.data.observations) {
    const v = Number(o.value);
    if (o.value === "." || !Number.isFinite(v) || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) continue;
    const d = new Date(`${o.date}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    byWeek.set(monday, { seriesId, period: monday, value: v, preliminary: false });
  }
  return [...byWeek.values()];
}

// ---- what the Market page shows ----

export interface BenchmarkSummary {
  series: BenchmarkSeries;
  points: BenchmarkPoint[];
  latest: BenchmarkPoint | null;
  /** Change against the period before, and against the same period a year earlier, in percent. */
  vsPrevious: number | null;
  vsYearAgo: number | null;
}

const change = (now: number, then: number | undefined) => (then === undefined || then === 0 ? null : Math.round(((now - then) / then) * 1000) / 10);

export function summarize(points: readonly BenchmarkPoint[]): BenchmarkSummary[] {
  return SERIES.map((series) => {
    const pts = points.filter((p) => p.seriesId === series.id).sort((a, b) => a.period.localeCompare(b.period));
    const latest = pts.at(-1) ?? null;
    if (!latest) return { series, points: pts, latest, vsPrevious: null, vsYearAgo: null };
    const prev = pts.at(-2)?.value;
    const yearAgoPeriod = `${Number(latest.period.slice(0, 4)) - 1}${latest.period.slice(4)}`;
    // A weekly series has no point on exactly the same day a year before: take the nearest within a week.
    const yearAgo = pts.find((p) => Math.abs(Date.parse(p.period) - Date.parse(yearAgoPeriod)) <= 3.5 * 86_400_000)?.value;
    return { series, points: pts, latest, vsPrevious: change(latest.value, prev), vsYearAgo: change(latest.value, yearAgo) };
  });
}

/** How many days old the newest stored point may be before the weekly read runs again. */
export const BENCHMARK_REFRESH_DAYS = 7;
