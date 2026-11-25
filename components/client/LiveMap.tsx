"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { syncNow } from "@/app/actions/agents";
import { AGENTS, agent as profile, aiUse } from "@/lib/domain/agents";
import { AI_USE, KIND_COLOR, KINDS, REACH, TRIGGER } from "@/lib/domain/registry";
import {
  ago,
  framesFor,
  liveHighlights,
  MAP_EDGES,
  MAP_GROUPS,
  MAP_LABELS,
  MAP_NODES,
  MAP_SIZE,
  MCP_NODE,
  MODEL_NODE,
  node,
  NODE_FACTS,
  pollDelay,
  related,
  route,
  STATE_WORD,
  took,
  type Frame,
  type LiveRun,
  type LiveSnapshot,
  type MapNode,
  type NodeState,
  type Point,
} from "@/lib/domain/orchestration";
import { Icon } from "../Icon";

// Mission Control's live map: the orchestration drawn as boxes and lines, lit up by the
// activity log. It asks Atlas for a fresh snapshot every few seconds while it is on
// screen (the browser only ever talks to Atlas itself), and can replay the last run
// step by step at a speed you can follow. Display mode fills the screen and keeps it
// awake, for an iPad or a second monitor.

const STATE_COLOR: Record<NodeState, string> = {
  idle: "var(--c-grey)",
  running: "var(--c-indigo)",
  ok: "var(--c-green)",
  failed: "var(--c-red)",
  skipped: "var(--c-warn)",
  stalled: "var(--c-warn)",
  paused: "var(--c-grey)",
};
const RUN_STATE: Record<LiveRun["status"], NodeState> = { started: "running", succeeded: "ok", failed: "failed", skipped: "skipped", stalled: "stalled" };
const ACTIVE = "var(--c-indigo)";

// ---- drawing ----

