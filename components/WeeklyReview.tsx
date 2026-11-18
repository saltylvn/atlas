import Link from "next/link";
import { minutesLabel } from "@/lib/domain/planner";
import type { Recommendation, WeeklyReview } from "@/lib/domain/review";
import { Icon } from "./Icon";
import { CardHeader, Meter, Pill } from "./ui";

function Delta({ n, unit = "", goodWhenUp = true }: { n: number; unit?: string; goodWhenUp?: boolean }) {
  if (n === 0) return <span className="text-xs text-ink-3">same as last week</span>;
  const good = n > 0 === goodWhenUp;
  return (
    <span className={`text-xs font-semibold ${good ? "text-good" : "text-bad"}`}>
      {n > 0 ? "▲" : "▼"} {Math.abs(n)}
      {unit} vs last week
    </span>
  );
}

function Tile({ label, value, children, color, className = "" }: { label: string; value: string; children?: React.ReactNode; color?: string; className?: string }) {
  return (
    <div className={`rounded-xl border border-line p-3 ${className}`}>
      <p className="text-xs font-semibold text-ink-3">{label}</p>
      <p className="h-display mt-0.5 text-2xl font-semibold" style={color ? { color } : undefined}>
        {value}
      </p>
      <div className="mt-1 min-h-4 text-xs text-ink-2">{children}</div>
    </div>
  );
}

/** Display-only weekly review: rolling 7 days, rules-based metrics and three recommendations. */
export function WeeklyReviewCard({ review: r, recs, label }: { review: WeeklyReview; recs: Recommendation[]; label: string }) {
  const maxDay = Math.max(1, ...r.timeSaved.daily.map((d) => d.minutes));
  const p = r.pipeline;
  return (
    <section className="card card-pad" aria-labelledby="weekly-review">
      <CardHeader title="Weekly review" icon="clock" hint={`Last 7 days (${label}). Computed from your plan, people, ledger and Applications board.`} />

      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-5">
        <Tile label="Time saved" value={minutesLabel(r.timeSaved.current)} color="var(--brand)">
          <div className="flex h-6 items-end gap-0.5" aria-label="Minutes saved per day" role="img">
            {r.timeSaved.daily.map((d) => (
              <span
                key={d.day}
                title={`${d.day}: ${d.minutes} min`}
                className="flex-1 rounded-sm"
                style={{ height: `${Math.max(8, (d.minutes / maxDay) * 100)}%`, background: d.minutes ? "var(--brand)" : "var(--line)" }}
              />
            ))}
          </div>
          <Delta n={r.timeSaved.delta} unit="m" />
        </Tile>
        <Tile label="Tasks done / planned" value={`${r.tasks.completed}/${r.tasks.planned}`}>
          <Meter value={r.tasks.completed} max={Math.max(1, r.tasks.planned)} color={r.tasks.rate >= 70 ? "var(--c-green)" : "var(--c-orange)"} />
          <span className="mt-1 block">
            {r.tasks.rate}% · {minutesLabel(r.tasks.completedMin)} of {minutesLabel(r.tasks.plannedMin)}
          </span>
        </Tile>
        <Tile label="Overdue debt" value={String(r.overdue.count)} color={r.overdue.count > 0 ? "var(--c-red)" : undefined}>
          {r.overdue.count > 0 ? `${minutesLabel(r.overdue.minutes)} · oldest ${r.overdue.oldestDays}d` : "All clear"}
        </Tile>
        <Tile label="Keep-in-touch debt" value={String(r.keepInTouch.due)} color={r.keepInTouch.due > 0 ? "var(--c-orange)" : undefined}>
          {r.keepInTouch.due > 0 ? <span className="line-clamp-2">{r.keepInTouch.names.join(", ")}</span> : "Everyone is current"}
        </Tile>
        <Tile label="Job pipeline" value={p ? `${p.appliedThisWeek} applied` : "No data"} color="var(--c-pink)" className="col-span-2 md:col-span-1">
          {p ? (
            <>
              <span className="block">
                {p.movedThisWeek} moved · {p.responseRate}% reply rate
              </span>
              <span className="block">
                {p.awaitingReply} waiting{p.awaitingReply ? ` ~${p.avgDaysWaiting}d` : ""}
              </span>
            </>
          ) : (
            "No applications yet"
          )}
        </Tile>
      </div>

      <h3 className="h-display mt-5 mb-2 text-sm font-semibold">Three things to change this week</h3>
      <ol className="space-y-2">
        {recs.map((rec, i) => (
          <li key={rec.id}>
            <Link href={rec.href} className="group flex min-h-11 items-start gap-3 rounded-xl bg-surface-2 p-3 hover:bg-brand-soft">
              <span className="h-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
                  <span className="text-sm font-semibold group-hover:text-brand">{rec.title}</span>
                  <Pill color="var(--c-green)">~{minutesLabel(rec.minutesPerWeek)}/wk</Pill>
                </span>
                <span className="mt-0.5 block text-xs text-ink-2">{rec.detail}</span>
              </span>
              <Icon name="arrow" size={14} className="mt-1 shrink-0 text-ink-3" />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
