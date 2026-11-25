import { describe, expect, it } from "vitest";
import { lensOf, lensStats } from "@/lib/domain/roleLens";
import type { TechPosting } from "@/lib/domain/techMarket";

// Your six roles as the market's categories (23 Nov 2026).

describe("Which of your six roles a title falls under", () => {
  it("reads each role's titles, at any level", () => {
    expect(lensOf("Software Engineer")).toBe("software");
    expect(lensOf("Senior Software Engineer, Payments")).toBe("software");
    expect(lensOf("Full Stack Engineer")).toBe("software");
    expect(lensOf("Backend Engineer II")).toBe("software");
    expect(lensOf("AI Automation Engineer")).toBe("automation");
    expect(lensOf("GTM Engineer")).toBe("automation");
    expect(lensOf("Workflow Automation Engineer")).toBe("workflow");
    expect(lensOf("Solutions Engineer")).toBe("solutions");
    expect(lensOf("Sales Engineer")).toBe("solutions");
    expect(lensOf("Agentic AI Engineer")).toBe("agentic");
    expect(lensOf("Forward Deployed Software Engineer")).toBe("fde");
  });

  it("keeps workflow, automation and solutions titles out of Software Engineer", () => {
    expect(lensOf("Software Engineer, Automation")).not.toBe("software");
    // No rule names it: Other for now, and one for Gemini to judge.
    expect(lensOf("Solutions Software Engineer")).toBeNull();
  });

  it("leaves a title no rule places for Other (Gemini judges it later)", () => {
    expect(lensOf("Data Engineer")).toBeNull();
    expect(lensOf("Site Reliability Engineer")).toBeNull();
  });
});

describe("The six roles over the last 30 days", () => {
  const p = (title: string, company: string, over: Partial<TechPosting> = {}): TechPosting => ({ fingerprint: `${company}:${title}:${Math.random()}`, title, company, family: "software", seniority: "mid", mode: "remote", region: "us", payMin: null, payMax: null, skills: [], sources: ["Test"], url: "https://example.com/j", postedAt: null, firstSeen: "2026-11-20", lastSeen: "2026-11-23", ...over });

  it("counts each role, ranks the companies hiring most, and leaves Other out of that ranking", () => {
    const s = lensStats(
      [
        p("Software Engineer", "Acme"),
        p("Software Engineer II", "Acme"),
        p("Solutions Engineer", "Acme"),
        p("Software Engineer", "Beta", { region: "utah" }),
        p("Data Engineer", "Gamma"),
        p("Data Engineer", "Gamma"),
        p("Data Engineer", "Gamma"),
        p("Software Engineer", "Old", { lastSeen: "2026-10-01" }),
      ],
      "2026-11-23",
    );
    expect(s.total30).toBe(7);
    const row = (l: string) => s.rows.find((r) => r.lens === l)!;
    expect(row("software")).toMatchObject({ jobs30: 3, jobs7: 3, where: { utah: 1, us: 2, global: 0, unstated: 0 } });
    expect(row("solutions").jobs30).toBe(1);
    expect(row("other").jobs30).toBe(3);
    expect(row("software").companies).toEqual([{ company: "Acme", jobs: 2 }, { company: "Beta", jobs: 1 }]);
    expect(s.topCompanies.map((c) => [c.company, c.jobs])).toEqual([["Acme", 3], ["Beta", 1]]);
    expect(s.topCompanies[0]!.by).toEqual([{ lens: "software", jobs: 2 }, { lens: "solutions", jobs: 1 }]);
  });

  it("says what the Other tech roles are: the biggest families, with their common titles, levels left off", () => {
    const s = lensStats(
      [
        p("Senior Data Engineer", "A", { family: "data" }),
        p("Data Engineer", "B", { family: "data" }),
        p("Analytics Engineer, Growth", "C", { family: "data" }),
        p("Security Engineer", "D", { family: "security" }),
        p("Software Engineer", "E"),
      ],
      "2026-11-23",
    );
    const other = s.rows.find((r) => r.lens === "other")!;
    expect(other.categories).toEqual([
      { label: "Data", jobs: 3, titles: ["Data Engineer", "Analytics Engineer"] },
      { label: "Security", jobs: 1, titles: ["Security Engineer"] },
    ]);
    expect(s.rows.find((r) => r.lens === "software")!.categories).toBeUndefined();
  });
});
