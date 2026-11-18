// Calendar-date helpers that work in the owner's timezone, not the server's.
// A server on Vercel runs in UTC; "today" must still mean the owner's today.

import type { LocalDate } from "./types";

/** The local date ("YYYY-MM-DD") of `instant` in `timeZone`. */
export function localDate(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Local "HH:MM" (24h) of `instant` in `timeZone`. */
export function localTime(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("hour")}:${get("minute")}`;
}

/** Date arithmetic on plain calendar dates (no timezone involved). */
export function addDays(day: LocalDate, days: number): LocalDate {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** 0 = Monday ... 6 = Sunday. */
export function weekdayIndex(day: LocalDate): number {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function mondayOf(day: LocalDate): LocalDate {
  return addDays(day, -weekdayIndex(day));
}

export function weekOf(day: LocalDate): LocalDate[] {
  const monday = mondayOf(day);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  const toUtc = (s: LocalDate) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekdayName(day: LocalDate): string {
  return WEEKDAY_NAMES[weekdayIndex(day)] ?? "";
}

/** "Wed, Nov 11" */
export function shortDate(day: LocalDate): string {
  const [, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${weekdayName(day).slice(0, 3)}, ${MONTHS[m - 1]} ${d}`;
}

/** "Wednesday, November 11" style long date for headers. */
export function longDate(day: LocalDate): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function greeting(hhmm: string): string {
  const hour = Number(hhmm.slice(0, 2));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/**
 * Converts a wall-clock time in `timeZone` to a UTC instant.
 * Used by the iCalendar parser for DTSTART;TZID=... values.
 */
export function zonedToUtc(day: LocalDate, hhmm: string, timeZone: string): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const [hh, mm] = hhmm.split(":").map(Number) as [number, number];
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Find the zone's offset at that moment, then correct once more for DST edges.
  const offsetAt = (ms: number) => {
    const local = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ms));
    const g = (t: string) => Number(local.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
    return asUtc - ms;
  };
  const first = guess - offsetAt(guess);
  return new Date(guess - offsetAt(first));
}
