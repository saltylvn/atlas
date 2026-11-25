import Link from "next/link";
import { shortDate } from "@/lib/domain/dates";
import type { PipelineView as View } from "@/lib/domain/pipelineView";
import { KindPill } from "./KindBadges";
import { Icon } from "./Icon";
import { CardHeader } from "./ui";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A count as a bar against the run's total read: one hue, the funnel narrowing as it goes. */
function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span aria-hidden className="block h-2 rounded-r-[4px] bg-brand" style={{ width: `${Math.max(1, Math.min(100, (value / Math.max(1, max)) * 100))}%`, opacity: 0.85 }} />
  );
}

/** Mission Control's Pipeline view: the job-market data, from the sources to the Market page. */
export function PipelineView({ view }: { view: View }) {
  const read = view.stages[0]?.count ?? 0;
  return (
    <div className="space-y-5">
      <section className="card card-pad flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span className="flex items-center gap-2">
          <KindPill kind="bot" /> Scout, at every 2-hour sync
        </span>
        <span>
          Last run: <b className="font-medium">{view.lastRun ? shortDate(view.lastRun) : "none yet"}</b>
          {view.lastRun && !view.fresh && <span className="ml-1 text-ink-3">(not today)</span>}
        </span>
        <span className="text-ink-3">Rules only, no AI model. Numbers are from the latest run.</span>
        <Link href="/data" className="ml-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand">
          Set it up on Data Pipeline <Icon name="arrow" size={14} />
        </Link>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card card-pad min-w-0" aria-label="Market data pipeline">
          <CardHeader title="Market data, stage by stage" icon="flow" hint="Raw postings in, a cleaned and summarized market out. Each stage says what it set aside." />
          <ol className="space-y-1">
            {view.stages.map((s, i) => (
              <li key={s.id}>
                {i > 0 && (
                  <div aria-hidden className="ml-4 flex h-5 items-center text-ink-3">
                    <Icon name="chevron" size={14} />
                  </div>
                )}
                <div className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">
                      {s.label}
                      {s.store && <code className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-xs font-normal text-ink-2">{s.store}</code>}
                    </p>
                    {s.count !== null && (
                      <p className="text-lg font-medium tabular-nums">
                        {s.count.toLocaleString()}
                        {s.id === "summary" && <span className="ml-1 text-xs font-normal text-ink-3">days</span>}
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-ink-3">{s.what}</p>
                  {s.count !== null && ["read", "filter", "dedupe"].includes(s.id) && (
                    <div className="mt-2">
                      <Bar value={s.count} max={read} />
                    </div>
                  )}
                  {s.lanes && (
                    <ul className="mt-2 space-y-1.5" aria-label="Jobs flowing into each of your roles">
                      {s.lanes.map((l) => (
                        <li key={l.label} className="grid grid-cols-[150px_minmax(0,1fr)_auto] items-center gap-2 text-xs">
                          <span className="text-ink-2">{l.label}</span>
                          <Bar value={l.n} max={Math.max(1, ...s.lanes!.map((x) => x.n))} />
                          <span className="tabular-nums">{l.n.toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.dropped && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {s.dropped.map((d) => (
                        <li key={d.reason} className="chip">
                          − {d.n.toLocaleString()} {d.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.warn && <p className="mt-2 text-xs font-medium text-bad">{s.warn}</p>}
                  {s.id === "page" && (
                    <Link href="/career/market" className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-brand">
                      Open the Market page <Icon name="arrow" size={14} />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="space-y-5">
          <section className="card card-pad">
            <CardHeader title="Sources" icon="plug" hint="Postings each source gave the last run." />
            <ul className="divide-y divide-line text-sm">
              {view.sources.map((s) => (
                <li key={s.name} className="py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: s.ok ? "var(--c-green)" : "var(--c-warn)" }} />
                      {s.name}
                    </span>
                    <span className="tabular-nums">{s.read.toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-ink-3">{s.ok ? `${s.tech.toLocaleString()} tech, ${s.withPay.toLocaleString()} with pay` : s.idle ? "Not read this run: once a day, with its key" : "No postings last run"}</p>
                </li>
              ))}
            </ul>
          </section>

          <section className="card card-pad">
            <CardHeader title="Data quality" icon="check" hint="Over the postings recorded in the last run." />
            {view.checks.length === 0 ? (
              <p className="text-sm text-ink-3">After the first run.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {view.checks.map((c) => (
                  <li key={c.label}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <Icon name={c.ok ? "check" : "alert"} size={14} className={c.ok ? "text-brand" : "text-bad"} />
                        {c.label}
                      </span>
                      <span className="font-medium tabular-nums">{pct(c.value)}</span>
                    </div>
                    <p className="text-xs text-ink-3">
                      {c.why} {c.ok ? "" : `Below ${pct(c.floor)}.`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card card-pad text-sm">
            <CardHeader title="Your roles, alongside" icon="jobs" hint="The older pipeline, unchanged: only your target roles." />
            <p>
              <b className="font-medium tabular-nums">{view.yours.postings.toLocaleString()}</b> postings for your roles in the last 30 days <code className="ml-1 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">market_postings</code>
            </p>
            <p className="mt-1 text-xs text-ink-3">The Analyst&apos;s report {view.yours.reportDay ? `(latest ${shortDate(view.yours.reportDay)})` : "(none yet)"}, the Career Mentor and your matches read these.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
