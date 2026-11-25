import { pageFacts, readyJobs, reviewResearch, searchProblem, type Fact, type ResearchOut } from "@/lib/domain/companyResearch";
import type { EvalCase } from "../types";

// The Researcher's golden set (docs/AGENT-ARCHITECTURE.md, lever 5): the code half of
// its verification. The failures that matter: a line that cites nothing it read, a number its
// source lacks, a guess about the company when the web gave nothing, a search that drifts off the
// company. The judge's half is checked by hand; these run in CI.

const FACTS: Fact[] = [
  { id: "f1", text: "Skills it names that you have: TypeScript, React" },
  { id: "n1", text: "Headline (2026-11-20): Larkspur Labs raises $12 million to expand its scheduling platform" },
  { id: "p1", text: "Larkspur Labs builds scheduling software used by 400 clinics." },
];
const good: ResearchOut = {
  about: [{ text: "Larkspur Labs builds scheduling software used by 400 clinics.", cites: ["p1"] }],
  whyThem: [{ text: "It just raised $12 million to expand its platform.", cites: ["n1"] }],
  yourAngle: [{ text: "Lead with TypeScript and React, which it names.", cites: ["f1"] }],
  questions: [{ text: "What will the new funding change for the engineering team?", cites: ["n1"] }],
};
const verdict = (o: ResearchOut, facts = FACTS) => (reviewResearch(o, facts).pass ? "pass" : "fail");

export const researchCases: EvalCase[] = [
  { name: "Research review: every line cites what was read", expected: "pass", actual: () => verdict(good) },
  { name: "Research review: a citation that was never read fails", expected: "fail", actual: () => verdict({ ...good, whyThem: [{ text: "It is growing fast in healthcare.", cites: ["p9"] }] }) },
  { name: "Research review: a number its source lacks fails", expected: "fail", actual: () => verdict({ ...good, about: [{ text: "Its software is used by 900 clinics.", cites: ["p1"] }] }) },
  { name: "Research review: what the company does must rest on the web, not the posting", expected: "fail", actual: () => verdict({ ...good, about: [{ text: "It names TypeScript and React as skills.", cites: ["f1"] }] }) },
  { name: "Research review: with nothing read from the web, a guess about the company fails", expected: "fail", actual: () => verdict({ ...good, about: [{ text: "It is a leader in its field today.", cites: ["f1"] }], whyThem: [{ text: "It names skills you have.", cites: ["f1"] }], questions: [{ text: "Which skills matter most?", cites: ["f1"] }] }, FACTS.slice(0, 1)) },
  { name: "Research: a page's cookie and link text is not kept as a fact", expected: "1", actual: () => String(pageFacts("We use cookies to improve your experience on this website today. Larkspur Labs builds scheduling software used by 400 clinics across the country. Read more at https://example.com/blog for the full story and more.").length) },
  { name: "Research: a search must name the company", expected: "refused", actual: () => (searchProblem("best scheduling software", "Larkspur Labs") ? "refused" : "allowed") },
  { name: "Research: a search for a person's private details is refused", expected: "refused", actual: () => (searchProblem("Larkspur Labs CEO home address", "Larkspur Labs") ? "refused" : "allowed") },
  { name: "Night shift: the most prepared pick comes first in the morning", expected: "c,b,a", actual: () => readyJobs([{ kitId: "a", title: "A", url: "" }, { kitId: "b", title: "B", url: "" }, { kitId: "c", title: "C", url: "" }], new Set(["b", "c"]), new Map([["c", { proven: 2, of: 3 }]])).map((j) => j.kitId).join(",") },
];
