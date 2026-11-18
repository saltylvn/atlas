import { describe, expect, it } from "vitest";
import { zonedToUtc } from "@/lib/domain/dates";
import {
  blockDay,
  dayInsights,
  longestMeetingRun,
  rollForwardTargets,
  clockLabel,
  eventInterval,
  freeSlots,
  fromMinutes,
  isDayOff,
  mergeIntervals,
  nowNext,
  suggestMoves,
  toMinutes,
  weekLoad,
  workHoursFrom,
  type WorkHours,
} from "@/lib/domain/schedule";
import type { CalendarEvent, Task } from "@/lib/domain/types";

const TZ = "America/Denver";
const DAY = "2026-11-11"; // Wednesday
const WORK: WorkHours = { start: 8 * 60, end: 17 * 60 + 30, minSlotMin: 15, bufferMin: 5 };

const at = (hhmm: string, day = DAY) => zonedToUtc(day, hhmm, TZ).toISOString();
let n = 0;
const ev = (start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `e${++n}`,
  title: "Meeting",
  start: at(start),
  end: at(end),
  allDay: false,
  location: "",
  source: "calendar",
  ...extra,
});
const allDay = (title: string, day = DAY): CalendarEvent => ({
  id: `a${++n}`,
  title,
  start: `${day}T00:00:00.000Z`,
  end: `${day}T00:00:00.000Z`,
  allDay: true,
  location: "",
  source: "calendar",
});
const task = (t: Partial<Task>): Task => ({
  id: t.id ?? `t${++n}`,
  title: t.title ?? "task",
  notes: "",
  status: "todo",
  priority: "medium",
  area: "work",
  day: DAY,
  startTime: null,
  estimateMin: 30,
  energy: "shallow",
  recurrence: "none",
  createdAt: "2026-11-01T00:00:00Z",
  completedAt: null,
  ...t,
});
const m = toMinutes;

describe("time helpers", () => {
  it("parses and formats HH:MM", () => {
    expect(m("09:30")).toBe(570);
    expect(Number.isNaN(m("9:30"))).toBe(true);
    expect(fromMinutes(570)).toBe("09:30");
    expect(clockLabel(m("12:00"))).toBe("12p");
    expect(clockLabel(m("09:05"))).toBe("9:05a");
  });
  it("falls back to default work hours for bad settings", () => {
    expect(workHoursFrom({})).toEqual(WORK);
    expect(workHoursFrom({ workStart: "17:00", workEnd: "09:00" }).start).toBe(480);
    expect(workHoursFrom({ workStart: "07:00", workEnd: "15:00", meetingBufferMin: 0 })).toMatchObject({ start: 420, end: 900, bufferMin: 0 });
  });
  it("merges overlapping and touching intervals", () => {
    expect(mergeIntervals([{ start: 60, end: 120 }, { start: 0, end: 30 }, { start: 30, end: 45 }, { start: 100, end: 150 }])).toEqual([
      { start: 0, end: 45 },
      { start: 60, end: 150 },
    ]);
  });
});

