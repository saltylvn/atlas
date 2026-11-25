import { beforeEach, describe, expect, it, vi } from "vitest";
import { oewsId, OEWS_FOR_TYPE, SERIES } from "@/lib/domain/benchmarks";
import { buildCareerMap, checkSteps, mapChanges, numbersIn, parseMap, pathFacts, rulesSteps, rungFor, weekOf, type CareerMap } from "@/lib/domain/careerMap";
import { certsIn, yearsAsked } from "@/lib/domain/requirements";
import { mergeTech, observeTech, type TechPosting } from "@/lib/domain/techMarket";

const DAY = "2026-11-23";
let n = 0;
const p = (over: Partial<TechPosting> = {}): TechPosting => ({
  fingerprint: `f${n++}`,
  title: "Backend Engineer",
  company: `Co${n % 9}`,
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
  firstSeen: "2026-11-10",
  lastSeen: DAY,
  ...over,
});

describe("Requirements read from a description", () => {
  it.each([
    ["5+ years of experience building APIs", 5],
    ["3-5 years of professional experience", 3],
    ["Minimum of seven years experience in security", 7],
    ["3+ years of Python and 6+ years of experience overall", 6],
    ["Founded 20 years ago", null],
    ["In 2024 we grew", null],
    ["30 years of experience", null],
  ])("%s -> %s", (text, years) => expect(yearsAsked(text)).toBe(years));

  it("names certifications, without reading plain words as them", () => {
    expect(certsIn("AWS Certified Solutions Architect and CompTIA Security+ preferred; CISSP a plus")).toEqual(["AWS certification", "CompTIA Security+", "CISSP"]);
    expect(certsIn("Active Secret clearance required. CKA welcome.")).toEqual(["Kubernetes (CKA/CKAD)", "Security clearance"]);
    expect(certsIn("We value security and access to great tools")).toEqual([]);
  });

  it("records them on a posting, and keeps them when a later titles-only read has none", () => {
    const { rows } = observeTech([{ key: "a", source: "Remote OK", title: "DevOps Engineer", company: "Acme", url: "https://x.com/a", location: "Remote - US", text: "full time. 4+ years of experience with Terraform. CKA preferred.", postedAt: null }], new Set(["Remote OK"]), DAY);
    expect(rows[0]).toMatchObject({ yearsMin: 4, certs: ["Kubernetes (CKA/CKAD)"] });
    expect(mergeTech(rows[0], { ...rows[0]!, yearsMin: null, certs: [] })).toMatchObject({ yearsMin: 4, certs: ["Kubernetes (CKA/CKAD)"] });
  });
});

