// Bills, renewals and documents. Rules decide what needs a look and when the next
// due date is. The page only renders what these functions return.

import { addDays, daysBetween, shortDate } from "./dates";
import type { LocalDate, Renewal, RenewalCadence } from "./types";

export type { Renewal, RenewalCadence, RenewalKind } from "./types";
export { RENEWAL_CADENCES, RENEWAL_KINDS } from "./types";

export type RenewalAttention = "overdue" | "today" | "soon";

export interface RenewalRow {
  renewal: Renewal;
  attention: RenewalAttention;
  /** Negative when the due date is before today. */
  daysUntil: number;
}

export interface RenewalView {
  /** Overdue, due today, or inside the lead window. Soonest first. */
  attention: RenewalRow[];
  /** Still outside the lead window. Soonest first. */
  later: RenewalRow[];
}

export function isCalendarDate(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  if (month < 1 || month > 12) return false;
  return date >= 1 && date <= daysInMonth(year, month);
}

export function anchorDayOf(dueOn: LocalDate): number {
  return Number(dueOn.slice(8, 10));
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Move `from` by `months`, clamping the day to `anchorDay` and the month length. */
export function addMonths(from: LocalDate, months: number, anchorDay: number): LocalDate {
  const year = Number(from.slice(0, 4));
  const month = Number(from.slice(5, 7));
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const day = Math.min(Math.max(anchorDay, 1), daysInMonth(nextYear, nextMonth));
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The next due date after this one has been handled.
 * `once` is finished and returns null. Monthly and yearly step until the result
 * is strictly after `today`, so a date that lapsed for several cycles catches up
 * in one tap instead of staying overdue.
 */
export function nextDueOn(
  dueOn: LocalDate,
  anchorDay: number,
  cadence: RenewalCadence,
  today: LocalDate,
): LocalDate | null {
  if (cadence === "once") return null;
  const months = cadence === "yearly" ? 12 : 1;
  let cursor = dueOn;
  for (let i = 0; i < 480; i++) {
    const stepped = addMonths(cursor, months, anchorDay);
    if (stepped <= cursor) return addDays(today, 1);
    cursor = stepped;
    if (cursor > today) return cursor;
  }
  return cursor;
}

/** https URL with a real host and no embedded username. Anything else is not a link. */
export function renewalHref(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (!parsed.hostname.includes(".")) return null;
  if (!parsed.href.startsWith("https://")) return null;
  return parsed.href;
}

/** "Sun, Nov 8" in the same year, and "Fri, Dec 17, 2027" when the year differs. */
export function renewalDueLabel(dueOn: LocalDate, today: LocalDate): string {
  const label = shortDate(dueOn);
  return dueOn.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${dueOn.slice(0, 4)}`;
}

export function renewalWhen(daysUntil: number): string {
  if (daysUntil < 0) {
    const n = -daysUntil;
    return n === 1 ? "1 day overdue" : `${n} days overdue`;
  }
  if (daysUntil === 0) return "Due today";
  return daysUntil === 1 ? "In 1 day" : `In ${daysUntil} days`;
}

function attentionOf(daysUntil: number): RenewalAttention {
  if (daysUntil < 0) return "overdue";
  if (daysUntil === 0) return "today";
  return "soon";
}

export function renewalView(items: Renewal[], today: LocalDate): RenewalView {
  const rows = items.map((renewal) => {
    const daysUntil = daysBetween(today, renewal.dueOn);
    return { renewal, daysUntil, attention: attentionOf(daysUntil) };
  });
  const bySoonest = (a: RenewalRow, b: RenewalRow) =>
    a.daysUntil - b.daysUntil || a.renewal.title.localeCompare(b.renewal.title);
  return {
    attention: rows.filter((row) => row.daysUntil <= row.renewal.leadDays).sort(bySoonest),
    later: rows.filter((row) => row.daysUntil > row.renewal.leadDays).sort(bySoonest),
  };
}