describe("freeSlots", () => {
  it("returns the whole work day when the calendar is empty", () => {
    expect(freeSlots({ day: DAY, timeZone: TZ, events: [], work: WORK })).toEqual([{ start: 480, end: 1050 }]);
  });
  it("cuts meetings out with buffers, merging overlaps", () => {
    const events = [ev("10:00", "11:00"), ev("10:30", "11:30"), ev("14:00", "15:00")];
    expect(freeSlots({ day: DAY, timeZone: TZ, events, work: WORK })).toEqual([
      { start: 480, end: m("09:55") },
      { start: m("11:35"), end: m("13:55") },
      { start: m("15:05"), end: 1050 },
    ]);
  });
  it("drops gaps shorter than the minimum slot", () => {
    const events = [ev("09:00", "10:00"), ev("10:15", "11:00")];
    const slots = freeSlots({ day: DAY, timeZone: TZ, events, work: WORK });
    expect(slots.find((s) => s.start === m("10:05"))).toBeUndefined();
  });
  it("ignores ordinary all-day events but treats OOO as no free time", () => {
    expect(freeSlots({ day: DAY, timeZone: TZ, events: [allDay("Mom's birthday")], work: WORK })).toHaveLength(1);
    expect(isDayOff(allDay("Out of office"))).toBe(true);
    expect(freeSlots({ day: DAY, timeZone: TZ, events: [allDay("PTO")], work: WORK })).toEqual([]);
  });
  it("skips time already gone today, rounded up to 5 minutes", () => {
    expect(freeSlots({ day: DAY, timeZone: TZ, events: [], work: WORK, nowMin: m("13:02") })).toEqual([{ start: m("13:05"), end: 1050 }]);
  });
  it("has no free time after work hours or in a wall-to-wall day", () => {
    expect(freeSlots({ day: DAY, timeZone: TZ, events: [], work: WORK, nowMin: m("18:00") })).toEqual([]);
    expect(freeSlots({ day: DAY, timeZone: TZ, events: [ev("07:00", "18:00")], work: WORK })).toEqual([]);
  });
  it("clips events that cross midnight", () => {
    const overnight = ev("22:00", "09:00", { start: at("22:00", "2026-11-10"), end: at("09:00", DAY) });
    expect(eventInterval(overnight, DAY, TZ)).toEqual({ start: 0, end: 540 });
    expect(freeSlots({ day: DAY, timeZone: TZ, events: [overnight], work: WORK })[0]!.start).toBe(m("09:05"));
    expect(eventInterval(ev("10:00", "11:00"), "2026-11-12", TZ)).toBeNull();
  });
});

describe("blockDay", () => {
  const base = { day: DAY, timeZone: TZ, work: WORK, dailyCapacityMin: 360, nowMin: null };

  it("places tasks by priority, deep work early and shallow work in tight gaps", () => {
    const events = [ev("09:00", "09:30"), ev("12:00", "13:00")];
    const tasks = [
      task({ id: "deep", priority: "high", energy: "deep", estimateMin: 90 }),
      task({ id: "quick", priority: "medium", estimateMin: 20 }),
      task({ id: "crit", priority: "critical", estimateMin: 30 }),
    ];
    const s = blockDay({ ...base, events, tasks });
    const byId = Object.fromEntries(s.blocks.map((b) => [b.taskId, b]));
    // Free: 8:00-8:55 (55m), 9:35-11:55 (140m), 13:05-17:30.
    expect(byId.crit).toEqual({ taskId: "crit", start: 480, end: 510 }); // tightest gap that fits
    expect(byId.deep!.start).toBe(m("09:35")); // earliest gap that fits 90m
    expect(byId.quick).toEqual({ taskId: "quick", start: 510, end: 530 });
    expect(s.overflow).toEqual([]);
    expect(s.timeline.map((i) => i.kind)).toEqual(["focus", "focus", "event", "focus", "event"]);
  });

  it("never blocks more than the day's capacity", () => {
    const tasks = [task({ id: "a", priority: "high", estimateMin: 200 }), task({ id: "b", estimateMin: 200 }), task({ id: "c", priority: "low", estimateMin: 100 })];
    const s = blockDay({ ...base, events: [], tasks });
    expect(s.blocks.map((b) => b.taskId)).toEqual(["a", "c"]);
    expect(s.overflow).toEqual([{ taskId: "b", reason: "capacity" }]);
    expect(s.blockedMin).toBeLessThanOrEqual(360);
  });

  it("reports tasks that have no gap long enough", () => {
    const events = [ev("08:00", "10:00"), ev("10:45", "13:00"), ev("13:45", "17:30")];
    const s = blockDay({ ...base, events, tasks: [task({ id: "big", estimateMin: 60 }), task({ id: "small", estimateMin: 30 })] });
    expect(s.overflow).toEqual([{ taskId: "big", reason: "no-slot" }]);
    expect(s.blocks.map((b) => b.taskId)).toEqual(["small"]);
  });

  it("keeps pinned tasks fixed, flags meeting clashes, and re-blocks pins that went by", () => {
    const events = [ev("10:00", "10:30")];
    const tasks = [
      task({ id: "pin", startTime: "09:30", estimateMin: 60 }),
      task({ id: "missed", startTime: "08:00", estimateMin: 30 }),
      task({ id: "loose", estimateMin: 30 }),
    ];
    const s = blockDay({ ...base, events, tasks, nowMin: m("09:00") });
    expect(s.timeline.find((i) => i.taskId === "pin")).toMatchObject({ kind: "pinned", start: 570, end: 630 });
    expect(s.conflicts).toEqual([{ taskId: "pin", eventId: events[0]!.id }]);
    const missed = s.blocks.find((b) => b.taskId === "missed")!;
    expect(missed.start).toBeGreaterThanOrEqual(m("09:00"));
    expect(s.blocks.every((b) => b.start >= m("09:00"))).toBe(true);
  });

  it("pulls overdue tasks into today but not into a future day", () => {
    const overdue = task({ id: "late", day: "2026-11-10", priority: "high" });
    expect(blockDay({ ...base, events: [], tasks: [overdue], nowMin: m("08:00") }).blocks).toHaveLength(1);
    expect(blockDay({ ...base, events: [], tasks: [overdue] }).blocks).toHaveLength(0);
  });

  it("blocks nothing on a day off or when the day is over", () => {
    const tasks = [task({ id: "x" })];
    expect(blockDay({ ...base, events: [allDay("Vacation")], tasks }).blocks).toEqual([]);
    const late = blockDay({ ...base, events: [], tasks, nowMin: m("17:45") });
    expect(late.blocks).toEqual([]);
    expect(late.overflow).toEqual([{ taskId: "x", reason: "no-slot" }]);
  });

  it("ignores done tasks", () => {
    expect(blockDay({ ...base, events: [], tasks: [task({ status: "done" })] }).blocks).toEqual([]);
  });
});

