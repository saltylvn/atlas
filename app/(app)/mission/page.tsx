import Link from "next/link";
import { aiConfigured, aiMissing, aiName } from "@/lib/ai/model";
import { loadLive } from "@/lib/agents/live";
import { getContext } from "@/lib/context";
import { AGENTS } from "@/lib/domain/agents";
import { hourLabel, nextBrief, nextSync, SLOT_LABEL, SYNC_TASK } from "@/lib/domain/briefSchedule";
import { localDate, localTime, shortDate } from "@/lib/domain/dates";
import type { AgentRunEvent, RunStatus } from "@/lib/domain/types";
import { env } from "@/lib/env";
import { EVAL_TASK, pct, runEvals } from "@/lib/evals";
import { pushConfigured } from "@/lib/push";
import { LiveMap } from "@/components/client/LiveMap";
import { AutoRefresh, PauseToggle, RunNowButton, SyncNowButton } from "@/components/client/MissionControls";
import { Icon } from "@/components/Icon";
import { Avatar, CardHeader, Empty, PageHeader, Pill, timeAgo } from "@/components/ui";
import { AiJudgmentCard } from "@/components/AiJudgmentCard";
import { QaCard } from "@/components/QaCard";
import { AI_CHECK_TASK } from "@/lib/domain/aiCheck";
import { activeProvider } from "@/lib/ai/model";
import { APPROVALS_HREF } from "@/components/ApprovalQueue";
import { RefreshMentorButton } from "@/components/client/CareerDesk";
import { geminiModel } from "@/lib/ai/gemini";

export const metadata = { title: "Mission Control" };
// Run Now builds a whole brief inside this request.
export const maxDuration = 60;

const STATUS_COLOR: Record<RunStatus, string> = {
  started: "var(--c-blue)",
  succeeded: "var(--c-green)",
  failed: "var(--c-red)",
  skipped: "var(--c-orange)",
};

/** "850 ms", "4.2 s", "1 min 5 s". */
const took = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

const usd = (n: number) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

/** Switches Mission Control between the dashboard and the live map. A link, so each has its own address to bookmark. */
function ViewToggle({ view }: { view: "dashboard" | "map" }) {
  const tab = (on: boolean) => `flex min-h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium ${on ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-ink-2 hover:text-ink"}`;
  return (
    <nav aria-label="Mission Control view" className="inline-flex gap-1 rounded-lg bg-surface-2 p-1">
      <Link href="/mission" aria-current={view === "dashboard" ? "page" : undefined} className={tab(view === "dashboard")}>
        <Icon name="shield" size={15} /> Dashboard
      </Link>
      <Link href="/mission?view=map" aria-current={view === "map" ? "page" : undefined} className={tab(view === "map")}>
        <Icon name="team" size={15} /> Live map
      </Link>
    </nav>
  );
}

/** The AI model as the live map draws it: its name, whether it is on, and its two models when it has them. */
function mapAi(on: boolean) {
  if (!aiConfigured()) return null;
  if (activeProvider() !== "gemini") return { name: aiName(), on };
  const writer = geminiModel("writer");
  const fast = geminiModel("fast");
  return { name: aiName(), on, writer, ...(fast !== writer ? { fast } : {}) };
}

/** The live map: the orchestration drawn out, lit up as agents work. Reads the activity log only. */
async function MissionMap() {
  const ctx = await getContext();
  // Rendered without details; the map asks for them only when you switch them on, on that device.
  const live = await loadLive(ctx, false);
  return (
    <div>
      <PageHeader title="Mission Control" sub="The orchestration map. Boxes light up as agents work; lines show where work and data move." action={<ViewToggle view="map" />} />
      <LiveMap initial={live} ai={mapAi(ctx.settings.aiEnabled && ctx.settings.outboundEnabled)} />
    </div>
  );
}

