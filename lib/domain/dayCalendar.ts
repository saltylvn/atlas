// Today as a calendar (owner's request, 24 Nov 2026): one day of your Google Calendar laid out
// on an hour grid, for an iPad left standing as a wall calendar. Only today, only what is on the
// calendar. Pure: events in, positions out; the page draws them (components/DayCalendar.tsx).

import { safeHex } from "./googleCalendar";
import { clockLabel, eventInterval } from "./schedule";
import type { CalendarEvent, LocalDate } from "./types";

export interface CalendarBlock {
  id: string;
  title: string;
  location: string;
  /** Minutes from midnight, clipped to the day. */
  start: number;
  end: number;
  /** "9a – 9:30a", the way Atlas writes times everywhere. */
  label: string;
  /** Which side-by-side column it sits in, and how many columns its overlapping group has. */
  col: number;
  cols: number;
  /** Marked Free in the calendar: shown lighter. */
  free: boolean;
  /** An interview Atlas put on the day. */
  interview: boolean;
  /** The color Google Calendar shows it in, or null (iCal and demo events use Atlas blue). */
  color: string | null;
  /** You declined it: drawn struck through, like Google. */
  declined: boolean;
}

export interface DayCalendarView {
  allDay: { id: string; title: string; color: string | null }[];
  blocks: CalendarBlock[];
  /** The grid's first and last minute, on the hour. */
  from: number;
  to: number;
  /** Each hour line on the grid, as minutes from midnight. */
  hours: number[];
  /** Each half-hour line between them, like Google's day view. */
  halves: number[];
}

/** The grid always shows the working day; it grows to fit anything earlier or later. */
export const GRID_DEFAULT = { from: 7 * 60, to: 20 * 60 } as const;
/**
 * The least an event is drawn, in minutes. Events are drawn at their real length, like Google,
 * so back-to-back events never look like they overlap (owner's report, 24 Nov 2026: a 4:00-4:15
 * break drawn 25 minutes tall ran into the 4:15 event). Only a zero-length event gets this floor.
 */
export const MIN_BLOCK_MIN = 5;

export function dayCalendar(events: readonly CalendarEvent[], day: LocalDate, timeZone: string): DayCalendarView {
  const allDay = events.filter((e) => e.allDay).map((e) => ({ id: e.id, title: e.title, color: safeHex(e.color) }));
  const timed = events
    .flatMap((e) => {
      const i = eventInterval(e, day, timeZone);
      return i ? [{ e, ...i }] : [];
    })
    .sort((a, b) => a.start - b.start || b.end - a.end || a.e.title.localeCompare(b.e.title));

  // Side-by-side columns for events that overlap: each goes in the first column that is free,
  // and every event in one overlapping run shares that run's column count.
  const blocks: CalendarBlock[] = [];
  let run: { block: CalendarBlock; shownEnd: number }[] = [];
  let runEnd = -1;
  const close = () => {
    const cols = Math.max(1, ...run.map((r) => r.block.col + 1));
    for (const r of run) r.block.cols = cols;
    run = [];
  };
  for (const t of timed) {
    const shownEnd = Math.max(t.end, t.start + MIN_BLOCK_MIN);
    if (run.length && t.start >= runEnd) close();
    const taken = new Set(run.filter((r) => r.shownEnd > t.start).map((r) => r.block.col));
    let col = 0;
    while (taken.has(col)) col++;
    const block: CalendarBlock = { id: t.e.id, title: t.e.title, location: t.e.location, start: t.start, end: t.end, label: `${clockLabel(t.start)} – ${clockLabel(t.end)}`, col, cols: 1, free: t.e.free === true, interview: t.e.source === "interview", color: safeHex(t.e.color), declined: t.e.declined === true };
    blocks.push(block);
    run.push({ block, shownEnd });
    runEnd = Math.max(runEnd, shownEnd);
  }
  if (run.length) close();

  const first = blocks.length ? Math.min(...blocks.map((b) => b.start)) : GRID_DEFAULT.from;
  const last = blocks.length ? Math.max(...blocks.map((b) => Math.max(b.end, b.start + MIN_BLOCK_MIN))) : GRID_DEFAULT.to;
  const from = Math.min(GRID_DEFAULT.from, Math.floor(first / 60) * 60);
  const to = Math.min(24 * 60, Math.max(GRID_DEFAULT.to, Math.ceil(last / 60) * 60));
  const hours: number[] = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  const halves = hours.slice(0, -1).map((m) => m + 30);
  return { allDay, blocks, from, to, hours, halves };
}

/** Where a minute sits on the grid, 0 to 100, or null when it is off the grid. */
export function gridPercent(view: Pick<DayCalendarView, "from" | "to">, minute: number): number | null {
  if (minute < view.from || minute > view.to) return null;
  return ((minute - view.from) / (view.to - view.from)) * 100;
}

/** "noon", "9 AM": the hour labels down the side. */
export function hourName(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  return h === 12 ? "Noon" : h === 0 ? "12 AM" : h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/** How many hours the calendar shows at once; the rest scrolls. Six unless you pick another. */
export const WINDOW_CHOICES = [4, 6, 8] as const;
export type WindowHours = (typeof WINDOW_CHOICES)[number];
export const WINDOW_DEFAULT: WindowHours = 6;
/** The cookie that remembers, on this device, how many hours the calendar shows. A display preference only. */
export const HOURS_COOKIE = "atlas_cal_hours";
export const windowHours = (raw: string | string[] | undefined): WindowHours => {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  return (WINDOW_CHOICES as readonly number[]).includes(n) ? (n as WindowHours) : WINDOW_DEFAULT;
};

/** The view Today opens in: the calendar only when asked for by name. */
export const todayView = (raw: string | string[] | undefined): "today" | "calendar" => (raw === "calendar" ? "calendar" : "today");

/** "9:41 AM": the large clock, written the way the browser will write it once it is live. */
export function clockFull(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}