describe("nowNext", () => {
  const base = { day: DAY, timeZone: TZ, work: WORK, dailyCapacityMin: 360 };
  const events = [ev("10:00", "11:00", { title: "Standup" }), ev("14:00", "15:00", { title: "Customer call" })];
  const tasks = [task({ id: "focus", title: "Write the deck", estimateMin: 45 })];

  it("in a gap: shows minutes until the next meeting and what to do", () => {
    const now = m("09:00");
    const s = blockDay({ ...base, events, tasks, nowMin: now });
    const nn = nowNext(s, now);
    expect(nn.state).toBe("working");
    expect(nn.current).toBeNull();
    expect(nn.next?.title).toBe("Standup");
    expect(nn.gap).toMatchObject({ start: now, end: m("10:00"), minutes: 60 });
    expect(nn.gap?.suggestion?.taskId).toBe("focus");
  });

  it("in a meeting: current is the meeting, next is the following one", () => {
    const now = m("10:15");
    const nn = nowNext(blockDay({ ...base, events, tasks, nowMin: now }), now);
    expect(nn.current?.title).toBe("Standup");
    expect(nn.next?.title).toBe("Customer call");
    expect(nn.gap).toBeNull();
  });

  it("before and after work", () => {
    const early = nowNext(blockDay({ ...base, events, tasks, nowMin: m("06:30") }), m("06:30"));
    expect(early.state).toBe("before-work");
    expect(early.gap?.start).toBe(WORK.start);
    const late = nowNext(blockDay({ ...base, events, tasks, nowMin: m("19:00") }), m("19:00"));
    expect(late.state).toBe("after-work");
    expect(late.gap).toBeNull();
    expect(late.next).toBeNull();
  });
});

describe("weekLoad and suggestMoves", () => {
  const days = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]; // Wed..Sat
  const busyThursday = [ev("08:00", "15:00", { start: at("08:00", "2026-11-12"), end: at("15:00", "2026-11-12") })];

  it("computes free time vs planned load per day", () => {
    const tasks = [task({ day: "2026-11-12", estimateMin: 240, priority: "low" })];
    const loads = weekLoad({ days, today: DAY, nowMin: m("12:00"), timeZone: TZ, events: busyThursday, tasks, work: WORK, dailyCapacityMin: 360 });
    expect(loads[0]).toMatchObject({ freeMin: 330, availableMin: 330, plannedMin: 0 }); // 12:00-17:30
    expect(loads[1]).toMatchObject({ freeMin: m("17:30") - m("15:05"), plannedMin: 240 });
    expect(loads[1]!.overMin).toBe(240 - 145);
    expect(loads[3]!.capacityMin).toBe(180); // Saturday: half
  });

  it("moves the least important tasks to the lightest allowed day, never critical ones", () => {
    const tasks = [
      task({ id: "crit", day: "2026-11-12", priority: "critical", estimateMin: 120 }),
      task({ id: "low", day: "2026-11-12", priority: "low", estimateMin: 60 }),
      task({ id: "med", day: "2026-11-12", priority: "medium", estimateMin: 60 }),
    ];
    const loads = weekLoad({ days, today: DAY, nowMin: m("08:00"), timeZone: TZ, events: busyThursday, tasks, work: WORK, dailyCapacityMin: 360 });
    const moves = suggestMoves(loads, tasks, DAY);
    expect(moves.map((x) => x.taskId)).toEqual(["low", "med"]);
    expect(moves.every((x) => x.to !== "2026-11-14")).toBe(true); // work tasks stay off the weekend
    expect(moves.some((x) => x.taskId === "crit")).toBe(false);
  });

  it("suggests nothing when every day fits", () => {
    const tasks = [task({ day: "2026-11-12", estimateMin: 30 })];
    const loads = weekLoad({ days, today: DAY, nowMin: m("08:00"), timeZone: TZ, events: [], tasks, work: WORK, dailyCapacityMin: 360 });
    expect(suggestMoves(loads, tasks, DAY)).toEqual([]);
  });
});

