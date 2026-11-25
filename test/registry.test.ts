import { describe, expect, it } from "vitest";
import { MENTOR_REFRESH_TASK } from "@/lib/agents/mentorRefresh";
import { AGENTS, aiUse } from "@/lib/domain/agents";
import { SLOT_LABEL, SYNC_TASK } from "@/lib/domain/briefSchedule";
import { JOBS, KINDS, LOOP_AGENTS, WORKFLOWS, workflowForTask } from "@/lib/domain/registry";
import { PITCH_TASK } from "@/lib/agents/pitch";
import { PREP_TASK } from "@/lib/agents/interviewPrep";
import { COMPANY_RESEARCH_TASK } from "@/lib/agents/companyResearch";
import { STRATEGIST_TASK } from "@/lib/agents/weeklyStrategist";
import { FOLLOWUP_TASK } from "@/lib/agents/followUp";
import { NIGHT_TASK } from "@/lib/agents/nightShift";
import { WATCH_TASK } from "@/lib/domain/watch";
import { AGENT_IDS } from "@/lib/domain/types";

describe("registry: every part of Atlas has one kind and its tags", () => {
  it("labels every roster entry with a kind, a pattern, a reach and a trigger", () => {
    for (const a of AGENTS) {
      expect(Object.keys(KINDS)).toContain(a.kind);
      expect(a.pattern.length).toBeGreaterThan(3);
      expect(["inside", "outside"]).toContain(a.reach);
      expect(["schedule", "button", "both"]).toContain(a.trigger);
    }
    expect(AGENTS.map((a) => a.id).sort()).toEqual([...AGENT_IDS].sort());
  });

  it("calls the orchestrator a workflow and the rest of the roster bots; the three agents are listed apart", () => {
    expect(AGENTS.find((a) => a.id === "chief-of-staff")!.kind).toBe("workflow");
    expect(AGENTS.filter((a) => a.id !== "chief-of-staff").every((a) => a.kind === "bot")).toBe(true);
    // Pitch and Interview Prep let the model pick its own tools: they are the agents, and they run under Applications.
    expect(LOOP_AGENTS.map((a) => a.name)).toEqual(["Tailor", "Researcher", "Coach", "Planner", "Nudger"]);
    expect(LOOP_AGENTS.every((a) => a.kind === "agent" && a.runsUnder === "career" && a.tools.length >= 3)).toBe(true);
    // Their task names are what the runs write to the activity log.
    expect(LOOP_AGENTS.map((a) => a.task)).toEqual([PITCH_TASK, COMPANY_RESEARCH_TASK, PREP_TASK, STRATEGIST_TASK, FOLLOWUP_TASK]);
    // The night shift is a workflow: it runs the agents in a fixed order and logs its own run.
    expect(workflowForTask(NIGHT_TASK)?.id).toBe("night-shift");
  });

  it("defines each kind by who picks the next step, with what qualifies it", () => {
    for (const k of Object.values(KINDS)) {
      expect(k.decides.length).toBeGreaterThan(10);
      expect(k.qualifies.length).toBeGreaterThanOrEqual(3);
      expect(k.example.length).toBeGreaterThan(10);
    }
    expect(KINDS.agent.decides).toMatch(/AI model/);
    expect(KINDS.bot.decides).toMatch(/^Code/);
  });

  it("draws the two agents on the live map and keeps the data pipeline off Mission Control", async () => {
    const { MAP_GROUPS, MAP_NODES, MAP_SIZE, NODE_FACTS, liveSnapshot } = await import("@/lib/domain/orchestration");
    const row = MAP_GROUPS.find((g) => g.id === "agents")!;
    for (const id of ["loop-research", "loop-pitch", "loop-prep", "loop-strategist", "loop-followup"]) {
      const n = MAP_NODES.find((x) => x.id === id)!;
      expect(n.kind).toBe("loop");
      expect(n.y - n.h / 2 >= row.y && n.y + n.h / 2 <= row.y + row.h, id).toBe(true);
      expect(NODE_FACTS[id]!.length).toBeGreaterThan(2);
    }
    for (const g of MAP_GROUPS) expect(g.y + g.h, g.id).toBeLessThanOrEqual(MAP_SIZE.h);
    // A Pitch run in the activity log lights its box.
    const snap = liveSnapshot({ rows: [{ id: "1", runId: "r1", agent: "career", task: PITCH_TASK, status: "succeeded", trigger: "owner", detail: "", at: "2026-11-24T17:00:00Z", model: "", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 900 } as never], paused: [], now: new Date("2026-11-24T18:00:00Z"), detail: false, nextSync: "", nextBrief: "" });
    expect(snap.loops!["loop-pitch"]!.state).toBe("ok");
    expect(snap.loops!["loop-prep"]!.state).toBe("idle");
    const { readFileSync } = await import("node:fs");
    const mission = readFileSync("app/(app)/mission/page.tsx", "utf8");
    expect(mission).not.toContain("<PipelineView");
    expect(readFileSync("app/(app)/data/page.tsx", "utf8")).toContain("<PipelineView view={view} />");
  });

  it("keeps display names free of the word Agent", () => {
    for (const a of AGENTS) expect(a.name).not.toMatch(/agent/i);
  });

  it("marks no bot as acting outside Atlas: you submit every application yourself (23 Nov 2026)", () => {
    expect(AGENTS.filter((a) => a.reach === "outside").map((a) => a.id)).toEqual([]);
    expect(JOBS.filter((j) => j.reach === "outside")).toEqual([]);
  });

  it("derives AI use from whether a bot asks the model anything", () => {
    expect(aiUse(AGENTS.find((a) => a.id === "calendar")!)).toBe("rules");
    expect(aiUse(AGENTS.find((a) => a.id === "analyst")!)).toBe("ai-assisted");
  });

  it("gives every bot at least one job, and every job a bot on the roster", () => {
    for (const a of AGENTS) expect(JOBS.some((j) => j.bot === a.id)).toBe(true);
  });

  it("matches workflow tasks to what each run writes to the activity log", () => {
    expect(workflowForTask(SLOT_LABEL.morning)?.id).toBe("morning-brief");
    expect(workflowForTask(SLOT_LABEL.saturday)?.id).toBe("morning-brief");
    expect(workflowForTask(SLOT_LABEL.afternoon)?.id).toBe("afternoon-brief");
    expect(workflowForTask(SYNC_TASK)?.id).toBe("sync");
    expect(workflowForTask(WATCH_TASK)?.id).toBe("watch");
    expect(workflowForTask(MENTOR_REFRESH_TASK)?.id).toBe("mentor-refresh");
    expect(workflowForTask("Daily market report")).toBeUndefined();
  });

  it("plans briefs and syncs by Weekend Mode", () => {
    const byId = (id: string) => WORKFLOWS.find((w) => w.id === id)!;
    // 2026-11-23 is a Monday, 2026-11-28 a Saturday, 2026-11-29 a Sunday.
    expect(byId("morning-brief").planned("2026-11-23")).toEqual(["09:00"]);
    expect(byId("afternoon-brief").planned("2026-11-28")).toEqual([]);
    expect(byId("morning-brief").planned("2026-11-28")).toEqual(["09:00"]);
    expect(byId("sync").planned("2026-11-29")).toEqual([]);
    expect(byId("sync").planned("2026-11-23")).toEqual(["06:00", "08:00", "10:00", "12:00", "14:00", "16:00"]);
  });
});