describe("The Career Map's facts", () => {
  const postings = [
    ...Array.from({ length: 8 }, (_, i) => p({ title: "Backend Engineer", seniority: "junior", payMin: 90000, payMax: 110000, skills: ["Python", "SQL"], yearsMin: 1, company: `J${i}` })),
    ...Array.from({ length: 8 }, (_, i) => p({ title: "Senior Backend Engineer", seniority: "senior", payMin: 170000, payMax: 190000, skills: ["Python", "Kubernetes", "Go"], yearsMin: 5, certs: ["AWS certification"], company: `S${i}` })),
    ...Array.from({ length: 3 }, () => p({ title: "Full Stack Developer" })),
    ...Array.from({ length: 2 }, () => p({ title: "iOS Engineer" })),
    ...Array.from({ length: 5 }, () => p({ title: "Software Engineer" })),
    p({ title: "Data Engineer", family: "data" }),
    p({ title: "Old Backend Engineer", lastSeen: "2026-08-01", firstSeen: "2026-07-01" }),
  ];
  const map = buildCareerMap({ postings, day: DAY, now: "2026-11-23T18:00:00Z", yourFamilies: new Set(["software"]) });
  const sw = map.types.find((t) => t.type === "software")!;

  it("keys the snapshot by the week's Monday", () => {
    expect(weekOf("2026-11-23")).toBe("2026-11-23");
    expect(weekOf("2026-11-29")).toBe("2026-11-23");
    expect(map.week).toBe("2026-11-23");
  });

  it("takes the three biggest named specialties as paths, never the catch-all ahead of them", () => {
    expect(sw.paths.map((x) => [x.name, x.jobs])).toEqual([
      ["Back end", 16],
      ["Full stack", 3],
      ["Mobile", 2],
    ]);
    expect(sw.paths[0]!.yours).toBe(true);
    expect(map.jobs).toBe(27);
  });

  it("lays out each path as rungs with pay, years, skills new at the level, and certifications", () => {
    const be = sw.paths[0]!;
    const [junior, mid, senior] = be.rungs;
    expect(junior).toMatchObject({ level: "junior", jobs: 8, payMedian: 100000, payLow: 100000, payHigh: 100000, yearsMedian: 1 });
    expect(mid).toMatchObject({ level: "mid", jobs: 0, payMedian: null });
    expect(senior).toMatchObject({ jobs: 8, payMedian: 180000, yearsMedian: 5 });
    // Mid is empty, so nothing can be "new" against it.
    expect(senior!.newSkills).toEqual([]);
    expect(senior!.certs[0]).toEqual({ name: "AWS certification", n: 8, share: 1 });
  });

  it("places a job with no level in its title by the years it asks for, and says how many", () => {
    expect(rungFor({ seniority: "senior", yearsMin: 1 })).toEqual({ level: "senior", byYears: false });
    expect([1, 3, 6, 10].map((y) => rungFor({ seniority: "unstated", yearsMin: y })?.level)).toEqual(["junior", "mid", "senior", "staff+"]);
    expect(rungFor({ seniority: "unstated", yearsMin: null })).toBeNull();
    expect(rungFor({ seniority: "manager", yearsMin: 8 })).toBeNull();
    const m = buildCareerMap({ postings: [...postings, ...Array.from({ length: 3 }, () => p({ title: "Backend Engineer", yearsMin: 4 }))], day: DAY, now: "x" });
    const mid = m.types.find((t) => t.type === "software")!.paths[0]!.rungs[1]!;
    expect(mid).toMatchObject({ level: "mid", jobs: 3, fromYears: 3 });
  });

  it("writes rules steps from the facts, one per move up", () => {
    const steps = sw.paths[0]!.steps;
    expect(steps.map((s) => `${s.from}>${s.to}`)).toEqual(["junior>mid", "mid>senior", "senior>staff+"]);
    expect(steps[1]!.items.map((i) => i.title)).toEqual(expect.arrayContaining(["Build toward 5 years of experience", "Consider AWS certification"]));
    expect(rulesSteps([])).toEqual([]);
  });

  it("drops a model step with a number not in the facts, or a link, and keeps the rules' step there", () => {
    const facts = pathFacts(sw);
    const path = sw.paths[0]!;
    const res = checkSteps(
      path,
      [
        { from: "mid", to: "senior", items: [{ title: "Ship a Go service on Kubernetes", why: "Senior roles pay a median $180k and ask 5 years." }, { title: "Earn a cert", why: "It adds $40k." }] },
        { from: "junior", to: "mid", items: [{ title: "Read this", why: "See https://example.com" }] },
      ],
      facts,
    );
    expect(res.dropped).toBe(2);
    expect(res.steps.find((s) => s.to === "senior")).toMatchObject({ writer: "model", items: [{ title: "Ship a Go service on Kubernetes" }] });
    expect(res.steps.find((s) => s.to === "mid")!.writer).toBe("rules");
    expect(numbersIn("$180k, 45% and 5 years")).toEqual(["180k", "45%", "5"]);
  });

  it("survives a round trip through storage, and says what changed since last week", () => {
    expect(parseMap(JSON.parse(JSON.stringify(map)))).toEqual(map);
    expect(parseMap({ week: 1 })).toBeNull();
    const next = buildCareerMap({ postings: postings.map((x) => (x.seniority === "senior" ? { ...x, payMin: 200000, payMax: 200000 } : x)), day: "2026-11-30", now: "2026-11-30T18:00:00Z" });
    const changes = mapChanges(map as CareerMap, next);
    expect(changes.some((c) => c.path === "Back end" && /Senior median pay up 11%/.test(c.text))).toBe(true);
    expect(mapChanges(null, next)).toEqual([]);
  });

  it("asks BLS for the official pay of the occupation closest to each type", () => {
    const ids = new Set(SERIES.map((s) => s.id));
    for (const { code } of Object.values(OEWS_FOR_TYPE)) {
      expect(ids.has(oewsId(code, false))).toBe(true);
      expect(ids.has(oewsId(code, true))).toBe(true);
    }
  });
});

