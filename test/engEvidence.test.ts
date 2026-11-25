import { beforeEach, describe, expect, it, vi } from "vitest";
import { engEvidence, specialtyOf } from "@/lib/domain/engEvidence";
import { CHECK_SAMPLE, checkItems, checkSample, compareLabels, rulesLabel, TypeCheckOut } from "@/lib/domain/typeCheck";
import { pipelineConfig } from "@/lib/domain/dataPipeline";
import type { TechPosting } from "@/lib/domain/techMarket";

const DAY = "2026-11-23";
let n = 0;
const p = (over: Partial<TechPosting> = {}): TechPosting => ({
  fingerprint: `f${n++}`,
  title: "Software Engineer",
  company: `Co${n % 5}`,
  family: "software",
  seniority: "unstated",
  mode: "remote",
  region: "us",
  payMin: null,
  payMax: null,
  skills: [],
  sources: ["Remote OK"],
  url: "https://x.com",
  postedAt: null,
  firstSeen: "2026-11-20",
  lastSeen: DAY,
  ...over,
});

describe("Specialties inside each type", () => {
  it.each([
    ["software", "Senior iOS Engineer", "Mobile"],
    ["software", "Full Stack Developer", "Full stack"],
    ["software", "Backend Engineer, Payments", "Back end"],
    ["software", "Software Engineer", "General software"],
    ["data-ai", "Machine Learning Engineer", "Machine learning and AI"],
    ["data-ai", "Senior Data Engineer", "Data engineering"],
    ["data-ai", "BI Analyst", "Analytics and BI"],
    ["cloud-devops", "Site Reliability Engineer", "Site reliability"],
    ["security", "Application Security Engineer", "Application security"],
    ["security", "SOC Analyst", "Security operations"],
    ["solutions-it", "Solutions Engineer", "Solutions and sales engineering"],
    ["solutions-it", "Help Desk Technician", "IT support"],
  ] as const)("%s: %s is %s", (type, title, spec) => expect(specialtyOf(type, title)).toBe(spec));
});

describe("Evidence for the five types", () => {
  it("counts 30 days of jobs: share of tech, companies, sources, growth and specialties", () => {
    const postings = [
      p({ title: "Backend Engineer", company: "A", firstSeen: "2026-11-20" }),
      p({ title: "Backend Engineer II", company: "B", sources: ["Acme careers"], firstSeen: "2026-11-01" }),
      p({ title: "iOS Engineer", company: "B", firstSeen: "2026-11-15" }),
      p({ title: "Data Engineer", family: "data", company: "C" }),
      p({ title: "Product Manager", family: "product" }),
      p({ title: "Old Backend Engineer", lastSeen: "2026-10-01", firstSeen: "2026-09-20" }),
    ];
    const ev = engEvidence(postings, DAY);
    expect(ev).toMatchObject({ tech: 5, engineering: 4, product: 1, coverage: 0.8 });
    const sw = ev.types[0]!;
    expect(sw).toMatchObject({ type: "software", jobs: 3, share: 0.6, companies: 2, sources: 2, newRecent: 2, newBefore: 1 });
    expect(sw.specialties[0]).toEqual({ name: "Back end", n: 2, share: 2 / 3 });
    expect(ev.types.map((t) => t.type).slice(0, 2)).toEqual(["software", "data-ai"]);
    expect(ev.spread).toBeNull();
  });
});

