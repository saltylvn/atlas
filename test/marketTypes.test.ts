import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENG_TYPE_INFO, ENG_TYPES, engTypeCards, engTypeOf } from "@/lib/domain/engTypes";
import { jobMaps } from "@/lib/domain/jobMap";
import { activeInView, marketSnapshot } from "@/lib/domain/marketSnapshot";
import { HOODS, PIPELINE } from "@/lib/domain/provenance";
import { FAMILIES, fingerprint, observeTech, regionOf, type DailyRow, type TechPosting } from "@/lib/domain/techMarket";

const DAY = "2026-11-23";
let n = 0;
const p = (over: Partial<TechPosting> = {}): TechPosting => ({
  fingerprint: `f${n++}`,
  title: "Software Engineer",
  company: `Co${n % 7}`,
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

describe("International: remote jobs open beyond the U.S. that hire people in it", () => {
  it.each([
    ["Worldwide", "global"],
    ["Remote - Anywhere in the World", "global"],
    ["Remote (Americas)", "global"],
    ["North America", "global"],
    ["United States, Canada", "global"],
    ["Remote - US or Europe", "global"],
    ["New York, NY; Remote (Worldwide)", "global"],
    ["Remote - US", "us"],
    ["Anywhere", "us"],
    ["Austin, TX", "us"],
    ["Austin, TX; London, UK", "us"],
    ["Lehi, UT", "utah"],
    ["Europe", null],
    ["Remote - Germany", null],
  ])("%s is %s", (loc, region) => expect(regionOf(loc, false)).toBe(region));

  it("records a worldwide job as remote, with the same identity it had as a U.S. job", () => {
    const { rows } = observeTech([{ key: "a", source: "Acme careers", title: "Data Engineer", company: "Acme", url: "https://x.com/a", location: "Worldwide", text: "full time", postedAt: null }], new Set(), DAY);
    expect(rows[0]).toMatchObject({ region: "global", mode: "remote", states: [] });
    expect(rows[0]!.fingerprint).toBe(fingerprint("Acme", "Data Engineer", "us", "a"));
  });

  it("splits Remote U.S. and International with no overlap, and keeps both in the whole market", () => {
    const postings = [p({ region: "global", company: "A" }), p({ region: "global", company: "B" }), p({ region: "us" }), p({ region: "utah", mode: "hybrid" })];
    const daily: DailyRow[] = [
      { day: DAY, family: "software", seniority: "unstated", region: "global", active: 40, added: 0, gone: 0, remote: 40, withPay: 0, payMedian: null },
      { day: DAY, family: "software", seniority: "unstated", region: "us", active: 100, added: 0, gone: 0, remote: 60, withPay: 0, payMedian: null },
    ];
    expect(marketSnapshot({ postings, daily, day: DAY, region: "intl" })).toMatchObject({ sample: 2, companyCount: 2, active: { value: 40 } });
    expect(marketSnapshot({ postings, daily, day: DAY, region: "remote" })).toMatchObject({ sample: 1, active: { value: 60 } });
    expect(marketSnapshot({ postings, daily, day: DAY, region: "all" }).sample).toBe(4);
    expect(activeInView(postings, DAY, "intl")).toHaveLength(2);
  });

  it("keeps worldwide jobs off the Remote U.S. map", () => {
    const m = jobMaps([p({ region: "global", states: [] }), p({ region: "us", states: [] })], DAY);
    expect(m.remote.total).toBe(1);
  });
});

describe("Five types of engineer", () => {
  it("cover every role family but product, each once", () => {
    const mapped = FAMILIES.filter((f) => engTypeOf(f) !== null);
    expect(mapped).toHaveLength(FAMILIES.length - 1);
    expect(engTypeOf("product")).toBeNull();
    expect(ENG_TYPES.flatMap((t) => ENG_TYPE_INFO[t].families).sort()).toEqual([...mapped].sort());
  });

  it("are ranked biggest first, with pay, remote share, skills and companies, product left apart", () => {
    const postings = [
      ...Array.from({ length: 6 }, () => p({ family: "data", skills: ["SQL", "Python"], payMin: 150000, payMax: 170000, company: "DataCo" })),
      p({ family: "ai-ml", skills: ["PyTorch"], mode: "hybrid", company: "AiCo", seniority: "senior" }),
      ...Array.from({ length: 3 }, () => p({ family: "software" })),
      p({ family: "solutions" }),
      p({ family: "product" }),
    ];
    const { cards, engineering, notEngineering } = engTypeCards(postings);
    expect(engineering).toBe(11);
    expect(notEngineering).toBe(1);
    expect(cards.map((c) => [c.type, c.jobs])).toEqual([
      ["data-ai", 7],
      ["software", 3],
      ["solutions-it", 1],
      ["cloud-devops", 0],
      ["security", 0],
    ]);
    const d = cards[0]!;
    expect(d).toMatchObject({ payMedian: 160000, payN: 6, topLevel: "Senior" });
    expect(d.share).toBeCloseTo(7 / 11);
    expect(d.remoteShare).toBeCloseTo(6 / 7);
    expect(d.topSkills[0]).toEqual({ skill: "Python", share: 6 / 7 });
    expect(d.topCompanies[0]).toEqual({ company: "DataCo", n: 6 });
  });

  it("count each company at most the cap in pay and shares, but not in jobs", () => {
    const big = Array.from({ length: 30 }, () => p({ family: "security", company: "Big", payMin: 300000, payMax: 300000 }));
    const small = Array.from({ length: 30 }, (_, i) => p({ family: "security", company: `S${i}`, payMin: 100000, payMax: 100000 }));
    const sec = engTypeCards([...big, ...small], 5).cards.find((c) => c.type === "security")!;
    expect(sec.jobs).toBe(60);
    expect(sec.base).toBe(35);
    expect(sec.payMedian).toBe(100000);
  });
});

describe("Under the hood", () => {
  it("names only files that exist", () => {
    const parts = [...PIPELINE, ...Object.values(HOODS).flatMap((h) => h.parts)];
    for (const part of parts) expect(existsSync(part.file), part.file).toBe(true);
  });
});