// ---- the Career Mentor's weekly job, with the model mocked ----

const structuredWithin = vi.fn();
vi.mock("@/lib/ai/model", () => ({ aiName: () => "Gemini", aiConfigured: () => true, structuredWithin: (...a: unknown[]) => structuredWithin(...a), whyNoAnswer: () => "not set up" }));
const takeAiCall = vi.fn();
vi.mock("@/lib/ai/budget", () => ({
  takeAiCall: (...a: unknown[]) => takeAiCall(...a),
  takeAiCallPaced: async (...a: unknown[]) => ({ ...(await takeAiCall(...a)), waitedMs: 0 }),
}));

describe("The Career Mentor's career map run", () => {
  beforeEach(() => {
    structuredWithin.mockReset();
    takeAiCall.mockReset();
  });

  const run = async () => {
    const { runCareerMap } = await import("@/lib/agents/careerMap");
    const { createMemoryStore, seedState } = await import("@/lib/data/memory");
    const store = createMemoryStore(seedState(new Date()));
    await store.techMarket.record([
      ...Array.from({ length: 6 }, (_, i) => p({ fingerprint: `j${i}`, seniority: "junior", payMin: 90000, payMax: 110000, skills: ["Python"] })),
      ...Array.from({ length: 6 }, (_, i) => p({ fingerprint: `s${i}`, seniority: "senior", payMin: 170000, payMax: 190000, skills: ["Python", "Go"] })),
      ...Array.from({ length: 4 }, (_, i) => p({ fingerprint: `d${i}`, family: "security", title: "SOC Analyst", seniority: "junior" })),
    ]);
    const settings = await store.settings.get();
    const ctx = { mode: "demo", userId: "", store, settings, now: new Date("2026-11-23T18:00:00Z"), today: DAY, time: "18:00" } as never;
    return { res: await runCareerMap(ctx, { trigger: "owner", persist: store }), store };
  };

  it("asks once per type that has paths, checks the steps, and saves the week", async () => {
    takeAiCall.mockResolvedValue({ allowed: true });
    structuredWithin.mockImplementation(async (_ms: number, _s: unknown, _task: string, data: string) => {
      const { paths } = JSON.parse(data) as { paths: { id: string }[] };
      return { ok: true, value: { paths: paths.map((x) => ({ id: x.id, steps: [{ from: "mid", to: "senior", items: [{ title: "Ship a Go service", why: "Go shows up at the senior level." }] }] })) } };
    });
    const { res, store } = await run();
    expect(structuredWithin).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ map: { week: "2026-11-23", writer: "model" } });
    const saved = parseMap((await store.careerMaps.latest(1))[0]!.data)!;
    const be = saved.types.find((t) => t.type === "software")!.paths[0]!;
    expect(be.steps.find((s) => s.to === "senior")).toMatchObject({ writer: "model" });
    expect(be.steps.find((s) => s.to === "mid")!.writer).toBe("rules");
  });

  it("keeps the rules' steps when the AI limit is reached, and still saves the map", async () => {
    takeAiCall.mockResolvedValue({ allowed: false, why: "daily AI limit reached" });
    const { res, store } = await run();
    expect(structuredWithin).not.toHaveBeenCalled();
    expect(res).toMatchObject({ map: { writer: "rules" } });
    expect(await store.careerMaps.latest(5)).toHaveLength(1);
  });
});
