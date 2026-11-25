import { describe, expect, it } from "vitest";
import { dayTimeline, position, runMarks } from "@/lib/domain/timeline";
import type { AgentRunEvent } from "@/lib/domain/types";

const TZ = "America/Denver";
let n = 0;
const row = (over: Partial<AgentRunEvent> & Pick<AgentRunEvent, "runId" | "agent" | "task" | "status" | "at">): AgentRunEvent => ({
  id: `r${n++}`,
  trigger: "schedule",
  detail: "",
  model: "",
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  ...over,
});

// 2026-11-23 is a Monday; Denver is UTC-7 in November.
const rows: AgentRunEvent[] = [
  row({ runId: "a", agent: "chief-of-staff", task: "Morning Brief", status: "started", at: "2026-11-23T15:55:00Z" }),
  row({ runId: "a", agent: "chief-of-staff", task: "Morning Brief", status: "succeeded", at: "2026-11-23T15:58:00Z", durationMs: 180_000 }),
  row({ runId: "b", agent: "calendar", task: "Calendar review", status: "failed", at: "2026-11-23T15:56:00Z" }),
  row({ runId: "c", agent: "scout", task: "Record the job market", status: "started", at: "2026-11-23T19:00:00Z", trigger: "owner" }),
  // Yesterday: left out.
  row({ runId: "d", agent: "news", task: "News", status: "succeeded", at: "2026-11-22T16:00:00Z" }),
];

describe("Day timeline", () => {
  it("groups the log into one mark per run, in local minutes", () => {
    const marks = runMarks(rows, "2026-11-23", TZ);
    expect(marks.map((m) => m.runId)).toEqual(["a", "b", "c"]);
    expect(marks[0]).toMatchObject({ start: 8 * 60 + 55, end: 8 * 60 + 58, status: "succeeded" });
    expect(marks[2]).toMatchObject({ status: "started", trigger: "owner" });
  });

  it("puts a workflow's own run on its lane and a bot's run on the bot's lane", () => {
    const t = dayTimeline({ rows, day: "2026-11-23", timeZone: TZ, now: new Date("2026-11-23T20:00:00Z") });
    const lane = (id: string) => t.lanes.find((l) => l.id === id)!;
    expect(lane("morning-brief").runs.map((r) => r.runId)).toEqual(["a"]);
    expect(lane("chief-of-staff").runs).toEqual([]);
    expect(lane("calendar").runs[0]!.status).toBe("failed");
    expect(lane("scout").runs).toHaveLength(1);
    expect(t.totals).toEqual({ runs: 3, failed: 1, planned: 1 + 1 + 6 + 1 + 4 });
    expect(t.now).toBe(13 * 60);
  });

  it("shows no now line on another day, and only the night shift planned on a Sunday", () => {
    const t = dayTimeline({ rows: [], day: "2026-11-29", timeZone: TZ, now: new Date("2026-11-23T20:00:00Z") });
    expect(t.now).toBeNull();
    // The briefs and syncs rest on Sunday; the night shift prepares Monday's applications (four short runs).
    expect(t.totals.planned).toBe(4);
    expect(t.lanes.find((l) => l.id === "night-shift")!.planned).toHaveLength(4);
    expect(t.lanes.find((l) => l.id === "watch")!.band).toEqual({ from: 420, to: 1260, everyMinutes: 15 });
  });

  it("places times across 6 AM to 10 PM, clamped", () => {
    expect(position(6 * 60)).toBe(0);
    expect(position(14 * 60)).toBe(50);
    expect(position(23 * 60)).toBe(100);
    expect(position(0)).toBe(0);
  });
});
