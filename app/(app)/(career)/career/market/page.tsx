import Link from "next/link";
import { careerPrefs } from "@/lib/agents/career";
import { getContext } from "@/lib/context";
import { addDays, shortDate } from "@/lib/domain/dates";
import { activeInView, marketSnapshot, MIN_SAMPLE, type RegionFilter } from "@/lib/domain/marketSnapshot";
import { engTypeCards } from "@/lib/domain/engTypes";
import { engEvidence } from "@/lib/domain/engEvidence";
import { aiConfigured } from "@/lib/ai/model";
import { inScope } from "@/lib/domain/marketSnapshot";
import { TypeCheckPanel, WhyTheseFive } from "@/components/EngEvidence";
import { PIPELINE } from "@/lib/domain/provenance";
import { PartRow, UnderTheHood } from "@/components/UnderTheHood";
import { pipelineConfig } from "@/lib/domain/dataPipeline";
import { familyOf, FAMILY_LABEL, type Family } from "@/lib/domain/techMarket";
import { CardHeader, Empty, PageHeader } from "@/components/ui";
import { FamilyTrends, payBars, pct, RankedBars, StatTile, TableView, usd } from "@/components/MarketCharts";
import { NationalTrend } from "@/components/NationalTrend";
import { RemoteJobMap, UtahJobMap } from "@/components/client/JobMaps";
import { jobMaps } from "@/lib/domain/jobMap";
import { summarize } from "@/lib/domain/benchmarks";
import { env } from "@/lib/env";

export const metadata = { title: "Market" };

const TABS: { id: RegionFilter; label: string; href: string }[] = [
  { id: "utah", label: "Utah local", href: "/career/market" },
  { id: "remote", label: "Remote U.S.", href: "/career/market?view=remote" },
  { id: "intl", label: "International", href: "/career/market?view=intl" },
  { id: "all", label: "Whole market", href: "/career/market?view=all" },
];

