import { likelyQuestions, reviewPrep, rulesPrep, type PrepPacket } from "@/lib/domain/interviewPrep";
import type { EvalCase } from "../types";

// Interview Prep's golden set (docs/AGENT-ARCHITECTURE.md, lever 5): the code half of its
// verification. The failures that matter most in an interview: an inflated result, a story with
// no source, a must-have nobody prepared for. The judge's half is checked by hand; these run in CI.

const MATERIAL = "Built Atlas, a Next.js and TypeScript app with 1,400 tests and CI on every PR.\nCut job-email triage from 30 minutes to 5 a day with rules and one AI call.";
const REQS = ["TypeScript", "AWS"];
const story = { situation: "Job emails took too long to sort.", task: "Make triage fast.", action: "Wrote rules with one AI call.", result: "Cut job-email triage from 30 minutes to 5 a day." };
const good: PrepPacket = {
  questions: [
    { question: "Walk me through something you built with TypeScript.", kind: "technical", requirement: "TypeScript", story, source: "Resume: Software Engineer 1" },
    { question: "Tell me about a project you're proud of.", kind: "behavioral", requirement: "", story: null, source: "" },
  ],
  gaps: [{ requirement: "AWS", plan: "Say I have not used AWS in production yet." }],
  ask: ["What would I work on first?"],
};
const verdict = (p: PrepPacket) => (reviewPrep(p, REQS, MATERIAL).pass ? "pass" : "fail");

export const prepCases: EvalCase[] = [
  { name: "Prep: one technical question per skill, then three behavioral", expected: "technical,behavioral,behavioral,behavioral", actual: () => likelyQuestions(["TypeScript", "2+ years of experience"]).map((q) => q.kind).join(",") },
  { name: "Prep review: a complete, true packet passes", expected: "pass", actual: () => verdict(good) },
  { name: "Prep review: an inflated result fails", expected: "fail", actual: () => verdict({ ...good, questions: [{ ...good.questions[0]!, story: { ...story, result: "Cut triage by 90%." } }, good.questions[1]!] }) },
  { name: "Prep review: a story with no source fails", expected: "fail", actual: () => verdict({ ...good, questions: [{ ...good.questions[0]!, source: "" }, good.questions[1]!] }) },
  { name: "Prep review: a must-have neither asked nor named a gap fails", expected: "fail", actual: () => verdict({ ...good, gaps: [] }) },
  { name: "Prep rules version: no invented stories, gaps named, passes review", expected: "0|AWS|pass", actual: () => { const p = rulesPrep({ requirements: REQS, evidence: { TypeScript: { title: "Resume", text: "Built Atlas" } }, company: "Acme", team: "", reportsTo: "" }); return `${p.questions.filter((q) => q.story).length}|${p.gaps.map((g) => g.requirement).join(",")}|${verdict(p)}`; } },
];
