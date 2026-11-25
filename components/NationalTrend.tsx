import type { BenchmarkSummary } from "@/lib/domain/benchmarks";
import { MiniLine, TableView } from "./MarketCharts";
import { CardHeader } from "./ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

function format(s: BenchmarkSummary["series"]) {
  return (v: number) => (s.unit === "dollars" ? `$${Math.round(v / 1000)}k` : s.unit === "thousands" ? (v >= 1000 ? `${(v / 1000).toFixed(1)}M` : `${Math.round(v)}k`) : s.unit === "percent" ? `${v.toFixed(1)}%` : v.toFixed(1));
}
const when = (s: BenchmarkSummary["series"], period: string) => (s.frequency === "weekly" ? `week of ${period}` : s.frequency === "yearly" ? period.slice(0, 4) : month(period));
const before = (s: BenchmarkSummary["series"]) => (s.frequency === "weekly" ? "the week before" : s.frequency === "yearly" ? "the year before" : "the month before");
const pct = (n: number | null) => (n === null ? "–" : `${n > 0 ? "+" : ""}${n}%`);

/**
 * National benchmarks beside Atlas's own sample: public BLS and FRED series, each its own small
 * chart, never on Atlas's scale or added to its counts. Different methods and coverage; they show
 * the direction of the national market.
 */
export function NationalTrend({ summaries, fredReady, sampleSince }: { summaries: BenchmarkSummary[]; fredReady: boolean; sampleSince: string | null }) {
  const shown = summaries.filter((s) => s.latest);
  const fred = summaries.filter((s) => s.series.source === "fred");
  return (
    <section className="card card-pad">
      <CardHeader title="National trend" icon="growth" hint="Public U.S. statistics, read once a week. They show which way the national tech market is moving; they are not counts of the same jobs as above." />
      {shown.length === 0 ? (
        <p className="text-sm text-ink-3">No national figures yet. The Scout reads them at the next evening run, then every Monday.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((s) => {
            const f = format(s.series);
            return (
              <li key={s.series.id} className="rounded-xl border border-line p-3">
                <p className="text-sm font-medium">{s.series.label}</p>
                <p className="mt-1 text-xl font-medium">
                  {f(s.latest!.value)} <span className="text-xs font-normal text-ink-3">{when(s.series, s.latest!.period)}</span>
                </p>
                <p className="text-xs text-ink-3">
                  {s.series.frequency === "yearly" ? (s.vsPrevious === null ? "Published yearly" : `${pct(s.vsPrevious)} vs ${before(s.series)}`) : `${pct(s.vsPrevious)} vs ${before(s.series)} · ${pct(s.vsYearAgo)} vs a year ago`}
                  {s.latest!.preliminary && <span className="ml-1 font-medium text-ink-2">· preliminary</span>}
                </p>
                <MiniLine points={s.points.slice(-24)} label={s.series.label} format={f} />
                <p className="mt-1 text-xs text-ink-3">{s.series.what}</p>
              </li>
            );
          })}
        </ul>
      )}
      {shown.length > 0 && (
        <TableView
          caption="National benchmarks, latest values"
          head={["Series", "Latest", "Period", "vs before", "vs a year ago", "Source"]}
          rows={shown.map((s) => [s.series.label, format(s.series)(s.latest!.value), s.latest!.period, pct(s.vsPrevious), pct(s.vsYearAgo), s.series.source === "bls" ? "BLS JOLTS" : "FRED (Indeed Hiring Lab)"])}
        />
      )}
      <div className="mt-3 space-y-1 text-xs text-ink-3">
        {fred.every((s) => !s.latest) && <p>{fredReady ? "Indeed software-development postings: waiting for the next read." : "Indeed software-development postings (FRED): not set up. Add FRED_API_KEY to show the closest public measure to what the Scout records."}</p>}
        <p>
          BLS JOLTS is monthly and about two months behind; the newest month is preliminary and is revised. Atlas&apos;s own sample {sampleSince ? `starts ${sampleSince}` : "has not started"}: a side-by-side comparison becomes meaningful once both cover the same months. Sources: U.S. Bureau of Labor Statistics; Federal Reserve Bank of St. Louis (FRED).
        </p>
      </div>
    </section>
  );
}
