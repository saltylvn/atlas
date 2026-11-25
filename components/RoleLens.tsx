import { CardHeader } from "@/components/ui";
import { LENS_LABEL, PROFILE_LEVEL_LABEL, type LensProfile, type LensStats } from "@/lib/domain/roleLens";

// Your six roles as the job market's categories: a bar per role (jobs seen in 30 days), and
// the companies hiring most for them. Counts come from stored postings, sorted by the title
// rules in lib/domain/roleLens.ts.

const pct = (x: number) => `${Math.round(x * 100)}%`;
const s = (n: number) => (n === 1 ? "" : "s");

/** The trend, once there are four weeks to compare; until then, how many are new. */
function trend(r: LensStats["rows"][number], historyDays: number): string {
  if (historyDays < 28 || r.prev14 === 0) return `${r.new14} new in 14 days`;
  const change = (r.new14 - r.prev14) / r.prev14;
  return `${r.new14} new in 14 days, ${change >= 0 ? "up" : "down"} ${pct(Math.abs(change))} on the 14 before`;
}

const money = (n: number) => `$${Math.round(n / 1000)}k`;

/** One role's card: pay by level, the skills asked most, years asked and certifications. Counts say what each rests on. */
function RoleProfile({ label, p, byAi }: { label: string; p: LensProfile; byAi: number }) {
  const y = p.years;
  return (
    <details className="sm:col-span-3">
      <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-ink-2 hover:text-ink">Pay, skills, years and certifications</summary>
      <dl className="mt-1 grid gap-3 text-sm sm:grid-cols-2" aria-label={`${label}: what postings ask for`}>
        <div className="min-w-0">
          <dt className="eyebrow mb-1">Median pay by level</dt>
          <dd>
            <ul className="space-y-0.5">
              {p.pay.map((x) => (
                <li key={x.level} className="flex justify-between gap-2 tabular-nums">
                  <span className="text-ink-2">{PROFILE_LEVEL_LABEL[x.level]}</span>
                  <span>{x.median == null ? <span className="text-ink-3">not stated</span> : `${money(x.median)} (${x.n})`}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="eyebrow mb-1">Skills asked most</dt>
          <dd className="break-words">{p.skills.length ? p.skills.map((s) => `${s.skill} ${pct(s.share)}`).join(" · ") : <span className="text-ink-3">No posting names a skill yet.</span>}</dd>
          {p.skillsFrom > 0 && <dd className="text-xs text-ink-3">Of {p.skillsFrom} postings that name skills.</dd>}
        </div>
        <div className="min-w-0">
          <dt className="eyebrow mb-1">Years asked</dt>
          <dd className="tabular-nums">{y.stated ? `0-2: ${y["0-2"]} · 3-4: ${y["3-4"]} · 5+: ${y["5+"]}` : <span className="text-ink-3">No description read states years yet.</span>}</dd>
          {y.stated > 0 && <dd className="text-xs text-ink-3">Of {y.stated} postings that state years.</dd>}
        </div>
        <div className="min-w-0">
          <dt className="eyebrow mb-1">Certifications named</dt>
          <dd className="break-words">{p.certs.length ? p.certs.map((c) => `${c.name} (${c.n})`).join(" · ") : <span className="text-ink-3">None named{p.certsFrom ? ` in ${p.certsFrom} postings read in full` : ""}.</span>}</dd>
        </div>
      </dl>
      {byAi > 0 && <p className="mt-1 text-xs text-ink-3">{byAi} of these jobs were placed here by Gemini from their title; the rest by the title rules.</p>}
    </details>
  );
}

export function RoleLens({ stats, historyDays }: { stats: LensStats; historyDays: number }) {
  const max = Math.max(1, ...stats.rows.map((r) => r.jobs30));
  const inRoles = stats.rows.filter((r) => r.lens !== "other").reduce((n, r) => n + r.jobs30, 0);
  return (
    <section className="card card-pad space-y-5" aria-labelledby="role-lens">
      <CardHeader
        title="Your six roles"
        icon="chart"
        hint={`Every tech job seen in the last 30 days, sorted by its title into your six roles: rules first, then Gemini once a day for titles the rules cannot place (${stats.judgedTitles} judged so far). ${inRoles.toLocaleString()} of ${stats.total30.toLocaleString()} jobs fall under one of them.${historyDays < 28 ? ` Trends need 4 weeks of data; Atlas has ${historyDays} day${s(historyDays)}.` : ""}`}
      />
      <h2 id="role-lens" className="sr-only">
        Jobs by role, last 30 days
      </h2>

      {/* The chart: one bar per role, longest first, Other last. Each bar carries its number. */}
      <ol className="space-y-3" aria-label="Jobs in the last 30 days, by role">
        {stats.rows
          .filter((r) => r.lens !== "other")
          .sort((a, b) => b.jobs30 - a.jobs30)
          .concat(stats.rows.filter((r) => r.lens === "other"))
          .map((r) => (
            <li key={r.lens} className="grid gap-1 sm:grid-cols-[200px_minmax(0,1fr)_auto] sm:items-center sm:gap-3">
              <span className={`text-sm ${r.lens === "other" ? "text-ink-3" : "font-medium"}`}>{r.label}</span>
              <span className="block h-3 rounded-r-[4px] bg-surface-2" title={`${r.label}: ${r.jobs30} jobs in 30 days (${pct(r.share)} of all tech jobs); ${r.jobs7} seen in the last 7 days`}>
                <span
                  aria-hidden
                  className={`block h-3 rounded-r-[4px] ${r.lens === "other" ? "bg-line-strong" : "bg-brand"}`}
                  style={{ width: `${Math.max(1, (r.jobs30 / max) * 100)}%` }}
                />
              </span>
              <span className="text-xs text-ink-2 tabular-nums sm:text-right">
                <span className="text-sm font-medium text-ink">{r.jobs30.toLocaleString()}</span> · {pct(r.share)} · {trend(r, historyDays)}
              </span>
              {r.profile && r.jobs30 > 0 && <RoleProfile label={r.label} p={r.profile} byAi={r.byAi} />}
              {r.categories && r.categories.length > 0 && (
                <details className="sm:col-span-3">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-ink-2 hover:text-ink">What the other tech roles are: top {r.categories.length}</summary>
                  <ol className="mt-1 space-y-1.5 text-sm">
                    {r.categories.map((c) => (
                      <li key={c.label} className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{c.label}</span>
                        <span className="text-xs text-ink-2 tabular-nums">
                          {c.jobs.toLocaleString()} jobs · {pct(r.jobs30 ? c.jobs / r.jobs30 : 0)} of Other
                        </span>
                        {c.titles.length > 0 && <span className="w-full text-xs text-ink-3 break-words">Most common: {c.titles.join(", ")}</span>}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </li>
          ))}
      </ol>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="eyebrow mb-2">Who&apos;s hiring most for your roles</h3>
          {stats.topCompanies.length === 0 ? (
            <p className="text-sm text-ink-3">No jobs in your roles yet. They appear after the next sync.</p>
          ) : (
            <ol className="divide-y divide-line">
              {stats.topCompanies.map((c, i) => (
                <li key={c.company} className="flex items-baseline gap-3 py-2 text-sm">
                  <span className="w-6 shrink-0 text-right text-xs text-ink-3 tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium break-words">{c.company}</span>
                    <span className="block text-xs text-ink-3">{c.by.map((b) => `${LENS_LABEL[b.lens]} ${b.jobs}`).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {c.jobs} job{s(c.jobs)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="min-w-0">
          <h3 className="eyebrow mb-2">Top companies in each role</h3>
          <dl className="space-y-3">
            {stats.rows
              .filter((r) => r.lens !== "other" && r.companies.length > 0)
              .map((r) => (
                <div key={r.lens}>
                  <dt className="text-xs font-medium text-ink-2">
                    {r.label} · Utah {r.where.utah} · U.S. {r.where.us} · international {r.where.global} · place not stated {r.where.unstated}
                  </dt>
                  <dd className="text-sm break-words">{r.companies.map((c) => `${c.company} (${c.jobs})`).join(", ")}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
