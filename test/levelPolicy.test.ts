import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { candidates, type RawJob } from "@/lib/domain/careerAgent";
import { aboveLevel, levelRule, levelVerdict, maxYearsOf } from "@/lib/domain/levelPolicy";
import { observe } from "@/lib/domain/mentor";
import { queueLevels, topFive } from "@/lib/domain/scoutFocus";
import { searchGoal } from "@/lib/domain/searchProfile";
import { ROLE_OPTIONS } from "@/lib/domain/targetRoles";
import type { Approval, JobMatch } from "@/lib/domain/types";

// One level rule for every agent (24 Nov 2026): early-career to mid-level, 1 to 3 years asked; senior roles ignored.

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("levelVerdict: where a posting sits against your level", () => {
  it("ignores senior, staff, lead, manager and level III+ titles", () => {
    for (const t of ["Senior Software Engineer", "Sr. Software Engineer", "Staff Engineer", "Lead Developer", "Engineering Manager", "Software Engineer III"]) expect(levelVerdict(t, "").fit, t).toBe("above");
    // A project or program manager runs work, not people.
    expect(levelVerdict("AI Project Manager", "").fit).not.toBe("above");
  });

  it("ignores any posting asking for 4 or more years, whatever its title", () => {
    expect(levelVerdict("Software Engineer", "Requires 4+ years of experience building APIs.")).toMatchObject({ fit: "above", years: 4 });
    expect(levelVerdict("Software Engineer", "Requires 3+ years of experience building APIs.")).toMatchObject({ fit: "target", years: 3 });
    expect(levelVerdict("Junior Software Engineer", "5 years of experience with Java required.").fit).toBe("above");
    expect(levelVerdict("Software Engineer at Acme", "Asks for: 4+ years of experience").fit).toBe("above");
  });

  it("targets junior and mid-level titles and anything asking for 3 years or fewer", () => {
    expect(levelVerdict("Software Engineer I", "").fit).toBe("target");
    expect(levelVerdict("Associate Software Engineer", "").fit).toBe("target");
    expect(levelVerdict("Software Engineer", "1-2 years of experience with TypeScript.")).toMatchObject({ fit: "target", years: 1 });
    expect(levelVerdict("Software Engineer II", "2+ years of experience in web development.").fit).toBe("target");
  });

  it("says to check when nothing states a level or years", () => {
    expect(levelVerdict("Software Engineer", "").fit).toBe("check");
    // Level II is mid-level: on target without a years line.
    expect(levelVerdict("Software Engineer II", "").fit).toBe("target");
  });

  it("the limit comes from Settings and defaults to 3", () => {
    expect(maxYearsOf({})).toBe(3);
    expect(maxYearsOf({ careerMaxYears: 2 })).toBe(2);
    expect(maxYearsOf({ careerMaxYears: -1 })).toBe(3);
    expect(aboveLevel("Software Engineer", "3+ years of experience required", 2)).toBe(true);
    expect(aboveLevel("Software Engineer", "3+ years of experience required")).toBe(false);
  });
});

describe("Every agent reads the same rule", () => {
  const raw = (title: string, text: string): RawJob => ({ id: title + text, title, company: "Acme", url: `https://example.com/${encodeURIComponent(title + text)}`, source: "Test", location: "Remote", text, postedAt: "2026-11-23T00:00:00Z", salaryMin: null, salaryMax: null }) as unknown as RawJob;
  const prefs = { roles: ROLE_OPTIONS.filter((r) => r.name === "Software Engineer 1"), minSalary: 0, targetSalary: 100_000, maxYears: 3 };
  const taste = { role: new Map(), company: new Map(), source: new Map(), skills: new Map() } as never;

  it("the Scout's matches leave out senior titles and 4+ years", () => {
    const got = candidates([raw("Software Engineer", "Full-time. 1-2 years of experience."), raw("Software Engineer", "Full-time. 5+ years of experience required."), raw("Senior Software Engineer", "Full-time."), raw("Junior Software Engineer", "Full-time.")], prefs, taste, new Date("2026-11-24T12:00:00Z"), new Set(["Test"]));
    expect(got.map((c) => c.text)).toEqual(expect.arrayContaining(["Full-time. 1-2 years of experience.", "Full-time."]));
    expect(got).toHaveLength(2);
  });

  const kit = (id: string, title: string, detail = ""): Approval => ({ id, kind: "application", title, detail, url: "", matchId: null, status: "pending", decidedAt: null, createdAt: "2026-11-23T00:00:00Z" });
  const kits = [kit("a", "Software Engineer I at Acme"), kit("b", "Senior Software Engineer at Beta"), kit("c", "Software Engineer at Gamma", "Asks for: 5+ years of experience"), kit("d", "Software Engineer at Delta", "Asks for: 2+ years of experience")];

  it("Apply to these 5 never lists a job above your level, and the queue names them", () => {
    expect(topFive(kits, [] as JobMatch[], "2026-11-24").map((p) => p.kitId).sort()).toEqual(["a", "d"]);
    expect(queueLevels(kits, []).filter((l) => l.verdict.fit === "above").map((l) => l.kitId)).toEqual(["b", "c"]);
    expect(topFive(kits, [], "2026-11-24").find((p) => p.kitId === "d")!.why).toContain("asks for 2 years");
  });

  it("the Career Mentor is told the rule and raises queued jobs that break it", () => {
    expect(searchGoal({ minSalary: 0, targetSalary: 100_000, maxYears: 3 })).toContain(levelRule(3));
    // Your wider background is part of the goal every model is given, and never engineering years.
    expect(searchGoal({ minSalary: 0, targetSalary: 100_000, maxYears: 3 })).toMatch(/10 years of professional experience[\s\S]*Never count it as years of engineering experience/);
    const o = observe({ today: "2026-11-24", slot: "morning", roles: ["Software Engineer 1"], applications: [], approvals: kits, matches: [], market: null, skills: ["TypeScript"], resumes: null, answersWritten: 9, answersTotal: 9, linkedin: "x", plan: 0, prior: [], maxYears: 3 } as never);
    expect(o.find((x) => x.id === "targeting:queue-above-level")).toMatchObject({ metric: "2" });
  });

  it("Pitch, Claude and the Apply page use it too", () => {
    expect(read("lib/agents/pitch.ts")).toMatch(/levelVerdict\(title, kit\.detail, maxYearsOf\(ctx\.settings\)\)[\s\S]*KEYWORD_RULE|KEYWORD_RULE[\s\S]*levelVerdict\(title, kit\.detail/);
    expect(read("lib/mcp/tools.ts")).toContain("levelRule: levelRule(maxYears)");
    expect(read("lib/mcp/server.ts")).toContain("never suggest applying to a job marked above their level");
    expect(read("app/(app)/(career)/career/page.tsx")).toContain("<LevelNotice levels={levels}");
    // Clearing is one sweep (the button and the night shift share it), audited, and never a thumbs-down.
    expect(read("app/actions/level.ts")).toMatch(/getContext\(\)[\s\S]*sweepAboveLevel\(store, settings, today, now, "owner"\)/);
    expect(read("lib/levelSweep.ts")).toContain("career.clear-above-level");
    expect(read("lib/levelSweep.ts")).not.toContain("notAGoodFit(");
    expect(read("lib/agents/nightShift.ts")).toContain("sweepAboveLevel(persist, ctx.settings, ctx.today, ctx.now, \"system\")");
  });
});
