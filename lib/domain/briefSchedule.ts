// When the Chief of Staff runs, by the plan's Daily Rhythm and Weekend Mode:
//   Monday-Friday  Morning Brief (9:00 AM) and 2:00 PM Brief
//   Saturday       one lighter brief in the morning
//   Sunday         off
// Pure: takes a local date and time, so it is testable and timezone-safe.

import { addDays, localDate, mondayOf, shortDate, weekdayIndex, weekOf } from "./dates";
import type { BriefSlot, LedgerEntry, LocalDate } from "./types";

export const BRIEF_TIMES: Record<BriefSlot, string> = { morning: "09:00", afternoon: "14:00", saturday: "09:00" };
export const SLOT_LABEL: Record<BriefSlot, string> = { morning: "Morning Brief", afternoon: "2:00 PM Brief", saturday: "Saturday Brief" };

/** The briefs a given day gets. weekdayIndex: 0 = Monday ... 6 = Sunday. */
export function slotsFor(day: LocalDate): BriefSlot[] {
  const w = weekdayIndex(day);
  if (w === 6) return [];
  if (w === 5) return ["saturday"];
  return ["morning", "afternoon"];
}

/**
 * The brief a scheduled run at this local time should produce, or null when Weekend
 * Mode says there is none. `wanted` is the slot the scheduler was triggered for.
 */
export function scheduledSlot(day: LocalDate, wanted: "morning" | "afternoon"): BriefSlot | null {
  const slots = slotsFor(day);
  if (wanted === "afternoon") return slots.includes("afternoon") ? "afternoon" : null;
  return slots.includes("morning") ? "morning" : slots.includes("saturday") ? "saturday" : null;
}

/** The slot a manual "Run now" fills: the brief that is current at this time of day. */
export function currentSlot(day: LocalDate, time: string): BriefSlot {
  const slots = slotsFor(day);
  if (slots.includes("afternoon") && time >= "12:00") return "afternoon";
  if (slots.includes("morning")) return "morning";
  return "saturday";
}

/** The next scheduled brief after this moment, for Mission Control's "next run". */
export function nextBrief(day: LocalDate, time: string): { day: LocalDate; slot: BriefSlot } {
  for (let i = 0; i < 8; i++) {
    const d = addDays(day, i);
    for (const slot of slotsFor(d)) {
      if (i > 0 || BRIEF_TIMES[slot] > time) return { day: d, slot };
    }
  }
  return { day: addDays(day, 1), slot: "morning" };
}

/** Last day a brief's calendar covers: tomorrow on Saturday, else the week ahead. */
export function aheadUntil(day: LocalDate, slot: BriefSlot): LocalDate {
  return addDays(day, slot === "saturday" ? 1 : 6);
}

// ---------------------------------------------------------------------------
// The day's briefs on Today

/** What you call each brief: "View Afternoon Brief", "Morning Brief: briefed". */
export const BRIEF_NAME: Record<BriefSlot, string> = { morning: "Morning Brief", afternoon: "Afternoon Brief", saturday: "Saturday Brief" };

/** Newest on top: the 2:00 PM brief sits above the morning one once it comes in. */
export const TODAY_ORDER: readonly BriefSlot[] = ["afternoon", "saturday", "morning"];

/** Today's saved briefs, newest first, one per slot. */
export function todaysBriefs<T extends { slot: BriefSlot }>(saved: T[]): T[] {
  return TODAY_ORDER.flatMap((slot) => saved.find((b) => b.slot === slot) ?? []);
}

/** How "you were briefed" is written in the time-saved ledger, per brief. */
export const BRIEFED_ACTIVITY: Record<BriefSlot, string> = { morning: "Morning brief", afternoon: "Afternoon brief", saturday: "Saturday brief" };

/**
 * How confirming a past day's brief is written in the ledger. It names the day, so it counts
 * for that day and not for today's brief of the same name.
 */
export const caughtUpActivity = (slot: BriefSlot, day: LocalDate): string => `${BRIEFED_ACTIVITY[slot]} (${shortDate(day)}, caught up)`;

/**
 * The briefs of `day` you confirmed reading: on the day itself, or later while catching up.
 * Each brief is confirmed on its own.
 */
export function briefedSlots(ledger: Pick<LedgerEntry, "agent" | "activity" | "at">[], day: LocalDate, timeZone: string): BriefSlot[] {
  const mine = ledger.filter((e) => e.agent === "chief-of-staff");
  return (Object.keys(BRIEFED_ACTIVITY) as BriefSlot[]).filter((slot) =>
    mine.some((e) => (e.activity === BRIEFED_ACTIVITY[slot] && localDate(new Date(e.at), timeZone) === day) || e.activity === caughtUpActivity(slot, day)),
  );
}

