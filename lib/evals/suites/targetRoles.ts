import type { MarketPosting } from "@/lib/domain/market";
import { describeRepo, isShown, portfolioFrom, skillEvidence, type RawRepo } from "@/lib/domain/portfolio";
import { acceptJudgment, draftProposal, roleOutlook, withoutPrivate, worthProposing, type RoleOutlook } from "@/lib/domain/roleOutlook";
import { candidatesBeyond, rolesFrom } from "@/lib/domain/targetRoles";
import type { EvalCase } from "../types";

// Which roles to target. Extra cases for three agents, all on fictional data:
//   Scout     does it read a repository's stack and skills right, and skip what is not your work?
//   Analyst   does a role's outlook count only what you can show, and refuse to judge thin data?
//   Career Mentor    does it move a role only on a clear lead, hold back when it should, and reject a
//             model's answer that drops a role or invents a number?

const TODAY = "2026-11-16";

const repo = (over: Partial<RawRepo> = {}): RawRepo => ({
  fullName: "sam/orbit",
  name: "orbit",
  description: "A supervisor agent that routes work to specialists.",
  url: "https://github.com/sam/orbit",
  isPrivate: false,
  fork: false,
  archived: false,
  pushedAt: "2026-11-10T12:00:00Z",
  topics: ["ai-agents"],
  languages: { TypeScript: 9000, Shell: 10 },
  readme: "",
  manifests: [{ path: "package.json", text: JSON.stringify({ dependencies: { next: "16", "@supabase/supabase-js": "2" }, devDependencies: { vitest: "5" } }) }],
  rootPaths: ["package.json", ".github"],
  ...over,
});
const described = describeRepo(repo(), TODAY);

export const portfolioCases: EvalCase[] = [
  { name: "A Next.js and Supabase project: the stack is read from its dependencies", expected: "Automated tests, GitHub Actions, Next.js, Supabase", actual: () => described.stack.join(", ") },
  { name: "Its topic 'ai-agents' counts as the AI agents skill", expected: "yes", actual: () => (described.skills.includes("AI agents") ? "yes" : "no") },
  { name: "A workflow folder counts as CI/CD", expected: "yes", actual: () => (described.skills.includes("CI/CD") ? "yes" : "no") },
  { name: "A language that is 0.1% of the code is not listed", expected: "TypeScript", actual: () => described.languages.join(", ") },
  { name: "A fork is not your work", expected: "orbit", actual: () => portfolioFrom([repo(), repo({ name: "forked", fullName: "sam/forked", fork: true })], "sam", TODAY).map((r) => r.name).join(", ") },
  { name: "A Python project with FastAPI and the Gemini SDK", expected: "FastAPI, Gemini API", actual: () => describeRepo(repo({ languages: { Python: 100 }, manifests: [{ path: "requirements.txt", text: "fastapi>=0.110\ngoogle-genai\n" }], rootPaths: ["requirements.txt"] }), TODAY).stack.join(", ") },
];

let n = 0;
const posting = (role: string, skills: string[]): MarketPosting => {
  n++;
  return { id: `e${n}`, key: `e${n}`, title: role, company: `Co${n}`, source: "Jobicy", url: `https://x.example/${n}`, location: "Remote", role, place: "remote", payMin: 130_000, payMax: 150_000, payUnit: "year", skills, postedAt: null, firstSeen: "2026-11-12", lastSeen: "2026-11-15", createdAt: "2026-11-12T00:00:00Z" };
};
const many = (count: number, role: string, skills: string[]) => Array.from({ length: count }, () => posting(role, skills));
const TARGETS = rolesFrom(["AI Engineer", "AI Automation Engineer", "Forward Deployed Engineer"]);
// Kubernetes is only ticked; Python, AI agents and Workflow automation are in projects; SQL is in a resume.
const EVIDENCE = skillEvidence([{ name: "orbit", skills: ["AI agents", "Python"], pushedAt: "2026-11-10T00:00:00Z" }, { name: "relay", skills: ["Workflow automation", "AI agents"], pushedAt: "2026-11-01T00:00:00Z" }], ["SQL"], ["Kubernetes"]);
const OUTLOOK = roleOutlook([...many(6, "AI Engineer", ["Kubernetes", "Python"]), ...many(8, "AI Automation Engineer", ["AI agents", "Workflow automation"]), ...many(2, "Forward Deployed Engineer", ["Salesforce"])], TARGETS, candidatesBeyond(TARGETS), EVIDENCE, [], TODAY);
const role = (name: string) => OUTLOOK.find((o) => o.role === name)!;
const pct = (x: number) => `${Math.round(x * 100)}%`;

