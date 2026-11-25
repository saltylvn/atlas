import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyBrief, marketMedian, postedMid, sameCompany, TREND_WEEKS } from "@/lib/domain/applyBrief";
import { addDays } from "@/lib/domain/dates";
import type { TechPosting } from "@/lib/domain/techMarket";

// The apply brief for a job in the Apply Queue (PR 2 of the MacBook-only plan, 23 Nov 2026).
// Fictional companies and numbers.

const TODAY = "2026-11-23";
let n = 0;
const post = (over: Partial<TechPosting> = {}): TechPosting => ({
  fingerprint: `f${n++}`,
  title: "Software Engineer I",
  company: "Acme",
  family: "software",
  seniority: "junior",
  mode: "remote",
  region: "us",
  payMin: 100_000,
  payMax: 120_000,
  skills: ["TypeScript"],
  sources: ["Greenhouse"],
  url: `https://example.com/${n}`,
  postedAt: null,
  firstSeen: TODAY,
  lastSeen: TODAY,
  ...over,
});
const job = { title: "Software Engineer I", company: "Acme, Inc.", role: "Software Engineer 1", payText: "$120k–$140k", skills: ["TypeScript", "React", "Go"] };
const base = { job, kitDetail: "Asks for: 1+ years of experience\nSkills it names: TypeScript, SQL", today: TODAY, mySkills: ["typescript", "SQL"], answers: { written: 17, total: 17, fixedSet: true } };

describe("The role", () => {
  it("reads the level, the skills you have and do not, and the years asked", () => {
    const b = applyBrief({ ...base, postings: [] });
    expect(b.role).toMatchObject({ level: "Junior", family: "Software engineering", years: "1+ years" });
    expect(b.role.asks).toEqual(["TypeScript", "React", "Go", "SQL"]);
    expect(b.role.have).toEqual(["TypeScript", "SQL"]);
    expect(b.role.missing).toEqual(["React", "Go"]);
  });

  it("puts its pay against the market median for the same family and level, each company capped", () => {
    // Six other companies at $110k mid; one big hirer at $200k counted at most 25 times.
    const market = [...Array.from({ length: 6 }, (_, i) => post({ company: `Co ${i}` })), ...Array.from({ length: 40 }, () => post({ company: "Big", payMin: 200_000, payMax: 200_000 }))];
    const m = marketMedian(market, "software", "junior");
    expect(m.n).toBe(31);
    const b = applyBrief({ ...base, postings: market });
    expect(b.role.pay).toMatchObject({ marketMedian: m.median, vsMarket: expect.any(String) });
    // Too few postings with pay: no median, no verdict.
    expect(applyBrief({ ...base, postings: [post({ company: "Co 1" })] }).role.pay).toMatchObject({ marketMedian: null, vsMarket: null });
  });

  it("reads posted pay as yearly, hourly included, and ignores what is not pay", () => {
    expect(postedMid("$120k–$140k")).toBe(130_000);
    expect(postedMid("$55/hr")).toBe(114_400);
    expect(postedMid("salary not listed")).toBeNull();
  });
});

describe("The company", () => {
  it("is the same company however a source writes its name", () => {
    expect(sameCompany("Acme, Inc.", "acme")).toBe(true);
    expect(sameCompany("Acme Labs", "Acme")).toBe(true);
    expect(sameCompany("Acme", "Apex")).toBe(false);
    expect(sameCompany("", "")).toBe(false);
  });

  it("counts its open roles, new postings week by week, what it hires and where", () => {
    const theirs = [
      post({ firstSeen: TODAY }),
      post({ firstSeen: addDays(TODAY, -2), family: "data", mode: "hybrid", region: "utah" }),
      post({ firstSeen: addDays(TODAY, -9), lastSeen: addDays(TODAY, -8), payMin: 90_000, payMax: 95_000 }),
    ];
    const b = applyBrief({ ...base, postings: [...theirs, post({ company: "Other" })] });
    expect(b.company.openNow).toBe(2);
    expect(b.company.weekly).toHaveLength(TREND_WEEKS);
    expect(b.company.weekly.slice(-2)).toEqual([1, 2]);
    expect(b.company.hiring[0]).toEqual({ label: "Software engineering", n: 2 });
    expect(b.company).toMatchObject({ remoteShare: 67, utah: 1, payRange: { min: 90_000, max: 120_000 } });
  });

  it("calls no direction until Atlas has two weeks of data, then compares the last two weeks with the two before", () => {
    const young = applyBrief({ ...base, postings: [post()] });
    expect(young.company.trend).toBe("new to Atlas");
    const old = [post({ company: "Seed", firstSeen: addDays(TODAY, -40), lastSeen: addDays(TODAY, -40) })];
    const growing = [...old, ...Array.from({ length: 5 }, () => post({ firstSeen: addDays(TODAY, -3) })), post({ firstSeen: addDays(TODAY, -20) })];
    expect(applyBrief({ ...base, postings: growing }).company.trend).toBe("growing");
    const slowing = [...old, ...Array.from({ length: 5 }, () => post({ firstSeen: addDays(TODAY, -20) })), post({ firstSeen: addDays(TODAY, -3) })];
    expect(applyBrief({ ...base, postings: slowing }).company.trend).toBe("slowing");
    expect(applyBrief({ ...base, postings: old }).company.trend).toBe("no data");
  });
});

describe("Your steps", () => {
  it("runs from research to the follow-up, with a referral step only when you know someone", () => {
    const b = applyBrief({ ...base, postings: [], contact: "Dana Lee" });
    expect(b.steps.map((s) => s.label)).toEqual([
      "Read this brief and the posting",
      "Use your Software Engineer 1 resume",
      "Answers ready",
      "Ask Dana Lee for a referral",
      "Apply on their site with Atlas Autofill",
      "Mark it submitted",
      "Follow up in a week",
    ]);
    expect(b.steps.find((s) => s.label === "Answers ready")!.done).toBe(true);
    const none = applyBrief({ ...base, postings: [], answers: { written: 3, total: 17, fixedSet: false } });
    expect(none.steps.some((s) => s.label.startsWith("Ask "))).toBe(false);
    expect(none.steps.find((s) => s.label === "Answers ready")).toMatchObject({ done: false, how: expect.stringContaining("set your fixed answers on Setup") });
  });

  it("is shown on each application in the Apply Queue, folded", () => {
    const queue = readFileSync(join(__dirname, "..", "components/ApprovalQueue.tsx"), "utf8");
    expect(queue).toContain("<ApplyBriefCard");
    expect(readFileSync(join(__dirname, "..", "components/ApplyBrief.tsx"), "utf8")).toContain("<details");
  });
});
