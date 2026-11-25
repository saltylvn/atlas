import Link from "next/link";
import { Suspense } from "react";
import { loadCareerSnapshot } from "@/lib/career";
import { getContext } from "@/lib/context";
import { ACTIVE_STAGES } from "@/lib/domain/jobs";
import { summarizePipeline } from "@/lib/domain/jobs";
import { scanBoards } from "@/lib/integrations/jobBoards";
import { buildDoNext, type DoNextInput } from "@/lib/domain/career";
import { JOB_BOARD_INFO, type JobWatch } from "@/lib/domain/types";
import { DoNextList } from "@/components/DoNextList";
import { SuggestWatchButton, UnwatchButton, WatchForm } from "@/components/client/WatchForm";
import { suggestedUtah } from "@/lib/domain/utahSeed";
import { BoardFinder } from "@/components/client/BoardFinder";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, Pill, hue, timeAgo } from "@/components/ui";
import { careerPrefs } from "@/lib/agents/career";
import { addDays, shortDate } from "@/lib/domain/dates";
import { JOB_SOURCES, NOT_READ, sourceCounts } from "@/lib/domain/jobSources";

export const metadata = { title: "Job watchlist" };

const STAGE_COLOR: Record<string, string> = {
  Draft: "var(--c-grey)",
  Applied: "var(--c-slate)",
  Reply: "var(--c-warn)",
  "Interview 1": "var(--c-indigo)",
  "Interview 2": "var(--c-indigo)",
  "Interview 3": "var(--c-indigo)",
  "Interview 4": "var(--c-indigo)",
  Offer: "var(--c-green)",
  Rejected: "var(--c-red)",
  Withdrawn: "var(--c-grey)",
  "On Hold": "var(--c-warn)",
};

