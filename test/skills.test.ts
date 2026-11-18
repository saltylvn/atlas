import { describe, expect, it } from "vitest";
import { extractSkills, isFirstWeekdayOfMonth, linkedinTuneup, portfolioProject, skillDemand, skillGaps } from "@/lib/domain/skills";
import { rolesFrom } from "@/lib/domain/targetRoles";

// A fixed priority order for these tests, whatever the current default is.
const roles = rolesFrom(["Solutions Engineer", "Forward Deployed Engineer", "AI Workflow Engineer", "AI + Automation Engineer", "AI Engineer", "Software Engineer"]);

describe("Skill extraction", () => {
  it("finds skills as whole words, not inside other words", () => {
    expect(extractSkills("Build RAG pipelines with LangChain and pgvector on AWS; Python and TypeScript")).toEqual(
      expect.arrayContaining(["RAG", "LangChain", "Vector databases", "AWS", "Python", "TypeScript"]),
    );
    expect(extractSkills("We drag and drop; storage; bragging rights")).toEqual([]);
    expect(extractSkills("Agentic workflows with n8n and REST APIs")).toEqual(expect.arrayContaining(["AI agents", "Workflow automation", "APIs & integrations"]));
    expect(extractSkills("Run product demos and proofs of concept for customers")).toContain("Customer-facing demos");
  });
});

describe("Skill gaps", () => {
  const matches = [
    { role: "Solutions Engineer", skills: ["Customer-facing demos", "Salesforce", "APIs & integrations"] },
    { role: "Solutions Engineer", skills: ["Customer-facing demos", "APIs & integrations"] },
    { role: "Forward Deployed Engineer", skills: ["Customer-facing demos"] },
    { role: "Software Engineer", skills: ["Go", "Kubernetes"] },
    { role: "Software Engineer", skills: ["Go"] },
    { role: "Software Engineer", skills: ["Go"] },
  ];

  it("weights skills toward your higher-priority roles and marks what you have", () => {
    const d = skillDemand(matches, roles, ["APIs & integrations"]);
    expect(d[0]).toMatchObject({ skill: "Customer-facing demos", count: 3, roles: ["Solutions Engineer", "Forward Deployed Engineer"], have: false });
    expect(d.find((x) => x.skill === "APIs & integrations")?.have).toBe(true);
    expect(d.find((x) => x.skill === "Go")?.count).toBe(3);
    expect(skillGaps(d).map((g) => g.skill)).not.toContain("APIs & integrations");
  });

  it("picks the month's project for the biggest gap, with a specific plan when one exists", () => {
    const gaps = skillGaps(skillDemand(matches, roles, []));
    expect(portfolioProject(gaps)).toMatchObject({ skill: "Customer-facing demos", title: "A 5-minute product demo of Atlas" });
    expect(portfolioProject([{ skill: "Salesforce", group: "Data", count: 1, roles: [], have: false }])?.title).toBe("A small Salesforce project tied to Atlas");
    expect(portfolioProject([])).toBeNull();
  });

  it("knows the first weekday of the month", () => {
    expect(isFirstWeekdayOfMonth("2026-12-01")).toBe(true); // Tuesday
    expect(isFirstWeekdayOfMonth("2026-11-02")).toBe(true); // Monday after a weekend 1st
    expect(isFirstWeekdayOfMonth("2026-11-01")).toBe(false); // Sunday
    expect(isFirstWeekdayOfMonth("2026-11-03")).toBe(false);
  });
});

describe("LinkedIn tune-up", () => {
  it("leads with your top roles and the skills you have that employers ask for", () => {
    const demand = skillDemand([{ role: "Solutions Engineer", skills: ["APIs & integrations", "Customer-facing demos", "Python"] }], roles, ["APIs & integrations", "Python"]);
    const t = linkedinTuneup(roles, demand, [{ title: "Solutions Engineer, Enterprise", role: "Solutions Engineer" }]);
    expect(t.headline.startsWith("Solutions Engineer | Forward Deployed Engineer")).toBe(true);
    expect(t.addSkills).toEqual(expect.arrayContaining(["APIs & integrations", "Python"]));
    expect(t.learn).toEqual(["Customer-facing demos"]);
    expect(t.aboutTips.join(" ")).toContain("Solutions Engineer");
  });
});