/** Utah local, Remote U.S. or the whole market: each tab's figures come only from its own jobs. */
function MarketTabs({ view }: { view: RegionFilter }) {
  const tab = (on: boolean) => `flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${on ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-ink-2 hover:text-ink"}`;
  return (
    <nav aria-label="Which jobs" className="inline-flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
      {TABS.map((t) => (
        <Link key={t.id} href={t.href} aria-current={view === t.id ? "page" : undefined} className={tab(view === t.id)}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

const INTRO: Record<RegionFilter, string> = {
  utah: "Local tech jobs in Utah, on-site or hybrid: where they are, what they pay, and who is hiring. Updated at every 2-hour sync.",
  remote: "Remote tech jobs open only in the U.S.: what they pay, the levels and skills asked for, and who is hiring. Updated at every 2-hour sync.",
  intl: "Remote tech jobs open beyond the U.S. that hire people in it: worldwide, across the Americas, or in the U.S. and other countries. Pay is read only in U.S. dollars. Updated at every 2-hour sync.",
  all: "Every tech job the Scout reads that is open to people in the U.S.: local, remote and international, with the national trend beside it. Updated at every 2-hour sync.",
};

export default async function MarketPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: v } = await searchParams;
  const region: RegionFilter = v === "remote" ? "remote" : v === "intl" ? "intl" : v === "all" ? "all" : "utah";
  const ctx = await getContext();
  const { store, today } = ctx;
  const [postings, daily, benchmarks] = await Promise.all([
    store.techMarket.since(addDays(today, -35)).catch(() => []),
    store.techMarket.daily(addDays(today, -45)).catch(() => []),
    store.benchmarks.since(addDays(today, -800)).catch(() => []),
  ]);
  const yourFamilies = new Set(careerPrefs(ctx.settings).roles.flatMap((role) => [role.name, ...role.titles].map(familyOf).filter((f): f is Family => f !== null)));
  const pipeline = pipelineConfig(ctx.settings.dataPipeline);
  const s = marketSnapshot({ postings, daily, day: today, region, yourFamilies, companyCap: pipeline.companyCap });
  const maps = jobMaps(postings, today);
  const where = region === "utah" ? "local in Utah" : region === "remote" ? "remote, open only in the U.S." : region === "intl" ? "remote, open beyond the U.S." : "open to people in the U.S.";
  const eng = engTypeCards(activeInView(postings, today, region), pipeline.companyCap);
  const evidence = engEvidence(postings.filter((p) => inScope(p, region)), today);
  const check = pipeline.typeCheck;
  const remoteUs = region === "intl" ? activeInView(postings, today, "remote").length : 0;
  // Facts every "Under the hood" note shares: the sample and when it was read.
  const sampleFacts: [string, string][] = [
    ["Sample", `${s.sample.toLocaleString()} active jobs (${where}); ${s.capped.toLocaleString()} after the per-company cap`],
    ["Updated", `${shortDate(s.day)}, at the latest 2-hour sync`],
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Tech job market" sub={INTRO[region]} toggle={<MarketTabs view={region} />} />

      {s.sample === 0 && s.historyDays === 0 ? (
        <section className="card card-pad">
          <Empty>No market data yet. The Scout records it at the next 2-hour sync (Monday to Saturday, 6 AM to 4 PM).</Empty>
        </section>
      ) : (
        <>
          <section aria-label="Headline figures" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label={region === "utah" ? "Local Utah jobs" : region === "remote" ? "Remote U.S. jobs" : region === "intl" ? "International remote jobs" : "Active tech postings"}
              value={(s.active.value ?? 0).toLocaleString()}
              delta={s.active.change === null ? null : { text: `${s.active.change > 0 ? "+" : ""}${s.active.change.toLocaleString()} vs 7 days ago`, up: s.active.change === 0 ? null : s.active.change > 0 }}
              note={`Seen in the last 7 days. ${s.added7.toLocaleString()} new, ${s.gone7.toLocaleString()} stopped appearing this week.`}
              small={s.active.small}
            />
            <StatTile label="Median pay" value={s.payMedian.value === null ? "–" : usd(s.payMedian.value)} note={`Yearly, from the ${s.payMedian.n.toLocaleString()} postings that state pay (${pct(s.payMedian.n / Math.max(1, s.capped))}).`} small={s.payMedian.small} />
            {region === "utah" ? (
              <>
                <StatTile label="Hybrid" value={s.hybridShare.value === null ? "–" : pct(s.hybridShare.value)} note="Share of local jobs that say hybrid; the rest are on-site or do not say." small={s.hybridShare.small} />
                <StatTile label="Cities" value={maps.utah.pins.length.toLocaleString()} note={`${s.companyCount.toLocaleString()} companies hiring locally.`} />
              </>
            ) : region === "intl" ? (
              <>
                <StatTile label="Share of remote jobs" value={s.sample + remoteUs ? pct(s.sample / (s.sample + remoteUs)) : "–"} note={`Of all remote jobs open to people in the U.S. The other ${remoteUs.toLocaleString()} are open only in the U.S.`} />
                <StatTile label="Companies hiring" value={s.companyCount.toLocaleString()} note="With an active posting open beyond the U.S." />
              </>
            ) : region === "remote" ? (
              <>
                <StatTile label="Open anywhere in the U.S." value={maps.remote.total ? pct(maps.remote.anywhere.length / maps.remote.total) : "–"} note="The rest are limited to certain states (see the map)." />
                <StatTile label="Companies hiring" value={s.companyCount.toLocaleString()} note="With an active remote posting." />
              </>
            ) : (
              <>
                <StatTile label="Remote" value={s.remoteShare.value === null ? "–" : pct(s.remoteShare.value)} note="Share of active postings that say remote." small={s.remoteShare.small} />
                <StatTile label="In Utah" value={s.utah.toLocaleString()} note={`${pct(s.utah / Math.max(1, s.sample))} of active postings.`} />
              </>
            )}
          </section>
          <div className="-mt-2 px-1">
            <UnderTheHood id="headline" facts={[...sampleFacts, ["Sources", s.sources.map((src) => `${src.name} (${src.n.toLocaleString()})`).join(", ") || "none yet"]]} />
          </div>

          <section className="card card-pad min-w-0" aria-labelledby="eng-types">
            <CardHeader title="Jobs by type of engineer" icon="jobs" hint={`The five engineering types, biggest first: ${eng.engineering.toLocaleString()} engineering jobs (${where}).`} />
            <h2 id="eng-types" className="sr-only">
              Jobs by type of engineer
            </h2>
            {eng.engineering ? (
              <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {eng.cards.map((c, i) => (
                  <li key={c.type} className="rounded-lg border border-line p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium">
                        <span className="mr-1.5 font-mono text-xs text-ink-3">{i + 1}</span>
                        {c.label}
                      </p>
                      <p className="text-lg font-medium tabular-nums">{c.jobs.toLocaleString()}</p>
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-surface-2" aria-hidden>
                      <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(2, Math.round(c.share * 100))}%` }} />
                    </div>
                    <p className="mt-1 text-xs text-ink-3">
                      {pct(c.share)} of engineering jobs · {c.what}
                    </p>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      <dt className="text-ink-3">Median pay</dt>
                      <dd className="tabular-nums">{c.payMedian === null ? "Not stated" : `${usd(c.payMedian)} (${c.payN.toLocaleString()} state pay)`}</dd>
                      <dt className="text-ink-3">Remote</dt>
                      <dd className="tabular-nums">{c.base ? pct(c.remoteShare) : "–"}</dd>
                      <dt className="text-ink-3">Top skills</dt>
                      <dd>{c.topSkills.length ? c.topSkills.map((k) => `${k.skill} ${pct(k.share)}`).join(", ") : "–"}</dd>
                      <dt className="text-ink-3">Hiring most</dt>
                      <dd>{c.topCompanies.length ? c.topCompanies.map((k) => `${k.company} (${k.n})`).join(", ") : "–"}</dd>
                      <dt className="text-ink-3">Level stated most</dt>
                      <dd>{c.topLevel ?? "Not stated"}</dd>
                    </dl>
                    {c.small && c.jobs > 0 && <p className="mt-1 text-xs text-ink-3">Small sample: under {MIN_SAMPLE} jobs after the cap.</p>}
                    {(() => {
                      const b = check?.byType.find((x) => x.type === c.type);
                      return b ? <p className="mt-1 text-xs text-ink-2">AI check: agrees on {b.agree} of {b.n} sampled</p> : null;
                    })()}
                    <p className="mt-1 text-[11px] text-ink-3">Role families: {c.families.join(", ")}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>No engineering jobs in this view yet.</Empty>
            )}
            {eng.notEngineering > 0 && <p className="mt-3 text-xs text-ink-3">Product and program roles: {eng.notEngineering.toLocaleString()} more tech jobs, not counted as engineering.</p>}
            <TableView caption="Jobs by type of engineer" head={["Type", "Jobs", "Share", "Median pay", "Remote", "Top skills"]} rows={eng.cards.map((c) => [c.label, c.jobs, pct(c.share), c.payMedian === null ? "–" : usd(c.payMedian), c.base ? pct(c.remoteShare) : "–", c.topSkills.map((k) => k.skill).join(", ")])} />
            <UnderTheHood id="eng-types" facts={sampleFacts} />
            <WhyTheseFive ev={evidence} where={where} />
            <TypeCheckPanel check={check} aiReady={aiConfigured()} />
          </section>

          {region === "utah" && (
            <section className="card card-pad min-w-0">
              <CardHeader title="Where the local jobs are" icon="jobs" hint="On-site and hybrid tech jobs, a pin at the city each posting names. Select a pin for its jobs." />
              <UtahJobMap data={maps.utah} />
              <UnderTheHood id="map-utah" facts={[["Pinned", `${(maps.utah.total - maps.utah.noCity.length).toLocaleString()} of ${maps.utah.total.toLocaleString()} local jobs name a city`]]} />
            </section>
          )}
          {region === "remote" && (
            <section className="card card-pad min-w-0">
              <CardHeader title="Where remote jobs are open" icon="jobs" hint="A remote job limited to certain states shows in each of them; one open anywhere is counted apart." />
              <RemoteJobMap data={maps.remote} />
              <UnderTheHood id="map-remote" facts={[["Jobs", `${maps.remote.total.toLocaleString()} remote U.S. jobs; ${maps.remote.anywhere.length.toLocaleString()} open anywhere in the U.S.`]]} />
            </section>
          )}

          <section className="card card-pad">
            <CardHeader title="Demand by role family" icon="chart" hint={`Active postings per day, last ${Math.min(30, s.historyDays)} days. Your target roles' families come first, in green.`} />
            <FamilyTrends trends={s.trends} />
            <TableView caption="Active postings by role family" head={["Role family", "Active", "7-day change", "Yours"]} rows={s.trends.map((t) => [t.label, t.latest.toLocaleString(), t.change === null ? "–" : t.change.toLocaleString(), t.yours ? "Yes" : ""])} />
            <UnderTheHood id="trends" facts={[["History", `${s.historyDays} days of daily summaries`], ...(region === "intl" ? ([["Note", "International was split out on 23 Nov 2026; earlier days count these jobs under Remote U.S."]] as [string, string][]) : [])]} />
          </section>

          {region === "all" && <NationalTrend summaries={summarize(benchmarks)} fredReady={Boolean(env().FRED_API_KEY)} sampleSince={daily.length ? shortDate([...daily].sort((a, b) => a.day.localeCompare(b.day))[0]!.day) : null} />}
          {region === "all" && (
            <div className="-mt-2 px-1">
              <UnderTheHood id="national" />
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card card-pad min-w-0">
              <CardHeader title="Median pay by role family" icon="chart" hint={`Yearly, U.S. dollars, from postings that state pay. Under ${MIN_SAMPLE} postings is marked small.`} />
              {s.payByFamily.length ? <RankedBars rows={payBars(s.payByFamily)} format={usd} highlight={yourFamilies} /> : <Empty>No postings with pay yet.</Empty>}
              <TableView caption="Median pay by role family" head={["Role family", "Median", "Postings"]} rows={s.payByFamily.map((p) => [p.label, usd(p.median), p.n])} />
              <UnderTheHood id="pay" facts={[["With pay", `${s.payMedian.n.toLocaleString()} of ${s.capped.toLocaleString()} jobs after the cap`]]} />
            </section>
            <section className="card card-pad min-w-0">
              <CardHeader title="Median pay by level" icon="chart" hint="Only titles that state a level. Most titles state none, so these samples are smaller." />
              {s.payByLevel.length ? <RankedBars rows={payBars(s.payByLevel)} format={usd} /> : <Empty>No postings with a level and pay yet.</Empty>}
              <TableView caption="Median pay by level" head={["Level", "Median", "Postings"]} rows={s.payByLevel.map((p) => [p.label, usd(p.median), p.n])} />
              <UnderTheHood id="pay" facts={[["With pay and a level", `${s.payByLevel.reduce((a, p) => a + p.n, 0).toLocaleString()} jobs`]]} />
            </section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card card-pad min-w-0">
              <CardHeader title="Who is being hired" icon="people" hint="Active postings by the level their title states." />
              <RankedBars rows={s.levels.map((l) => ({ key: l.key, label: l.label, value: l.share, n: l.n }))} format={pct} />
              <TableView caption="Active postings by level" head={["Level", "Postings", "Share"]} rows={s.levels.map((l) => [l.label, l.n, pct(l.share)])} />
              <UnderTheHood id="levels" facts={sampleFacts} />
            </section>
            <section className="card card-pad min-w-0">
              <CardHeader title="Where the work is done" icon="chart" hint="Active postings by work mode, as the posting states it." />
              <RankedBars rows={s.modes.map((m) => ({ key: m.key, label: m.label, value: m.share, n: m.n }))} format={pct} />
              <TableView caption="Active postings by work mode" head={["Work mode", "Postings", "Share"]} rows={s.modes.map((m) => [m.label, m.n, pct(m.share)])} />
              <UnderTheHood id="modes" facts={sampleFacts} />
            </section>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <section className="card card-pad min-w-0">
              <CardHeader title="Skills asked for most" icon="sparkle" hint={`Share of the ${s.skillBase.toLocaleString()} active postings that came with a description. SmartRecruiters, Workable, Recruitee and BambooHR boards give a title only.`} />
              {s.topSkills.length ? <RankedBars rows={s.topSkills.map((k) => ({ key: k.skill, label: k.skill, value: k.share, n: k.n }))} format={pct} /> : <Empty>No skills found yet.</Empty>}
              <h3 className="mt-5 text-sm font-medium">Rising this week</h3>
              {s.rising.length ? (
                <table className="mt-2 w-full text-left text-xs">
                  <caption className="sr-only">Skills rising this week</caption>
                  <thead>
                    <tr className="border-b border-line text-ink-3">
                      <th scope="col" className="py-1.5 font-medium">Skill</th>
                      <th scope="col" className="py-1.5 font-medium">This week</th>
                      <th scope="col" className="py-1.5 font-medium">3 weeks before</th>
                      <th scope="col" className="py-1.5 font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {s.rising.map((k) => (
                      <tr key={k.skill} className="border-b border-line last:border-0">
                        <td className="py-1.5">{k.skill}</td>
                        <td className="py-1.5">{pct(k.shareNow)}</td>
                        <td className="py-1.5">{pct(k.shareBefore)}</td>
                        <td className="py-1.5 font-medium">+{k.change} pts</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="mt-1 text-xs text-ink-3">Needs at least {MIN_SAMPLE} new postings this week and in the three weeks before. Check back after a few weeks of syncs.</p>
              )}
              <UnderTheHood id="skills" facts={[["With a description", `${s.skillBase.toLocaleString()} of ${s.capped.toLocaleString()} jobs after the cap`]]} />
            </section>
            <section className="card card-pad min-w-0">
              <CardHeader title="Hiring the most" icon="jobs" hint="Companies with the most active postings in this sample." />
              {s.companies.length ? <RankedBars rows={s.companies.map((c) => ({ key: c.company, label: c.company, value: c.n }))} format={(v) => v.toLocaleString()} /> : <Empty>No companies yet.</Empty>}
              <p className="mt-3 text-xs text-ink-3">Companies on your watchlist and the Utah list are read in full, so they show up more here than in the market as a whole.</p>
              <UnderTheHood id="companies" facts={[["Companies", `${s.companyCount.toLocaleString()} with an active job here`]]} />
            </section>
          </div>

          <section className="card card-pad text-sm text-ink-2" aria-labelledby="hood-page">
            <h2 id="hood-page" className="font-medium text-ink">
              Under the hood: this page
            </h2>
            <p className="mt-1 text-xs">Every figure above follows this path, from the schedule to the stored table. Each card&apos;s own &ldquo;Under the hood&rdquo; adds the math behind it.</p>
            <ol aria-label="The path behind the Market page" className="mt-2 divide-y divide-line text-xs">
              {PIPELINE.map((p) => (
                <PartRow key={`${p.kind}:${p.name}`} part={p} />
              ))}
            </ol>
            <p className="mt-3 font-medium text-ink">What this rests on</p>
            <p className="mt-1">
              {s.sample.toLocaleString()} active full-time tech jobs ({where}), the same job from two sources counted once, from {s.sources.length} sources:{" "}
              {s.sources.map((src) => `${src.name} (${src.n.toLocaleString()})`).join(", ")}. {s.historyDays} days of history, through {shortDate(s.day)}.
            </p>
            <p className="mt-1">
              Shares and medians count each company at most {pipeline.companyCap} times ({s.capped.toLocaleString()} postings after the cap), so a large employer on your watchlist cannot set the market&apos;s pay or levels on its own. Counts of postings are not capped.
            </p>
            {s.sources.some((src) => src.name === "Adzuna") && (
              <p className="mt-1">
                Job and salary data in part from{" "}
                <a href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">
                  Adzuna
                </a>{" "}
                (the Adzuna API), as its terms ask.
              </p>
            )}
            {ctx.mode === "demo" &&<p className="mt-1 font-medium text-ink">Demo: the trend history before today and the national figures are invented; today&apos;s postings are read live from the sources.</p>}
            <p className="mt-1 text-xs text-ink-3">
              A sample of what the Scout reads, not the whole market: the sources lean toward remote job boards and the companies you watch. Families:{Object.values(FAMILY_LABEL).join(", ")}.{" "}
              <Link href="/data#pipeline" className="font-medium text-ink-2 underline underline-offset-4">
                See how the data flows
              </Link>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
