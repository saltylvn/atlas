import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { blsRequest, fredUrl, parseBls, parseFred, SERIES, type BenchmarkPoint } from "@/lib/domain/benchmarks";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import type { AgentRunEvent } from "@/lib/domain/types";
import { env } from "@/lib/env";
import { safeFetchJson } from "@/lib/security/safeFetch";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Scout's weekly read of the national benchmarks (lib/domain/benchmarks.ts). Rules only, no
// model, $0: two requests a week at most. BLS answers without a key (with lower limits), so it
// always runs; FRED needs its key and is skipped, and says so, without one. Keys stay server-side:
// BLS's goes in the request body; FRED's is in its URL, which safeFetch never logs (errors name
// the host only).

export const BENCHMARK_TASK = "Read national benchmarks";

export interface BenchmarkResult {
  added: number;
  read: number;
  /** Per source: "read", "not set up", or why it failed. */
  sources: { bls: string; fred: string };
  headline: string;
}

export interface BenchmarkDeps {
  /** Swapped in tests, which must not reach the network. */
  fetchJson?: typeof safeFetchJson;
}

export async function runBenchmarks(ctx: Context, opts: { trigger: AgentRunEvent["trigger"]; honorPause: boolean; persist: Store; deps?: BenchmarkDeps }): Promise<BenchmarkResult | AgentMissing> {
  const agent = "scout" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  const fetchJson = opts.deps?.fetchJson ?? safeFetchJson;
  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task: BENCHMARK_TASK, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }
  await logRun(ctx, { runId, agent, task: BENCHMARK_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  const keys = env();
  const points: BenchmarkPoint[] = [];
  const sources = { bls: "not read", fred: "not set up" };

  const bls = await t
    .step(
      "Read BLS JOLTS (information sector)",
      async () => parseBls(await fetchJson("https://api.bls.gov/publicAPI/v2/timeseries/data/", { method: "POST", body: blsRequest(keys.BLS_API_KEY, ctx.now), headers: { "content-type": "application/json" }, accept: "application/json", timeoutMs: 15_000, maxBytes: 2_000_000, revalidate: 0 })),
      (r) => (r.error ? `BLS said: ${r.error}` : `${r.points.length} monthly values`),
    )
    .catch((e: Error) => ({ points: [] as BenchmarkPoint[], error: (e.message ?? "failed").slice(0, 120) }));
  points.push(...bls.points);
  sources.bls = bls.error && bls.points.length === 0 ? `failed: ${bls.error}` : "read";

  const fredSeries = SERIES.filter((s) => s.source === "fred");
  if (keys.FRED_API_KEY) {
    for (const s of fredSeries) {
      const got = await t
        .step(`Read FRED ${s.id}`, async () => parseFred(s.id, await fetchJson(fredUrl(s.id, keys.FRED_API_KEY!, ctx.now), { accept: "application/json", timeoutMs: 15_000, maxBytes: 4_000_000, revalidate: 0 })), (r) => `${r.length} weekly values`)
        .catch((e: Error) => {
          sources.fred = `failed: ${(e.message ?? "failed").slice(0, 120)}`;
          return [] as BenchmarkPoint[];
        });
      points.push(...got);
      if (got.length) sources.fred = "read";
    }
  } else t.note("Read FRED", "Skipped: FRED_API_KEY is not set", true);

  try {
    const added = await t.step("Store them", () => persist.benchmarks.upsert(points), (n) => `${n} new, ${points.length - n} already stored or revised`);
    const failed = sources.bls.startsWith("failed") && !sources.fred.startsWith("read");
    const headline = failed ? "No benchmark could be read." : `${points.length} benchmark values read (${added} new). BLS: ${sources.bls}. FRED: ${sources.fred}.`;
    await logRun(ctx, { runId, agent, task: BENCHMARK_TASK, status: failed ? "failed" : "succeeded", trigger, detail: headline.slice(0, 300), ...NO_MODEL, ...t.finish() });
    return { added, read: points.length, sources, headline };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: BENCHMARK_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
