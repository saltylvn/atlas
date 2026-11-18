import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { briefedSlots, briefWeek, catchUpDays, catchUpSummary, caughtUpActivity, pickBriefDay, unreadCount } from "@/lib/domain/briefSchedule";

// 2026-11-16 is a Monday; 2026-11-15 a Sunday (no briefs).
const MON = "2026-11-16";
const THU = "2026-11-19";
const SAT = "2026-11-21";
const TZ = "America/Denver";
const entry = (activity: string, at: string) => ({ agent: "chief-of-staff" as const, activity, at });

describe("catching up on missed briefs", () => {
  it("covers three days with today, and never goes back before this week's Monday", () => {
    expect(catchUpDays(MON)).toEqual([]); // a new week starts clean
    expect(catchUpDays("2026-11-17")).toEqual([MON]);
    expect(catchUpDays("2026-11-18")).toEqual(["2026-11-17", MON]);
    expect(catchUpDays(THU)).toEqual(["2026-11-18", "2026-11-17"]);
    expect(catchUpDays(SAT)).toEqual(["2026-11-20", THU]);
    // Sunday ends the week: Saturday and Friday are the last chance.
    expect(catchUpDays("2026-11-22")).toEqual([SAT, "2026-11-20"]);
  });

  it("opens only today or a catch-up day", () => {
    expect(pickBriefDay("2026-11-17", THU)).toBe("2026-11-17");
    expect(pickBriefDay(MON, THU)).toBe(THU); // three days back: too old
    expect(pickBriefDay("2026-11-14", MON)).toBe(MON); // last week
    expect(pickBriefDay("2026-11-15", "2026-11-17")).toBe("2026-11-17"); // last week's Sunday
    expect(pickBriefDay("2026-11-20", THU)).toBe(THU); // the future
    expect(pickBriefDay("../x", THU)).toBe(THU);
    expect(pickBriefDay(["2026-11-17"], THU)).toBe(THU);
    expect(pickBriefDay(undefined, THU)).toBe(THU);
  });

  it("counts a past brief as briefed for its own day, not today's brief of the same name", () => {
    const today = "2026-11-16T17:00:00Z"; // Monday 10 AM in Denver
    const ledger = [entry(caughtUpActivity("morning", "2026-11-13"), today)];
    expect(caughtUpActivity("morning", "2026-11-13")).toBe("Morning brief (Fri, Nov 13, caught up)");
    expect(briefedSlots(ledger, "2026-11-13", TZ)).toEqual(["morning"]);
    expect(briefedSlots(ledger, MON, TZ)).toEqual([]);
    expect(briefedSlots(ledger, "2026-11-12", TZ)).toEqual([]);
    // Confirmed on the day itself still counts for that day.
    expect(briefedSlots([entry("Afternoon brief", "2026-11-13T21:30:00Z")], "2026-11-13", TZ)).toEqual(["afternoon"]);
  });

  it("shows how many briefs each day still has unread", () => {
    expect(unreadCount([{ slot: "morning" }, { slot: "afternoon" }], ["morning"])).toBe(1);
    const ledger = [entry(caughtUpActivity("afternoon", "2026-11-20"), "2026-11-21T17:00:00Z")];
    const days = catchUpDays(SAT);
    const saved = [[{ slot: "morning" as const }, { slot: "afternoon" as const }], []];
    expect(catchUpSummary(days, saved, ledger, TZ)).toEqual([
      { day: "2026-11-20", saved: 2, unread: 1 },
      { day: THU, saved: 0, unread: 0 },
    ]);
  });

  it("draws this week as a calendar, with only today and the catch-up days to open", () => {
    const week = briefWeek(THU, [
      { day: "2026-11-18", saved: 2, unread: 1 },
      { day: "2026-11-17", saved: 0, unread: 0 },
    ]);
    expect(week.map((c) => [c.day.slice(8), c.state, c.unread])).toEqual([
      ["16", "too-old", 0],
      ["17", "none-saved", 0],
      ["18", "open", 1],
      ["19", "today", 0],
      ["20", "ahead", 0],
      ["21", "ahead", 0],
      ["22", "ahead", 0],
    ]);
    // On a Monday the whole week is ahead: nothing to catch up on.
    expect(briefWeek(MON, []).filter((c) => c.state !== "ahead").map((c) => c.state)).toEqual(["today"]);
  });

  it("checks the day on the server before recording Briefed", () => {
    const action = readFileSync("app/actions/brief.ts", "utf8");
    expect(action).toContain("pickBriefDay(day, today)");
    expect(action).toContain("That brief is too old to catch up on.");
    expect(action).toContain("No such brief that day.");
  });
});