export const outlookCases: EvalCase[] = [
  { name: "A skill you only ticked does not count as shown", expected: "not shown", actual: () => (isShown(EVIDENCE.get("kubernetes")) ? "shown" : "not shown") },
  { name: "A skill in a resume counts as shown", expected: "shown", actual: () => (isShown(EVIDENCE.get("sql")) ? "shown" : "not shown") },
  { name: "AI Engineer asks Kubernetes and Python equally; you show Python", expected: "50%", actual: () => pct(role("AI Engineer").qualified) },
  { name: "AI Automation Engineer: both asked skills are in your projects", expected: "100%", actual: () => pct(role("AI Automation Engineer").qualified) },
  { name: "The project that backs AI Automation Engineer", expected: "relay", actual: () => role("AI Automation Engineer").projects.join(", ") },
  { name: "A role with 2 postings is too thin to judge", expected: "thin", actual: () => (role("Forward Deployed Engineer").thin ? "thin" : "judged") },
  { name: "A private project's name is not shown to a model", expected: "a private project", actual: () => withoutPrivate(OUTLOOK, new Set(["relay"])).find((o) => o.role === "AI Automation Engineer")!.projects.join(", ") },
];

const o = (name: string, score: number, over: Partial<RoleOutlook> = {}): RoleOutlook => ({ role: name, target: true, postings: 10, thisWeek: 3, lastWeek: 3, trend: "flat", reachable: 1, payMedian: 140_000, asked: [{ skill: "Python", share: 0.8, shown: true, projects: ["orbit"] }], qualified: score / 100, projects: ["orbit"], applied: 0, responses: 0, thin: false, score, ...over });
const order = (rows: RoleOutlook[]) => draftProposal(rows)?.order.join(" > ") ?? "no proposal";
const DRAFT = draftProposal([o("A", 50), o("B", 70), o("C", 40), o("New", 90, { target: false, qualified: 0.9 })])!;
const judged = (j: { order: string[]; headline?: string; why?: string }) => (acceptJudgment(DRAFT, { order: j.order, headline: j.headline ?? "Lead with B", reasons: [{ role: "B", why: j.why ?? "You can show 70% of what its 10 postings ask for." }] }) ? "accepted" : "dropped");

export const roleCases: EvalCase[] = [
  { name: "The real order holds up on live-shaped data: the better-shown role leads", expected: "AI Automation Engineer > AI Engineer > Forward Deployed Engineer", actual: () => order(OUTLOOK) },
  { name: "A 5-point lead is noise: nothing moves", expected: "A > B > C", actual: () => order([o("A", 50), o("B", 55), o("C", 40)]) },
  { name: "A clear lead moves a role to the top", expected: "C > B > A", actual: () => order([o("A", 50), o("B", 56), o("C", 80)]) },
  { name: "A role with 4 postings stays where you put it, however good it looks", expected: "B > Few > C > A", actual: () => order([o("A", 30), o("Few", 95, { postings: 4 }), o("B", 70), o("C", 50)]) },
  { name: "One role with enough data is not enough to re-order anything", expected: "no proposal", actual: () => order([o("A", 50), o("B", 0, { thin: true })]) },
  { name: "A well-shown candidate role that would sit in your top three is added", expected: "New > A > B > C", actual: () => order([o("A", 70), o("B", 60), o("C", 50), o("New", 90, { target: false, qualified: 0.9 })]) },
  { name: "A candidate you can only half show is not added", expected: "A > B > C", actual: () => order([o("A", 70), o("B", 60), o("C", 50), o("New", 90, { target: false, qualified: 0.5 })]) },
  { name: "Model keeps every role and explains its move", expected: "accepted", actual: () => judged({ order: ["B", "A", "C"] }) },
  { name: "Model drops a role", expected: "dropped", actual: () => judged({ order: ["B", "A"] }) },
  { name: "Model adds a role it was not offered", expected: "dropped", actual: () => judged({ order: ["B", "A", "C", "Astronaut"] }) },
  { name: "Model writes a percentage that is not in the facts", expected: "dropped", actual: () => judged({ order: ["B", "A", "C"], why: "You can show 99% of what it asks for." }) },
  { name: "Model invents a posting count in its headline", expected: "dropped", actual: () => judged({ order: ["B", "A", "C"], headline: "Lead with B: 500 new postings" }) },
  { name: "Nothing is raised while a proposal is waiting on you", expected: "wait", actual: () => (worthProposing({ base: ["A", "B"], order: ["B", "A"] }, [{ status: "new", forDate: "2026-11-01", proposed: ["B", "A"] }], TODAY) ? "raise" : "wait") },
  { name: "An order you dismissed last week is not raised again", expected: "wait", actual: () => (worthProposing({ base: ["A", "B"], order: ["B", "A"] }, [{ status: "dismissed", forDate: "2026-11-10", proposed: ["B", "A"] }], TODAY) ? "raise" : "wait") },
  { name: "Four days after you approved an order, it is left alone", expected: "wait", actual: () => (worthProposing({ base: ["A", "B"], order: ["B", "A"] }, [{ status: "approved", forDate: "2026-11-12", proposed: ["A", "B"] }], TODAY) ? "raise" : "wait") },
];
