import { afterEach, describe, expect, it, vi } from "vitest";
import { tracer } from "@/lib/agents/trace";
import { keywords, sameStory } from "@/lib/domain/newsAgent";
import { queryTerms } from "@/lib/domain/retrieval";
import { classifyEvent } from "@/lib/domain/calendarAgent";

// Fixes for the QA review of 22 Nov 2026.

const logRun = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/agents/log", () => ({ logRun: (...a: unknown[]) => logRun(...a), NO_MODEL: { model: null, inputTokens: 0, outputTokens: 0, costUsd: 0 } }));

describe("A run that is about to be stopped says where it was", () => {
  afterEach(() => {
    vi.useRealTimers();
    logRun.mockClear();
  });

  it("the tracer knows the step running now", async () => {
    const t = tracer();
    expect(t.current()).toBeNull();
    let seen: string | null = null;
    await t.step("Ask the Scout", async () => {
      seen = t.current();
    });
    expect(seen).toBe("Ask the Scout");
    expect(t.current()).toBeNull();
  });

  it("the watchdog logs the step and the trace just before the deadline, and not after a clean finish", async () => {
    vi.useFakeTimers();
    const { watchdog, WATCHDOG_MARGIN_MS } = await import("@/lib/agents/watchdog");
    const t = tracer();
    const ctx = { deadline: Date.now() + 10_000 } as never;
    const stop = watchdog(ctx, { runId: "r1", agent: "chief-of-staff", task: "2-hour sync", trigger: "schedule" }, t);
    void t.step("Ask the Scout", () => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(10_000 - WATCHDOG_MARGIN_MS + 1);
    expect(logRun).toHaveBeenCalledTimes(1);
    expect(logRun.mock.calls[0]![1]).toMatchObject({ runId: "r1", status: "failed", detail: expect.stringContaining('during "Ask the Scout"') });
    stop();

    const stop2 = watchdog({ deadline: Date.now() + 10_000 } as never, { runId: "r2", agent: "chief-of-staff", task: "Morning Brief", trigger: "schedule" }, tracer());
    stop2();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(logRun).toHaveBeenCalledTimes(1);
  });
});

describe("Rules the evals flagged", () => {
  it("news: the same story in other words, and a template headline about another company", () => {
    expect(sameStory(keywords("Fed holds interest rates steady"), keywords("Federal Reserve leaves rates unchanged"))).toBe(true);
    expect(sameStory(keywords("Microsoft earnings beat expectations on cloud growth"), keywords("Amazon earnings beat expectations on cloud growth"))).toBe(false);
    // The template check needs a different lead the other headline never names.
    expect(sameStory(keywords("Senate passes government funding bill, averting shutdown"), keywords("Government shutdown averted as Senate passes funding bill"))).toBe(true);
    expect(sameStory(keywords("Fed holds talks with banks"), keywords("Bank of England holds rates"))).toBe(false);
  });

  it("Ask Atlas: everyday words add the words records use, after the question's own", () => {
    expect(queryTerms("What do I owe this month?")).toEqual(expect.arrayContaining(["owe", "due", "bill"]));
    expect(queryTerms("Who should I catch up with soon?")).toEqual(expect.arrayContaining(["touch", "contact"]));
    expect(queryTerms("When is my interview?")).not.toContain("due");
  });

  it("calendar: Dr Pepper is a soda; Dr. Lee is a doctor", () => {
    expect(classifyEvent("Pick up Dr Pepper for the party") ?? "routine").toBe("routine");
    expect(classifyEvent("Dr. Lee checkup")).not.toBe("routine");
  });
});