describe("insights and shutdown", () => {
  const base = { day: DAY, timeZone: TZ, work: WORK, dailyCapacityMin: 360, nowMin: null };

  it("warns about heavy meeting days and back-to-back runs", () => {
    const events = [ev("08:00", "09:00"), ev("09:05", "10:30"), ev("10:40", "12:00"), ev("13:00", "14:00")];
    const s = blockDay({ ...base, events, tasks: [] });
    const text = dayInsights(s).map((i) => i.text).join(" | ");
    expect(longestMeetingRun(s.timeline)).toEqual({ start: 480, end: 720 });
    expect(text).toContain("Meetings take");
    expect(text).toContain("4h of back-to-back meetings from 8a to 12p");
  });

  it("points at the best focus window, or warns when there is none", () => {
    const open = dayInsights(blockDay({ ...base, events: [ev("12:00", "13:00")], tasks: [] }));
    expect(open.find((i) => i.level === "info")?.text).toContain("Best focus window: 1:05p–5:30p");
    const choppy = [ev("08:30", "09:30"), ev("10:15", "11:15"), ev("12:00", "13:00"), ev("13:45", "14:45"), ev("15:30", "16:30")];
    expect(dayInsights(blockDay({ ...base, events: choppy, tasks: [] })).some((i) => i.text.startsWith("No free hour"))).toBe(true);
    expect(dayInsights(blockDay({ ...base, events: [allDay("OOO")], tasks: [] }))).toEqual([]);
  });

  it("rolls unfinished non-recurring tasks to the next allowed day", () => {
    const fri = "2026-11-13";
    const next = ["2026-11-14", "2026-11-15", "2026-11-16"];
    const tasks = [
      task({ id: "work", day: fri }),
      task({ id: "home", day: fri, area: "home" }),
      task({ id: "old", day: "2026-11-10" }),
      task({ id: "rec", day: fri, recurrence: "daily" }),
      task({ id: "done", day: fri, status: "done" }),
      task({ id: "later", day: "2026-11-20" }),
    ];
    const r = Object.fromEntries(rollForwardTargets(tasks, fri, next).map((x) => [x.taskId, x.to]));
    expect(r).toEqual({ work: "2026-11-16", home: "2026-11-14", old: "2026-11-16" });
  });
});

describe("deep-work protection", () => {
  it("keeps shallow work out of the longest gap when another gap fits", () => {
    const events = [ev("09:00", "09:30"), ev("10:30", "11:00")];
    // Free: 8:00-8:55 (55m), 9:35-10:25 (50m), 11:05-17:30 (protected).
    const s = blockDay({ day: DAY, timeZone: TZ, events, work: WORK, dailyCapacityMin: 360, nowMin: null, tasks: [task({ id: "a", priority: "high", estimateMin: 30 }), task({ id: "deep", energy: "deep", estimateMin: 120 })] });
    expect(s.blocks.find((b) => b.taskId === "a")!.start).toBe(480);
    expect(s.blocks.find((b) => b.taskId === "deep")!.start).toBe(m("11:05"));
    expect(s.focusWindow).toEqual({ start: m("13:05"), end: m("17:30") });
  });
});
