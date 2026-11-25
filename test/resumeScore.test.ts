import { describe, expect, it } from "vitest";
import { lengthNote, resumeScorecards, resumeTexts, scoreResume } from "@/lib/domain/resumeScore";
import type { TechPosting } from "@/lib/domain/techMarket";

// Resume Optimization, part 1: the rules scorecard (23 Nov 2026).

const p = (title: string, skills: string[]): TechPosting => ({ fingerprint: `${title}:${skills.join(",")}:${Math.random()}`, title, company: "Acme", family: "software", seniority: "mid", mode: "remote", region: "us", payMin: null, payMax: null, skills, sources: ["Test"], url: "https://example.com/j", postedAt: null, firstSeen: "2026-11-20", lastSeen: "2026-11-23" });
const postings = [p("Software Engineer", ["TypeScript", "React", "PostgreSQL"]), p("Software Engineer II", ["TypeScript", "Go"]), p("Solutions Engineer", ["Salesforce", "SQL"])];

const resume = {
  name: "Software Engineer 1",
  text: [
    "Tyler Clark",
    "Software Engineer",
    "Built a TypeScript job-hunt app on Next.js used every day across 12 agents and 1,400 tests",
    "Responsible for maintaining the deployment pipeline and fixing build issues when they came up",
    "Cut sync time by 40% by paging database reads and adding a watchdog for long runs",
  ].join("\n"),
};

describe("A resume against its role's postings", () => {
  it("lists the skills the role's postings ask for, on the resume or missing, and an easy add you already have", () => {
    const c = scoreResume(resume, { postings, today: "2026-11-23", mySkills: ["React"], otherResumes: [] });
    expect(c.lens).toBe("software");
    expect(c.postings).toBe(2);
    expect(c.keywords.map((k) => k.skill)).toEqual(["TypeScript", "Go", "PostgreSQL", "React"]);
    expect(c.keywords.find((k) => k.skill === "TypeScript")).toMatchObject({ share: 1, onResume: true });
    expect(c.keywords.find((k) => k.skill === "React")).toMatchObject({ onResume: false, haveElsewhere: true });
    expect(c.keywords.find((k) => k.skill === "Go")).toMatchObject({ onResume: false, haveElsewhere: false });
    // Solutions postings do not count for a Software Engineer resume.
    expect(c.keywords.some((k) => k.skill === "Salesforce")).toBe(false);
  });

  it("checks the headline, numbers in bullets and weak openings", () => {
    const c = scoreResume(resume, { postings, today: "2026-11-23", mySkills: [], otherResumes: [] });
    expect(c.headline.ok).toBe(true);
    expect(c.bullets).toMatchObject({ lines: 3, quantified: 2 });
    expect(c.bullets.weak).toEqual(["Responsible for maintaining the deployment pipeline and fixing build issues when they came up"]);
    expect(c.score).toBeGreaterThan(0);
    expect(c.score).toBeLessThanOrEqual(100);
  });

  it("measures the Master Resume against all six roles together, and lists it last", () => {
    const cards = resumeScorecards([{ name: "Master Resume", text: "TypeScript SQL" }, resume], { postings, today: "2026-11-23", mySkills: [], roleOrder: ["Software Engineer 1"] });
    expect(cards.map((c) => c.name)).toEqual(["Software Engineer 1", "Master Resume"]);
    expect(cards[1]).toMatchObject({ lens: null, postings: 3, against: "all six of your roles" });
  });

  it("reads each resume from its indexed passages, and words its length", () => {
    expect(resumeTexts([{ title: "Resume: Software Engineer 1", content: "a" }, { title: "Resume: Software Engineer 1", content: "b" }, { title: "Resume: Master Resume", content: "c" }])).toEqual([
      { name: "Software Engineer 1", text: "a\nb" },
      { name: "Master Resume", text: "c" },
    ]);
    expect(lengthNote(200)).toContain("room to add");
    expect(lengthNote(500)).toContain("one page");
    expect(lengthNote(900)).toContain("past one page");
  });
});
