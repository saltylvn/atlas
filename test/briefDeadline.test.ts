import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AFTER_SPECIALIST_MS, AFTER_WORDING_MS, aiCap, FUNCTION_LIMIT_MS, MIN_MODEL_WAIT_MS, modelWait, SCHEDULED_AI_CAP_MS, SCHEDULED_LIMIT_MS } from "@/lib/domain/deadline";

// On 2026-11-17 the Morning Brief's run was stopped at Vercel's 60-second limit while the
// model was still wording it: nothing was saved, so Today showed a live preview with no
// Briefed button. These tests pin down the two guards: model calls wait only for the time
// left, and the brief is saved before the model words it.

const SKIPPED = { missing: "skipped" as const, why: "not part of this test" };

vi.mock("@/lib/agents/email", async (orig) => ({ ...(await orig<object>()), runEmailAgent: vi.fn(async () => SKIPPED) }));
vi.mock("@/lib/agents/calendar", async (orig) => ({ ...(await orig<object>()), runCalendarAgent: vi.fn(async () => SKIPPED) }));
vi.mock("@/lib/agents/news", async (orig) => ({ ...(await orig<object>()), runNewsAgent: vi.fn(async () => SKIPPED) }));
vi.mock("@/lib/agents/career", async (orig) => ({ ...(await orig<object>()), runCareerAgent: vi.fn(async () => SKIPPED) }));
vi.mock("@/lib/agents/finance", async (orig) => ({ ...(await orig<object>()), runFinanceAgent: vi.fn(async () => SKIPPED) }));
vi.mock("@/lib/agents/analyst", async (orig) => ({ ...(await orig<object>()), runAnalyst: vi.fn(async () => SKIPPED) }));
vi.mock("@/lib/agents/mentor", async (orig) => ({ ...(await orig<object>()), runMentor: vi.fn(async () => SKIPPED) }));
vi.mock("@/lib/push", () => ({ sendToAll: vi.fn(async () => undefined) }));
// The brief's other inputs, without the network (weather, feeds, calendar).
vi.mock("@/lib/briefing", async () => {
  const { composeBrief } = await import("@/lib/domain/brief");
  return {
    loadBrief: vi.fn(async (ctx: Context) => ({
      brief: composeBrief({ today: ctx.today, tasks: [], events: [], peopleDue: [], pipeline: null, news: [], weather: null, dailyCapacityMin: 360, timeZone: ctx.settings.timezone }),
      tasks: [],
      weather: null,
      pipeline: null,
      snapshot: null,
      news: [],
      calendarStatus: "ok",
      briefedToday: false,
      briefedSlots: [],
      briefLedger: [],
      minutesSavedThisWeek: 0,
      gmailConnected: false,
      newsFailed: [],
      renewalsDue: [],
    })),
  };
});
vi.mock("@/lib/ai/budget", async (orig) => ({
  ...(await orig<object>()),
  // The real gate's time rule; the rest of the gate (key, daily cap) is not under test.
  takeAiCallWithin: vi.fn(async (_s: unknown, _st: unknown, _p: string, wait: number) => (wait > 0 ? { allowed: true } : { allowed: false, why: "Too little time left in this run to wait for the model." })),
}));
vi.mock("@/lib/ai/model", async (orig) => ({ ...(await orig<object>()), aiName: () => "Gemini", structuredWithin: vi.fn() }));

const { runChiefOfStaff } = await import("@/lib/agents/chiefOfStaff");
const { structuredWithin } = await import("@/lib/ai/model");
const { runMentor } = await import("@/lib/agents/mentor");
const model = vi.mocked(structuredWithin);

const NOW = new Date("2026-11-17T16:00:00Z");
const TODAY = "2026-11-17";

function demo(deadline?: number): Context {
  const state = seedState(NOW);
  return { mode: "demo", userId: "demo", store: createMemoryStore(state), settings: state.settings, now: NOW, today: TODAY, time: "08:00", deadline };
}

describe("How long a model call may wait inside a run", () => {
  it("keeps its own cap when the run has time", () => {
    expect(modelWait(18_000, 100_000, 0, AFTER_SPECIALIST_MS)).toBe(18_000);
  });

  it("is cut to the time left, minus what the run still has to do", () => {
    expect(modelWait(25_000, 60_000, 40_000, AFTER_WORDING_MS)).toBe(15_000);
  });

  it("is skipped when too little is left to be worth starting", () => {
    expect(modelWait(25_000, 60_000, 60_000 - AFTER_WORDING_MS - MIN_MODEL_WAIT_MS + 1, AFTER_WORDING_MS)).toBe(0);
    expect(modelWait(25_000, 60_000, 70_000, AFTER_WORDING_MS)).toBe(0);
  });

  it("keeps the cap when there is no deadline", () => {
    expect(modelWait(18_000, undefined, 0, AFTER_SPECIALIST_MS)).toBe(18_000);
  });

  it("replays 2026-11-17: 35 s in, the wording gets what is left and still ends before the limit", () => {
    const wait = modelWait(25_000, FUNCTION_LIMIT_MS, 35_500, AFTER_WORDING_MS);
    expect(wait).toBe(19_500);
    expect(35_500 + wait + AFTER_WORDING_MS).toBeLessThanOrEqual(FUNCTION_LIMIT_MS);
  });
});

