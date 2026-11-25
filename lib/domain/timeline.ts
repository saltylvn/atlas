// The Day timeline: what Atlas planned to run today, and what actually ran, on one clock.
//
// One lane per workflow (its planned times, and its own runs when it logs one) and one lane
// per bot (every run it logged). The live map shows how Atlas is wired; this shows when it
// moved. Built from the activity log every run already writes, so it adds no new data.
//
// Pure: the server passes in today's log rows, the day and the timezone.

import { AGENTS } from "./agents";
import { localDate, localTime } from "./dates";
import { WORKFLOWS, workflowForTask, type Kind } from "./registry";
import type { AgentId, AgentRunEvent, LocalDate, RunStatus } from "./types";

/** The day the timeline draws, in local minutes after midnight: 6 AM to 10 PM. */
export const DAY_WINDOW = { from: 6 * 60, to: 22 * 60 } as const;

export interface RunMark {
  runId: string;
  task: string;
  /** Local minutes after midnight. */
  start: number;
  end: number;
  /** "started" while it is still running. */
  status: RunStatus;
  trigger: AgentRunEvent["trigger"];
}

export interface Lane {
  id: string;
  label: string;
  kind: Kind;
  /** Planned start times, in local minutes. */
  planned: number[];
  /** A repeating schedule drawn as one span, for the 15-minute watch. */
  band: { from: number; to: number; everyMinutes: number } | null;
  runs: RunMark[];
  agent?: AgentId;
}

export interface DayTimeline {
  day: LocalDate;
  lanes: Lane[];
  /** Local minutes now, or null when the day is not today. */
  now: number | null;
  /** Runs today, and how many failed. */
  totals: { runs: number; failed: number; planned: number };
}

export const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Groups the log's rows into one mark per run: start, end and how it ended. */
export function runMarks(rows: readonly AgentRunEvent[], day: LocalDate, timeZone: string): (RunMark & { agent: AgentId })[] {
  const byRun = new Map<string, AgentRunEvent[]>();
  for (const r of rows) {
    if (localDate(new Date(r.at), timeZone) !== day) continue;
    const list = byRun.get(r.runId) ?? [];
    list.push(r);
    byRun.set(r.runId, list);
  }
  const out: (RunMark & { agent: AgentId })[] = [];
  for (const [runId, list] of byRun) {
    const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    const ended = sorted.find((r) => r.status !== "started") ?? null;
    const endAt = new Date(ended?.at ?? last.at);
    // A run that logged only its ending row: its duration tells where it began.
    const startAt = ended && sorted.length === 1 && ended.durationMs ? new Date(endAt.getTime() - ended.durationMs) : new Date(first.at);
    const start = toMinutes(localTime(startAt, timeZone));
    out.push({ runId, agent: first.agent, task: first.task, start, end: Math.max(start, toMinutes(localTime(endAt, timeZone))), status: ended?.status ?? "started", trigger: first.trigger });
  }
  return out.sort((a, b) => a.start - b.start);
}

export function dayTimeline(input: { rows: readonly AgentRunEvent[]; day: LocalDate; timeZone: string; now: Date }): DayTimeline {
  const { day, timeZone } = input;
  const marks = runMarks(input.rows, day, timeZone);
  const workflowLanes: Lane[] = WORKFLOWS.map((w) => ({
    id: w.id,
    label: w.name,
    kind: "workflow",
    planned: w.planned(day).map(toMinutes),
    band: w.band ? { from: toMinutes(w.band.from), to: toMinutes(w.band.to), everyMinutes: w.band.everyMinutes } : null,
    runs: [],
  }));
  const botLanes: Lane[] = AGENTS.map((a) => ({ id: a.id, label: a.name, kind: a.kind, planned: [], band: null, runs: [], agent: a.id }));
  for (const m of marks) {
    const lane = workflowLanes.find((l) => l.id === workflowForTask(m.task)?.id) ?? botLanes.find((l) => l.agent === m.agent);
    lane?.runs.push(m);
  }
  const isToday = localDate(input.now, timeZone) === day;
  return {
    day,
    lanes: [...workflowLanes, ...botLanes],
    now: isToday ? toMinutes(localTime(input.now, timeZone)) : null,
    totals: { runs: marks.length, failed: marks.filter((m) => m.status === "failed").length, planned: workflowLanes.reduce((n, l) => n + l.planned.length, 0) },
  };
}

/** Where a time sits across the window, 0 to 100, clamped. */
export const position = (minutes: number): number => Math.min(100, Math.max(0, ((minutes - DAY_WINDOW.from) / (DAY_WINDOW.to - DAY_WINDOW.from)) * 100));
