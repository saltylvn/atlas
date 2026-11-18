import { describe, expect, it } from "vitest";
import { logEvalRun } from "@/lib/agents/evals";
import { runFinanceAgent } from "@/lib/agents/finance";
import { logRun, NO_MODEL } from "@/lib/agents/log";
import { NO_TRACE, tracer } from "@/lib/agents/trace";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { Store } from "@/lib/data/store";
import { EVAL_TASK } from "@/lib/evals";

const NOW = new Date("2026-11-16T16:00:00Z");

/** The demo data with an empty activity log. */
const emptyLog = () => ({ ...seedState(NOW), agentRuns: [] });

function context(store: Store): Context {
  const state = seedState(NOW);
  return { mode: "demo", userId: "", store, settings: state.settings, now: NOW, today: "2026-11-16", time: "09:00" } as Context;
}

describe("Tracing", () => {
  it("times each step and records what it decided", async () => {
    let clock = 1000;
    const t = tracer(() => clock);
    const emails = await t.step(
      "Load the inbox",
      async () => {
        clock += 250;
        return [1, 2, 3];
      },
      (v) => `${v.length} emails`,
    );
    t.note("Pick", "2 chosen");
    clock += 50;
    expect(emails).toEqual([1, 2, 3]);
    expect(t.finish()).toEqual({
      durationMs: 300,
      trace: [
        { name: "Load the inbox", ms: 250, ok: true, note: "3 emails" },
        { name: "Pick", ms: 0, ok: true, note: "2 chosen" },
      ],
    });
  });

  it("records a failed step and still throws, keeping only the first line of the error", async () => {
    const t = tracer();
    await expect(
      t.step("Read feeds", () => {
        throw new Error("timeout\nstack line with details");
      }),
    ).rejects.toThrow("timeout");
    expect(t.finish().trace).toEqual([{ name: "Read feeds", ms: expect.any(Number), ok: false, note: "timeout" }]);
  });

  it("clips long notes and caps the number of steps", () => {
    const t = tracer();
    for (let i = 0; i < 40; i++) t.note(`Step ${i}`, "x".repeat(500));
    const { trace } = t.finish();
    expect(trace).toHaveLength(24);
    expect(trace[0]!.note.length).toBe(240);
  });

  it("runs steps without keeping anything when nobody is tracing", async () => {
    expect(await NO_TRACE.step("x", () => 7)).toBe(7);
    expect(NO_TRACE.finish()).toEqual({ durationMs: 0, trace: [] });
  });

  it("puts the trace on the row that ends an agent run", async () => {
    const store = createMemoryStore(emptyLog());
    await runFinanceAgent(context(store), { trigger: "run-now", honorPause: false });
    const runs = await store.agentRuns.recent(10);
    const started = runs.find((r) => r.status === "started")!;
    const done = runs.find((r) => r.status === "succeeded")!;
    expect(started.trace).toBeUndefined();
    expect(done.durationMs).toEqual(expect.any(Number));
    expect(done.trace!.map((s) => s.name)).toEqual(["Load the inbox the Email Agent synced, and your Renewals list", "Read bills, payment alerts and deals"]);
    expect(done.trace![1]!.note).toMatch(/\d+ bills .* \d+ deals/);
  });

  it("keeps the log row when the trace cannot be stored", async () => {
    const store = createMemoryStore(emptyLog());
    const append = store.agentRuns.append.bind(store.agentRuns);
    // A database that does not know the trace columns yet.
    store.agentRuns.append = async (e) => {
      if (e.trace !== undefined) throw new Error("column trace does not exist");
      return append(e);
    };
    await logRun({ store }, { runId: "r", agent: "news", task: "News", status: "succeeded", trigger: "schedule", detail: "9 stories", ...NO_MODEL, durationMs: 12, trace: [{ name: "a", ms: 1, ok: true, note: "" }] });
    const [row] = await store.agentRuns.recent(1);
    expect(row).toMatchObject({ agent: "news", detail: "9 stories" });
    expect(row!.trace).toBeUndefined();
  });
});

describe("Daily eval run", () => {
  it("logs every suite's score under the Chief of Staff", async () => {
    const store = createMemoryStore(emptyLog());
    const report = await logEvalRun({ store }, "schedule");
    const [row] = await store.agentRuns.recent(1);
    expect(row).toMatchObject({ agent: "chief-of-staff", task: EVAL_TASK, status: report.ok ? "succeeded" : "failed", costUsd: 0 });
    expect(row!.detail).toMatch(new RegExp(`^${report.passed}/${report.total} \\(\\d+%\\): Chief of Staff \\d+/\\d+, Calendar `));
    expect(row!.detail.length).toBeLessThanOrEqual(500);
    expect(row!.trace).toHaveLength(report.suites.length);
    expect(row!.trace!.every((s) => /\d+\/\d+ pass/.test(s.note))).toBe(true);
  });
});
