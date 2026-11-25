import { describe, expect, it } from "vitest";
import { zonedToUtc } from "@/lib/domain/dates";
import { clockFull, windowHours, dayCalendar, GRID_DEFAULT, gridPercent, hourName, MIN_BLOCK_MIN, todayView } from "@/lib/domain/dayCalendar";
import type { CalendarEvent } from "@/lib/domain/types";

const TZ = "America/Denver";
const DAY = "2026-11-24";
const at = (hhmm: string, day = DAY) => zonedToUtc(day, hhmm, TZ).toISOString();
let n = 0;
const ev = (title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: `e${++n}`, title, start: at(start), end: at(end), allDay: false, location: "", source: "calendar", ...extra });

describe("dayCalendar", () => {
  it("shows the working day when the calendar is empty", () => {
    const v = dayCalendar([], DAY, TZ);
    expect(v.blocks).toEqual([]);
    expect(v.allDay).toEqual([]);
    expect([v.from, v.to]).toEqual([GRID_DEFAULT.from, GRID_DEFAULT.to]);
    expect(v.hours[0]).toBe(7 * 60);
    expect(v.hours.at(-1)).toBe(20 * 60);
  });

  it("orders events by start and labels their times", () => {
    const v = dayCalendar([ev("Lunch", "12:00", "13:00"), ev("Standup", "09:00", "09:30", { location: "Zoom" })], DAY, TZ);
    expect(v.blocks.map((b) => b.title)).toEqual(["Standup", "Lunch"]);
    expect(v.blocks[0]).toMatchObject({ start: 540, end: 570, label: "9a – 9:30a", location: "Zoom", col: 0, cols: 1 });
  });

  it("keeps all-day events off the grid", () => {
    const holiday: CalendarEvent = { id: "h", title: "Day off", start: `${DAY}T00:00:00.000Z`, end: `${DAY}T00:00:00.000Z`, allDay: true, location: "", source: "calendar" };
    const v = dayCalendar([holiday, ev("Call", "10:00", "10:30")], DAY, TZ);
    expect(v.allDay).toEqual([{ id: "h", title: "Day off", color: null }]);
    expect(v.blocks).toHaveLength(1);
  });

  it("puts overlapping events side by side and gives the next run the full width", () => {
    const v = dayCalendar([ev("A", "09:00", "10:30"), ev("B", "09:30", "10:00"), ev("C", "10:00", "11:00"), ev("D", "14:00", "15:00")], DAY, TZ);
    const by = Object.fromEntries(v.blocks.map((b) => [b.title, b]));
    expect([by.A!.col, by.B!.col, by.C!.col]).toEqual([0, 1, 1]);
    expect([by.A!.cols, by.B!.cols, by.C!.cols]).toEqual([2, 2, 2]);
    expect(by.D).toMatchObject({ col: 0, cols: 1 });
  });

  it("draws events at their real length, so back-to-back events never look like they overlap", () => {
    // The owner's day (24 Nov 2026): Break 4:00-4:15, then Wrap Up Day Flow at 4:15.
    const v = dayCalendar([ev("Break", "16:00", "16:15"), ev("Wrap Up Day Flow", "16:15", "17:00"), ev("Quick", "09:00", "09:10"), ev("Next", "09:15", "10:00")], DAY, TZ);
    expect(MIN_BLOCK_MIN).toBeLessThanOrEqual(5);
    // Each sits full width in its own row: none share a run.
    expect(v.blocks.map((b) => [b.title, b.col, b.cols])).toEqual([
      ["Quick", 0, 1],
      ["Next", 0, 1],
      ["Break", 0, 1],
      ["Wrap Up Day Flow", 0, 1],
    ]);
    const brk = v.blocks.find((b) => b.title === "Break")!;
    const wrap = v.blocks.find((b) => b.title === "Wrap Up Day Flow")!;
    expect(Math.max(brk.end, brk.start + MIN_BLOCK_MIN)).toBeLessThanOrEqual(wrap.start);
  });
  it("still puts events that truly overlap side by side", () => {
    const v = dayCalendar([ev("A", "16:00", "16:30"), ev("B", "16:15", "17:00")], DAY, TZ);
    expect(v.blocks.map((b) => [b.col, b.cols])).toEqual([[0, 2], [1, 2]]);
  });

  it("grows the grid for early and late events, and never past midnight", () => {
    const v = dayCalendar([ev("Run", "05:30", "06:15"), ev("Late", "21:00", "23:50")], DAY, TZ);
    expect([v.from, v.to]).toEqual([5 * 60, 24 * 60]);
  });

  it("clips an event that started yesterday and drops other days", () => {
    const overnight = ev("Flight", "22:00", "08:00", { start: at("22:00", "2026-11-23") });
    const tomorrow = ev("Tomorrow", "09:00", "10:00", { start: at("09:00", "2026-11-25"), end: at("10:00", "2026-11-25") });
    const v = dayCalendar([overnight, tomorrow], DAY, TZ);
    expect(v.blocks).toHaveLength(1);
    expect(v.blocks[0]).toMatchObject({ title: "Flight", start: 0, end: 480 });
    expect(v.from).toBe(0);
  });

  it("marks free time and interviews", () => {
    const v = dayCalendar([ev("Hold", "09:00", "10:00", { free: true }), ev("Interview", "11:00", "12:00", { source: "interview" })], DAY, TZ);
    expect(v.blocks.map((b) => [b.free, b.interview])).toEqual([[true, false], [false, true]]);
  });
});

