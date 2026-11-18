// The roles the Career Agent hunts for, in Tyler's priority order. The order lives in
// the Priority column of the Resumes database in Notion and syncs from there; this
// list is the fallback when Notion is not connected, kept in the same order. These are the defaults; you can
// reorder or change them in Settings (careerRoles). Each role lists the job titles
// that count as that role, including the market names from your career direction
// (careerDirection.ts), e.g. "Agent Deployment Engineer" counts as Forward Deployed. Titles are matched as whole phrases, so "AI Engineer" does
// not match "Paid AI Engineering Intern".

export interface TargetRole {
  /** The role as you name it. */
  name: string;
  /** Job-title phrases that count as this role, most exact first. */
  titles: string[];
}

// Order as of 18 Nov 2026: Solutions Engineer leads (the title that matches the most
// postings for what you build), then Software Engineer. Integration Engineer counts as
// Solutions Engineer: it is the same work under another name.
export const TARGET_ROLES: readonly TargetRole[] = [
  {
    name: "Solutions Engineer",
    titles: ["solutions engineer", "solution engineer", "technical solutions engineer", "solutions architect", "integration engineer", "integrations engineer", "sales engineer", "customer engineer", "pre sales engineer", "presales engineer"],
  },
  {
    name: "Software Engineer",
    titles: ["software engineer", "software developer", "full stack engineer", "fullstack engineer", "full stack developer", "backend engineer", "product engineer", "typescript engineer", "python engineer"],
  },
  {
    name: "AI Engineer",
    titles: ["ai engineer", "applied ai engineer", "ai integration engineer", "generative ai engineer", "genai engineer", "llm engineer", "ai ml engineer", "ai software engineer"],
  },
  {
    name: "AI + Automation Engineer",
    titles: ["ai automation engineer", "ai and automation engineer", "intelligent automation engineer", "internal ai engineer", "automation engineer", "ai automation developer", "automation developer"],
  },
  {
    name: "AI Workflow Engineer",
    titles: ["ai workflow engineer", "workflow automation engineer", "workflow engineer", "ai workflow developer", "ai operations engineer", "ai agent engineer", "agentic ai engineer", "agentic engineer", "agent engineer", "agentic"],
  },
  {
    name: "Forward Deployed Engineer",
    titles: ["forward deployed engineer", "forward deployed software engineer", "forward deployed ai engineer", "forward deployed", "fde", "agent deployment engineer", "deployed engineer", "deployment engineer"],
  },
  {
    name: "GTM Engineer",
    titles: ["gtm engineer", "go to market engineer", "gtm systems engineer", "gtm automation engineer", "revenue engineer", "revops engineer", "revenue operations engineer"],
  },
];

/**
 * Roles next to yours that you do not target today. The Scout records their postings too,
 * so the Analyst can measure them and the Mentor can say when one deserves a place on
 * your list. A role here never becomes a target without your approval.
 */
export const CANDIDATE_ROLES: readonly TargetRole[] = [
  { name: "Implementation Engineer", titles: ["implementation engineer", "technical implementation engineer", "implementation consultant", "onboarding engineer"] },
  { name: "Customer Success Engineer", titles: ["customer success engineer", "technical account manager", "technical customer success manager", "technical success manager"] },
  { name: "Developer Advocate", titles: ["developer advocate", "developer relations engineer", "developer relations", "devrel engineer", "developer evangelist"] },
  { name: "AI Consultant", titles: ["ai consultant", "ai solutions consultant", "ai implementation consultant", "ai strategist", "ai transformation consultant"] },
  { name: "AI Product Manager", titles: ["ai product manager", "technical product manager", "product manager ai"] },
  { name: "AI Platform Engineer", titles: ["ai platform engineer", "ml platform engineer", "mlops engineer", "llmops engineer", "machine learning engineer"] },
  { name: "Data Engineer", titles: ["data engineer", "analytics engineer"] },
];

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The roles to hunt for: yours from Settings, mapped onto the built-in title lists. */
export function rolesFrom(names: readonly string[] | undefined): TargetRole[] {
  if (!names || names.length === 0) return [...TARGET_ROLES];
  return names.map((n) => {
    const known = [...TARGET_ROLES, ...CANDIDATE_ROLES].find((r) => key(r.name) === key(n) || (key(n) === "fde" && r.name === "Forward Deployed Engineer"));
    // A role you typed that is not built in matches its own name as a title.
    return known ?? { name: n, titles: [key(n)] };
  });
}

/** The roles next to yours that are not already on your list. */
export function candidatesBeyond(targets: readonly TargetRole[]): TargetRole[] {
  const mine = new Set(targets.map((r) => key(r.name)));
  return CANDIDATE_ROLES.filter((r) => !mine.has(key(r.name)));
}
