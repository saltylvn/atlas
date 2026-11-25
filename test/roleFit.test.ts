import { describe, expect, it } from "vitest";
import { rankedPostings, ROLE_FIT, roleFitBrief, topFit, topThreeAverage } from "@/lib/domain/roleFit";

describe("Role fit study", () => {
  it("has four groups in rank order: two targets, a stretch and a fallback", () => {
    expect(ROLE_FIT.groups.map((g) => g.rank)).toEqual([1, 2, 3, 4]);
    expect(ROLE_FIT.groups.map((g) => g.stance)).toEqual(["target", "target", "stretch", "fallback"]);
  });

  it("holds every saved posting once, with a fit from 0 to 100", () => {
    const all = rankedPostings();
    expect(all).toHaveLength(ROLE_FIT.postings);
    expect(new Set(all.map((p) => `${p.company}|${p.title}`)).size).toBe(all.length);
    expect(all.every((p) => p.fit >= 0 && p.fit <= 100)).toBe(true);
    // Best first.
    expect(all.map((p) => p.fit)).toEqual([...all.map((p) => p.fit)].sort((a, b) => b - a));
  });

  it("puts eight of the nine postings that scored 60 or more in the two target groups", () => {
    const strong = rankedPostings().filter((p) => p.fit >= 60);
    const targets = ROLE_FIT.groups.filter((g) => g.stance === "target").map((g) => g.name);
    expect(strong).toHaveLength(9);
    expect(strong.filter((p) => (targets as string[]).includes(p.group))).toHaveLength(8);
  });

  it("scores a group by its best fit and its top-three average", () => {
    const [internal, customer] = ROLE_FIT.groups;
    expect(topFit(internal!)).toBe(88);
    expect(topThreeAverage(internal!)).toBe(79);
    expect(topThreeAverage(customer!)).toBe(75);
  });

  it("lists the gaps in rank order, each with a step that closes it", () => {
    expect(ROLE_FIT.gaps.map((g) => g.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const g of ROLE_FIT.gaps) expect(g.close.length).toBeGreaterThan(20);
  });

  it("gives the Career Mentor a short plain-text brief with the groups, gaps and filters", () => {
    const brief = roleFitBrief();
    expect(brief.length).toBeLessThan(1500);
    expect(brief).toContain("Internal AI and Automation Engineer");
    expect(brief).toContain("MCP server");
    expect(brief).toContain("security clearance");
    expect(brief).not.toMatch(/https?:\/\//);
  });
});
