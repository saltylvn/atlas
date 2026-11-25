import { hourLabel } from "@/lib/domain/briefSchedule";
import { KIND_COLOR, KINDS } from "@/lib/domain/registry";
import { DAY_WINDOW, position, type DayTimeline as Timeline, type Lane, type RunMark } from "@/lib/domain/timeline";
import type { RunStatus } from "@/lib/domain/types";
import { KindPill } from "./KindBadges";

const STATUS: Record<RunStatus, { color: string; word: string }> = {
  started: { color: "var(--c-indigo)", word: "running" },
  succeeded: { color: "var(--c-green)", word: "finished" },
  failed: { color: "var(--c-red)", word: "failed" },
  skipped: { color: "var(--c-warn)", word: "skipped" },
};

const clock = (m: number) => {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const HOURS = Array.from({ length: (DAY_WINDOW.to - DAY_WINDOW.from) / 120 + 1 }, (_, i) => DAY_WINDOW.from / 60 + i * 2);

function Mark({ run }: { run: RunMark }) {
  const left = position(run.start);
  const width = Math.max(0.6, position(run.end) - left);
  const s = STATUS[run.status];
  const label = `${run.task}: ${s.word}, ${clock(run.start)}${run.end > run.start ? ` to ${clock(run.end)}` : ""}${run.trigger === "schedule" ? "" : " (you started it)"}`;
  return (
    <span
      title={label}
      className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-full ${run.status === "started" ? "animate-pulse" : ""}`}
      style={{ left: `${left}%`, width: `max(${width}%, 8px)`, background: s.color, outline: run.trigger === "schedule" ? undefined : "2px solid var(--ink)", outlineOffset: 1 }}
    />
  );
}

function Row({ lane, now }: { lane: Lane; now: number | null }) {
  const missed = lane.planned.filter((p) => now !== null && p + 30 < now && !lane.runs.some((r) => Math.abs(r.start - p) <= 60));
  return (
    <li className="grid grid-cols-[9.5rem_minmax(0,1fr)] items-center gap-3 py-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[lane.kind] }} />
        <span className="truncate text-sm">{lane.label}</span>
      </span>
      <span className="relative block h-7 rounded-md bg-surface-2">
        {lane.band && (
          <span
            title={`Planned every ${lane.band.everyMinutes} minutes, ${clock(lane.band.from)} to ${clock(lane.band.to)}`}
            className="absolute inset-y-1.5 rounded-sm border border-dashed"
            style={{ left: `${position(lane.band.from)}%`, width: `${position(lane.band.to) - position(lane.band.from)}%`, borderColor: `color-mix(in oklab, ${KIND_COLOR.workflow} 45%, transparent)` }}
          />
        )}
        {lane.planned.map((p) => (
          <span
            key={p}
            title={`Planned ${clock(p)}${missed.includes(p) ? ": no run logged" : ""}`}
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface"
            style={{ left: `${position(p)}%`, borderColor: missed.includes(p) ? "var(--c-red)" : `color-mix(in oklab, ${KIND_COLOR.workflow} 70%, var(--ink))` }}
          />
        ))}
        {lane.runs.map((r) => (
          <Mark key={r.runId} run={r} />
        ))}
      </span>
      {/* For screen readers: the lane as a sentence. */}
      <span className="sr-only">
        {`${lane.label}, ${KINDS[lane.kind].label}. `}
        {lane.planned.length ? `Planned at ${lane.planned.map(clock).join(", ")}. ` : ""}
        {lane.runs.length ? lane.runs.map((r) => `${r.task} ${STATUS[r.status].word} at ${clock(r.start)}`).join("; ") : "No runs today."}
      </span>
    </li>
  );
}

/** Mission Control's third view: today, 6 AM to 10 PM, planned against what actually ran. */
export function DayTimeline({ timeline }: { timeline: Timeline }) {
  const { lanes, now, totals } = timeline;
  const workflows = lanes.filter((l) => l.kind === "workflow" && !l.agent);
  const bots = lanes.filter((l) => l.agent);
  return (
    <div className="space-y-4">
      <section className="card card-pad flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span>
          <b className="font-medium">{totals.runs}</b> <span className="text-ink-3">runs today</span>
        </span>
        <span>
          <b className="font-medium" style={{ color: totals.failed ? "var(--c-red)" : undefined }}>
            {totals.failed}
          </b>{" "}
          <span className="text-ink-3">failed</span>
        </span>
        <span>
          <b className="font-medium">{totals.planned}</b> <span className="text-ink-3">scheduled workflow runs</span>
        </span>
        <span className="flex flex-wrap items-center gap-3 text-xs text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border-2 bg-surface" style={{ borderColor: KIND_COLOR.workflow }} /> Planned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border-2 bg-surface" style={{ borderColor: "var(--c-red)" }} /> Planned, no run
          </span>
          {(["succeeded", "failed", "skipped", "started"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-full" style={{ background: STATUS[s].color }} /> {STATUS[s].word[0]!.toUpperCase() + STATUS[s].word.slice(1)}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 rounded-full bg-ink-3" style={{ outline: "2px solid var(--ink)", outlineOffset: 1 }} /> You started it
          </span>
        </span>
      </section>

      <section className="card card-pad overflow-x-auto" aria-label="Today's timeline">
        <div className="min-w-[44rem]">
          <div className="grid grid-cols-[9.5rem_minmax(0,1fr)] gap-3 pb-1">
            <span />
            <span className="relative block h-5 text-xs text-ink-3">
              {HOURS.map((h) => (
                <span key={h} className="absolute -translate-x-1/2" style={{ left: `${position(h * 60)}%` }}>
                  {hourLabel(h)}
                </span>
              ))}
            </span>
          </div>
          <div className="relative">
            {/* Hour lines and the "now" line, behind every lane. */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-[calc(9.5rem+0.75rem)]">
              {HOURS.map((h) => (
                <span key={h} className="absolute inset-y-0 w-px bg-line" style={{ left: `${position(h * 60)}%` }} />
              ))}
              {now !== null && now >= DAY_WINDOW.from && now <= DAY_WINDOW.to && (
                <span className="absolute inset-y-0 z-10 w-0.5 bg-ink" style={{ left: `${position(now)}%` }} title={`Now, ${clock(now)}`} />
              )}
            </div>
            <div className="mb-1 flex items-center gap-2">
              <KindPill kind="workflow" />
              <span className="text-xs text-ink-3">{KINDS.workflow.definition}</span>
            </div>
            <ul>
              {workflows.map((l) => (
                <Row key={l.id} lane={l} now={now} />
              ))}
            </ul>
            <div className="mt-3 mb-1 flex items-center gap-2">
              <KindPill kind="bot" />
              <span className="text-xs text-ink-3">Every run each bot logged, including the ones a workflow started.</span>
            </div>
            <ul>
              {bots.map((l) => (
                <Row key={l.id} lane={l} now={now} />
              ))}
            </ul>
          </div>
        </div>
      </section>
      <p className="text-xs text-ink-3">Hover or long-press a mark for its task and times. Read from the activity log; nothing here is estimated.</p>
    </div>
  );
}
