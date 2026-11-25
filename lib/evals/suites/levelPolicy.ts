import { levelVerdict } from "@/lib/domain/levelPolicy";
import type { EvalCase } from "../types";

// The level rule's golden set (lib/domain/levelPolicy.ts): early-career to mid-level, 1 to 3
// years asked, senior ignored. The cases are the ones a screen turned down in the real funnel, and the near misses.

const fit = (title: string, text = "") => levelVerdict(title, text).fit;

export const levelCases: EvalCase[] = [
  { name: "Level rule: a senior title is ignored", expected: "above", actual: () => fit("Senior Software Engineer") },
  { name: "Level rule: a staff or lead title is ignored", expected: "above|above", actual: () => `${fit("Staff Software Engineer")}|${fit("Lead Software Engineer")}` },
  { name: "Level rule: a plain title asking for 4+ years is ignored", expected: "above", actual: () => fit("Software Engineer", "4+ years of experience building web apps.") },
  { name: "Level rule: a plain title asking for 3 years is on target", expected: "target", actual: () => fit("Software Engineer", "3+ years of experience building web apps.") },
  { name: "Level rule: a level II title is mid-level and on target", expected: "target", actual: () => fit("Software Engineer II") },
  { name: "Level rule: a junior title asking for 5 years is ignored (years win)", expected: "above", actual: () => fit("Junior Software Engineer", "5 years of experience required.") },
  { name: "Level rule: a plain title asking for 2 years is on target", expected: "target", actual: () => fit("Software Engineer", "2+ years of experience with React.") },
  { name: "Level rule: an Engineer II asking for 2 years is on target", expected: "target", actual: () => fit("Software Engineer II", "Minimum of 2 years of experience in software development.") },
  { name: "Level rule: an associate title with no years is on target", expected: "target", actual: () => fit("Associate Software Engineer") },
  { name: "Level rule: no level and no years says to check", expected: "check", actual: () => fit("Software Engineer") },
  { name: "Level rule: a kit's years line is read", expected: "above", actual: () => fit("Software Engineer at Acme", "Software Engineer · Remote\nAsks for: 4+ years of experience") },
  { name: "Level rule: a project manager is not a people manager", expected: "check", actual: () => fit("AI Project Manager") },
];