export default async function MissionControlPage({ searchParams }: { searchParams: Promise<{ q?: string; view?: string }> }) {
  const { q, view } = await searchParams;
  if (view === "map") return <MissionMap />;
  const query = (q ?? "").trim().slice(0, 80);
  const { store, now, today, time, settings, mode } = await getContext();
  // Whether an agent that uses a model actually reaches one right now.
  const aiOn = aiConfigured() && settings.aiEnabled && settings.outboundEnabled;
  const tz = settings.timezone;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const [runs, states, connections, devices, briefs, tracked, approvals, aiUsed, qaReports] = await Promise.all([
    store.agentRuns.since(weekAgo),
    store.agentState.list(),
    store.connections.list(),
    store.push.list(),
    store.briefs.search({ limit: 20, query: query || undefined }),
    store.applications.list().catch(() => []),
    store.approvals.list().catch(() => []),
    store.aiUsage.countToday().catch(() => 0),
    store.qa.recent(1).catch(() => []),
  ]);

  // The daily eval run is logged under the Chief of Staff; it is not one of its briefs.
  const finished = (r: AgentRunEvent) => r.status !== "started" && r.task !== EVAL_TASK && r.task !== SYNC_TASK && r.task !== AI_CHECK_TASK;
  // The 2-hour sync: every agent reports to the Chief of Staff between briefs.
  const lastSync = runs.find((r) => r.task === SYNC_TASK && r.status !== "started");
  const sync = nextSync(today, time);
  const evals = runEvals();
  const todayRuns = runs.filter((r) => localDate(new Date(r.at), tz) === today);
  const costToday = (agent?: string) => todayRuns.filter((r) => !agent || r.agent === agent).reduce((n, r) => n + r.costUsd, 0);
  const alerts = runs.filter((r) => r.status === "failed" || r.status === "skipped").slice(0, 12);
  const next = nextBrief(today, time);
  const lastCalendar = runs.find((r) => r.agent === "calendar" && finished(r) && r.status !== "skipped");
  const gmail = connections.find((c) => c.provider === "gmail_imap") ?? connections.find((c) => c.provider === "google");

  // The Atlas tracker (the Applications board).
  const stages = tracked
    .filter((a) => a.status !== "saved")
    .map((a) => ({ applied: a.status === "applied", reply: a.status === "replied", interview: a.status === "interview", offer: a.status === "offer", rejected: a.status === "rejected" }));
  const apps = stages;
  const responded = stages.filter((x) => x.reply || x.interview || x.offer || x.rejected).length;
  const byStage = (
    [
      ["Applied", "applied"],
      ["Reply", "reply"],
      ["Interview", "interview"],
      ["Offer", "offer"],
      ["Rejected", "rejected"],
    ] as const
  ).map(([stage, k]) => ({ stage, n: stages.filter((x) => x[k]).length }));
  const pendingApprovals = approvals.filter((a) => a.status === "pending").length;
  const agents = AGENTS.map((a) => ({
    a,
    last: runs.find((r) => r.agent === a.id && finished(r)),
    paused: states.some((s) => s.agent === a.id && s.paused),
    live: a.status === "live",
  }));

  const health: { name: string; ok: boolean | null; note: string }[] = [
    { name: "Supabase", ok: mode === "live", note: mode === "live" ? "Live database" : "Demo mode (in memory)" },
    {
      name: "Gmail",
      ok: gmail ? gmail.status === "active" : null,
      note: gmail
        ? gmail.status === "active"
          ? `${gmail.provider === "gmail_imap" ? "App password" : "Google sign-in (expires every 7 days)"} · synced ${gmail.lastSyncAt ? timeAgo(gmail.lastSyncAt, now) : "never"}`
          : gmail.lastError || "Needs attention"
        : "Not connected",
    },
    {
      name: "Google Calendar",
      ok: e(env().CALENDAR_ICS_URL) && lastCalendar?.status !== "failed",
      note: !env().CALENDAR_ICS_URL
        ? "Add CALENDAR_ICS_URL"
        : lastCalendar?.status === "failed"
          ? `Last read failed ${timeAgo(lastCalendar.at, now)}: ${lastCalendar.detail}`
          : lastCalendar
            ? `Secret iCal address · read ${timeAgo(lastCalendar.at, now)}`
            : "Secret iCal address set",
    },
    {
      name: "Notion",
      ok: !env().NOTION_TOKEN ? null : settings.notion ? settings.notion.ok : null,
      note: !env().NOTION_TOKEN
        ? "Not connected (role order and resumes come from Settings)"
        : !settings.notion
          ? "Token set. Run the first sync in Connectors."
          : settings.notion.ok
            ? `Read-only · ${settings.notion.roles} roles, ${settings.notion.resumes} resumes${settings.notion.master ? " (with master)" : ""} · synced ${timeAgo(settings.notion.at, now)}`
            : settings.notion.message,
    },
    { name: aiConfigured() ? `AI model (${aiName()})` : "AI model", ok: e(aiConfigured() && settings.aiEnabled), note: !aiConfigured() ? `Add ${aiMissing()} (briefs fall back to rules)` : settings.aiEnabled ? "On" : "Switched off in Settings" },
    { name: "Phone push", ok: pushConfigured() ? devices.length > 0 : null, note: pushConfigured() ? `${devices.length} device${devices.length === 1 ? "" : "s"}` : "Not configured" },
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-5">
        <PageHeader
          title="Mission Control"
          sub={`Every agent at a glance. Next: ${SLOT_LABEL[next.slot]}, ${next.day === today ? "today" : shortDate(next.day)}.`}
          action={
            <div className="flex flex-wrap items-center gap-3">
              <AutoRefresh seconds={15} />
              <ViewToggle view="dashboard" />
            </div>
          }
        />

        <p className="-mt-2 text-xs text-ink-3 md:hidden">Laid out for an iPad or Mac. On a phone, tap an agent for its details; the live map scrolls sideways.</p>

        <section className="card card-pad flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="h-display font-semibold">2-hour sync</p>
            <p className="text-sm text-ink-2">
              Monday to Saturday, every two hours from 6 AM to 4 PM, every agent reports to the Chief of Staff.{" "}
              {lastSync ? (
                <span className={lastSync.status === "failed" ? "text-bad" : ""}>
                  Last: {timeAgo(lastSync.at, now)} ({lastSync.status}).
                </span>
              ) : (
                "No sync has run yet."
              )}{" "}
              Next: around {hourLabel(sync.hour)}
              {sync.day === today ? "" : `, ${shortDate(sync.day)}`}.
            </p>
            {lastSync?.detail && <p className="mt-1 text-xs text-ink-3">{lastSync.detail}</p>}
          </div>
          <SyncNowButton />
        </section>

        {aiConfigured() && (
          <AiJudgmentCard
            name={aiName()}
            on={aiOn}
            models={activeProvider() === "gemini" ? { writer: geminiModel("writer"), fast: geminiModel("fast") !== geminiModel("writer") ? geminiModel("fast") : null } : null}
            usedToday={aiUsed}
            limit={env().ATLAS_AI_DAILY_LIMIT}
            runs={runs.filter((r) => r.task !== AI_CHECK_TASK)}
            lastCheck={runs.find((r) => r.task === AI_CHECK_TASK) ?? null}
            now={now}
          />
        )}

        <QaCard latest={qaReports[0] ?? null} now={now} />

        {/* On a phone: one row per agent, tapped open for its last result, its AI use and its buttons. */}
        <section className="card divide-y divide-line md:hidden" aria-label="Agents">
          {agents.map(({ a, last, paused, live }) => (
            <details key={a.id} className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
                <Avatar initials={a.initials} color={a.color} size={30} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{a.name}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {!live ? a.role : last ? (
                      <>
                        {timeAgo(last.at, now)} · <span style={{ color: STATUS_COLOR[last.status] }}>{last.status}</span>
                      </>
                    ) : (
                      "No run yet"
                    )}
                  </span>
                </span>
                <AgentPill live={live} paused={paused} step={a.buildStep} />
                <Icon name="chevron" size={16} className="shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
              </summary>
              <div className="flex flex-col gap-3 px-4 pb-4">
                {last?.detail && <p className="break-words text-xs text-ink-3">{last.detail}</p>}
                <AgentWork agent={a} live={live} paused={paused} aiOn={aiOn} />
              </div>
            </details>
          ))}
        </section>

        <section className="hidden gap-4 md:grid lg:grid-cols-3">
          {agents.map(({ a, last, paused, live }) => (
            <div key={a.id} className={`card card-pad flex flex-col gap-3 ${live ? "" : "opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <Avatar initials={a.initials} color={a.color} size={34} />
                  <div>
                    <p className="h-display font-semibold">{a.name}</p>
                    <p className="text-xs text-ink-3">{a.role}</p>
                  </div>
                </div>
                <AgentPill live={live} paused={paused} step={a.buildStep} />
              </div>
              {live && (
                <>
                  <dl className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-ink-3">Last run</dt>
                      <dd className="font-medium">{last ? timeAgo(last.at, now) : "never"}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Result</dt>
                      <dd className="font-medium" style={{ color: last ? STATUS_COLOR[last.status] : undefined }}>
                        {last?.status ?? "–"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Next run</dt>
                      <dd className="font-medium">{next.day === today ? "today" : shortDate(next.day)}</dd>
                    </div>
                  </dl>
                  {last?.detail && (
                    <p className="truncate text-xs text-ink-3" title={last.detail}>
                      {last.detail}
                    </p>
                  )}
                </>
              )}
              <AgentWork agent={a} live={live} paused={paused} aiOn={aiOn} />
            </div>
          ))}
        </section>

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="card card-pad lg:col-span-2">
            <CardHeader title="Live activity" icon="clock" hint="Every task each agent started, finished, failed or skipped. Open a trace to see its steps." />
            {runs.length === 0 ? (
              <Empty>No agent activity yet. The first scheduled brief logs here.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {runs.slice(0, 30).map((r) => (
                  <li key={r.id} className="flex items-start gap-3 py-2 text-sm">
                    <span className="w-16 shrink-0 text-xs text-ink-3">{localTime(new Date(r.at), tz)}</span>
                    <Pill color={STATUS_COLOR[r.status]}>{r.status}</Pill>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{AGENTS.find((x) => x.id === r.agent)?.name}</span> · {r.task}
                      {r.detail && <span className="block truncate text-xs text-ink-3">{r.detail}</span>}
                      {r.trace && r.trace.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-brand">
                            Trace: {r.trace.length} step{r.trace.length === 1 ? "" : "s"}
                          </summary>
                          <ol className="mt-1.5 space-y-1.5 border-l-2 border-line pl-3">
                            {r.trace.map((step, i) => (
                              <li key={i} className="text-xs">
                                <span className="flex items-baseline justify-between gap-3">
                                  <span className={step.ok ? "font-medium" : "font-medium text-bad"}>
                                    {i + 1}. {step.name}
                                  </span>
                                  {step.ms > 0 && <span className="shrink-0 text-ink-3">{took(step.ms)}</span>}
                                </span>
                                {step.note && <span className="block text-ink-2">{step.note}</span>}
                              </li>
                            ))}
                          </ol>
                        </details>
                      )}
                    </span>
                    <span className="shrink-0 text-right text-xs text-ink-3">
                      {typeof r.durationMs === "number" && r.status !== "started" && <span className="block">{took(r.durationMs)}</span>}
                      {r.costUsd > 0 && <span className="block">{usd(r.costUsd)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-5">
            <section className="card card-pad">
              <CardHeader title="Errors & alerts" icon="alert" hint="Last 7 days" />
              {alerts.length === 0 ? (
                <Empty>Nothing failed or was skipped.</Empty>
              ) : (
                <ul className="space-y-2">
                  {alerts.map((r) => (
                    <li key={r.id} className="text-sm">
                      <span className="font-medium" style={{ color: STATUS_COLOR[r.status] }}>
                        {r.status === "failed" ? "Failed" : "Skipped"}
                      </span>{" "}
                      · {r.task} · <span className="text-ink-3">{timeAgo(r.at, now)}</span>
                      {r.detail && <span className="block text-xs text-ink-2">{r.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card card-pad">
              <CardHeader
                title="Agent evals"
                icon="check"
                hint="Each agent's rules scored against labeled cases, right now"
                action={
                  <Link href="/evals" className="btn btn-ghost btn-sm">
                    Open
                  </Link>
                }
              />
              <p className="h-display text-3xl font-medium" style={{ color: evals.ok ? "var(--c-green)" : "var(--c-red)" }}>
                {pct(evals.score)}
              </p>
              <p className="text-xs text-ink-3">
                {evals.passed} of {evals.total} cases pass
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {evals.suites.map((s, i) => (
                  <li key={`${s.agent}:${s.title}`} className="flex justify-between">
                    {/* An agent's second suite (Ask Atlas) goes by its own name. */}
                    <span className="text-ink-2">{evals.suites.findIndex((x) => x.agent === s.agent) === i ? AGENTS.find((a) => a.id === s.agent)?.name : s.title.split(":")[0]}</span>
                    <span style={{ color: s.ok ? undefined : "var(--c-red)" }}>
                      {s.passed}/{s.total}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card card-pad">
              <CardHeader title="Cost today" icon="sparkle" hint="AI model usage, estimated from tokens" />
              <p className="h-display text-3xl font-medium text-brand">{usd(costToday())}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {AGENTS.filter((a) => a.status === "live").map((a) => (
                  <li key={a.id} className="flex justify-between">
                    <span className="text-ink-2">{a.name}</span>
                    <span>{usd(costToday(a.id))}</span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <section className="card card-pad">
            <CardHeader title="Connection health" icon="plug" />
            <ul className="space-y-2">
              {health.map((h) => (
                <li key={h.name} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: h.ok === null ? "var(--c-grey)" : h.ok ? "var(--c-green)" : "var(--c-orange)" }} />
                  <span>
                    <span className="font-medium">{h.name}</span>
                    <span className="block text-xs text-ink-3">{h.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card card-pad">
            <CardHeader title="Job pipeline" icon="jobs" hint={apps.length ? `${Math.round((responded / apps.length) * 100)}% response rate` : "No applications yet"} />
            {apps.length === 0 ? (
              <Empty>No applications yet.</Empty>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {byStage.map((s) => (
                  <li key={s.stage} className="flex justify-between">
                    <span className="text-ink-2">{s.stage}</span>
                    <span className="font-medium">{s.n}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <Link href={APPROVALS_HREF} className="flex justify-between hover:text-brand">
                <span className="text-ink-2">Approval Queue</span>
                <span className="font-medium">{pendingApprovals} waiting</span>
              </Link>
              <p className="flex justify-between">
                <span className="text-ink-2">Job / gig applications</span>
                <span className="font-medium">Semi-Automation</span>
              </p>
            </div>
          </section>

          <section className="card card-pad">
            <CardHeader title="Brief history" icon="news" />
            <form className="mb-3 flex gap-2" action="/mission">
              <input name="q" defaultValue={query} placeholder="Search past briefs" maxLength={80} className="field !min-h-[34px] text-sm" />
              <button className="btn btn-ghost btn-sm">Search</button>
            </form>
            {briefs.length === 0 ? (
              <Empty>{query ? "No brief mentions that." : "Saved briefs appear here after the first run."}</Empty>
            ) : (
              <ul className="space-y-1.5">
                {briefs.map((b) => (
                  <li key={b.id}>
                    <Link href={`/briefs/${b.id}`} className="block rounded-md px-2 py-1.5 hover:bg-surface-2">
                      <span className="text-xs text-ink-3">
                        {shortDate(b.forDate)} · {SLOT_LABEL[b.slot]}
                      </span>
                      <span className="block truncate text-sm font-medium">{b.headline}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <Icon name="shield" size={13} /> Agents only draft and recommend. Nothing irreversible happens without your approval.
        </p>
      </div>
    </div>
  );
}

function e(v: unknown): boolean {
  return Boolean(v);
}

function AgentPill({ live, paused, step }: { live: boolean; paused: boolean; step: number }) {
  return <Pill color={!live ? "var(--c-grey)" : paused ? "var(--c-orange)" : "var(--c-green)"}>{!live ? `Step ${step}` : paused ? "Paused" : "Live"}</Pill>;
}

/** What an agent judges with the AI model (or that it runs on rules), and its Run now and Pause buttons. */
function AgentWork({ agent: a, live, paused, aiOn }: { agent: (typeof AGENTS)[number]; live: boolean; paused: boolean; aiOn: boolean }) {
  if (!live) return <p className="text-xs text-ink-3">Its work runs inside the Chief of Staff until it ships as its own agent.</p>;
  return (
    <>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
        {a.ai ? (
          <>
            <Pill color={aiOn ? "var(--c-purple)" : "var(--c-grey)"}>{aiOn ? `AI: ${aiName()}` : "AI off: rules only"}</Pill>
            <span className="min-w-0 flex-1 basis-40 break-words">{a.ai}</span>
          </>
        ) : (
          <>
            <Pill color="var(--c-grey)">Rules only</Pill>
            <span>Never calls an AI model.</span>
          </>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <RunNowButton agent={a.id} />
        <PauseToggle agent={a.id} paused={paused} />
      </div>
      {/* The Mentor with fresh data from the Scout, your job emails and the Analyst. */}
      {a.id === "mentor" && <RefreshMentorButton />}
    </>
  );
}