describe("Scheduled runs: five minutes, and a minute per model call", () => {
  const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");

  it("every cron route asks Vercel for the time the deadline assumes", () => {
    for (const route of ["morning", "afternoon", "evening", "sync"]) {
      expect(read(`app/api/cron/${route}/route.ts`), route).toContain(`export const maxDuration = ${SCHEDULED_LIMIT_MS / 1000};`);
    }
    expect(read("lib/agents/cron.ts")).toContain("Date.now() + SCHEDULED_LIMIT_MS");
    expect(read("lib/agents/cron.ts")).toContain("patient: true");
    expect(read("lib/agents/sync.ts")).toContain("deadline: Date.now() + SCHEDULED_LIMIT_MS, patient: true");
  });

  it("gives a model call a minute when nobody is waiting, and its own cap when someone is", () => {
    expect(aiCap({ patient: true }, 18_000)).toBe(SCHEDULED_AI_CAP_MS);
    expect(aiCap({}, 18_000)).toBe(18_000);
    expect(aiCap({ patient: false }, 25_000)).toBe(25_000);
  });

  it("still ends a scheduled brief inside five minutes in the worst case", () => {
    // Analyst, Career Mentor, role review and wording each take their whole minute, one after another.
    let now = 0;
    for (const reserve of [AFTER_SPECIALIST_MS, AFTER_SPECIALIST_MS, AFTER_SPECIALIST_MS, AFTER_WORDING_MS]) {
      now += 6_000 + modelWait(SCHEDULED_AI_CAP_MS, SCHEDULED_LIMIT_MS, now, reserve);
    }
    expect(now + AFTER_WORDING_MS).toBeLessThanOrEqual(SCHEDULED_LIMIT_MS);
  });
});

describe("The Chief of Staff's run inside its time limit", () => {
  beforeEach(() => {
    model.mockReset();
    vi.mocked(runMentor).mockClear();
  });

  it("saves the rules-based brief before the model words it, then saves the wording", async () => {
    const ctx = demo(Date.now() + FUNCTION_LIMIT_MS);
    let savedWhenAsked = -1;
    model.mockImplementation(async () => {
      savedWhenAsked = (await ctx.store.briefs.forDate(TODAY)).length;
      return { ok: true, value: { headline: "Worded by the model today", summary: ["First line here", "Second line here"] } } as never;
    });
    const out = await runChiefOfStaff(ctx, "morning", "run-now");
    expect(out.status).toBe("succeeded");
    expect(savedWhenAsked).toBe(1);
    const [saved] = await ctx.store.briefs.forDate(TODAY);
    expect(saved!.headline).toBe("Worded by the model today");
  });

  it("with no time left, skips the model and still saves the brief", async () => {
    const ctx = demo(Date.now() + 3_000);
    const out = await runChiefOfStaff(ctx, "morning", "run-now");
    expect(out.status).toBe("succeeded");
    expect(model).not.toHaveBeenCalled();
    expect(await ctx.store.briefs.forDate(TODAY)).toHaveLength(1);
    const [run] = (await ctx.store.agentRuns.recent(5)).filter((r) => r.agent === "chief-of-staff" && r.status === "succeeded");
    expect(JSON.stringify(run!.trace)).toContain("Too little time left");
  });

  it("a slow model never costs the brief: the rules-based one stays saved", async () => {
    const ctx = demo(Date.now() + FUNCTION_LIMIT_MS);
    model.mockResolvedValue({ ok: false, reason: "error" } as never);
    const out = await runChiefOfStaff(ctx, "morning", "run-now");
    expect(out.status).toBe("succeeded");
    const [saved] = await ctx.store.briefs.forDate(TODAY);
    expect((saved!.report as { errors: string[] }).errors.join(" ")).toContain("Gemini could not word the brief");
  });

  it("a scheduled run lets the wording wait up to a minute", async () => {
    model.mockResolvedValue({ ok: false, reason: "error" } as never);
    await runChiefOfStaff({ ...demo(Date.now() + SCHEDULED_LIMIT_MS), patient: true }, "morning", "schedule");
    expect(model.mock.calls[0]![0]).toBe(SCHEDULED_AI_CAP_MS);
  });

  it("Run Now gets a deadline too, and passes it to the Career Mentor", async () => {
    model.mockResolvedValue({ ok: false, reason: "error" } as never);
    const before = Date.now();
    await runChiefOfStaff(demo(), "morning", "run-now");
    const passed = vi.mocked(runMentor).mock.calls[0]![0].deadline!;
    expect(passed).toBeGreaterThanOrEqual(before + FUNCTION_LIMIT_MS);
    expect(passed).toBeLessThanOrEqual(Date.now() + FUNCTION_LIMIT_MS);
    // The wording's wait fits inside the limit.
    expect(model.mock.calls[0]![0]).toBeLessThanOrEqual(25_000);
  });
});
