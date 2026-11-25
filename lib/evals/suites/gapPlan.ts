import { EMPTY_PLAN, assign, gradeInsight, lessonCandidates, lessonsToSave, nextProof, rankGaps } from "@/lib/domain/gapPlan";
import { skillEvidence } from "@/lib/domain/portfolio";
import type { EvalCase } from "../types";

// Step 3's golden set (docs/AGENT-ARCHITECTURE.md, lever 5): the Career Mentor's gap ranking,
// proof projects, the grade that sends weak advice back, and what memory keeps. Rules only; in CI.

const ROLE = "Software Engineer 1";
const p = (title: string, skills: string[]) => ({ title, role: ROLE, skills });
const POSTINGS = [p("Software Engineer I", ["AWS", "Docker"]), p("Junior Software Engineer", ["AWS"]), p("Software Engineer", ["AWS", "Go"]), p("Associate Software Engineer", ["Docker"]), p("Senior Software Engineer", ["Kubernetes"]), p("Staff Software Engineer", ["Kubernetes"])];
const shown = skillEvidence([{ name: "atlas", skills: ["Docker"], pushedAt: "2026-11-20" }], [], []);
const gaps = rankGaps(POSTINGS, ROLE, shown);
const open = assign(EMPTY_PLAN, gaps[0]!, ROLE, { text: "x", writer: "rules" }, "2026-11-24");

export const gapPlanCases: EvalCase[] = [
  { name: "Gaps: junior-asked skills outrank senior-only ones, shown skills are left out", expected: "AWS|Go|Kubernetes", actual: () => gaps.map((g) => g.skill).join("|") },
  { name: "Proof: a repo pushed before it was assigned does not close it", expected: "keep", actual: () => nextProof(open, gaps, [{ name: "old", skills: ["AWS"], pushedAt: "2026-11-01" }], "2026-11-25").kind },
  { name: "Proof: a repo pushed since that shows the skill closes it", expected: "closed", actual: () => nextProof(open, gaps, [{ name: "lambda-api", skills: ["AWS"], pushedAt: "2026-11-26" }], "2026-11-27").kind },
  { name: "Grade: advice for later is sent back", expected: "fail", actual: () => (gradeInsight({ action: "Over the next month, build three AWS projects.", evidence: ["x"] }).pass ? "pass" : "fail") },
  { name: "Grade: repeating what you already did is sent back", expected: "fail", actual: () => (gradeInsight({ action: "Add an AWS bullet to your resume.", evidence: ["x"] }, ["Added an AWS bullet to my resume"]).pass ? "pass" : "fail") },
  { name: "Grade: one evidenced step for today passes", expected: "pass", actual: () => (gradeInsight({ action: "Apply to the junior role at Acme today with your Software Engineer resume.", evidence: ["x"] }).pass ? "pass" : "fail") },
  { name: "Memory: a funnel finding seen again is confirmed, not duplicated", expected: "0 added, 1 confirmed", actual: () => { const c = lessonCandidates([{ id: "fast-screen", text: "4 of 5 rejections came within 10 days." }], [], "2026-11-24"); const r = lessonsToSave([{ id: "l1", agent: "mentor", lesson: "x", evidence: "funnel:fast-screen | old", confirmed: 0, expiresOn: "2026-12-01" }], c, "2026-11-24"); return `${r.add.length} added, ${r.confirm.length} confirmed`; } },
];
