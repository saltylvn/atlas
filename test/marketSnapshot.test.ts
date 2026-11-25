import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/domain/dates";
import { capPerCompany, COMPANY_CAP, marketSnapshot, MIN_SAMPLE } from "@/lib/domain/marketSnapshot";
import { pipelineView } from "@/lib/domain/pipelineView";
import type { DailyRow, RunQuality, TechPosting } from "@/lib/domain/techMarket";

const DAY = "2026-11-22";
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
  firstSeen: "2026-11-01",
  lastSeen: DAY,
  ...over,
});
const row = (day: string, over: Partial<DailyRow> = {}): DailyRow => ({ day, family: "software", seniority: "unstated", region: "us", active: 100, added: 10, gone: 5, remote: 50, withPay: 40, payMedian: 150000, ...over });

describe("Market snapshot", () => {
  it("takes medians from postings, never from other medians", () => {
    const postings = [p({ payMin: 100000, payMax: 100000 }), p({ payMin: 120000, payMax: 120000 }), p({ payMin: 200000, payMax: 200000, family: "data" })];
    const s = marketSnapshot({ postings, daily: [], day: DAY });
    expect(s.payMedian).toEqual({ value: 120000, n: 3, small: true });
    expect(s.payByFamily.map((r) => [r.key, r.median, r.n])).toEqual([
      ["data", 200000, 1],
      ["software", 110000, 2],
    ]);
  });

  it("counts only postings seen in the last 7 days as active", () => {
    const s = marketSnapshot({ postings: [p(), p({ lastSeen: addDays(DAY, -6) }), p({ lastSeen: addDays(DAY, -7) })], daily: [], day: DAY });
    expect(s.sample).toBe(2);
  });

  it("shows a 7-day change only when there is a day to compare with", () => {
    const without = marketSnapshot({ postings: [p()], daily: [row(DAY)], day: DAY });
    expect(without.active.change).toBeNull();
    const withWeek = marketSnapshot({ postings: [p()], daily: [row(addDays(DAY, -7), { active: 80 }), row(DAY, { active: 100 })], day: DAY });
    expect(withWeek.active).toMatchObject({ value: 100, change: 20 });
    expect(withWeek.trends.find((t) => t.family === "software")).toMatchObject({ latest: 100, change: 20 });
  });

  it("Utah local: only Utah jobs that are not remote, and your families first", () => {
    const postings = [p({ region: "utah", family: "data", mode: "hybrid" }), p({ region: "utah", mode: "remote" }), p({ region: "us", mode: "onsite" })];
    const s = marketSnapshot({ postings, daily: [row(DAY, { region: "utah", family: "data", active: 9, remote: 2 }), row(DAY, { active: 90 })], day: DAY, region: "utah", yourFamilies: new Set(["solutions"]) });
    expect(s.sample).toBe(1);
    expect(s.active.value).toBe(7);
    expect(s.hybridShare.value).toBe(1);
    expect(s.trends[0]!.family).toBe("solutions");
    expect(s.trends[0]!.yours).toBe(true);
  });

  it("Remote: only remote jobs, from anywhere, with their own trend from the summary's remote counts", () => {
    const postings = [p({ mode: "remote", company: "A" }), p({ mode: "remote", region: "utah", company: "B" }), p({ mode: "onsite" })];
    const s = marketSnapshot({ postings, daily: [row(DAY, { active: 100, remote: 60 }), row(DAY, { region: "utah", active: 9, remote: 2 })], day: DAY, region: "remote" });
    expect(s.sample).toBe(2);
    expect(s.active.value).toBe(62);
    expect(s.companyCount).toBe(2);
  });

  it("flags a figure under the minimum sample as small", () => {
    const many = Array.from({ length: MIN_SAMPLE }, () => p());
    expect(marketSnapshot({ postings: many, daily: [], day: DAY }).active.small).toBe(false);
    expect(marketSnapshot({ postings: many.slice(1), daily: [], day: DAY }).active.small).toBe(true);
  });

  it("calls a skill rising only with enough postings in both periods", () => {
    const fresh = Array.from({ length: 30 }, (_, i) => p({ firstSeen: DAY, skills: i < 15 ? ["RAG"] : ["SQL"] }));
    const before = Array.from({ length: 30 }, (_, i) => p({ firstSeen: addDays(DAY, -14), skills: i < 3 ? ["RAG"] : ["SQL"] }));
    const s = marketSnapshot({ postings: [...fresh, ...before], daily: [], day: DAY });
    expect(s.rising[0]).toMatchObject({ skill: "RAG", now: 15, change: 40 });
    expect(marketSnapshot({ postings: fresh, daily: [], day: DAY }).rising).toEqual([]);
  });

  it("counts each company at most 25 times in shares and medians, but not in counts", () => {
    const big = Array.from({ length: 100 }, () => p({ company: "BigCo", payMin: 300000, payMax: 300000, seniority: "senior" }));
    const rest = Array.from({ length: 30 }, (_, i) => p({ company: `Small${i}`, payMin: 100000, payMax: 100000, seniority: "junior" }));
    const s = marketSnapshot({ postings: [...big, ...rest], daily: [], day: DAY });
    expect(s.sample).toBe(130);
    expect(s.capped).toBe(55);
    expect(s.payMedian.value).toBe(100000);
    expect(s.levels.find((l) => l.key === "senior")).toMatchObject({ n: 25 });
    expect(s.companies[0]).toEqual({ company: "BigCo", n: 100 });
    expect(capPerCompany(big)).toHaveLength(COMPANY_CAP);
  });

  it("bases skill shares on postings that came with text", () => {
    const s = marketSnapshot({ postings: [p({ skills: ["SQL"] }), p({ skills: ["SQL", "Python"] }), p(), p()], daily: [], day: DAY });
    expect(s.skillBase).toBe(2);
    expect(s.topSkills[0]).toMatchObject({ skill: "SQL", n: 2, share: 1 });
  });

  it("lists sources by how many active postings each gave, company boards grouped", () => {
    const s = marketSnapshot({ postings: [p({ sources: ["Acme careers", "Himalayas"] }), p({ sources: ["Beta careers"] })], daily: [], day: DAY });
    expect(s.sources).toEqual([
      { name: "Company boards", n: 2 },
      { name: "Himalayas", n: 1 },
    ]);
  });
});