export default async function JobsPage() {
  const ctx = await getContext();
  const { store, now, today, settings } = ctx;
  const [snapshot, watches, contacts, recorded, runs] = await Promise.all([
    loadCareerSnapshot(ctx),
    store.watches.list(),
    store.contacts.list(),
    store.market.since(addDays(today, -30)).catch(() => []),
    store.agentRuns.recent(80).catch(() => []),
  ]);
  const counts = sourceCounts(recorded, careerPrefs(settings).roles.map((r) => r.name), addDays(today, -30));
  // The Scout's last run says which sources failed to answer.
  const lastScout = runs.find((r) => r.agent === "scout" && r.task === "Record the job market" && r.status !== "started");
  const failed = new Set((/Job feeds that failed: ([^·]+)/.exec(lastScout?.detail ?? "")?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const pipeline = snapshot ? summarizePipeline(snapshot, now, today) : null;
  const tz = settings.timezone;
  const lanes = ["Applied", "Reply", "Interviewing", "Offer"] as const;
  const laneOf = (stage: string) => (stage.startsWith("Interview") ? "Interviewing" : stage);
  const active = snapshot?.applications.filter((a) => ACTIVE_STAGES.includes(a.stage)) ?? [];
  const doNext: DoNextInput = { snapshot, contacts, now, today, timeZone: tz, displayName: settings.displayName };

  return (
    <div className="space-y-5">
      <PageHeader title="Job watchlist" sub="What to do next on your applications, your pipeline, and your company watchlist." />

      <Suspense fallback={<DoNextList items={buildDoNext(doNext)} today={today} pending={watches.length > 0} />}>
        <DoNextWithPostings input={doNext} watches={watches} keywords={settings.jobKeywords} locations={settings.jobLocations} />
      </Suspense>

      {!snapshot ? (
        <section className="card card-pad">
          <CardHeader title="No applications yet" icon="jobs" />
          <p className="text-sm text-ink-2">
            The Applications bot adds an application whenever a company emails to thank you for applying. Open the Pipeline to find past ones in Gmail, or add one by hand.
          </p>
          <Link href="/applications" className="btn btn-primary btn-sm mt-3">
            Open the Pipeline
          </Link>
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Active", pipeline!.active, "var(--c-slate)"],
              ["Interviewing", pipeline!.interviewing, "var(--c-indigo)"],
              ["Offers", pipeline!.offers, "var(--c-green)"],
              ["Closed", pipeline!.closed, "var(--c-grey)"],
            ].map(([label, n, color]) => (
              <div key={label as string} className="card px-4 py-3">
                <p className="text-xs font-semibold text-ink-3">{label}</p>
                <p className="h-display text-3xl font-semibold" style={{ color: color as string }}>
                  {n}
                </p>
              </div>
            ))}
          </section>
          <p className="text-xs text-ink-3">
            From your applications and the interviews on your calendar.{" "}
            <Link href="/applications" className="font-medium text-brand hover:underline">
              Open the Pipeline
            </Link>
          </p>

          <section id="sources" className="card card-pad scroll-mt-20">
        <CardHeader
          title={`Job boards the Analyst works from (${JOB_SOURCES.length})`}
          icon="jobs"
          hint="The Scout reads these at every 2-hour sync and records each posting; the Analyst's market report and the Career Mentor's role advice use only what it recorded. Counts are the last 30 days."
        />
        <ul className="divide-y divide-line">
          {JOB_SOURCES.map((src) => {
            const c = counts.find((x) => x.name === src.name);
            const down = failed.has(src.name);
            return (
              <li key={src.name} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {src.url ? (
                      <a href={src.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {src.name} <Icon name="external" size={12} />
                      </a>
                    ) : (
                      src.name
                    )}
                    {down ? <Pill color="var(--c-warn)">Did not answer last run</Pill> : <Pill color="var(--c-green)">Read</Pill>}
                  </p>
                  <p className="text-xs text-ink-3 break-words">{src.what}{src.kind === "watchlist" ? ` ${watches.length} compan${watches.length === 1 ? "y" : "ies"} watched.` : ""}</p>
                </div>
                <p className="text-sm text-ink-2">
                  <span className="font-semibold text-ink">{c?.postings ?? 0}</span> postings
                  {c && c.postings > 0 ? ` · ${c.yours} for your roles · last ${shortDate(c.lastSeen!)}` : ""}
                </p>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 rounded-lg border border-line p-3">
          <p className="eyebrow mb-1.5">Not read</p>
          <ul className="space-y-1 text-sm">
            {NOT_READ.map((n) => (
              <li key={n.name} className="break-words">
                <span className="font-medium">{n.name}:</span> <span className="text-ink-2">{n.why}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">A job you find on one of these still counts: paste it into Save a job on the Career page, or it is logged from its confirmation email.</p>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <section className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {lanes.map((lane) => {
                const items = active.filter((a) => laneOf(a.stage) === lane);
                return (
                  <div key={lane} className="rounded-xl bg-surface-2 p-2.5">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="text-sm font-semibold">{lane}</span>
                      <span className="chip">{items.length}</span>
                    </div>
                    <div className="space-y-2">
                      {items.length === 0 && <p className="px-1 py-3 text-center text-xs text-ink-3">None</p>}
                      {items.map((a) => (
                        <article key={a.applicationId} className="card p-3">
                          <p className="text-sm font-semibold">{a.company}</p>
                          <p className="text-xs text-ink-2">{a.role}</p>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <Pill color={STAGE_COLOR[a.stage] ?? "var(--c-grey)"}>{a.stage}</Pill>
                            {a.postingUrl && (
                              <a href={a.postingUrl} target="_blank" rel="noopener noreferrer" className="text-ink-3 hover:text-brand" aria-label={`Posting for ${a.company}`}>
                                <Icon name="external" size={14} />
                              </a>
                            )}
                          </div>
                          {a.nextAction && (
                            <p className={`mt-2 text-xs ${a.nextActionDue && a.nextActionDue <= today ? "font-semibold text-bad" : "text-ink-3"}`}>
                              Next: {a.nextAction}
                              {a.nextActionDue ? ` · ${a.nextActionDue.slice(5)}` : ""}
                            </p>
                          )}
                        </article>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>

            <aside className="space-y-5">
              <section className="card card-pad">
                <CardHeader title="Upcoming interviews" icon="clock" />
                {pipeline!.upcomingInterviews.length === 0 ? (
                  <Empty>None scheduled.</Empty>
                ) : (
                  <ul className="space-y-2">
                    {pipeline!.upcomingInterviews.map((i) => (
                      <li key={i.interviewId} className="rounded-lg border-l-4 bg-surface-2 px-3 py-2" style={{ borderLeftColor: "var(--c-career)" }}>
                        <p className="text-sm font-semibold">{i.company}</p>
                        <p className="text-xs text-ink-2">
                          {i.round} · {new Date(i.start).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {i.status}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="card card-pad">
                <CardHeader title="Follow-ups due" icon="alert" />
                {pipeline!.followUps.length === 0 ? (
                  <Empty>Nothing due.</Empty>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {pipeline!.followUps.map((a) => (
                      <li key={a.applicationId}>
                        <span className="font-semibold">{a.company}</span>: {a.nextAction}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        </>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="card card-pad min-w-0">
          <CardHeader title="Open roles that match you" icon="sparkle" hint={`Career Scout checks ${watches.length} boards for: ${settings.jobKeywords.join(", ")}`} />
          <Suspense fallback={<p className="py-6 text-center text-sm text-ink-3">Scanning job boards…</p>}>
            <Openings watches={watches} keywords={settings.jobKeywords} locations={settings.jobLocations} now={now} />
          </Suspense>
        </section>
        <section className="card card-pad">
          <CardHeader title="Watched boards" icon="jobs" />
          <ul className="mb-4 divide-y divide-line">
            {watches.map((w) => (
              <li key={w.id} className="flex items-center justify-between py-1.5 text-sm">
                <span>
                  {w.company} <span className="text-xs text-ink-3">· {JOB_BOARD_INFO[w.board].label}</span>
                </span>
                <UnwatchButton id={w.id} company={w.company} />
              </li>
            ))}
          </ul>
          <WatchForm />
          <div className="mt-5">
            <p className="eyebrow">Find a company&apos;s board</p>
            <div className="mt-2">
              <BoardFinder />
            </div>
          </div>
          {suggestedUtah(watches).length > 0 && (
            <div className="mt-5">
              <p className="eyebrow">Suggested: Utah tech companies</p>
              <p className="mt-1 text-xs text-ink-3">Each board checked by its public API. Nothing is watched until you press Watch.</p>
              <ul className="mt-2 divide-y divide-line">
                {suggestedUtah(watches).map((s) => (
                  <li key={`${s.board}:${s.slug}`} className="flex items-center justify-between gap-2 py-1">
                    <span className="min-w-0 text-sm">
                      {s.company}{" "}
                      <span className="text-xs text-ink-3">
                        · {s.where} · {JOB_BOARD_INFO[s.board].label}
                      </span>
                    </span>
                    <SuggestWatchButton company={s.company} board={s.board} slug={s.slug} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

async function Openings({ watches, keywords, locations, now }: { watches: JobWatch[]; keywords: string[]; locations: string[]; now: Date }) {
  if (watches.length === 0) return <Empty>Watch a company board to start.</Empty>;
  const scan = await scanBoards(watches, keywords, locations);
  return (
    <>
      <p className="mb-2 text-xs text-ink-3">
        {scan.postings.length} matches from {scan.scanned} open roles.{scan.failed.length > 0 && ` Unavailable: ${scan.failed.join(", ")}.`}
      </p>
      {scan.postings.length === 0 ? (
        <Empty>No matching roles right now. Try broader keywords in Settings.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {scan.postings.slice(0, 30).map((p) => (
            <li key={p.id}>
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-3 py-2.5">
                <span
                  className="tint h-display flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
                  style={hue(p.score >= 90 ? "var(--c-green)" : p.score >= 75 ? "var(--c-indigo)" : "var(--c-grey)")}
                  title="Match score"
                >
                  {p.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold group-hover:text-brand">{p.title}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {p.company} · {p.location || "Location not listed"}
                    {p.updatedAt ? ` · ${timeAgo(p.updatedAt, now)}` : ""}
                  </span>
                </span>
                <Icon name="external" size={14} className="shrink-0 text-ink-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

async function DoNextWithPostings({ input, watches, keywords, locations }: { input: DoNextInput; watches: JobWatch[]; keywords: string[]; locations: string[] }) {
  const scan = watches.length > 0 ? await scanBoards(watches, keywords, locations) : null;
  return <DoNextList items={buildDoNext({ ...input, postings: scan?.postings ?? [] })} today={input.today} />;
}
