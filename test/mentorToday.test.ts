import { describe, expect, it } from "vitest";
import { insightsForToday, type MentorInsight } from "@/lib/domain/mentor";

const insight = (id: string, forDate: string, over: Partial<MentorInsight> = {}): MentorInsight => ({
  id,
  forDate,
  slot: "evening",
  key: `k:${id}`,
  area: "activity",
  title: `Title ${id}`,
  body: "Body.",
  action: "Do the thing.",
  evidence: ["a fact"],
  metric: "",
  writer: "rules",
  status: "new",
  createdAt: `${forDate}T18:00:00.000Z`,
  ...over,
});

describe("insightsForToday", () => {
  const today = "2026-11-16"; // a Monday

  it("keeps open insights only, newest first, at most two", () => {
    const rows = [
      insight("old", "2026-11-14"),
      insight("done", "2026-11-16", { status: "done" }),
      insight("dismissed", "2026-11-16", { status: "dismissed" }),
      insight("morning", "2026-11-16", { createdAt: "2026-11-16T15:00:00.000Z" }),
      insight("midday", "2026-11-16", { createdAt: "2026-11-16T19:00:00.000Z" }),
    ];
    expect(insightsForToday(rows, today).map((i) => i.id)).toEqual(["midday", "morning"]);
    expect(insightsForToday(rows, today, 5).map((i) => i.id)).toEqual(["midday", "morning", "old"]);
  });

  it("carries Saturday evening's insight across a Sunday with no runs, then lets it go", () => {
    const saturday = [insight("sat", "2026-11-14")];
    expect(insightsForToday(saturday, "2026-11-15")).toHaveLength(1);
    expect(insightsForToday(saturday, "2026-11-16")).toHaveLength(1);
    expect(insightsForToday(saturday, "2026-11-17")).toHaveLength(0);
  });

  it("shows nothing when the Mentor has nothing open, and ignores a date in the future", () => {
    expect(insightsForToday([], today)).toEqual([]);
    expect(insightsForToday([insight("future", "2026-11-17")], today)).toEqual([]);
  });
});