// ---------------------------------------------------------------------------
// Catching up: if you miss a day's briefs, you can open them for two days after, with every
// action they had (Briefed, thumbs, fit check). Never past this week's Monday: you
// catch up by the weekend, and a new week starts clean.

/** How many days the switcher on Today covers, today included. */
export const CATCH_UP_DAYS = 3;

/** The days before today whose briefs you can still open, newest first: this week only. */
export function catchUpDays(today: LocalDate): LocalDate[] {
  const monday = mondayOf(today);
  const out: LocalDate[] = [];
  for (let i = 1; i < CATCH_UP_DAYS; i++) {
    const d = addDays(today, -i);
    if (d < monday) break;
    if (slotsFor(d).length > 0) out.push(d);
  }
  return out;
}

/** How a day looks on the brief calendar: today, open to catch up on, or not selectable and why. */
export type BriefWeekState = "today" | "open" | "none-saved" | "too-old" | "ahead";

/**
 * This week, Monday to Sunday, as the brief calendar on Today draws it. Only today and the
 * catch-up days (`days`, from catchUpSummary) can be opened; the rest are shown for context.
 */
export function briefWeek(today: LocalDate, days: readonly { day: LocalDate; saved: number; unread: number }[]): { day: LocalDate; state: BriefWeekState; unread: number }[] {
  return weekOf(today).map((day) => {
    if (day === today) return { day, state: "today", unread: 0 };
    if (day > today) return { day, state: "ahead", unread: 0 };
    const back = days.find((d) => d.day === day);
    if (!back) return { day, state: "too-old", unread: 0 };
    return back.saved > 0 ? { day, state: "open", unread: back.unread } : { day, state: "none-saved", unread: 0 };
  });
}

/** The day a ?day= link asks for: one of the catch-up days, else today. Anything older or malformed is today. */
export function pickBriefDay(raw: unknown, today: LocalDate): LocalDate {
  return typeof raw === "string" && catchUpDays(today).includes(raw) ? raw : today;
}

/** How many of a day's saved briefs you have not confirmed. */
export const unreadCount = (saved: readonly { slot: BriefSlot }[], briefed: readonly BriefSlot[]): number => saved.filter((b) => !briefed.includes(b.slot)).length;

/** For the day switcher: each catch-up day with how many briefs were saved and how many you have not confirmed. */
export function catchUpSummary(
  days: readonly LocalDate[],
  saved: readonly (readonly { slot: BriefSlot }[])[],
  ledger: Pick<LedgerEntry, "agent" | "activity" | "at">[],
  timeZone: string,
): { day: LocalDate; saved: number; unread: number }[] {
  return days.map((day, i) => {
    const s = saved[i] ?? [];
    return { day, saved: s.length, unread: unreadCount(s, briefedSlots(ledger, day, timeZone)) };
  });
}

// ---------------------------------------------------------------------------
// The 2-hour sync: Monday to Saturday, every two hours from 6:00 AM to 4:00 PM.
// Between briefs, every agent reports to the Chief of Staff so each page in Atlas is at
// most two hours old. It refreshes data; it does not write a brief.

export const SYNC_TASK = "2-hour sync";
export const SYNC_HOURS: readonly number[] = [6, 8, 10, 12, 14, 16];

/** True on a sync day (Monday to Saturday; Sunday is off). */
export const isSyncDay = (day: LocalDate) => weekdayIndex(day) <= 5;

/**
 * True when a scheduled call at this local time should run the sync. The scheduler fires
 * once in every candidate hour (it runs on UTC and its timing is approximate), so the
 * local hour decides: any minute inside a sync hour counts.
 */
export function isSyncTime(day: LocalDate, time: string): boolean {
  return isSyncDay(day) && SYNC_HOURS.includes(Number(time.slice(0, 2)));
}

/** The next sync after this moment: its day and hour (24h). */
export function nextSync(day: LocalDate, time: string): { day: LocalDate; hour: number } {
  const hourNow = Number(time.slice(0, 2));
  for (let i = 0; i < 8; i++) {
    const d = addDays(day, i);
    if (!isSyncDay(d)) continue;
    const hour = SYNC_HOURS.find((h) => i > 0 || h > hourNow);
    if (hour !== undefined) return { day: d, hour };
  }
  return { day: addDays(day, 1), hour: SYNC_HOURS[0]! };
}

/** "6 AM", "12 PM", "4 PM". */
export const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
