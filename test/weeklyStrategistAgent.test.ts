import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAction } from "@/lib/agents/runtime/loop";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { weeklyPlanOf } from "@/lib/domain/weeklyPlan";

// The Weekly Strategist end to end (24 Nov 2026), with a scripted model: it must read the
// funnel, the queue and last week before it may finish; it is sent back once for a number its
// facts lack; it saves a proposed plan. Approving it puts three tasks on the days, once.

let moves: (NextAction | null)[] = [];
vi.mock("@/lib/agents/runtime/decide", () => ({ modelDecider: () => async () => moves.shift() ?? null }));
vi.mock("@/lib/ai/budget", () => ({ takeAiCall: async () => ({ allowed: false, why: "off in tests" }), takeAiCallPaced: async () => ({ allowed: false, why: "off", waitedMs: 0 }) }));

const NOW = new Date("2026-11-30T05:00:00Z"); // Sunday night, Mountain time
const TODAY = "2026-11-29";

async function setup() {
  const store = createMemoryStore(seedState(NOW));
  const settings = await store.settings.get();
  const ctx = { mode: "demo", userId: "", store, settings, now: NOW, today: TODAY, time: "22:00" } as never;
  return { store, ctx };
}

const call = (tool: string, input: Record<string, unknown> = {}): NextAction => ({ action: "call", tool, input, why: "" });
const plan = (why0: string) =>
  JSON.stringify({
    headline: "Send your best-prepared applications early in the week.",
    moves: [
      { title: "Apply to your top picks, most prepared first", why: why0, cites: ["q1"], day: 0, minutes: 120 },
      { title: "Follow up on applications with no reply", why: "Replies are what move the funnel.", cites: ["a1"], day: 1, minutes: 45 },
      { title: "Review what your applications say and adjust", why: "The funnel shows where replies come from.", cites: ["a1"], day: 3, minutes: 30 },
    ],
  });

describe("The Weekly Strategist", () => {
  beforeEach(() => {
    moves = [];
  });

  it("will not finish before reading, is sent back for an uncited number, then saves a proposed plan", async () => {
    const { runWeeklyStrategist } = await import("@/lib/agents/weeklyStrategist");
    const { store, ctx } = await setup();
    moves = [
      { action: "done", answer: plan("Apply now.") }, // too early: the funnel, queue and last week are unread
      call("readFunnel"),
      call("readQueue"),
      call("readLastWeek"),
      { action: "done", answer: plan("There are 999 jobs waiting.") }, // a number no fact has: sent back
      { action: "done", answer: plan("These are the jobs at your level that Atlas ranked first.") },
    ];
    const res = await runWeeklyStrategist(ctx, { persist: store });
    expect(res.writer).toBe("model");
    expect(res.plan).toMatchObject({ weekOf: "2026-11-30", status: "proposed" });
    expect(res.plan.moves).toHaveLength(3);
    const steps = res.state!.steps.map((s) => `${s.tool}:${s.ok ? "ok" : "no"}`);
    expect(steps).toContain("done:no");
    expect(steps.filter((s) => s === "review:no")).toHaveLength(1);
    expect(weeklyPlanOf((await store.settings.get()).weeklyPlan)?.weekOf).toBe("2026-11-30");
  });

  it("falls back to the rules' plan when the model does not answer", async () => {
    const { runWeeklyStrategist } = await import("@/lib/agents/weeklyStrategist");
    const { store, ctx } = await setup();
    moves = [null];
    const res = await runWeeklyStrategist(ctx, { persist: store });
    expect(res.writer).toBe("rules");
    expect(res.plan.moves).toHaveLength(3);
    expect(res.plan.status).toBe("proposed");
  });

  it("keeps a plan already approved for the week, and approving twice adds the tasks once", async () => {
    const { runWeeklyStrategist } = await import("@/lib/agents/weeklyStrategist");
    const { tasksForPlan } = await import("@/lib/domain/weeklyPlan");
    const { store, ctx } = await setup();
    moves = [null];
    const { plan: proposed } = await runWeeklyStrategist(ctx, { persist: store });
    // Approve as the action does: one task per move, by natural key, then mark it approved.
    const approve = async () => {
      const existing = await store.tasks.list();
      const ids: string[] = [];
      for (const t of tasksForPlan(proposed, TODAY)) {
        const same = existing.find((x) => x.title === t.title && x.day === t.day && x.notes.startsWith("This week's plan:"));
        ids.push(same ? same.id : (await store.tasks.create(t)).id);
      }
      await store.settings.update({ weeklyPlan: { ...proposed, status: "approved", taskIds: ids } });
    };
    const before = (await store.tasks.list()).length;
    await approve();
    await approve();
    expect((await store.tasks.list()).length - before).toBe(3);
    const again = await runWeeklyStrategist(ctx, { persist: store });
    expect(again.kept).toBe(true);
    expect(again.plan.status).toBe("approved");
  });
});