/** A line through its corners, with the corners rounded. */
function pathOf(points: readonly Point[], r = 12): string {
  const [x0, y0] = points[0]!;
  let d = `M ${x0} ${y0}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1]!;
    const [x, y] = points[i]!;
    const [nx, ny] = points[i + 1]!;
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    if (inLen === 0 || outLen === 0) continue;
    const k = Math.min(r, inLen / 2, outLen / 2);
    d += ` L ${x - ((x - px) / inLen) * k} ${y - ((y - py) / inLen) * k} Q ${x} ${y} ${x + ((nx - x) / outLen) * k} ${y + ((ny - y) / outLen) * k}`;
  }
  const [xl, yl] = points.at(-1)!;
  return `${d} L ${xl} ${yl}`;
}

const EDGE_PATHS = MAP_EDGES.map((e) => ({ edge: e, d: pathOf(route(e)) }));
const RELATED = new Map(MAP_NODES.map((n) => [n.id, new Set(related(n.id))]));

/** The AI model's color on the map: a judgment made by the model, not by rules. */
const AI_COLOR = "var(--c-ai)";
/** Text in the AI color: its deeper shade, readable on the light map. */
const AI_INK = "var(--c-ai-ink)";
/** The Claude connector (MCP) layer's highlight. */
const CONNECTOR = "var(--c-connector)";
/** The color each outlined part of the map wears. Parts not listed keep a plain grey line. */
const GROUP_COLOR: Readonly<Record<string, string>> = {
  "daily-desk": "var(--c-daily)",
  "career-desk": "var(--c-career)",
  acts: "var(--c-career)",
  quality: "var(--c-qa)",
  agents: "var(--c-ai)",
  sources: CONNECTOR,
  connector: CONNECTOR,
};
/** The palette's key under the map, in the order of the sidebar. */
const PALETTE_KEY: readonly [string, string][] = [
  ["Daily", "var(--c-daily)"],
  ["Career", "var(--c-career)"],
  ["System, connectors, MCP", "var(--c-system)"],
  ["Data", "var(--c-data)"],
  ["QA", "var(--c-qa)"],
  ["AI", "var(--c-ai)"],
];

export interface MapAi {
  name: string;
  on: boolean;
  /** The writing model and its fast fallback, when the provider has both. */
  writer?: string;
  fast?: string;
}

function Box({
  n,
  state,
  line,
  sub,
  lit,
  dim,
  focused,
  color,
  ai,
  calls,
  onSelect,
}: {
  n: MapNode;
  state: NodeState | null;
  line: string;
  sub: string;
  lit: boolean;
  dim: boolean;
  focused: boolean;
  color: string;
  ai: MapAi | null;
  calls: { used: number; limit: number } | undefined;
  onSelect: () => void;
}) {
  const isAgent = n.kind === "agent" || n.kind === "orchestrator";
  const big = n.kind === "orchestrator";
  const p = n.agent ? profile(n.agent) : null;
  // Outside Atlas: the sources, the AI model, Claude and Supabase Auth get a dashed border.
  const outside = n.kind === "source" || n.kind === "model" || n.kind === "client";
  const aiBox = n.kind === "model" || !!p?.ai;
  const tint = aiBox && ai?.on ? AI_COLOR : null;
  const hot = lit || focused;
  // Every connector and MCP component wears an orange outline: sources, Claude, Supabase Auth, the MCP server and its data.
  const connector = n.kind === "source" || n.kind === "client" || n.kind === "connector";
  const stroke = hot ? color : n.kind === "model" && ai?.on ? AI_COLOR : connector ? CONNECTOR : state && state !== "idle" && state !== "paused" ? STATE_COLOR[state] : "var(--line-strong)";
  const fill = hot ? `color-mix(in oklab, ${color} 9%, var(--surface))` : tint ? `color-mix(in oklab, ${tint} 6%, var(--surface))` : "var(--surface)";
  return (
    <g
      transform={`translate(${n.x - n.w / 2} ${n.y - n.h / 2})`}
      opacity={dim ? 0.3 : 1}
      style={{ transition: "opacity 300ms", cursor: "pointer" }}
      role="button"
      tabIndex={0}
      aria-pressed={focused}
      aria-label={`${n.kind === "model" ? (ai?.name ?? "AI model") : n.label}: show what it reads, judges and writes`}
      className="outline-none"
      onClick={(ev) => {
        ev.stopPropagation();
        onSelect();
      }}
      onKeyDown={(ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          onSelect();
        }
      }}
    >
      {hot && <rect className="map-halo" x={-6} y={-6} width={n.w + 12} height={n.h + 12} rx={19} fill="none" strokeWidth={5} style={{ stroke: color }} />}
      <rect
        width={n.w}
        height={n.h}
        rx={14}
        strokeWidth={hot ? 2.5 : connector ? 2.5 : 1.5}
        strokeDasharray={state === "paused" || outside ? "6 5" : undefined}
        style={{ fill, stroke, transition: "fill 300ms, stroke 300ms" }}
      />
      {n.kind === "model" ? (
        <>
          <text x={18} y={32} fontSize={18} fontWeight={650} style={{ fill: ai?.on ? AI_INK : "var(--ink-3)" }}>
            ✦ {ai?.name ?? "AI model"}
          </text>
          {ai ? (
            <>
              <text x={18} y={62} fontSize={13} className="fill-ink-2">
                {ai.writer ?? `${ai.name} models`}
              </text>
              {ai.fast && (
                <text x={18} y={84} fontSize={13} className="fill-ink-3">
                  Falls back to {ai.fast.replace(/^gemini-/, "")}
                </text>
              )}
              <text x={18} y={ai.fast ? 112 : 90} fontSize={13} fontWeight={600} style={{ fill: ai.on ? AI_INK : "var(--ink-3)" }}>
                {!ai.on ? "Off: bots use rules" : calls ? `Today: ${calls.used} of ${calls.limit} calls` : "Connected"}
              </text>
              <text x={18} y={ai.fast ? 136 : 114} fontSize={12} className="fill-ink-3">
                {n.sub}
              </text>
            </>
          ) : (
            <text x={18} y={62} fontSize={13} className="fill-ink-3">
              Not set up: every bot uses rules
            </text>
          )}
        </>
      ) : isAgent && p ? (
        <>
          <circle cx={big ? 42 : 34} cy={n.h / 2} r={big ? 24 : 19} style={{ fill: `color-mix(in oklab, ${p.color} 20%, var(--surface))`, stroke: p.color }} strokeWidth={1.5} />
          <text x={big ? 42 : 34} y={n.h / 2 + (big ? 5.5 : 4.5)} textAnchor="middle" fontSize={big ? 15 : 12.5} fontWeight={700} style={{ fill: p.color }}>
            {p.initials}
          </text>
          <text x={big ? 80 : 63} y={n.h / 2 - (big ? 12 : 11)} fontSize={big ? 20 : 16} fontWeight={650} className="fill-ink">
            {n.label}
          </text>
          <text x={big ? 80 : 63} y={n.h / 2 + (big ? 10 : 8)} fontSize={big ? 14 : 12.5} style={{ fill: hot ? color : state ? STATE_COLOR[state] : "var(--ink-3)" }} fontWeight={600}>
            {line}
          </text>
          <text x={big ? 80 : 63} y={n.h / 2 + (big ? 29 : 26)} fontSize={big ? 12.5 : 11.5} className="fill-ink-3">
            {sub}
          </text>
          {/* Its kind, in the same hue as everywhere else in Atlas: Workflow, Bot or Agent. */}
          <g transform={`translate(${big ? n.w - 164 : n.w - 62} ${big ? 10 : 8})`}>
            <title>{KINDS[p.kind].definition}</title>
            <rect width={big ? 70 : 46} height={big ? 22 : 18} rx={big ? 11 : 9} style={{ fill: `color-mix(in oklab, ${KIND_COLOR[p.kind]} 13%, var(--surface))`, stroke: `color-mix(in oklab, ${KIND_COLOR[p.kind]} 35%, transparent)` }} strokeWidth={1} />
            <text x={big ? 35 : 23} y={big ? 15 : 12.5} textAnchor="middle" fontSize={big ? 11.5 : 10} fontWeight={600} style={{ fill: `color-mix(in oklab, ${KIND_COLOR[p.kind]} 48%, var(--ink))` }}>
              {KINDS[p.kind].label}
            </text>
          </g>
          {/* Live status: done, working or idle, at a glance. */}
          {state && <circle cx={n.w - 16} cy={n.h - 16} r={5} className={state === "running" ? "animate-pulse" : ""} style={{ fill: STATE_COLOR[state] }} />}
          {/* The agents whose judgment comes from the AI model. Grey when the model is off: they run on rules. */}
          {p.ai && ai &&
            (big ? (
              <g transform={`translate(${n.w - 84} 10)`}>
                <title>{ai.on ? `${ai.name}: ${p.ai}` : `AI is off, so this bot runs on rules. With it on: ${p.ai}`}</title>
                <rect width={74} height={22} rx={11} style={{ fill: ai.on ? `color-mix(in oklab, ${AI_COLOR} 18%, var(--surface))` : "var(--surface-2)", stroke: ai.on ? AI_COLOR : "var(--line-strong)" }} strokeWidth={1} />
                <text x={37} y={15} textAnchor="middle" fontSize={11.5} fontWeight={700} style={{ fill: ai.on ? AI_INK : "var(--ink-3)" }}>
                  ✦ {ai.name}
                </text>
              </g>
            ) : (
              // A small mark on the box's corner, so it never covers the agent's name.
              <g transform={`translate(${n.w - 2} 2)`}>
                <title>{ai.on ? `${ai.name}: ${p.ai}` : `AI is off, so this bot runs on rules. With it on: ${p.ai}`}</title>
                <circle r={10} style={{ fill: ai.on ? AI_COLOR : "var(--surface-2)", stroke: ai.on ? AI_COLOR : "var(--line-strong)" }} strokeWidth={1.5} />
                <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} style={{ fill: ai.on ? "var(--ink)" : "var(--ink-3)" }}>
                  ✦
                </text>
              </g>
            ))}
        </>
      ) : (
        <>
          <text x={16} y={26} fontSize={15} fontWeight={650} className="fill-ink">
            {n.label}
          </text>
          <text x={16} y={45} fontSize={11.5} style={{ fill: state && state !== "idle" ? STATE_COLOR[state] : "var(--ink-3)" }} fontWeight={state && state !== "idle" ? 600 : 400}>
            {sub}
          </text>
          {/* What starts a run: an automation (a schedule that fires on its own) or you. */}
          {n.kind === "trigger" && (
            <g transform={`translate(${n.w - 92} 8)`}>
              <title>{n.id === "trigger-you" ? "You press a button; nothing here runs on its own." : "An automation: a schedule (Vercel Cron) that starts a workflow on its own."}</title>
              <rect width={84} height={18} rx={9} style={{ fill: "var(--surface-2)", stroke: "var(--line-strong)" }} strokeWidth={1} />
              <text x={42} y={12.5} textAnchor="middle" fontSize={10} fontWeight={600} className="fill-ink-2">
                {n.id === "trigger-you" ? "Manual" : "Automation"}
              </text>
            </g>
          )}
          {/* Atlas's agents carry the Agent badge, in the same hue as everywhere else. */}
          {n.kind === "loop" && (
            <g transform={`translate(${n.w - 82} 8)`}>
              <title>{KINDS.agent.definition}</title>
              <rect width={46} height={18} rx={9} style={{ fill: `color-mix(in oklab, ${KIND_COLOR.agent} 13%, var(--surface))`, stroke: `color-mix(in oklab, ${KIND_COLOR.agent} 35%, transparent)` }} strokeWidth={1} />
              <text x={23} y={12.5} textAnchor="middle" fontSize={10} fontWeight={600} style={{ fill: `color-mix(in oklab, ${KIND_COLOR.agent} 48%, var(--ink))` }}>
                {KINDS.agent.label}
              </text>
            </g>
          )}
          {/* Live status for boxes that have one (the agents, the MCP server): working, done, failed or off. */}
          {state && <circle cx={n.w - 14} cy={14} r={5} className={state === "running" ? "animate-pulse" : ""} style={{ fill: STATE_COLOR[state] }} />}
        </>
      )}
    </g>
  );
}

// ---- the "show details" choice, remembered on this device ----

const DETAIL_KEY = "atlas.map.detail";
const listeners = new Set<() => void>();
let fallback = false;
function readDetail(): boolean {
  try {
    const v = window.localStorage.getItem(DETAIL_KEY);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}
function writeDetail(on: boolean) {
  fallback = on;
  try {
    window.localStorage.setItem(DETAIL_KEY, on ? "1" : "0");
  } catch {
    // Private windows can refuse storage; the choice then lasts until the page closes.
  }
  listeners.forEach((l) => l());
}
function subscribeDetail(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

// ---- the component ----

interface Replay {
  frames: Frame[];
  i: number;
  /** True when Atlas started it because a run finished between two looks. */
  auto: boolean;
}

export function LiveMap({ initial, ai = null }: { initial: LiveSnapshot; /** The AI model behind the agents marked ✦, or null when none is set up. */ ai?: MapAi | null }) {
  const [snap, setSnap] = useState(initial);
  /** The box you selected: the rest of the map dims, and the panel under it says what that box does. */
  const [focus, setFocus] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.parse(initial.at));
  const [clock, setClock] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [replay, setReplay] = useState<Replay | null>(null);
  const [syncing, startSync] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const detail = useSyncExternalStore(subscribeDetail, readDetail, () => false);

  // The server's clock minus this device's, so "4 min ago" is right on a tablet whose clock is off.
  const skew = useRef(0);
  const boostUntil = useRef(0);
  const kick = useRef<(() => void) | null>(null);
  const initialRun = initial.mission?.run;
  // Runs seen while they were working (no need to replay those), and the last finished run seen.
  const watched = useRef(new Set<string>(initialRun?.status === "started" ? [initialRun.runId] : []));
  const lastDone = useRef(initialRun && initialRun.status !== "started" ? initialRun.runId : "");

  // Ask Atlas for a fresh snapshot: quickly while agents work, slowly when idle, never while hidden.
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last: LiveSnapshot | null = null;
    const tick = async () => {
      if (stop) return;
      if (document.visibilityState === "visible") {
        try {
          const res = await fetch(`/api/mission/live${detail ? "?detail=1" : ""}`, { cache: "no-store", headers: { accept: "application/json" } });
          if (stop) return;
          if (res.ok && (res.headers.get("content-type") ?? "").includes("json")) {
            const next = (await res.json()) as LiveSnapshot;
            if (stop) return;
            last = next;
            skew.current = Date.parse(next.at) - Date.now();
            setSnap(next);
            setOnline(true);
            setNowMs(Date.parse(next.at));
            const run = next.mission?.run;
            if (run?.status === "started") watched.current.add(run.runId);
            else if (run && run.runId !== lastDone.current) {
              // A run finished between two looks: play it back so it is not missed.
              if (!watched.current.has(run.runId) && run.steps.length > 0) {
                const frames = framesFor(next.mission!);
                setReplay((r) => r ?? { frames, i: 0, auto: true });
              }
              lastDone.current = run.runId;
            }
          } else {
            setOnline(false);
          }
        } catch {
          if (!stop) setOnline(false);
        }
      }
      if (stop) return;
      const now = Date.now();
      const wait = now < boostUntil.current ? 2000 : last ? pollDelay(last, now + skew.current) : 15_000;
      timer = setTimeout(() => void tick(), wait);
    };
    kick.current = () => {
      clearTimeout(timer);
      void tick();
    };
    timer = setTimeout(() => void tick(), 1200);
    const onVisible = () => {
      if (document.visibilityState === "visible") kick.current?.();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      kick.current = null;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [detail]);

  // A clock, and "ago" labels that keep counting between snapshots.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now() + skew.current;
      setNowMs(t);
      setClock(new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Replay: one frame at a time.
  useEffect(() => {
    if (!replay) return;
    const f = replay.frames[replay.i];
    if (!f) return;
    const id = setTimeout(() => setReplay((r) => (r && r.i + 1 < r.frames.length ? { ...r, i: r.i + 1 } : null)), f.playMs);
    return () => clearTimeout(id);
  }, [replay]);

  // Display mode: Escape leaves it, the page behind does not scroll, and the screen stays awake.
  useEffect(() => {
    if (!full) return;
    let off = false;
    let lock: WakeLockSentinel | null = null;
    const keepAwake = async () => {
      if (!("wakeLock" in navigator)) return;
      try {
        lock = await navigator.wakeLock.request("screen");
      } catch {
        lock = null; // Low battery or an unsupported browser: the display still works.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible" && !off) void keepAwake();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    void keepAwake();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("keydown", onKey);
    return () => {
      off = true;
      document.body.style.overflow = overflow;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("keydown", onKey);
      void lock?.release().catch(() => undefined);
    };
  }, [full]);

  const toggleFull = () => {
    const el = document.documentElement;
    if (!full) {
      if ("requestFullscreen" in el) void el.requestFullscreen().catch(() => undefined);
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    setFull(!full);
  };

  const mission = snap.mission;
  const frame = replay ? (replay.frames[replay.i] ?? null) : null;
  const lit = frame ? { nodes: frame.nodes, edges: frame.edges } : liveHighlights(snap, nowMs);
  const litNodes = new Set(lit.nodes);
  const litEdges = new Set(lit.edges);
  const color = frame && !frame.ok ? "var(--c-red)" : ACTIVE;
  const running = snap.agents.filter((a) => a.state === "running");
  const canReplay = !!mission && mission.run.status !== "started" && mission.run.steps.length > 0;

  const agentLine = (n: MapNode): { state: NodeState | null; line: string; sub: string } => {
    // Atlas's agents: the latest run of each, found by its task in the activity log.
    const loop = snap.loops?.[n.id];
    if (loop) return { state: loop.state, line: "", sub: loop.state === "idle" ? n.sub : loop.state === "running" ? "Working…" : `${STATE_WORD[loop.state]}${loop.at ? ` · ${ago(loop.at, nowMs)}` : ""}` };
    // The MCP server: whether Claude access is on, and Claude's reads today, from the audit log.
    if (n.id === MCP_NODE && snap.mcp) {
      const m = snap.mcp;
      const sub = !m.on ? "Off in Settings" : m.state === "running" ? "Claude is reading…" : m.calls ? `${m.calls} read${m.calls === 1 ? "" : "s"} today${m.lastAt ? ` · ${ago(m.lastAt, nowMs)}` : ""}` : "On · no reads today";
      return { state: m.state, line: "", sub };
    }
    const a = snap.agents.find((x) => x.agent === n.agent);
    if (!a) return { state: null, line: "", sub: n.sub };
    if (frame) return { state: a.state, line: litNodes.has(n.id) ? (frame.actor === a.agent ? "Working…" : "In this step") : STATE_WORD[a.state], sub: n.sub };
    const when = a.state === "running" || a.state === "idle" ? "" : ago(a.at, nowMs);
    const line = a.state === "paused" ? "Paused" : when ? `${STATE_WORD[a.state]} · ${when}` : STATE_WORD[a.state];
    // The Chief of Staff's box is wide enough to name its last task; a specialist's shows its job.
    const sub = n.kind !== "orchestrator" || !a.task ? n.sub : a.state === "running" || a.durationMs === null ? a.task : `${a.task} · took ${took(a.durationMs)}`;
    return { state: a.state, line, sub: sub.length > 42 ? `${sub.slice(0, 41)}…` : sub };
  };

  const facts = (id: string): [string, string][] => {
    const n = node(id);
    const rows: [string, string][] = (NODE_FACTS[id] ?? []).map(([k, v]) => [k, v]);
    if (n.agent) {
      const p = profile(n.agent);
      const judged: [string, string] = p.ai ? (ai?.on ? [`${ai.name} judges`, p.ai] : ["Judgment", ai ? `Rules while AI is off. With it on: ${p.ai}` : `Rules: no AI model is set up. With one: ${p.ai}`]) : ["Judgment", "Rules only"];
      rows.splice(1, 0, judged);
      rows.unshift(["Kind", `${KINDS[p.kind].label} · ${p.pattern}`], ["Tags", `${AI_USE[aiUse(p)].label} · ${REACH[p.reach].label} · ${TRIGGER[p.trigger].label}`]);
      const a = snap.agents.find((x) => x.agent === n.agent);
      if (a) {
        const when = a.state === "running" || a.state === "idle" ? "" : ` · ${ago(a.at, nowMs)}`;
        const length = a.durationMs !== null && a.state !== "running" ? ` · took ${took(a.durationMs)}` : "";
        rows.push(["Last run", a.state === "idle" ? "No runs yet" : `${STATE_WORD[a.state]}${a.task ? ` · ${a.task}` : ""}${when}${length}`]);
      }
    }
    if (id === MCP_NODE && snap.mcp) {
      const m = snap.mcp;
      rows.unshift(["Claude access", m.on ? "On" : "Off: every request is refused. Turn it on in Settings, Connect Claude"], ["Today", m.calls ? `${m.calls} tool call${m.calls === 1 ? "" : "s"}, ${m.errors} failed${m.lastAt ? `, the last ${ago(m.lastAt, nowMs)}` : ""}` : "No calls yet"]);
    }
    if (id === MODEL_NODE) {
      const uses = AGENTS.filter((x) => x.ai).map((x) => x.name).join(", ");
      const model: [string, string][] = ai
        ? [
            ["Model", ai.writer ? `${ai.writer}${ai.fast ? `, falling back to ${ai.fast} when it is slow or busy` : ""}` : ai.name],
            ["Today", !ai.on ? "AI is off: the bots below use their rules" : snap.aiCalls ? `${snap.aiCalls.used} of ${snap.aiCalls.limit} calls` : "Connected"],
            ["Used by", uses],
          ]
        : [["Status", "No AI model is set up, so every bot uses its rules"], ["Would judge for", uses]];
      rows.unshift(...model);
    }
    return rows;
  };
  const focusNode = focus ? node(focus) : null;
  const near = focus ? (RELATED.get(focus) ?? new Set<string>()) : null;

  const headline = frame
    ? `Replaying the ${mission?.run.task ?? "last run"}`
    : running.length > 0
      ? mission?.run.status === "started"
        ? `${mission.run.task} in progress`
        : `${profile(running[0]!.agent).name} is working`
      : `Idle · next sync ${snap.nextSync}`;

  return (
    <div className={full ? "fixed inset-0 z-[60] flex flex-col gap-3 overflow-auto bg-canvas p-4 md:p-6" : "space-y-4"}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold"
            style={{ borderColor: !online ? "var(--c-red)" : frame ? ACTIVE : "var(--brand-border)", color: !online ? "var(--c-red)" : frame ? ACTIVE : "var(--brand)" }}
          >
            <span className={`h-2 w-2 rounded-full ${online ? "animate-pulse" : ""}`} style={{ background: "currentColor" }} />
            {!online ? "Offline" : frame ? "Replay" : "Live"}
          </span>
          <p className={`h-display truncate font-semibold ${full ? "text-xl" : ""}`}>{online ? headline : "Can't reach Atlas. If you were signed out, open Atlas and sign in again."}</p>
          {full && clock && <span className="font-mono text-sm text-ink-3">{clock}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {replay ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReplay(null)}>
              <Icon name="x" size={14} /> Stop replay
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" disabled={!canReplay} onClick={() => mission && setReplay({ frames: framesFor(mission), i: 0, auto: false })}>
              <Icon name="refresh" size={14} /> Replay last run
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={syncing}
            onClick={() => {
              setNote(null);
              boostUntil.current = Date.now() + 120_000;
              kick.current?.();
              startSync(async () => {
                const r = await syncNow();
                setNote(r.ok ? { ok: true, text: detail ? (r.message ?? "Synced") : "Synced" } : { ok: false, text: r.error });
                kick.current?.();
              });
            }}
          >
            <Icon name="sparkle" size={14} className={syncing ? "animate-pulse" : ""} /> {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-pressed={detail}
            title="Details can name a company or a sender. Leave them hidden on a screen other people can see."
            onClick={() => writeDetail(!detail)}
          >
            <Icon name="shield" size={14} /> {detail ? "Hide details" : "Show details"}
          </button>
          <button type="button" className={`btn btn-sm ${full ? "btn-ghost" : "btn-primary"}`} onClick={toggleFull}>
            <Icon name={full ? "x" : "external"} size={14} /> {full ? "Exit display mode" : "Display mode"}
          </button>
        </div>
      </div>

      <div className={`card ${full ? "min-h-0 flex-1 overflow-hidden" : "overflow-x-auto"}`}>
        <svg
          viewBox={`0 0 ${MAP_SIZE.w} ${MAP_SIZE.h}`}
          role="img"
          aria-label="Atlas orchestration map: triggers start the Chief of Staff, which asks a Daily desk and a Career desk; the AI model judges for four agents; each agent reads its sources outside Atlas; results are delivered to you. Select a box for its details."
          preserveAspectRatio="xMidYMid meet"
          // On a phone the map keeps a readable size and scrolls sideways.
          className={full ? "h-full w-full" : "h-auto w-full min-w-[880px] md:min-w-0"}
          onClick={() => setFocus(null)}
        >
          <defs>
            {(["line", "lit", "ai"] as const).map((k) => (
              <marker key={k} id={`map-arrow-${k}`} viewBox="0 0 10 10" refX={8} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" style={{ stroke: k === "lit" ? color : k === "ai" ? AI_COLOR : "var(--line-strong)" }} />
              </marker>
            ))}
          </defs>
          {MAP_LABELS.map((l) => (
            <text key={l.text} x={l.x} y={l.y} fontSize={11.5} letterSpacing="0.12em" className="fill-ink-3 font-mono uppercase">
              {l.text}
            </text>
          ))}
          {MAP_GROUPS.map((g) => {
            // Each part of the map wears its meaning's color (owner's palette, 24 Nov 2026): the desks
            // their desk's, QA red, the AI agents pink, connectors and MCP yellow. Outline only.
            const hue = GROUP_COLOR[g.id];
            const loud = g.id === "connector" || g.id === "sources";
            return (
              <g key={g.id}>
                <rect x={g.x} y={g.y} width={g.w} height={g.h} rx={16} fill="none" strokeWidth={hue ? (loud ? 3 : 2) : 1.2} style={{ stroke: hue ?? "var(--line-strong)" }} />
                <text x={g.x + 14} y={g.labelBottom ? g.y + g.h - 10 : g.y + 17} fontSize={11.5} letterSpacing="0.12em" fontWeight={hue ? 600 : undefined} className="font-mono uppercase" style={{ fill: hue ? `color-mix(in oklab, ${hue} 50%, var(--ink))` : "var(--ink-3)" }}>
                  {g.label}
                </text>
              </g>
            );
          })}
          {/* Quiet lines first, then the lit and focused ones on top. */}
          {[...EDGE_PATHS]
            .sort((x, y) => Number(litEdges.has(x.edge.id) || focus === x.edge.from || focus === x.edge.to) - Number(litEdges.has(y.edge.id) || focus === y.edge.from || focus === y.edge.to))
            .map(({ edge, d }) => {
              const on = litEdges.has(edge.id);
              const mine = !!focus && (edge.from === focus || edge.to === focus);
              const judge = edge.kind === "judge";
              const aiLine = judge && !!ai?.on;
              const back = on && !!frame?.reverse && edge.kind === "ask";
              const quiet = (frame && !on) || (focus && !mine);
              const stroke = on ? color : mine ? (aiLine ? AI_COLOR : color) : aiLine ? AI_COLOR : "var(--line-strong)";
              return (
                <path
                  key={edge.id}
                  d={d}
                  fill="none"
                  opacity={quiet ? 0.25 : 1}
                  strokeWidth={on || mine ? 2.6 : judge ? 1.6 : 1.4}
                  strokeLinecap="round"
                  strokeDasharray={on ? undefined : judge ? "7 5" : edge.kind === "handoff" ? "3 5" : undefined}
                  markerEnd={`url(#map-arrow-${on || (mine && !aiLine) ? "lit" : aiLine ? "ai" : "line"})`}
                  className={on ? (back ? "map-flow-rev" : "map-flow") : ""}
                  style={{ stroke, transition: "opacity 300ms" }}
                >
                  {edge.label && <title>{edge.label}</title>}
                </path>
              );
            })}
          {MAP_NODES.map((n) => {
            const on = litNodes.has(n.id);
            const info = agentLine(n);
            const dim = (!!frame && !on) || (!!near && !near.has(n.id));
            return (
              <Box
                key={n.id}
                n={n}
                state={info.state}
                line={info.line}
                sub={info.sub}
                lit={on}
                dim={dim}
                focused={focus === n.id}
                color={color}
                ai={ai}
                calls={snap.aiCalls}
                onSelect={() => setFocus((f) => (f === n.id ? null : n.id))}
              />
            );
          })}
        </svg>
      </div>

      {/* The palette: what each color means, everywhere in Atlas. */}
      <div className="-mt-1 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-ink-2" aria-label="What the colors mean">
        {PALETTE_KEY.map(([label, color]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-4 rounded-[4px] border-2" style={{ borderColor: color }} />
            {label}
          </span>
        ))}
      </div>

      {/* The key, then what the selected box does. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-grid h-4 w-4 place-items-center rounded-full text-[10px] font-bold" style={{ background: ai?.on ? AI_COLOR : "var(--surface-2)", color: ai?.on ? "var(--ink)" : undefined }}>
            ✦
          </span>
          {ai ? (ai.on ? `Judged by ${ai.name}` : "AI is off: rules for now") : "No AI model set up"}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="21" y2="4" strokeWidth="1.6" strokeDasharray="5 4" style={{ stroke: ai?.on ? AI_COLOR : "var(--line-strong)" }} />
          </svg>
          AI judgment
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="22" height="8" aria-hidden="true">
            <line x1="1" y1="4" x2="21" y2="4" strokeWidth="1.4" style={{ stroke: "var(--line-strong)" }} />
          </svg>
          Asks, reads, delivers
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-4 rounded-[4px] border border-dashed" style={{ borderColor: "var(--line-strong)" }} />
          Outside Atlas
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR.ok }} />
          <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR.running }} />
          <span className="h-2 w-2 rounded-full" style={{ background: STATE_COLOR.idle }} />
          Done, working, idle
        </span>
      </div>

      <div className="card card-pad" aria-live="polite">
        {focusNode ? (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="eyebrow">Selected</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFocus(null)}>
                <Icon name="x" size={14} /> Clear
              </button>
            </div>
            <p className={`h-display font-semibold ${full ? "text-2xl" : "text-lg"}`}>{focusNode.kind === "model" ? `✦ ${ai?.name ?? "AI model"}` : focusNode.label}</p>
            <dl className="mt-2 divide-y divide-line text-sm">
              {facts(focusNode.id).map(([k, v]) => (
                <div key={k} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3 py-2">
                  <dt className="text-ink-3">{k}</dt>
                  <dd className="break-words">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <p className="text-sm text-ink-2">Select any box: the rest of the map dims, and this panel says what it reads, what {ai?.name ?? "the AI model"} judges for it, what it writes, and how its last run went.</p>
        )}
      </div>

      <div className="card card-pad">
        {frame && replay ? (
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="eyebrow">
                {replay.auto ? "Just finished · replay" : "Replay"} · step {replay.i + 1} of {replay.frames.length}
              </p>
              <p className="text-xs text-ink-3">
                {profile(frame.actor).name}
                {frame.ms !== null ? ` · took ${took(frame.ms)}` : ""}
                {frame.ok ? "" : " · failed"}
              </p>
            </div>
            <p className={`h-display mt-1 font-semibold ${full ? "text-2xl" : "text-lg"}`} style={frame.ok ? undefined : { color: "var(--c-red)" }}>
              {frame.title}
            </p>
            {frame.note && <p className="mt-1 text-sm text-ink-2">{frame.note}</p>}
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full" style={{ width: `${((replay.i + 1) / replay.frames.length) * 100}%`, background: ACTIVE, transition: "width 400ms" }} />
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">{running.length > 0 ? "Now" : "Last run"}</p>
              {running.length > 0 ? (
                <p className={`h-display mt-1 font-semibold ${full ? "text-2xl" : "text-lg"}`}>{running.map((a) => profile(a.agent).name).join(", ")} working</p>
              ) : mission ? (
                <>
                  <p className={`h-display mt-1 font-semibold ${full ? "text-2xl" : "text-lg"}`}>
                    {mission.run.task} <span style={{ color: STATE_COLOR[RUN_STATE[mission.run.status]] }}>{STATE_WORD[RUN_STATE[mission.run.status]].toLowerCase()}</span> {ago(mission.run.endedAt ?? mission.run.startedAt, nowMs)}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-2">
                    {mission.run.durationMs !== null ? `Took ${took(mission.run.durationMs)}. ` : ""}
                    {mission.members.length} bot{mission.members.length === 1 ? "" : "s"} reported.
                    {mission.run.detail ? ` ${mission.run.detail}.` : ""}
                  </p>
                </>
              ) : (
                <p className="h-display mt-1 text-lg font-semibold">No sync or brief has run yet. Press Sync now to watch one.</p>
              )}
            </div>
            <p className="text-right text-xs text-ink-3">
              {note && <span className={`block ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
              Next sync {snap.nextSync} · Next brief: {snap.nextBrief}
            </p>
          </div>
        )}
      </div>

      <ul className={`grid gap-2 ${full ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2"}`}>
        {snap.feed.slice(0, full ? 4 : 8).map((r) => {
          const state = RUN_STATE[r.status];
          return (
            <li key={r.runId} className="card flex items-start gap-2.5 px-3 py-2.5">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${state === "running" ? "animate-pulse" : ""}`} style={{ background: STATE_COLOR[state] }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {profile(r.agent).name} <span className="font-normal text-ink-3">· {r.task}</span>
                </p>
                <p className="truncate text-xs text-ink-3">
                  <span style={{ color: STATE_COLOR[state] }}>{STATE_WORD[state]}</span>
                  {state === "running" ? "" : ` · ${ago(r.endedAt ?? r.startedAt, nowMs)}`}
                  {r.durationMs !== null ? ` · ${took(r.durationMs)}` : ""}
                  {r.detail ? ` · ${r.detail}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      {!full && (
        <p className="text-xs text-ink-3">
          Display mode fills the screen and keeps it awake, for an iPad or a second monitor. Details stay hidden until you show them on that device. Agents work in short bursts, so a run that finishes between two looks is replayed
          automatically.
        </p>
      )}
    </div>
  );
}
