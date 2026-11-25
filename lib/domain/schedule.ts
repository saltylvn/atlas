// Time-blocking. Deterministic, like the planner: the same calendar and task list give
// the same day every time, it is unit-tested, and it cannot be argued into overbooking.
// The planner decides which DAY a task belongs to; this module decides WHEN in that day.
//
// All times inside this module are minutes from local midnight (0..1440) on one day in
// the owner's timezone. ISO instants only appear at the edges (calendar events in,
// nothing out), so the logic stays easy to test.

import { localDate, localTime } from "./dates";
import { allowedOn, capacityFor, comparePriority } from "./planner";
import type { CalendarEvent, LocalDate, Priority, Settings, Task } from "./types";

export interface WorkHours {
  /** Minutes from midnight. */
  start: number;
  end: number;
  /** Shortest free gap worth putting a task in. */
  minSlotMin: number;
  /** Kept free before and after each meeting. */
  bufferMin: number;
}

export const DEFAULT_WORK_HOURS = { start: "08:00", end: "17:30", minSlotMin: 15, bufferMin: 5 } as const;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function toMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function fromMinutes(min: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/** "9:30a", "12p", "5:15p": compact, for narrow timelines. */
export function clockLabel(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const suffix = h24 < 12 ? "a" : "p";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

/** Work hours from settings, falling back to safe defaults for anything missing or invalid. */
export function workHoursFrom(settings: Partial<Pick<Settings, "workStart" | "workEnd" | "minSlotMin" | "meetingBufferMin">>): WorkHours {
  let start = toMinutes(settings.workStart ?? DEFAULT_WORK_HOURS.start);
  let end = toMinutes(settings.workEnd ?? DEFAULT_WORK_HOURS.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < 60) {
    start = toMinutes(DEFAULT_WORK_HOURS.start);
    end = toMinutes(DEFAULT_WORK_HOURS.end);
  }
  const minSlot = settings.minSlotMin;
  const buffer = settings.meetingBufferMin;
  return {
    start,
    end,
    minSlotMin: typeof minSlot === "number" && minSlot >= 5 && minSlot <= 120 ? Math.round(minSlot) : DEFAULT_WORK_HOURS.minSlotMin,
    bufferMin: typeof buffer === "number" && buffer >= 0 && buffer <= 30 ? Math.round(buffer) : DEFAULT_WORK_HOURS.bufferMin,
  };
}

export interface Interval {
  start: number;
  end: number;
}

const DAY_OFF = /\b(out of (the )?office|ooo|vacation|pto|holiday|day off|sick)\b/i;

/** An all-day event that means "not working today" (OOO, vacation, holiday...). */
export function isDayOff(e: CalendarEvent): boolean {
  return e.allDay && DAY_OFF.test(e.title);
}

/** Where a timed event falls on `day`, clipped to that day. Null if it is all-day or elsewhere. */
export function eventInterval(e: CalendarEvent, day: LocalDate, timeZone: string): Interval | null {
  if (e.allDay) return null;
  const s = new Date(e.start);
  const en = new Date(e.end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(en.getTime())) return null;
  const sDay = localDate(s, timeZone);
  const eDay = localDate(en, timeZone);
  if (sDay > day || eDay < day) return null;
  const start = sDay < day ? 0 : toMinutes(localTime(s, timeZone));
  // An event ending exactly at midnight the next day ends at 24:00 here.
  const end = eDay > day ? 24 * 60 : toMinutes(localTime(en, timeZone));
  if (end <= start) return null;
  return { start, end };
}

/** Sorts and merges overlapping or touching intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

/** `window` minus `busy`, keeping only gaps at least `minLen` long. */
export function subtractIntervals(window: Interval, busy: Interval[], minLen: number): Interval[] {
  const free: Interval[] = [];
  let cursor = window.start;
  for (const b of mergeIntervals(busy)) {
    if (b.end <= cursor) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) free.push({ start: cursor, end: Math.min(b.start, window.end) });
    cursor = Math.max(cursor, b.end);
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free.filter((f) => f.end - f.start >= minLen);
}

/** Rounds "now" up to the next 5 minutes so a block never starts in the past. */
export function roundUp5(min: number): number {
  return Math.ceil(min / 5) * 5;
}

export interface FreeSlotsInput {
  day: LocalDate;
  timeZone: string;
  events: CalendarEvent[];
  work: WorkHours;
  /** Minutes from midnight right now, when `day` is today. Time before it is gone. */
  nowMin?: number | null;
  /** Extra busy time, e.g. tasks already pinned to a start time. */
  extraBusy?: Interval[];
}

export function freeSlots(input: FreeSlotsInput): Interval[] {
  const { day, timeZone, events, work } = input;
  if (events.some(isDayOff)) return [];
  const start = input.nowMin == null ? work.start : Math.max(work.start, roundUp5(input.nowMin));
  if (start >= work.end) return [];
  const busy = events
    .filter((e) => !e.declined)
    .map((e) => eventInterval(e, day, timeZone))
    .filter((i): i is Interval => i !== null)
    .map((i) => ({ start: i.start - work.bufferMin, end: i.end + work.bufferMin }));
  return subtractIntervals({ start, end: work.end }, [...busy, ...(input.extraBusy ?? [])], work.minSlotMin);
}

/** Minutes of meetings inside the work window (all-day events excluded). */
export function meetingMinutes(events: CalendarEvent[], day: LocalDate, timeZone: string, work: WorkHours): number {
  const inWindow = events
    .filter((e) => !e.declined)
    .map((e) => eventInterval(e, day, timeZone))
    .filter((i): i is Interval => i !== null)
    .map((i) => ({ start: Math.max(i.start, work.start), end: Math.min(i.end, work.end) }));
  return mergeIntervals(inWindow).reduce((n, i) => n + (i.end - i.start), 0);
}

// ---------------------------------------------------------------------------
// Blocking one day

export type BlockKind = "event" | "pinned" | "focus";

export interface TimelineItem {
  kind: BlockKind;
  id: string;
  title: string;
  start: number;
  end: number;
  taskId?: string;
  priority?: Priority;
  deep?: boolean;
  /** For events: calendar vs tracked interview. */
  source?: CalendarEvent["source"];
}

export interface FocusBlock {
  taskId: string;
  start: number;
  end: number;
}

export type OverflowReason = "capacity" | "no-slot";

export interface DaySchedule {
  day: LocalDate;
  work: WorkHours;
  dayOff: boolean;
  allDay: CalendarEvent[];
  /** Free gaps before any task is placed (after meetings, buffers and pinned tasks). */
  slots: Interval[];
  /** Meetings, pinned tasks and suggested focus blocks, sorted by start. */
  timeline: TimelineItem[];
  /** The suggestion: open tasks with no time yet, and when to do them. */
  blocks: FocusBlock[];
  overflow: { taskId: string; reason: OverflowReason }[];
  /** Pinned tasks that overlap a meeting. */
  conflicts: { taskId: string; eventId: string }[];
  freeMin: number;
  meetingMin: number;
  capacityMin: number;
  /** Minutes of tasks on the timeline (pinned + suggested). */
  blockedMin: number;
  /** What is left of the protected deep-work window after blocking (an hour or more), if any. */
  focusWindow: Interval | null;
}

export interface BlockDayInput {
  day: LocalDate;
  timeZone: string;
  events: CalendarEvent[];
  tasks: Task[];
  work: WorkHours;
  dailyCapacityMin: number;
  /** Minutes from midnight now, if `day` is today; null for a future day. */
  nowMin: number | null;
}

/** Open tasks that belong on `day`: planned for it, or overdue (when `day` is today). */
export function tasksForDay(tasks: Task[], day: LocalDate, isToday: boolean): Task[] {
  return tasks
    .filter((t) => t.status !== "done" && t.day !== null && (t.day === day || (isToday && t.day < day)))
    .sort((a, b) => comparePriority(a, b) || Number(b.day! < day) - Number(a.day! < day));
}

function pinnedInterval(t: Task, day: LocalDate, nowMin: number | null): Interval | null {
  if (t.day !== day || !t.startTime) return null;
  const start = toMinutes(t.startTime);
  if (!Number.isFinite(start)) return null;
  const end = Math.min(24 * 60, start + t.estimateMin);
  // A pinned slot that already went by while the task is still open gets re-blocked.
  if (nowMin != null && end <= nowMin && t.status !== "doing") return null;
  return { start, end };
}

export function blockDay(input: BlockDayInput): DaySchedule {
  const { day, timeZone, events, tasks, work, nowMin } = input;
  const isToday = nowMin != null;
  const capacityMin = capacityFor(day, input.dailyCapacityMin);
  const allDay = events.filter((e) => e.allDay);
  const dayOff = events.some(isDayOff);

  const eventItems: TimelineItem[] = events
    .map((e) => ({ e, i: eventInterval(e, day, timeZone) }))
    .filter((x): x is { e: CalendarEvent; i: Interval } => x.i !== null)
    .map(({ e, i }) => ({ kind: "event" as const, id: e.id, title: e.title, start: i.start, end: i.end, source: e.source }));

  const candidates = tasksForDay(tasks, day, isToday);
  const pinned: TimelineItem[] = [];
  const loose: Task[] = [];
  for (const t of candidates) {
    const iv = pinnedInterval(t, day, nowMin);
    if (iv) pinned.push({ kind: "pinned", id: `pin:${t.id}`, taskId: t.id, title: t.title, start: iv.start, end: iv.end, priority: t.priority, deep: t.energy === "deep" });
    else loose.push(t);
  }

  const conflicts = pinned.flatMap((p) =>
    eventItems.filter((e) => e.start < p.end && p.start < e.end).map((e) => ({ taskId: p.taskId!, eventId: e.id })),
  );

  const slots = dayOff ? [] : freeSlots({ day, timeZone, events, work, nowMin, extraBusy: pinned });
  const freeMin = slots.reduce((n, s) => n + (s.end - s.start), 0);

  // Each slot keeps a cursor; tasks are laid end to end inside it.
  const room = slots.map((s) => ({ ...s, cursor: s.start }));
  let used = pinned.reduce((n, p) => n + (p.end - p.start), 0);
  const blocks: FocusBlock[] = [];
  const overflow: DaySchedule["overflow"] = [];
  // The longest gap of an hour or more is protected for deep work.
  const protectedSlot = room.reduce<(typeof room)[number] | null>((b, r) => (r.end - r.start >= 60 && (!b || r.end - r.start > b.end - b.start) ? r : b), null);

  for (const t of loose) {
    if (used + t.estimateMin > capacityMin) {
      overflow.push({ taskId: t.id, reason: "capacity" });
      continue;
    }
    const allFits = room.filter((r) => r.end - r.cursor >= t.estimateMin);
    // Shallow work stays out of the protected focus window unless nothing else fits.
    const outside = allFits.filter((r) => r !== protectedSlot);
    const fits = t.energy === "deep" || outside.length === 0 ? allFits : outside;
    if (fits.length === 0) {
      overflow.push({ taskId: t.id, reason: "no-slot" });
      continue;
    }
    // Urgent and deep work take the earliest gap that fits (fresh mind, mornings first).
    // Other shallow work takes the tightest gap that fits, saving long gaps for deep work.
    const pick =
      t.energy === "deep" || t.priority === "critical" || t.priority === "high"
        ? fits[0]!
        : fits.reduce((best, r) => (r.end - r.cursor < best.end - best.cursor ? r : best));
    blocks.push({ taskId: t.id, start: pick.cursor, end: pick.cursor + t.estimateMin });
    pick.cursor += t.estimateMin;
    used += t.estimateMin;
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const focusItems: TimelineItem[] = blocks.map((b) => {
    const t = byId.get(b.taskId)!;
    return { kind: "focus", id: `focus:${t.id}`, taskId: t.id, title: t.title, start: b.start, end: b.end, priority: t.priority, deep: t.energy === "deep" };
  });

  const order: Record<BlockKind, number> = { event: 0, pinned: 1, focus: 2 };
  const timeline = [...eventItems, ...pinned, ...focusItems].sort((a, b) => a.start - b.start || order[a.kind] - order[b.kind] || a.end - b.end);

  return {
    day,
    work,
    dayOff,
    allDay,
    slots,
    timeline,
    blocks,
    overflow,
    conflicts,
    freeMin,
    meetingMin: meetingMinutes(events, day, timeZone, work),
    capacityMin,
    blockedMin: used,
    focusWindow: protectedSlot && protectedSlot.end - protectedSlot.cursor >= 60 ? { start: protectedSlot.cursor, end: protectedSlot.end } : null,
  };
}

// ---------------------------------------------------------------------------
// Now / Next

export interface NowNext {
  state: "before-work" | "working" | "after-work" | "day-off";
  /** The meeting (or pinned task) happening right now. */
  current: TimelineItem | null;
  /** The next meeting (or pinned task) after now. */
  next: TimelineItem | null;
  /** When nothing fixed is happening: the open gap you are in and what to do with it. */
  gap: { start: number; end: number; minutes: number; suggestion: TimelineItem | null } | null;
}

export function nowNext(schedule: DaySchedule, nowMin: number): NowNext {
  const fixed = schedule.timeline.filter((i) => i.kind !== "focus");
  const current = fixed.find((i) => i.start <= nowMin && nowMin < i.end) ?? null;
  const next = fixed.find((i) => i.start > nowMin) ?? null;
  const { work } = schedule;

  if (schedule.dayOff) return { state: "day-off", current, next, gap: null };
  const state = nowMin < work.start ? "before-work" : nowMin >= work.end ? "after-work" : "working";

  let gap: NowNext["gap"] = null;
  if (!current && state !== "after-work") {
    const start = Math.max(nowMin, work.start);
    const end = Math.min(next ? next.start : work.end, work.end);
    if (end > start) {
      const suggestion = schedule.timeline.find((i) => i.kind === "focus" && i.start < end && i.end > start) ?? null;
      gap = { start, end, minutes: Math.round(end - start), suggestion };
    }
  }
  return { state, current, next, gap };
}

// ---------------------------------------------------------------------------
// The week: free time vs planned load, and where overflow should go

export interface DayLoad {
  day: LocalDate;
  dayOff: boolean;
  /** Free minutes in work hours after meetings (and, for today, after now). */
  freeMin: number;
  meetingMin: number;
  capacityMin: number;
  /** What the day can really hold: the smaller of free time and capacity. */
  availableMin: number;
  plannedMin: number;
  overMin: number;
}

export interface WeekLoadInput {
  days: LocalDate[];
  today: LocalDate;
  nowMin: number;
  timeZone: string;
  events: CalendarEvent[];
  tasks: Task[];
  work: WorkHours;
  dailyCapacityMin: number;
}

export function weekLoad(input: WeekLoadInput): DayLoad[] {
  const { days, today, nowMin, timeZone, events, tasks, work, dailyCapacityMin } = input;
  return days.map((day) => {
    const past = day < today;
    const dayEvents = events.filter((e) => touchesDay(e, day, timeZone));
    const dayOff = dayEvents.some(isDayOff);
    const freeMin = past || dayOff
      ? 0
      : freeSlots({ day, timeZone, events: dayEvents, work, nowMin: day === today ? nowMin : null }).reduce((n, s) => n + s.end - s.start, 0);
    const capacityMin = dayOff ? 0 : capacityFor(day, dailyCapacityMin);
    const plannedMin = tasks.filter((t) => t.status !== "done" && t.day === day).reduce((n, t) => n + t.estimateMin, 0);
    const availableMin = Math.min(freeMin, capacityMin);
    return {
      day,
      dayOff,
      freeMin,
      meetingMin: meetingMinutes(dayEvents, day, timeZone, work),
      capacityMin,
      availableMin,
      plannedMin,
      overMin: past ? 0 : Math.max(0, plannedMin - availableMin),
    };
  });
}

function touchesDay(e: CalendarEvent, day: LocalDate, timeZone: string): boolean {
  if (e.allDay) {
    // All-day events carry their date at midnight UTC or local; compare the date part.
    const startDay = e.start.slice(0, 10);
    const endDay = e.end.slice(0, 10);
    return startDay <= day && (day < endDay || startDay === endDay);
  }
  return eventInterval(e, day, timeZone) !== null;
}

export interface MoveSuggestion {
  taskId: string;
  from: LocalDate;
  to: LocalDate;
  minutes: number;
}

/**
 * For each overbooked day, moves the least important open tasks to the lightest day
 * that has room, until the day fits. Critical tasks never move. Returns suggestions only.
 */
export function suggestMoves(loads: DayLoad[], tasks: Task[], today: LocalDate): MoveSuggestion[] {
  const state = new Map(loads.map((l) => [l.day, { ...l }]));
  const future = loads.filter((l) => l.day >= today).map((l) => l.day);
  const moves: MoveSuggestion[] = [];

  for (const from of future) {
    const src = state.get(from)!;
    if (src.plannedMin <= src.availableMin) continue;
    const movable = tasks
      .filter((t) => t.status !== "done" && t.day === from && t.priority !== "critical" && t.status !== "doing")
      .sort((a, b) => comparePriority(b, a));
    for (const t of movable) {
      if (src.plannedMin <= src.availableMin) break;
      const targets = future
        .filter((d) => d !== from && allowedOn(d, t))
        .map((d) => state.get(d)!)
        .filter((d) => d.availableMin - d.plannedMin >= t.estimateMin);
      if (targets.length === 0) continue;
      const to = targets.reduce((best, d) =>
        d.availableMin - d.plannedMin > best.availableMin - best.plannedMin ? d : best,
      );
      to.plannedMin += t.estimateMin;
      src.plannedMin -= t.estimateMin;
      moves.push({ taskId: t.id, from, to: to.day, minutes: t.estimateMin });
    }
  }
  return moves;
}

// ---------------------------------------------------------------------------
// Insights: meeting load and deep-work protection, as plain facts

export interface DayInsight {
  level: "warn" | "info";
  text: string;
}

/** Longest stretch of meetings with no break of at least `minBreak` minutes between them. */
export function longestMeetingRun(items: TimelineItem[], minBreak = 15): Interval | null {
  const meetings = mergeIntervals(items.filter((i) => i.kind === "event").map((i) => ({ start: i.start, end: i.end })));
  let best: Interval | null = null;
  let run: Interval | null = null;
  for (const m of meetings) {
    run = run && m.start - run.end < minBreak ? { start: run.start, end: Math.max(run.end, m.end) } : { ...m };
    if (!best || run.end - run.start > best.end - best.start) best = { ...run };
  }
  return best;
}

export function dayInsights(s: DaySchedule): DayInsight[] {
  if (s.dayOff) return [];
  const out: DayInsight[] = [];
  const windowMin = s.work.end - s.work.start;
  if (s.meetingMin >= windowMin / 2) {
    out.push({ level: "warn", text: `Meetings take ${Math.round((s.meetingMin / windowMin) * 100)}% of your work hours (${fmt(s.meetingMin)}). Decline or shorten one.` });
  }
  const run = longestMeetingRun(s.timeline);
  if (run && run.end - run.start >= 180) {
    out.push({ level: "warn", text: `${fmt(run.end - run.start)} of back-to-back meetings from ${clockLabel(run.start)} to ${clockLabel(run.end)}. Plan a break before it.` });
  }
  const deepOverflow = s.overflow.filter((o) => o.reason === "no-slot").length;
  const longest = s.focusWindow;
  if (longest) {
    out.push({ level: "info", text: `Best focus window: ${clockLabel(longest.start)}–${clockLabel(longest.end)} (${fmt(longest.end - longest.start)}). Protect it for deep work.` });
  } else if (s.slots.length > 0 || deepOverflow > 0) {
    out.push({ level: "warn", text: "No free hour left for deep work today. Move a deep task to a lighter day." });
  }
  const clashes = s.conflicts.length;
  if (clashes > 0) out.push({ level: "warn", text: `${clashes} scheduled task${clashes === 1 ? " clashes" : "s clash"} with a meeting.` });
  return out;
}

function fmt(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Shutdown: roll unfinished work forward

/**
 * Where each unfinished task from today (and earlier) should go: the next day it is
 * allowed on (work tasks skip the weekend). Recurring tasks are left alone, since
 * completing them already schedules the next one.
 */
export function rollForwardTargets(tasks: Task[], today: LocalDate, nextDays: LocalDate[]): { taskId: string; to: LocalDate }[] {
  return tasks
    .filter((t) => t.status !== "done" && t.day !== null && t.day <= today && t.recurrence === "none")
    .sort(comparePriority)
    .flatMap((t) => {
      const to = nextDays.find((d) => d > today && allowedOn(d, t));
      return to ? [{ taskId: t.id, to }] : [];
    });
}
