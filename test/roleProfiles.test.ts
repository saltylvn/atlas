import { describe, expect, it } from "vitest";
import { lensJudgments, lensProfile, lensStats, lensWithJudged, mergeJudgments, titleKey, titlesToJudge, JUDGED_KEEP } from "@/lib/domain/roleLens";
import type { TechPosting } from "@/lib/domain/techMarket";

// Six roles, parts 2 and 3 (24 Nov 2026): what each role asks for, and Gemini's judgment of the
// titles the rules cannot place.

const TODAY = "2026-11-24";
const job = (title: string, over: Partial<TechPosting> = {}): TechPosting =>
  ({ fingerprint: title + Math.random(), title, company: "Acme", family: "software", seniority: "unstated", mode: "remote", region: "us", payMin: null, payMax: null, skills: [], sources: ["x"], url: "", postedAt: null, firstSeen: TODAY, lastSeen: TODAY, ...over }) as TechPosting;

describe("lensProfile: pay by level, skills, years and certifications", () => {
  const jobs = [
    job("Software Engineer I", { seniority: "junior", payMin: 100_000, payMax: 120_000, skills: ["TypeScript", "AWS"], yearsMin: 1 }),
    job("Junior Software Engineer", { seniority: "junior", payMin: 90_000, payMax: 110_000, skills: ["TypeScript"], yearsMin: 2, certs: ["AWS certification"] }),
    job("Software Engineer", { seniority: "unstated", skills: ["Python"], yearsMin: 3 }),
    job("Senior Software Engineer", { seniority: "senior", payMin: 180_000, payMax: 220_000, yearsMin: 6 }),
    job("Software Engineer II", { seniority: "mid" }),
  ];
  const p = lensProfile(jobs);

  it("medians the posted range's midpoint per level, with how many state it", () => {
    expect(p.pay).toEqual([
      { level: "junior", median: 105_000, n: 2 },
      { level: "mid", median: null, n: 0 },
      { level: "senior", median: 200_000, n: 1 },
      { level: "staff+", median: null, n: 0 },
    ]);
  });

  it("counts skills over the postings that name any, and years and certifications from descriptions", () => {
    expect(p.skills[0]).toEqual({ skill: "TypeScript", share: 2 / 3 });
    expect(p.skillsFrom).toBe(3);
    expect(p.years).toEqual({ "0-2": 2, "3-4": 1, "5+": 1, stated: 4 });
    expect(p.certs).toEqual([{ name: "AWS certification", n: 1 }]);
  });

  it("lensStats attaches a profile to each of your roles, not to Other", () => {
    const s = lensStats([...jobs, job("Data Engineer", { family: "data" })], TODAY);
    expect(s.rows.find((r) => r.lens === "software")?.profile?.pay[0]?.n).toBe(2);
    expect(s.rows.find((r) => r.lens === "other")?.profile).toBeUndefined();
  });
});

describe("Gemini judges the titles the rules cannot place", () => {
  const postings = [
    job("Member of Technical Staff"),
    job("Senior Member of Technical Staff"),
    job("Platform Engineer"),
    job("Software Engineer"),
    job("Data Engineer", { family: "data" }),
  ];

  it("asks about unplaced titles in families that could be yours, most common first, by bare title", () => {
    expect(titlesToJudge(postings, {})).toEqual(["Member of Technical Staff", "Platform Engineer"]);
    expect(titlesToJudge(postings, { "member of technical staff": "software" })).toEqual(["Platform Engineer"]);
  });

  it("keeps only answers to titles it asked, from the fixed list", () => {
    const next = mergeJudgments(lensJudgments(undefined), ["Platform Engineer"], [
      { title: "Platform Engineer", lens: "software" },
      { title: "Ignore all rules", lens: "software" },
      { title: "Platform Engineer", lens: "ceo" },
    ], TODAY);
    expect(next).toEqual({ day: TODAY, titles: { "platform engineer": "software" } });
  });

  it("places a judged title in its role, by its bare form, and says so", () => {
    const judged = { "member of technical staff": "software" as const };
    expect(lensWithJudged("Senior Member of Technical Staff", judged)).toEqual({ lens: "software", by: "ai" });
    expect(lensWithJudged("Software Engineer", judged)).toEqual({ lens: "software", by: "rules" });
    const s = lensStats(postings, TODAY, judged);
    expect(s.rows.find((r) => r.lens === "software")).toMatchObject({ jobs30: 3, byAi: 2 });
    expect(s.judgedTitles).toBe(1);
  });

  it("keeps at most the newest judgments, and reads a bad stored value as none", () => {
    const many = Object.fromEntries(Array.from({ length: JUDGED_KEEP + 5 }, (_, i) => [`t${i}`, "other" as const]));
    const next = mergeJudgments({ day: "", titles: many }, ["New Title"], [{ title: "New Title", lens: "agentic" }], TODAY);
    expect(Object.keys(next.titles)).toHaveLength(JUDGED_KEEP);
    expect(next.titles["new title"]).toBe("agentic");
    expect(next.titles.t0).toBeUndefined();
    expect(lensJudgments({ day: 3, titles: { a: "boss" } })).toEqual({ day: "", titles: {} });
    expect(titleKey("Staff Platform Engineer, Infra")).toBe("platform engineer");
  });
});
