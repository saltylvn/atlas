"use client";

import { useEffect, useMemo, useState } from "react";
import { DATA_MAP_SIZE, REPLAY, type DataEdge, type DataHue, type DataNode, type DataState } from "@/lib/domain/dataMap";
import type { LiveSnapshot } from "@/lib/domain/orchestration";
import { Icon } from "../Icon";

/** Atlas's palette (the same as Mission Control's): what each box is. */
export const HUE: Record<DataHue, string> = { career: "var(--c-career)", data: "var(--c-data)", ai: "var(--c-ai)", system: "var(--c-system)" };
const HUE_KEY: readonly [DataHue, string][] = [
  ["system", "Sources and connectors"],
  ["career", "Career bot and pages"],
  ["data", "Cleaning and stored data"],
  ["ai", "AI judgment (Gemini)"],
];
const STATE_COLOR: Record<DataState, string> = { ok: "var(--c-green)", idle: "var(--c-grey)", off: "var(--c-grey)", down: "var(--c-warn)", none: "var(--c-grey)" };
const STATE_WORD: Record<DataState, string> = { ok: "answering", idle: "idle by design", off: "off", down: "did not answer", none: "no run yet" };
const COLUMNS: [string, number][] = [
  ["Sources", 110],
  ["Bot", 360],
  ["Clean", 600],
  ["Stored", 850],
  ["Shown", 1100],
];
const POLL_MS = 10_000;

/** A curve from the right edge of one box to the left edge of the next. */
function path(a: DataNode, b: DataNode): string {
  const x1 = a.x + a.w / 2;
  const x2 = b.x - b.w / 2;
  const mid = (x1 + x2) / 2;
  return `M${x1},${a.y} C${mid},${a.y} ${mid},${b.y} ${x2},${b.y}`;
}

interface Frame {
  title: string;
  nodes: Set<string>;
}

