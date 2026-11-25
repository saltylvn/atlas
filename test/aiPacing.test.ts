import { beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_MODEL_WAIT_MS, PACE_SLACK_MS, paceWait } from "@/lib/domain/deadline";
import { resetRateLimits } from "@/lib/security/rateLimit";

// The evening run of 23 Nov 2026: the Career Map's Gemini calls found the per-minute AI limit
// used up by the agents before it, and its steps fell back to the rules'. A scheduled run now
// waits for the minute to turn when it has the time; someone pressing a button does not.

vi.mock("@/lib/ai/model", () => ({ aiConfigured: () => true }));

describe("Waiting for the per-minute AI limit", () => {
  const now = 1_000_000;

  it("a scheduled run waits the limit's reset plus a little slack, when time is left", () => {
    expect(paceWait(42_000, true, now + 300_000, now, 30_000)).toBe(42_000 + PACE_SLACK_MS);
  });

  it("someone waiting on a button, or a run with no deadline, does not wait", () => {
    expect(paceWait(42_000, false, now + 300_000, now, 30_000)).toBeNull();
    expect(paceWait(42_000, true, undefined, now, 30_000)).toBeNull();
  });

  it("does not wait when the call and what follows would not fit before the deadline", () => {
    const wait = 42_000 + PACE_SLACK_MS;
    expect(paceWait(42_000, true, now + wait + 30_000 + MIN_MODEL_WAIT_MS, now, 30_000)).toBe(wait);
    expect(paceWait(42_000, true, now + wait + 30_000 + MIN_MODEL_WAIT_MS - 1, now, 30_000)).toBeNull();
  });
});

describe("The paced gate", () => {
  beforeEach(() => resetRateLimits());

  const setup = async () => {
    const { takeAiCall, takeAiCallPaced } = await import("@/lib/ai/budget");
    const { createMemoryStore, seedState } = await import("@/lib/data/memory");
    const store = createMemoryStore(seedState(new Date()));
    const settings = { ...(await store.settings.get()), aiEnabled: true, outboundEnabled: true };
    // Use up this minute's calls, as the evening run's earlier agents do.
    for (let i = 0; i < 10; i++) expect((await takeAiCall(store, settings, "earlier agent")).allowed).toBe(true);
    return { store, settings, takeAiCallPaced };
  };

  it("the per-minute refusal says how long until calls are allowed again", async () => {
    const { store, settings } = await setup();
    const { takeAiCall } = await import("@/lib/ai/budget");
    const gate = await takeAiCall(store, settings, "career-map");
    expect(gate).toMatchObject({ allowed: false, why: "Too many AI requests this minute." });
    expect(!gate.allowed && gate.retryAfterMs).toBeGreaterThan(0);
  });

  it("a scheduled run waits once for the minute to turn, then gets its call", async () => {
    const { store, settings, takeAiCallPaced } = await setup();
    const waits: number[] = [];
    const gate = await takeAiCallPaced({ store, settings, patient: true, deadline: Date.now() + 300_000 }, "career-map", 30_000, async (ms) => {
      waits.push(ms);
      resetRateLimits(); // the minute turned
    });
    expect(gate).toMatchObject({ allowed: true });
    expect(waits).toHaveLength(1);
    expect(gate.waitedMs).toBe(waits[0]);
  });

  it("a button press does not wait: the refusal stands and the rules' version is used", async () => {
    const { store, settings, takeAiCallPaced } = await setup();
    const wait = vi.fn(async () => undefined);
    const gate = await takeAiCallPaced({ store, settings }, "career-map", 30_000, wait);
    expect(gate).toMatchObject({ allowed: false, waitedMs: 0 });
    expect(wait).not.toHaveBeenCalled();
  });

  it("the daily limit is not something to wait for", async () => {
    const { store, settings, takeAiCallPaced } = await setup();
    const wait = vi.fn(async () => undefined);
    const gate = await takeAiCallPaced({ store, settings: { ...settings, aiEnabled: false }, patient: true, deadline: Date.now() + 300_000 }, "career-map", 30_000, wait);
    expect(gate).toMatchObject({ allowed: false, why: "AI is switched off in Settings.", waitedMs: 0 });
    expect(wait).not.toHaveBeenCalled();
  });
});
