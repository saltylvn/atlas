// The Market page's charts. One hue (the accent) for what matters, grey for context: no
// categorical palette, so identity never rests on color. Thin marks, 4px rounded data-ends,
// hairline grids, values in text colors. Every chart has a table view beside it.

import type { ReactNode } from "react";
import { shortDate } from "@/lib/domain/dates";
import type { FamilyTrend, PayRow } from "@/lib/domain/marketSnapshot";

export const usd = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
export const pct = (x: number) => `${Math.round(x * 100)}%`;
const signed = (n: number) => (n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString());

/** A headline number: label, value, an optional change, and what it rests on. */
export function StatTile({ label, value, delta, note, small }: { label: string; value: string; delta?: { text: string; up: boolean | null } | null; note: string; small?: boolean }) {
  return (
    <div className="card card-pad min-w-0">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="h-display mt-1 text-3xl font-medium">{value}</p>
      {delta && (
        <p className="mt-0.5 text-xs font-medium" style={{ color: delta.up === null ? "var(--ink-2)" : delta.up ? "var(--c-green)" : "var(--c-warn)" }}>
          {delta.up === null ? "" : delta.up ? "▲ " : "▼ "}
          {delta.text}
        </p>
      )}
      <p className="mt-1 text-xs text-ink-3">
        {note}
        {small && <span className="ml-1 font-medium text-ink-2">· small sample</span>}
      </p>
    </div>
  );
}

/** One role family's active postings over time: a 2px line, the latest day marked and labeled. */
function Sparkline({ t }: { t: FamilyTrend }) {
  const W = 220;
  const H = 56;
  const pts = t.series;
  const max = Math.max(1, ...pts.map((p) => p.active));
  const x = (i: number) => (pts.length <= 1 ? W - 6 : 6 + (i / (pts.length - 1)) * (W - 12));
  const y = (v: number) => H - 6 - (v / max) * (H - 14);
  const color = t.yours ? "var(--brand)" : "var(--ink-3)";
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.active).toFixed(1)}`).join(" ");
  const last = pts.at(-1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-14 w-full" role="img" aria-label={`${t.label}: ${t.latest} active postings${t.change === null ? "" : `, ${signed(t.change)} in 7 days`}`}>
      <line x1={0} x2={W} y1={H - 6} y2={H - 6} stroke="var(--line)" strokeWidth={1} />
      {pts.length > 1 && <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
      {last && <circle cx={x(pts.length - 1)} cy={y(last.active)} r={4} fill={color} stroke="var(--surface)" strokeWidth={2} />}
      {pts.map((p, i) => (
        <rect key={p.day} x={x(i) - 6} y={0} width={12} height={H} fill="transparent">
          <title>{`${shortDate(p.day)}: ${p.active.toLocaleString()} active`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** A plain 2px line for any series: grey, the last point marked. For the national benchmarks. */
export function MiniLine({ points, label, format }: { points: { period: string; value: number }[]; label: string; format: (v: number) => string }) {
  const W = 220;
  const H = 56;
  if (points.length < 2) return null;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = max - min || 1;
  const x = (i: number) => 6 + (i / (points.length - 1)) * (W - 12);
  const y = (v: number) => H - 8 - ((v - min) / span) * (H - 16);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const last = points.at(-1)!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-14 w-full" role="img" aria-label={`${label}: from ${format(points[0]!.value)} to ${format(last.value)}`}>
      <path d={d} fill="none" stroke="var(--ink-3)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(points.length - 1)} cy={y(last.value)} r={4} fill="var(--ink-2)" stroke="var(--surface)" strokeWidth={2} />
      {points.map((p, i) => (
        <rect key={p.period} x={x(i) - 5} y={0} width={10} height={H} fill="transparent">
          <title>{`${p.period.slice(0, 7)}: ${format(p.value)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** Small multiples: one panel per role family, your families first, in the accent. */
export function FamilyTrends({ trends }: { trends: FamilyTrend[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {trends.map((t) => (
        <li key={t.family} className="rounded-xl border border-line p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium" title={t.label}>
              {t.label}
            </p>
            {t.yours && <span className="chip shrink-0">Yours</span>}
          </div>
          <p className="mt-1 text-xl font-medium">
            {t.latest.toLocaleString()} <span className="text-xs font-normal text-ink-3">active</span>
          </p>
          <p className="text-xs text-ink-3">{t.change === null ? "7-day change after a week of history" : `${signed(t.change)} vs 7 days ago`}</p>
          <Sparkline t={t} />
        </li>
      ))}
    </ul>
  );
}

/** Ranked horizontal bars, one hue: a value at each bar's tip, its sample size beside the name. */
export function RankedBars<K extends string>({ rows, format, highlight, unit }: { rows: { key: K; label: string; value: number; n?: number; small?: boolean }[]; format: (v: number) => string; highlight?: ReadonlySet<K>; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const on = highlight?.has(r.key);
        return (
          <li key={r.key} className="grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)] items-center gap-3 max-sm:grid-cols-1 max-sm:gap-1" title={`${r.label}: ${format(r.value)}${r.n !== undefined ? ` (${r.n} postings)` : ""}`}>
            <span className="min-w-0 truncate text-sm">
              {r.label}
              {r.n !== undefined && <span className="text-xs text-ink-3"> · n={r.n.toLocaleString()}</span>}
            </span>
            <span className="flex items-center gap-2">
              <span className="block h-3 rounded-r-[4px]" style={{ width: `${Math.max(1.5, (r.value / max) * 82)}%`, background: on ? "var(--brand)" : r.small ? "color-mix(in oklab, var(--ink-3) 35%, var(--surface))" : "color-mix(in oklab, var(--ink-3) 70%, var(--surface))" }} />
              <span className="shrink-0 text-xs font-medium tabular-nums">
                {format(r.value)}
                {unit ?? ""}
                {r.small && <span className="font-normal text-ink-3"> small sample</span>}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export const payBars = <K extends string>(rows: PayRow<K>[]) => rows.map((r) => ({ key: r.key, label: r.label, value: r.median, n: r.n, small: r.small }));

/** The same numbers as a table, for screen readers, print and anyone who wants the figures. */
export function TableView({ caption, head, rows }: { caption: string; head: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-ink-2">Show as a table</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line text-ink-3">
              {head.map((h) => (
                <th key={h} scope="col" className="py-1.5 pr-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-line last:border-0">
                {r.map((c, j) => (
                  <td key={j} className="py-1.5 pr-3">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
