import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkAdvice, currentStep, mentorFacts, PIPELINE_DEFAULTS, pipelineConfig, rulesAdvice, setupSteps, type SetupInput } from "@/lib/domain/dataPipeline";
import type { RunQuality } from "@/lib/domain/techMarket";

const quality: RunQuality = { day: "2026-11-22", read: 3000, notTech: 1000, notFullTime: 10, outsideUs: 300, tech: 1700, duplicates: 150, recorded: 1500, withPay: 150, withSkills: 1100, levelStated: 600, capped: false, sources: [{ source: "Company boards", read: 2500, tech: 1200, withPay: 100 }, { source: "Remote OK", read: 100, tech: 60, withPay: 40 }] };
const base = (over: Partial<SetupInput> = {}): SetupInput => ({ config: PIPELINE_DEFAULTS, watchCount: 6, quality, keys: { bls: true, fred: false, adzuna: false }, ...over });
const factsFor = (i: SetupInput) => mentorFacts({ ...i, sources: i.quality!.sources.map((s) => ({ name: s.source, read: s.read, tech: s.tech, withPay: s.withPay })), stored: 1600, historyDays: 14 });

describe("Your pipeline settings", () => {
  it("fills defaults, and never lets a bad value stop a sync", () => {
    expect(pipelineConfig(undefined)).toEqual(PIPELINE_DEFAULTS);
    expect(pipelineConfig({ companyCap: "lots", floors: { pay: 7 } })).toEqual(PIPELINE_DEFAULTS);
    expect(pipelineConfig({ sourcesOff: ["Remote OK", "Not a source"] }).sourcesOff).toEqual(["Remote OK"]);
  });
});

describe("Setup steps", () => {
  it("works out each step from the real numbers, and opens the first one not done", () => {
    const steps = setupSteps(base());
    expect(steps.map((s) => [s.id, s.done])).toEqual([
      ["watchlist", false],
      ["details", false],
      ["sources", false],
      ["benchmarks", false],
      ["adzuna", false],
      ["floors", false],
    ]);
    expect(steps[0]!.now).toBe("6 of 10 watched");
    expect(steps[1]!.now).toContain("10% of postings state pay");
    expect(currentStep(steps)!.id).toBe("watchlist");
  });

  it("marks a step done by its number, or once you reviewed it", () => {
    const steps = setupSteps(base({ watchCount: 12, quality: { ...quality, withPay: 900 }, keys: { bls: true, fred: true, adzuna: false }, config: { ...PIPELINE_DEFAULTS, reviewed: ["sources", "floors", "adzuna"] } }));
    expect(steps.every((s) => s.done)).toBe(true);
    expect(currentStep(steps)).toBeNull();
  });

  it("does not call details done when you turned them off", () => {
    expect(setupSteps(base({ quality: { ...quality, withPay: 1500 }, config: { ...PIPELINE_DEFAULTS, details: "off" } }))[1]!.done).toBe(false);
  });
});

describe("The mentor's facts, rules advice and check", () => {
  it("lists the facts it may cite, including each source's share", () => {
    const facts = factsFor(base());
    expect(facts.find((f) => f.key === "pay")!.value).toBe("10%");
    expect(facts.find((f) => f.key === "src:Company boards")!.value).toBe("95%");
  });

  it("writes rules advice from the facts, every number among them", () => {
    const i = base();
    const facts = factsFor(i);
    const advice = rulesAdvice(i, facts);
    expect(advice.map((a) => a.step)).toEqual(["watchlist", "sources", "details", "benchmarks"]);
    expect(checkAdvice(advice, facts).dropped).toEqual([]);
  });

  it("drops advice that cites an unknown fact or writes a number the facts do not hold", () => {
    const facts = factsFor(base());
    const { kept, dropped } = checkAdvice(
      [
        { title: "Pay coverage is low", why: "Only 10% of postings state pay.", action: "Watch companies on Lever.", cites: ["pay"] },
        { title: "Pay coverage is low", why: "Only 12% of postings state pay.", action: "Watch companies on Lever.", cites: ["pay"] },
        { title: "Add a source", why: "More breadth.", action: "Add LinkedIn.", cites: ["linkedin"] },
        { title: "No evidence", why: "Trust me.", action: "Do it.", cites: [] },
      ],
      facts,
    );
    expect(kept.map((a) => a.why)).toEqual(["Only 10% of postings state pay."]);
    expect(dropped).toHaveLength(3);
  });
});

// ---- the mentor's evaluator loop, with the model mocked ----

const structuredWithin = vi.fn();
vi.mock("@/lib/ai/model", () => ({ aiName: () => "Gemini", aiConfigured: () => true, structuredWithin: (...a: unknown[]) => structuredWithin(...a), whyNoAnswer: () => "not set up" }));
const takeAiCall = vi.fn();
vi.mock("@/lib/ai/budget", () => ({ takeAiCall: (...a: unknown[]) => takeAiCall(...a) }));

describe("The Data Mentor: draft, check, refine", () => {
  beforeEach(() => {
    structuredWithin.mockReset();
    takeAiCall.mockReset();
  });

  const run = async () => {
    const { runDataMentor } = await import("@/lib/agents/dataMentor");
    const { createMemoryStore, seedState } = await import("@/lib/data/memory");
    const store = createMemoryStore(seedState(new Date()));
    await store.techMarket.saveQuality({ ...quality, day: "2026-11-22" });
    const settings = await store.settings.get();
    const ctx = { mode: "demo", userId: "", store, settings, now: new Date(), today: "2026-11-22", time: "12:00" } as never;
    return { res: await runDataMentor(ctx, { focus: null, trigger: "owner" }), store };
  };

  it("refines when the check drops a draft, and saves the passing advice", async () => {
    takeAiCall.mockResolvedValue({ allowed: true });
    structuredWithin
      .mockResolvedValueOnce({ ok: true, value: { advice: [{ title: "Pay is thin", why: "Only 99% state pay.", action: "Watch Lever boards.", cites: ["pay"] }] } })
      .mockResolvedValueOnce({ ok: true, value: { advice: [{ title: "Pay is thin", why: "Only 10% state pay.", action: "Watch Lever boards.", cites: ["pay"] }] } });
    const { res, store } = await run();
    expect(structuredWithin).toHaveBeenCalledTimes(2);
    expect(JSON.parse(structuredWithin.mock.calls[1]![3] as string).critique.problems).toHaveLength(1);
    expect("missing" in res ? null : res.review).toMatchObject({ writer: "model", dropped: 0, advice: [{ why: "Only 10% state pay." }] });
    expect(pipelineConfig((await store.settings.get()).dataPipeline).review?.writer).toBe("model");
  });

  it("falls back to the rules when the AI budget says no", async () => {
    takeAiCall.mockResolvedValue({ allowed: false, why: "Daily AI limit reached." });
    const { res } = await run();
    expect(structuredWithin).not.toHaveBeenCalled();
    expect("missing" in res ? null : res.review.writer).toBe("rules");
  });
});
