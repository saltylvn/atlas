import { describe, expect, it } from "vitest";
import { addDays, localDate, mondayOf, weekdayIndex, zonedToUtc, daysBetween, greeting } from "@/lib/domain/dates";
import { planWeek, nextOccurrence, capacityFor, minutesLabel } from "@/lib/domain/planner";
import { contactsDue, daysUntilBirthday, dueLabel } from "@/lib/domain/relationships";
import { scorePosting, summarizePipeline } from "@/lib/domain/jobs";
import { composeBrief } from "@/lib/domain/brief";
import { seedState } from "@/lib/data/memory";
import { demoSnapshot } from "./helpers/demoSnapshot";
import type { Contact, Task } from "@/lib/domain/types";

const task = (t: Partial<Task>): Task => ({
  id: t.id ?? Math.random().toString(36).slice(2),
  title: "t",
  notes: "",
  status: "todo",
  priority: "medium",
  area: "work",
  day: null,
  startTime: null,
  estimateMin: 60,
  energy: "shallow",
  recurrence: "none",
  createdAt: "2026-11-01T00:00:00Z",
  completedAt: null,
  ...t,
});

describe("dates", () => {
  it("uses the owner's timezone, not UTC", () => {
    // 03:00 UTC on Nov 12 is still Nov 11 in Denver.
    expect(localDate(new Date("2026-11-12T03:00:00Z"), "America/Denver")).toBe("2026-11-11");
  });
  it("finds Monday and weekday indexes", () => {
    expect(weekdayIndex("2026-11-11")).toBe(2); // Wednesday
    expect(mondayOf("2026-11-15")).toBe("2026-11-09"); // Sunday -> Monday before
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-11-01", "2026-11-11")).toBe(10);
  });
  it("converts zoned wall time across DST", () => {
    expect(zonedToUtc("2026-07-01", "09:00", "America/Denver").toISOString()).toBe("2026-07-01T15:00:00.000Z");
    expect(zonedToUtc("2026-12-01", "09:00", "America/Denver").toISOString()).toBe("2026-12-01T16:00:00.000Z");
  });
  it("greets by time of day", () => {
    expect(greeting("07:30")).toBe("Good morning");
    expect(greeting("19:00")).toBe("Good evening");
  });
});

describe("planner", () => {
  const days = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  it("never overbooks a day", () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task({ id: `t${i}`, estimateMin: 120 }));
    const r = planWeek({ tasks, today: days[0]!, days, dailyCapacityMin: 240 });
    for (const d of days) expect(r.load[d]).toBeLessThanOrEqual(capacityFor(d, 240));
    expect(r.unplaced.length).toBeGreaterThan(0);
  });
  it("puts urgent work first and keeps work off the weekend", () => {
    const r = planWeek({
      tasks: [task({ id: "low", priority: "low" }), task({ id: "crit", priority: "critical" }), task({ id: "home", area: "home", priority: "low" })],
      today: days[0]!,
      days,
      dailyCapacityMin: 480,
    });
    expect(r.placements.find((p) => p.taskId === "crit")?.day).toBe("2026-11-11");
    const workDays = r.placements.filter((p) => p.taskId !== "home").map((p) => p.day);
    expect(workDays.every((d) => weekdayIndex(d) < 5)).toBe(true);
  });
  it("re-plans overdue work and leaves done tasks alone", () => {
    const r = planWeek({
      tasks: [task({ id: "late", day: "2026-11-09" }), task({ id: "done", day: null, status: "done" })],
      today: days[0]!,
      days,
      dailyCapacityMin: 480,
    });
    expect(r.placements.map((p) => p.taskId)).toEqual(["late"]);
  });
  it("counts already-scheduled load", () => {
    const r = planWeek({
      tasks: [task({ id: "fixed", day: "2026-11-11", estimateMin: 400 }), task({ id: "new", priority: "critical", estimateMin: 120 })],
      today: days[0]!,
      days,
      dailyCapacityMin: 480,
    });
    expect(r.placements[0]).toEqual({ taskId: "new", day: "2026-11-12" });
  });
  it("computes next occurrences", () => {
    expect(nextOccurrence("2026-11-13", "weekdays")).toBe("2026-11-16"); // Fri -> Mon
    expect(nextOccurrence("2026-11-13", "weekly")).toBe("2026-11-20");
    expect(nextOccurrence("2026-11-13", "none")).toBeNull();
    expect(minutesLabel(95)).toBe("1h 35m");
  });
});

describe("relationships", () => {
  const c = (p: Partial<Contact>): Contact => ({
    id: p.name ?? "x", name: "X", circle: "friends", email: null, phone: null, cadenceDays: 0,
    lastContactAt: null, birthday: null, notes: "", createdAt: "2026-01-01T00:00:00Z", ...p,
  });
  it("orders birthdays first, then most overdue", () => {
    const due = contactsDue(
      [
        c({ name: "A", cadenceDays: 7, lastContactAt: "2026-11-01T00:00:00Z" }),
        c({ name: "B", cadenceDays: 7, lastContactAt: "2026-10-20T00:00:00Z" }),
        c({ name: "C", birthday: "11-13" }),
        c({ name: "D", cadenceDays: 30, lastContactAt: "2026-11-10T00:00:00Z" }),
      ],
      "2026-11-11",
    );
    expect(due.map((d) => d.contact.name)).toEqual(["C", "B", "A"]);
    expect(dueLabel(due[0]!)).toBe("Birthday in 2d");
  });
  it("wraps birthdays across the new year and handles Feb 29", () => {
    expect(daysUntilBirthday("2026-12-30", "01-02")).toBe(3);
    expect(daysUntilBirthday("2027-02-27", "02-29")).toBe(1);
  });
});

describe("jobs", () => {
  it("scores title and location matches", () => {
    const kw = ["Solutions Engineer"];
    expect(scorePosting("Senior Solutions Engineer, AI", "Denver, CO", kw, ["Denver"]).score).toBe(100);
    expect(scorePosting("Solutions Engineering Manager", "NYC", kw, ["Denver"]).score).toBe(0);
    expect(scorePosting("Software Engineer", "Denver", kw, ["Denver"]).score).toBe(0);
    expect(scorePosting("Solutions Engineer", "Anywhere", kw, ["Remote"]).score).toBe(90);
  });
  it("summarizes the demo pipeline", () => {
    const now = new Date("2026-11-11T15:00:00Z");
    const p = summarizePipeline(demoSnapshot(now), now, "2026-11-11");
    // Five open applications, one of them logged from an email with no role on it.
    expect(p.active).toBe(5);
    expect(p.interviewing).toBe(1);
    expect(p.closed).toBe(1);
    expect(p.upcomingInterviews).toHaveLength(1);
    expect(p.followUps.map((a) => a.company)).toEqual(["Halcyon AI"]);
  });
});

describe("brief", () => {
  it("flags overload, overdue work, and reads facts from data only", () => {
    const now = new Date("2026-11-11T15:00:00Z");
    const s = seedState(now);
    const b = composeBrief({
      today: "2026-11-11",
      tasks: s.tasks,
      events: [],
      peopleDue: contactsDue(s.contacts, "2026-11-11"),
      pipeline: summarizePipeline(demoSnapshot(now), now, "2026-11-11"),
      news: [],
      weather: null,
      dailyCapacityMin: 120,
      timeZone: "America/Denver",
    });
    expect(b.focus[0]?.title).toMatch(/Northwind/);
    expect(b.risks.some((r) => r.includes("over capacity"))).toBe(true);
    expect(b.risks.some((r) => r.includes("overdue"))).toBe(true);
    expect(b.source).toBe("rules");
  });
});
