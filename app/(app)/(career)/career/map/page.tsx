import Link from "next/link";
import { careerPrefs } from "@/lib/agents/career";
import { getContext } from "@/lib/context";
import { buildCareerMap, mapChanges, MAP_DAYS, parseMap, RUNG_LABEL, type CareerMap, type CareerPath, type Rung } from "@/lib/domain/careerMap";
import { pipelineConfig } from "@/lib/domain/dataPipeline";
import { addDays, shortDate } from "@/lib/domain/dates";
import { ENG_TYPES, type EngType } from "@/lib/domain/engTypes";
import { familyOf, type Family } from "@/lib/domain/techMarket";
import { CardHeader, Empty, PageHeader } from "@/components/ui";
import { pct, usd } from "@/components/MarketCharts";
import { UnderTheHood } from "@/components/UnderTheHood";
import { UpdateCareerMapButton } from "@/components/client/UpdateCareerMap";

export const metadata = { title: "Career Map" };

/** One rung of a ladder: who hires at this level, what it pays and what it asks for. */
function RungCard({ r }: { r: Rung }) {
  return (
    <li className="rounded-lg border border-line p-3 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{RUNG_LABEL[r.level]}</p>
        <p className="tabular-nums text-ink-2">
          {r.jobs.toLocaleString()} {r.jobs === 1 ? "job" : "jobs"}
          {r.fromYears > 0 && <span className="block text-[11px] text-ink-3">{r.fromYears} placed by years asked</span>}
        </p>
      </div>
      {r.jobs === 0 ? (
        <p className="mt-2 text-ink-3">No titles at this level in the last {MAP_DAYS} days.</p>
      ) : (
        <dl className="mt-2 space-y-1.5">
          <div>
            <dt className="text-ink-3">Pay</dt>
            <dd className="tabular-nums">
              {r.payMedian === null ? (
                "Not stated"
              ) : (
                <>
                  <span className="text-base font-medium text-ink">{usd(r.payMedian)}</span> median
                  {r.payLow && r.payHigh ? ` · middle half ${usd(r.payLow)}–${usd(r.payHigh)}` : ""} <span className="text-ink-3">({r.payN} state pay)</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Experience asked</dt>
            <dd>{r.yearsMedian ? `${r.yearsMedian} ${r.yearsMedian === 1 ? "year" : "years"} median (${r.yearsN} say)` : "Not stated"}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Skills asked most</dt>
            <dd>{r.skills.length ? r.skills.slice(0, 4).map((s) => `${s.name} ${pct(s.share)}`).join(" · ") : "–"}</dd>
          </div>
          {r.newSkills.length > 0 && (
            <div>
              <dt className="text-ink-3">New at this level</dt>
              <dd>{r.newSkills.map((s) => `${s.name} (${pct(s.before)} → ${pct(s.share)})`).join(" · ")}</dd>
            </div>
          )}
          {r.certs.length > 0 && (
            <div>
              <dt className="text-ink-3">Certifications named</dt>
              <dd>{r.certs.map((c) => `${c.name} ${pct(c.share)}`).join(" · ")}</dd>
            </div>
          )}
          <div>
            <dt className="text-ink-3">Hiring most</dt>
            <dd>{r.companies.length ? r.companies.slice(0, 3).map((c) => `${c.name} (${c.n})`).join(", ") : "–"}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Remote</dt>
            <dd className="tabular-nums">{pct(r.remoteShare)}</dd>
          </div>
          {r.small && <p className="text-ink-3">Small sample: read as a hint.</p>}
        </dl>
      )}
    </li>
  );
}

function PathCard({ p, rank }: { p: CareerPath; rank: number }) {
  return (
    <section className="card card-pad min-w-0" aria-labelledby={`path-${p.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`path-${p.id}`} className="font-medium">
            <span className="mr-1.5 font-mono text-xs text-ink-3">Path {rank}</span>
            {p.name}
            {p.yours && <span className="chip ml-2 align-middle">Your target</span>}
          </h2>
          <p className="mt-1 text-xs text-ink-2">
            {p.jobs.toLocaleString()} jobs ({pct(p.share)} of the type){p.payMedian ? ` · median pay ${usd(p.payMedian)} (${p.payN} state pay)` : ""} · {p.unstated.toLocaleString()} state no level or years
            {p.managers ? `, ${p.managers.toLocaleString()} are managers` : ""}
          </p>
        </div>
      </div>
      <ol aria-label={`${p.name}: the levels`} className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {p.rungs.map((r) => (
          <RungCard key={r.level} r={r} />
        ))}
      </ol>
      <h3 className="mt-4 text-sm font-medium">How to move up</h3>
      <ol className="mt-2 grid gap-3 lg:grid-cols-3">
        {p.steps.map((s) => (
          <li key={`${s.from}-${s.to}`} className="rounded-lg bg-surface-2 p-3 text-xs">
            <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
              {RUNG_LABEL[s.from]} → {RUNG_LABEL[s.to]}
              <span className="chip" title={s.writer === "model" ? "Written by the Career Mentor's AI model from the facts, and checked: every number is in the facts." : "Written by rules from the facts."}>
                {s.writer === "model" ? "✦ AI, checked" : "Rules"}
              </span>
            </p>
            {s.items.length ? (
              <ul className="mt-1.5 space-y-1.5">
                {s.items.map((it, i) => (
                  <li key={i}>
                    <p className="font-medium text-ink">{it.title}</p>
                    <p className="text-ink-2">{it.why}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1.5 text-ink-3">Not enough postings at these levels to say.</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function CareerMapPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type: q } = await searchParams;
  const ctx = await getContext();
  const { store, today } = ctx;
  const stored = (await store.careerMaps.latest(2).catch(() => [])).map((m) => parseMap(m.data)).filter((m): m is CareerMap => m !== null);
  const yourFamilies = new Set(careerPrefs(ctx.settings).roles.flatMap((r) => [r.name, ...r.titles].map(familyOf).filter((f): f is Family => f !== null)));
  // Before the first weekly map: a preview built now by rules, so the page is never empty.
  const preview = stored.length === 0;
  const map = stored[0] ?? buildCareerMap({ postings: await store.techMarket.since(addDays(today, -MAP_DAYS)).catch(() => []), day: today, now: ctx.now.toISOString(), yourFamilies, companyCap: pipelineConfig(ctx.settings.dataPipeline).companyCap });
  const changes = mapChanges(stored[1] ?? null, map);
  const firstYours = map.types.find((t) => t.paths.some((p) => p.yours))?.type;
  const type: EngType = ENG_TYPES.includes(q as EngType) ? (q as EngType) : (firstYours ?? "software");
  const t = map.types.find((x) => x.type === type)!;
  const tab = (on: boolean) => `flex min-h-11 items-center rounded-md px-3 text-sm font-medium ${on ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-ink-2 hover:text-ink"}`;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Career Map"
        sub={`Three real paths for each type of engineer, junior to staff: what each level pays, asks for and who hires, from ${map.jobs.toLocaleString()} tech jobs in the last ${map.days} days. Rebuilt every Monday by the Career Mentor.`}
        action={<UpdateCareerMapButton />}
      />

      <nav aria-label="Engineering type" className="inline-flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
        {map.types.map((x) => (
          <Link key={x.type} href={`/career/map?type=${x.type}`} aria-current={x.type === type ? "page" : undefined} className={tab(x.type === type)}>
            {x.label}
            {x.paths.some((p) => p.yours) && <span className="ml-1.5 text-xs text-ink-3">· yours</span>}
          </Link>
        ))}
      </nav>

      <section className="card card-pad text-sm" aria-label="This week's map">
        <p>
          {preview ? (
            <>
              <span className="font-medium">Preview, built now by rules.</span> The Career Mentor&apos;s weekly map, with AI-written steps, is saved on Monday evening, or press Update now.
            </>
          ) : (
            <>
              Week of {shortDate(map.week)} · steps by {map.writer === "rules" ? "rules" : map.writer === "model" ? "the Career Mentor's AI, checked against the facts" : "the Career Mentor's AI and rules"} · built {new Date(map.at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: ctx.settings.timezone })}
            </>
          )}
        </p>
        <p className="mt-1 text-xs text-ink-2">
          {t.label}: {t.jobs.toLocaleString()} jobs in the last {map.days} days.
          {t.gov && (t.gov.us || t.gov.utah) ? ` Official median pay for ${t.gov.occupation.toLowerCase()} (BLS, ${t.gov.year}): ${t.gov.us ? `${usd(t.gov.us)} U.S.` : ""}${t.gov.us && t.gov.utah ? ", " : ""}${t.gov.utah ? `${usd(t.gov.utah)} Utah` : ""}.` : " Official pay for the closest occupation appears after the next Monday read of BLS figures."}
        </p>
        {changes.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-medium">Since last week</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-2">
              {changes.map((c, i) => (
                <li key={i}>
                  <span className="font-medium text-ink">{c.path}:</span> {c.text}
                </li>
              ))}
            </ul>
          </div>
        )}
        <UnderTheHood id="career-map" facts={[["Sample", `${map.jobs.toLocaleString()} tech jobs seen in the last ${map.days} days`], ["Week", preview ? "Preview (not saved)" : `Week of ${shortDate(map.week)}`]]} />
      </section>

      {t.paths.length ? (
        t.paths.map((p, i) => <PathCard key={p.id} p={p} rank={i + 1} />)
      ) : (
        <section className="card card-pad">
          <CardHeader title={t.label} />
          <Empty>No {t.label.toLowerCase()} jobs recorded yet. The Scout records jobs at each 2-hour sync.</Empty>
        </section>
      )}

      <section className="card card-pad text-xs text-ink-2">
        <p className="font-medium text-ink">How to read this</p>
        <p className="mt-1">
          A path is one of the three most common specialties inside the type, read from job titles. A level is the one the title states; when it states none, the years of experience the posting asks for place it (0 to 2 years Junior, 3 to 4 Mid, 5 to 7 Senior, 8 or more Staff and lead). Jobs with neither count in the path but on no level. Pay is yearly U.S. dollars from postings that state it. These jobs are a sample of what the Scout reads (remote job boards, your watchlist and the Utah list), not the whole market.{" "}
          <Link href="/career/market" className="font-medium underline underline-offset-4">
            See the market
          </Link>
        </p>
        <UnderTheHood id="career-steps" />
      </section>
    </div>
  );
}