export function DataMap({ nodes, edges, maxFlow }: { nodes: DataNode[]; edges: DataEdge[]; maxFlow: number }) {
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const [focus, setFocus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [frame, setFrame] = useState(0);

  // Live: while the map is on screen, ask every 10 seconds whether the Scout is running.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/mission/live", { cache: "no-store" });
        if (!r.ok) return;
        const snap = (await r.json()) as LiveSnapshot;
        if (stop) return;
        setRunning(snap.agents.some((a) => a.agent === "scout" && a.state === "running"));
      } catch {
        // The map stays as it was; the next tick tries again.
      }
    };
    void tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  // Replay: the last Scout run, step by step.
  useEffect(() => {
    if (!frames) return;
    // The last frame ends the replay; any other moves on to the next.
    const t = setTimeout(() => (frame + 1 >= frames.length ? setFrames(null) : setFrame(frame + 1)), 1800);
    return () => clearTimeout(t);
  }, [frames, frame]);

  // The live feed carries no step details (they stay off screens by default), so the replay walks
  // the Scout's stages in the order its code runs them, with the last run's counts on each box.
  const replay = () => {
    const out: Frame[] = REPLAY.map((r) => ({ title: r.title, nodes: new Set(r.nodes === "sources" ? ["scout", ...nodes.filter((n) => n.kind === "source" && n.state === "ok").map((n) => n.id)] : r.nodes) }));
    setFrame(0);
    setFrames(out);
  };

  const lit: Set<string> = frames && frame < frames.length ? frames[frame]!.nodes : running ? new Set(["scout", ...nodes.filter((n) => n.kind === "source" && n.state === "ok").map((n) => n.id)]) : new Set();
  const near = focus ? new Set([focus, ...edges.filter((e) => e.from === focus || e.to === focus).flatMap((e) => [e.from, e.to])]) : null;
  const focused = focus ? byId.get(focus) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={replay} disabled={!!frames}>
          <Icon name="refresh" size={14} /> Replay the last run
        </button>
        <p role="status" aria-live="polite" className="text-sm text-ink-2">
          {frames && frame < frames.length ? `${frame + 1}/${frames.length} · ${frames[frame]!.title}` : running ? "The Scout is reading the sources now." : "Line width follows the postings in the last run. Select a box for its details."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-2" aria-label="What the colors mean">
        {HUE_KEY.map(([h, label]) => (
          <span key={h} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 rounded-[4px] border-2" style={{ borderColor: HUE[h] }} />
            {label}
          </span>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <svg viewBox={`0 0 ${DATA_MAP_SIZE.w} ${DATA_MAP_SIZE.h}`} className="block w-full min-w-[56rem]" role="group" aria-label="Data Map: job sources feed the Scout, which cleans and stores the postings that the Market page and Mission Control show">
          {COLUMNS.map(([label, x]) => (
            <text key={label} x={x} y={28} textAnchor="middle" fontSize={12} className="fill-ink-3" style={{ letterSpacing: "0.08em" }}>
              {label.toUpperCase()}
            </text>
          ))}
          {edges.map((e) => {
            const a = byId.get(e.from);
            const b = byId.get(e.to);
            if (!a || !b) return null;
            const on = lit.has(e.from) && lit.has(e.to);
            const dim = near ? !(near.has(e.from) && near.has(e.to)) : false;
            const width = e.flow === null ? 1.5 : 1.5 + 14 * (e.flow / maxFlow);
            return (
              <g key={e.id} opacity={dim ? 0.25 : 1} style={{ transition: "opacity 300ms" }}>
                <path d={path(a, b)} fill="none" strokeWidth={width} strokeLinecap="round" strokeDasharray={e.dashed ? "6 6" : undefined} className={on ? "map-flow" : undefined} style={{ stroke: on ? "var(--brand)" : "var(--line-strong)", opacity: e.flow === 0 ? 0.35 : 0.9 }}>
                  <title>{`${a.label} → ${b.label}${e.flow !== null ? `: ${e.flow.toLocaleString()} postings` : ""}${e.label ? ` (${e.label})` : ""}`}</title>
                </path>
              </g>
            );
          })}
          {nodes.map((n) => {
            const on = lit.has(n.id);
            const dim = near ? !near.has(n.id) : false;
            const off = n.state === "off";
            return (
              <g
                key={n.id}
                transform={`translate(${n.x - n.w / 2} ${n.y - n.h / 2})`}
                opacity={dim ? 0.3 : off ? 0.55 : 1}
                style={{ transition: "opacity 300ms", cursor: "pointer" }}
                role="button"
                tabIndex={0}
                aria-pressed={focus === n.id}
                aria-label={`${n.label}: ${n.count || n.sub}. ${STATE_WORD[n.state]}. Show details`}
                className="outline-none focus-visible:[&>rect:first-child]:stroke-[3]"
                onClick={() => setFocus((f) => (f === n.id ? null : n.id))}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter" || ev.key === " ") {
                    ev.preventDefault();
                    setFocus((f) => (f === n.id ? null : n.id));
                  }
                }}
              >
                <rect width={n.w} height={n.h} rx={12} strokeWidth={on || focus === n.id ? 2.75 : 2} strokeDasharray={off || n.state === "idle" || n.kind === "benchmark" ? "5 4" : undefined} style={{ fill: on ? "color-mix(in oklab, var(--brand) 10%, var(--surface))" : `color-mix(in oklab, ${HUE[n.hue]} 6%, var(--surface))`, stroke: on || focus === n.id ? "var(--brand)" : HUE[n.hue], transition: "fill 300ms, stroke 300ms" }} />
                <text x={12} y={n.h / 2 - (n.sub ? 9 : 2)} fontSize={n.kind === "bot" ? 17 : 13.5} fontWeight={600} className="fill-ink">
                  {n.label.length > 24 ? `${n.label.slice(0, 23)}…` : n.label}
                </text>
                {n.count && (
                  <text x={12} y={n.h / 2 + (n.sub ? 7 : 14)} fontSize={12} fontWeight={500} className="fill-ink-2">
                    {n.count}
                  </text>
                )}
                {n.sub && (
                  <text x={12} y={n.h / 2 + (n.count ? 21 : 7)} fontSize={10.5} className="fill-ink-3">
                    {n.sub.length > 32 ? `${n.sub.slice(0, 31)}…` : n.sub}
                  </text>
                )}
                {n.who && (
                  <text x={n.w - 10} y={n.h - 9} textAnchor="end" fontSize={10} fontWeight={600} style={{ fill: `color-mix(in oklab, ${HUE[n.hue]} 48%, var(--ink))`, letterSpacing: "0.04em" }}>
                    {n.who.toUpperCase()}
                  </text>
                )}
                {n.kind !== "view" && <circle cx={n.w - 12} cy={12} r={4.5} style={{ fill: n.state === "off" || n.state === "none" ? "var(--surface)" : STATE_COLOR[n.state], stroke: STATE_COLOR[n.state] }} strokeWidth={1.5} className={on && n.kind === "bot" ? "animate-pulse motion-reduce:animate-none" : undefined} />}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="card card-pad" aria-live="polite">
        {focused ? (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="h-display font-medium">{focused.label}</p>
              <button type="button" className="btn btn-ghost btn-sm min-h-11" onClick={() => setFocus(null)}>
                <Icon name="x" size={14} /> Clear
              </button>
            </div>
            <dl className="mt-2 divide-y divide-line text-sm">
              {[...(focused.count ? ([["Now", focused.count]] as [string, string][]) : []), ...focused.facts].map(([k, v]) => (
                <div key={k} className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3 py-2">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="text-sm text-ink-2">Select any box: the rest of the map dims, and this panel says what it holds, how the last run went and where it goes next.</p>
        )}
      </div>
    </div>
  );
}
