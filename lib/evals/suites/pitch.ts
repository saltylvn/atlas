import { requirementsOf, reviewPacket, rulesPacket, traceClaims, type PitchPacket } from "@/lib/domain/pitch";
import type { EvalCase } from "../types";

// The Tailor's golden set (docs/AGENT-ARCHITECTURE.md, lever 5): the code half of its
// verification, on real-looking inputs and the failures that matter most: an invented number,
// a skill you do not have, a must-have left out, a swap from a line that is not on the resume.
// The judge model's half is checked by hand on the Evals page; these run in CI.

const MATERIAL = [
  "Software Engineer 1",
  "Built Atlas, a Next.js and TypeScript app with 1,400 tests and GitHub Actions CI on every PR.",
  "Integrated Gmail, Notion and Figma APIs with retries and rate limits; Postgres on Supabase with row-level security.",
  "Cut job-email triage from 30 minutes to 5 a day with rules and one AI call.",
  "Skills: TypeScript, React, Node.js, PostgreSQL, Python",
].join("\n");
const RESUME = MATERIAL;
const REQS = ["TypeScript", "React", "AWS"];
const good: PitchPacket = {
  resume: "Software Engineer 1",
  map: [
    { requirement: "TypeScript", status: "proven", evidence: "Built Atlas, a Next.js and TypeScript app with 1,400 tests." },
    { requirement: "React", status: "proven", evidence: "Atlas UI in React (Next.js)." },
    { requirement: "AWS", status: "gap", evidence: "" },
  ],
  swaps: [{ from: "Built Atlas, a Next.js and TypeScript app", to: "Built Atlas in TypeScript and React: 1,400 tests, CI on every PR.", why: "Names both must-haves and the test discipline." }],
  note: "I'm applying for the Software Engineer I role at Acme. I built Atlas in TypeScript and React, with 1,400 tests and CI on every PR.",
};
const verdict = (p: PitchPacket, reqs = REQS) => (reviewPacket(p, reqs, MATERIAL, RESUME).pass ? "pass" : "fail");

export const pitchCases: EvalCase[] = [
  { name: "Tailor: must-haves are the kit's named skills, then the years it asks", expected: "TypeScript|React|3+ years of experience", actual: () => requirementsOf("Skills it names: TypeScript, React\nAsks for: 3+ years of experience", "Software Engineer").join("|") },
  { name: "Tailor: before the posting is read, the saved job's skills are the must-haves", expected: "TypeScript|React|AWS", actual: () => requirementsOf("Software Engineer · salary not listed", "Software Engineer I", ["TypeScript", "React", "AWS"]).join("|") },
  { name: "Tailor: with no named skills, they are read from the title and kit", expected: "Python", actual: () => requirementsOf("Remote, $120k", "Python Developer").join("|") },
  { name: "Tailor: a true claim from your material is not flagged", expected: "0", actual: () => String(traceClaims("I built Atlas in TypeScript with 1,400 tests.", MATERIAL).length) },
  { name: "Tailor: an invented number is flagged", expected: "1", actual: () => String(traceClaims("Cut triage by 85%.", MATERIAL).length) },
  { name: "Tailor: a skill you never name is flagged", expected: "1", actual: () => String(traceClaims("Deployed services on Kubernetes.", MATERIAL).length) },
  { name: "Tailor: a number you do state passes (30 to 5 minutes)", expected: "0", actual: () => String(traceClaims("Cut job-email triage from 30 minutes to 5.", MATERIAL).length) },
  { name: "Tailor review: a complete, true packet passes", expected: "pass", actual: () => verdict(good) },
  { name: "Tailor review: a must-have left out fails", expected: "fail", actual: () => verdict({ ...good, map: good.map.slice(0, 2) }) },
  { name: "Tailor review: proven with no evidence fails", expected: "fail", actual: () => verdict({ ...good, map: [{ requirement: "TypeScript", status: "proven", evidence: "" }, ...good.map.slice(1)] }) },
  { name: "Tailor review: an invented number in a swap fails", expected: "fail", actual: () => verdict({ ...good, swaps: [{ ...good.swaps[0]!, to: "Built Atlas, used by 5,000 people." }] }) },
  { name: "Tailor review: a swap from a line not on the resume fails", expected: "fail", actual: () => verdict({ ...good, swaps: [{ ...good.swaps[0]!, from: "Led a team of 12 engineers" }] }) },
  { name: "Tailor review: a note over 120 words fails", expected: "fail", actual: () => verdict({ ...good, note: Array.from({ length: 130 }, () => "word").join(" ") }) },
  { name: "Tailor review: a gap named honestly passes", expected: "pass", actual: () => verdict({ ...good, map: good.map.map((m) => (m.requirement === "React" ? { ...m, status: "gap" as const, evidence: "" } : m)) }) },
  { name: "Tailor rules version: proof by keyword, gaps named, no swaps, a true note", expected: "proven,gap|0|pass", actual: () => { const p = rulesPacket({ resume: "Software Engineer 1", requirements: ["TypeScript", "AWS"], evidence: { TypeScript: "Built Atlas in TypeScript" }, company: "Acme", title: "Software Engineer I" }); return `${p.map.map((m) => m.status).join(",")}|${p.swaps.length}|${verdict(p, ["TypeScript", "AWS"])}`; } },
];