describe("grid helpers", () => {
  it("places a minute on the grid, or nowhere when it is off it", () => {
    const v = { from: 7 * 60, to: 20 * 60 };
    expect(gridPercent(v, 7 * 60)).toBe(0);
    expect(gridPercent(v, 20 * 60)).toBe(100);
    expect(gridPercent(v, 13 * 60 + 30)).toBe(50);
    expect(gridPercent(v, 6 * 60)).toBeNull();
    expect(gridPercent(v, 21 * 60)).toBeNull();
  });
  it("names the hours", () => {
    expect([0, 9 * 60, 12 * 60, 15 * 60, 24 * 60].map(hourName)).toEqual(["12 AM", "9 AM", "Noon", "3 PM", "12 AM"]);
  });
  it("writes the large clock in full", () => {
    expect([0, 9 * 60 + 5, 12 * 60, 15 * 60 + 41].map(clockFull)).toEqual(["12:00 AM", "9:05 AM", "12:00 PM", "3:41 PM"]);
  });
  it("shows 4, 6 or 8 hours at once, 6 unless asked", () => {
    expect(["4", "6", "8"].map(windowHours)).toEqual([4, 6, 8]);
    expect([undefined, "5", "24", "abc", ["8"]].map(windowHours)).toEqual([6, 6, 6, 6, 6]);
  });
  it("opens the calendar only when asked for by name", () => {
    expect(todayView("calendar")).toBe("calendar");
    expect([undefined, "", "week", ["calendar"]].map(todayView)).toEqual(["today", "today", "today", "today"]);
  });
});

describe("Google's look", () => {
  it("draws half-hour lines between the hours", () => {
    const v = dayCalendar([], DAY, TZ);
    expect(v.halves[0]).toBe(7 * 60 + 30);
    expect(v.halves).toHaveLength(v.hours.length - 1);
  });
  it("carries Google's color and declined events through, and drops a color that is not plain hex", () => {
    const v = dayCalendar([ev("Lunch", "12:00", "13:00", { color: "#0B8043" }), ev("Party", "18:00", "19:00", { declined: true }), ev("Bad", "09:00", "10:00", { color: "red;x" })], DAY, TZ);
    const by = Object.fromEntries(v.blocks.map((b) => [b.title, b]));
    expect(by.Lunch).toMatchObject({ color: "#0b8043", declined: false });
    expect(by.Party).toMatchObject({ color: null, declined: true });
    expect(by.Bad!.color).toBeNull();
  });
});