describe("Pipeline view", () => {
  const quality: RunQuality = { day: DAY, read: 2000, notTech: 900, notFullTime: 50, outsideUs: 250, tech: 800, duplicates: 100, recorded: 700, withPay: 140, withSkills: 420, levelStated: 300, capped: false, sources: [{ source: "Remote OK", read: 100, tech: 60, withPay: 50 }] };

  it("draws each stage with what it set aside, and flags weak data", () => {
    const v = pipelineView({ quality, size: { postings: 5000, days: 12 }, today: DAY, yourPostings: 210, reportDay: DAY });
    expect(v.stages.map((s) => s.count)).toEqual([2000, 800, 700, 5000, 12, null]);
    expect(v.stages[1]!.dropped).toEqual([
      { reason: "not a tech role", n: 900 },
      { reason: "contract or part-time", n: 50 },
      { reason: "outside the U.S.", n: 250 },
    ]);
    expect(v.checks.find((c) => c.label === "States pay")).toMatchObject({ value: 0.2, ok: false });
    expect(v.checks.find((c) => c.label === "Names a skill")).toMatchObject({ value: 0.6, ok: true });
    expect(v.sources.find((s) => s.name === "Remote OK")).toMatchObject({ read: 100, ok: true });
    expect(v.sources.find((s) => s.name === "Remotive")).toMatchObject({ ok: false });
    expect(v.fresh).toBe(true);
  });

  it("warns when a run hit its row cap, and is empty before the first run", () => {
    expect(pipelineView({ quality: { ...quality, capped: true }, size: { postings: 0, days: 0 }, today: DAY, yourPostings: 0, reportDay: null }).stages[2]!.warn).toMatch(/cap/);
    const empty = pipelineView({ quality: null, size: { postings: 0, days: 0 }, today: DAY, yourPostings: 0, reportDay: null });
    expect(empty.lastRun).toBeNull();
    expect(empty.checks).toEqual([]);
  });
});
