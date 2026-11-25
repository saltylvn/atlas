import Link from "next/link";
import { LiveEval } from "@/components/client/LiveEval";
import { embeddingsConfigured } from "@/lib/ai/embeddings";
import { getContext } from "@/lib/context";
import { LIVE_EVAL_TASK } from "@/lib/knowledge/liveEval";
import { AGENTS } from "@/lib/domain/agents";
import { localTime, shortDate, localDate } from "@/lib/domain/dates";
import { EVAL_TASK, pct, runEvals } from "@/lib/evals";
import { Avatar, CardHeader, Empty, Meter, PageHeader, Pill } from "@/components/ui";

export const metadata = { title: "Evals" };
// The live retrieval eval embeds its texts one small request at a time.
export const maxDuration = 60;

const GOOD = "var(--c-green)";
const WARN = "var(--c-warn)";
const BAD = "var(--c-red)";

/**
 * "How do you know your agents are working?" Every agent's rules, scored right now
 * against its labeled cases, with each miss shown and the daily history from the
 * activity log. The same suites run in CI on every pull request.
 */
export default async function EvalsPage() {
  const { store, now, settings, mode } = await getContext();
  const tz = settings.timezone;
  const report = runEvals();
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const runs = await store.agentRuns.since(since).catch(() => []);
  const history = runs.filter((r) => r.task === EVAL_TASK).slice(0, 30);
  const live = runs.filter((r) => r.task === LIVE_EVAL_TASK && r.status !== "started").slice(0, 5);
  const gaps = report.suites.reduce((n, s) => n + s.failures.length, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Evals"
        sub={`How Atlas knows its agents are working: ${report.total} labeled cases in ${report.suites.length} suites across ${new Set(report.suites.map((s) => s.agent)).size} agents, scored against the live rules just now in ${report.tookMs} ms. No model call, $0.`}
        action={
          <Link href="/mission?view=dashboard" className="btn btn-ghost btn-sm">
            Mission Control
          </Link>
        }
      />

      <section className="card card-pad">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Overall</p>
            <p className="h-display text-4xl font-medium" style={{ color: report.ok ? GOOD : BAD }}>
              {pct(report.score)}
            </p>
            <p className="text-sm text-ink-2">
              {report.passed} of {report.total} cases pass · {gaps === 0 ? "no misses" : `${gaps} known gap${gaps === 1 ? "" : "s"}`}
            </p>
          </div>
          <Pill color={report.ok ? GOOD : BAD}>{report.ok ? "Every bot meets its bar" : "A bot is below its bar"}</Pill>
        </div>
        <ul className="mt-4 grid gap-x-6 gap-y-1 text-sm text-ink-2 sm:grid-cols-3">
          <li>
            <span className="font-medium text-ink">Every pull request.</span> CI runs these suites; a score below a bot&apos;s bar fails the build.
          </li>
          <li>
            <span className="font-medium text-ink">Every morning.</span> The scores are logged before the brief, so a drop shows in Errors &amp; alerts.
          </li>
          <li>
            <span className="font-medium text-ink">Every miss is written down.</span> A case the rules get wrong stays here with the reason.
          </li>
        </ul>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {report.suites.map((s) => {
          const a = AGENTS.find((x) => x.id === s.agent)!;
          const color = !s.ok ? BAD : s.score === 1 ? GOOD : WARN;
          return (
            <section key={`${s.agent}:${s.title}`} className="card card-pad">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Avatar initials={a.initials} color={a.color} size={34} />
                  <div>
                    <p className="h-display font-semibold">{a.name}</p>
                    <p className="text-xs text-ink-3">{s.title}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="h-display text-2xl font-semibold" style={{ color }}>
                    {pct(s.score)}
                  </p>
                  <p className="text-xs text-ink-3">
                    {s.passed}/{s.total} · bar {pct(s.threshold)}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <Meter value={s.passed} max={s.total} color={color} />
              </div>
              <p className="mt-3 text-sm text-ink-2">{s.what}</p>
              {s.failures.length === 0 ? (
                <p className="mt-3 text-xs text-ink-3">Every case passes.</p>
              ) : (
                <ul className="mt-3 space-y-3 border-t border-line pt-3">
                  {s.failures.map((f) => (
                    <li key={f.name} className="text-sm">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <Pill color={f.knownGap ? WARN : BAD}>{f.knownGap ? "Known gap" : "Failing"}</Pill>
                        <span className="font-medium">{f.name}</span>
                      </div>
                      <p className="mt-1 text-xs text-ink-2">
                        Should be <span className="font-semibold text-ink">{f.expected}</span>, the rules say <span className="font-semibold text-ink">{f.actual}</span>.
                      </p>
                      {f.knownGap && <p className="mt-0.5 text-xs text-ink-3">{f.knownGap}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <section className="card card-pad">
        <CardHeader title="Ask Atlas on live embeddings" icon="sparkle" hint="The same fictional questions, embedded by the real model: keyword, meaning and hybrid search scored side by side. None of your data is read." />
        <LiveEval available={mode === "live" && embeddingsConfigured()} />
        {live.length > 0 && (
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {live.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span className="w-28 shrink-0 text-xs text-ink-3">
                  {shortDate(localDate(new Date(r.at), tz))} · {localTime(new Date(r.at), tz)}
                </span>
                <Pill color={r.status === "succeeded" ? GOOD : BAD}>{r.status === "succeeded" ? "Scored" : "Did not finish"}</Pill>
                <span className="min-w-0 flex-1 text-ink-2">{r.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card card-pad">
        <CardHeader title="Daily history" icon="clock" hint="Logged before each morning brief. Scores only change when the rules or the cases change." />
        {history.length === 0 ? (
          <Empty>The first daily score is logged before the next morning brief.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {history.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span className="w-28 shrink-0 text-xs text-ink-3">
                  {shortDate(localDate(new Date(r.at), tz))} · {localTime(new Date(r.at), tz)}
                </span>
                <Pill color={r.status === "succeeded" ? GOOD : BAD}>{r.status === "succeeded" ? "Met every bar" : "Below a bar"}</Pill>
                <span className="min-w-0 flex-1 text-ink-2">{r.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-ink-3">
        The cases live in <code>lib/evals/suites</code>, one file per bot. Run them yourself with <code>npm run evals</code>. Each run of an agent is also traced step by step in{" "}
        <Link href="/mission" className="text-brand">
          Mission Control
        </Link>
        .
      </p>
    </div>
  );
}