describe("The AI label check: sample and compare", () => {
  const mixed = [...Array.from({ length: 60 }, () => p()), ...Array.from({ length: 5 }, () => p({ family: "security", title: "Security Engineer" })), ...Array.from({ length: 4 }, () => p({ family: "product", title: "Product Manager" }))];

  it("takes an even share of each label, the same sample all day", () => {
    const s = checkSample(mixed, DAY);
    expect(s).toHaveLength(CHECK_SAMPLE);
    expect(s.filter((x) => rulesLabel(x) === "security")).toHaveLength(5);
    expect(s.filter((x) => rulesLabel(x) === "product")).toHaveLength(4);
    expect(checkSample(mixed, DAY).map((x) => x.fingerprint)).toEqual(s.map((x) => x.fingerprint));
    expect(checkItems(s)[0]).toEqual({ i: 0, title: s[0]!.title, company: s[0]!.company });
  });

  it("measures agreement, per label, and lists where the AI differs", () => {
    const sample = [p(), p({ family: "security", title: "Security Engineer" }), p({ family: "product", title: "Sales Engineer" }), p()];
    const out = TypeCheckOut.parse({ items: [{ i: 0, type: "software" }, { i: 1, type: "security" }, { i: 2, type: "solutions-it" }, { i: 0, type: "data-ai" }, { i: 9, type: "software" }] });
    const c = compareLabels(sample, out, "2026-11-23T18:00:00Z", "Gemini");
    expect(c).toMatchObject({ sample: 4, judged: 3, agree: 2 });
    expect(c.byType).toEqual([
      { type: "software", n: 1, agree: 1 },
      { type: "security", n: 1, agree: 1 },
      { type: "product", n: 1, agree: 0 },
    ]);
    expect(c.disagreements).toEqual([{ title: "Sales Engineer", company: sample[2]!.company, rules: "product", ai: "solutions-it" }]);
  });

  it("rejects a label that is not one of the seven", () => {
    expect(TypeCheckOut.safeParse({ items: [{ i: 0, type: "marketing" }] }).success).toBe(false);
  });

  it("keeps a saved check through the settings schema, and drops a broken one", () => {
    const check = compareLabels([p()], { items: [{ i: 0, type: "software" }] }, "2026-11-23T18:00:00Z", "Gemini");
    expect(pipelineConfig({ typeCheck: check }).typeCheck).toEqual(check);
    expect(pipelineConfig({ typeCheck: { at: 1 } }).typeCheck).toBeUndefined();
  });
});

// ---- the check end to end, with the model mocked ----

const structuredWithin = vi.fn();
vi.mock("@/lib/ai/model", () => ({ aiName: () => "Gemini", aiConfigured: () => true, structuredWithin: (...a: unknown[]) => structuredWithin(...a), whyNoAnswer: () => "not set up" }));
const takeAiCall = vi.fn();
vi.mock("@/lib/ai/budget", () => ({ takeAiCall: (...a: unknown[]) => takeAiCall(...a) }));

describe("The type check run", () => {
  beforeEach(() => {
    structuredWithin.mockReset();
    takeAiCall.mockReset();
  });

  const run = async (jobs: TechPosting[]) => {
    const { runTypeCheck } = await import("@/lib/agents/typeCheck");
    const { createMemoryStore, seedState } = await import("@/lib/data/memory");
    const store = createMemoryStore(seedState(new Date()));
    await store.techMarket.record(jobs);
    const settings = await store.settings.get();
    const ctx = { mode: "demo", userId: "", store, settings, now: new Date("2026-11-23T18:00:00Z"), today: DAY, time: "18:00" } as never;
    return { res: await runTypeCheck(ctx, { trigger: "owner" }), store };
  };

  it("asks once with titles and companies only, saves the result, and changes no label", async () => {
    takeAiCall.mockResolvedValue({ allowed: true });
    structuredWithin.mockImplementation(async (_ms: number, _schema: unknown, _task: string, data: string) => {
      const { items } = JSON.parse(data) as { items: { i: number; title: string; company: string }[] };
      expect(Object.keys(items[0]!).sort()).toEqual(["company", "i", "title"]);
      return { ok: true, value: { items: items.map((x) => ({ i: x.i, type: "software" })) } };
    });
    const jobs = Array.from({ length: 12 }, (_, i) => p({ fingerprint: `t${i}`, family: i < 10 ? "software" : "data", title: i < 10 ? "Software Engineer" : "Data Engineer" }));
    const { res, store } = await run(jobs);
    expect(structuredWithin).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ check: { sample: 12, judged: 12, agree: 10 } });
    expect(pipelineConfig((await store.settings.get()).dataPipeline).typeCheck?.agree).toBe(10);
    expect((await store.techMarket.since("2026-11-01")).filter((x) => x.family === "data")).toHaveLength(2);
  });

  it("does not call the model with too few jobs, or over the AI limit", async () => {
    expect(await run([p()]).then((r) => r.res)).toMatchObject({ missing: "skipped" });
    takeAiCall.mockResolvedValue({ allowed: false, why: "daily AI limit reached" });
    expect(await run(Array.from({ length: 12 }, (_, i) => p({ fingerprint: `u${i}` }))).then((r) => r.res)).toMatchObject({ missing: "skipped", why: "daily AI limit reached" });
    expect(structuredWithin).not.toHaveBeenCalled();
  });
});
