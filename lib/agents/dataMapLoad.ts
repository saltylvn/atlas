import "server-only";
import type { Context } from "@/lib/context";
import { pipelineConfig } from "@/lib/domain/dataPipeline";
import { dataMap } from "@/lib/domain/dataMap";
import { addDays } from "@/lib/domain/dates";
import { pipelineView, type PipelineView } from "@/lib/domain/pipelineView";
import { lensJudgments, lensStats, type LensStats } from "@/lib/domain/roleLens";
import { env } from "@/lib/env";

/** Everything the Data Map and the Pipeline tab draw: the latest run's numbers, read once. Counts only. */
export async function loadPipeline(ctx: Context): Promise<{ view: PipelineView; map: ReturnType<typeof dataMap>; lens: LensStats; historyDays: number }> {
  const { store, today } = ctx;
  const [quality, size, yours, report, benchmarks, postings] = await Promise.all([
    store.techMarket.quality(addDays(today, -14)).catch(() => []),
    store.techMarket.size().catch(() => ({ postings: 0, days: 0 })),
    store.market.since(addDays(today, -30)).catch(() => []),
    store.market.latestReport().catch(() => null),
    store.benchmarks.since(addDays(today, -800)).catch(() => []),
    store.techMarket.since(addDays(today, -30)).catch(() => []),
  ]);
  // Your six roles: the last 30 days of jobs, sorted by title (lib/domain/roleLens.ts).
  const lens = lensStats(postings, today, lensJudgments(ctx.settings.lensJudged).titles);
  const config = pipelineConfig(ctx.settings.dataPipeline);
  const latest = [...quality].sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
  const inRoles = lens.rows.filter((r) => r.lens !== "other").reduce((n, r) => n + r.jobs30, 0);
  const view = pipelineView({ quality: latest, size, today, yourPostings: yours.length, reportDay: report?.forDate ?? null, floors: config.floors, lens: { rows: lens.rows.filter((r) => r.lens !== "other").map((r) => ({ label: r.label, n: r.jobs30 })), inRoles, other: lens.total30 - inRoles } });
  const newest = [...benchmarks].sort((a, b) => b.period.localeCompare(a.period))[0];
  const map = dataMap({ view, sourcesOff: config.sourcesOff, benchmarks: { points: benchmarks.length, latest: newest?.period ?? null, fred: Boolean(env().FRED_API_KEY) }, historyDays: size.days });
  return { view, map, lens, historyDays: size.days };
}
