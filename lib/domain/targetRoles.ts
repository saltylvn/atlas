// The roles the Career Agent hunts for, in Tyler's priority order. Atlas owns the list and
// its order (settings.careerRoles, set on the Target Roles page); Notion keeps only the
// resume for each role. At most seven roles (20 Nov 2026), and every job title Atlas
// tracks folds into one of them: Implementation and Integration Engineer count as
// Solutions Engineer, Customer and Field Engineer as Forward Deployed, Embedded and
// Developer Advocate as Software Engineer, and GTM, AI Workflow and workflow-tool titles
// as AI Automation Engineer. Titles are matched as whole phrases, so "AI Engineer" does
// not match "Paid AI Engineering Intern".

export interface TargetRole {
  /** The role as you name it. */
  name: string;
  /** Job-title phrases that count as this role, most exact first. */
  titles: string[];
  /** Words that keep a title out of this role even when a phrase matches ("workflow" in "Workflow Software Engineer"). */
  exclude?: string[];
}

/** The most roles you target at once: the seven options. */
export const MAX_ROLES = 7;

// Order as of 19 Nov 2026, chosen by Tyler from the Analyst's numbers.
export const TARGET_ROLES: readonly TargetRole[] = [
  {
    name: "Solutions Engineer",
    titles: [
      "solutions engineer", "solution engineer", "technical solutions engineer", "ai solutions engineer", "solutions architect", "solutions consultant",
      "sales engineer", "pre sales engineer", "presales engineer",
      "integration engineer", "integrations engineer",
      "implementation engineer", "technical implementation engineer", "implementation consultant", "onboarding engineer",
      "customer success engineer", "technical success engineer",
    ],
  },
  {
    name: "AI Engineer",
    titles: [
      "ai engineer", "applied ai engineer", "ai integration engineer", "generative ai engineer", "genai engineer", "llm engineer", "ai ml engineer", "ai software engineer",
      "ai developer", "applied ai developer", "ai consultant", "ai solutions consultant", "ai implementation consultant",
    ],
  },
  {
    name: "Forward Deployed Engineer",
    titles: [
      "forward deployed engineer", "forward deployed software engineer", "forward deployed ai engineer", "forward deployed", "fde",
      "agent deployment engineer", "ai deployment engineer", "deployed engineer", "deployment engineer", "customer engineer", "field engineer",
    ],
  },
  {
    name: "Software Engineer",
    titles: [
      "software engineer", "software developer", "full stack engineer", "fullstack engineer", "full stack developer", "backend engineer", "back end engineer", "backend developer",
      "product engineer", "typescript engineer", "python engineer",
      "embedded software engineer", "embedded engineer", "embedded systems engineer", "engineer embedded", "firmware engineer", "iot engineer",
      "developer advocate", "developer relations engineer", "devrel engineer", "developer evangelist",
    ],
  },
  {
    name: "AI Automation Engineer",
    titles: [
      "ai automation engineer", "ai and automation engineer", "intelligent automation engineer", "internal ai engineer", "automation engineer", "ai automation developer", "automation developer",
      "ai workflow engineer", "workflow automation engineer", "workflow engineer", "ai workflow developer", "ai operations engineer",
      "ai agent engineer", "agentic ai engineer", "agentic engineer", "agent engineer", "agentic",
      "gtm engineer", "go to market engineer", "gtm systems engineer", "gtm automation engineer", "revenue engineer", "revops engineer", "revenue operations engineer",
      "n8n developer", "n8n engineer", "zapier developer",
      "business automation engineer", "ai integration developer",
    ],
  },
];

/**
 * Roles next to yours that none of the five absorbs. The Scout records their postings too,
 * so the Analyst can measure them and the Career Mentor can say when one deserves a place on
 * your list. A role here never becomes a target without your approval.
 */
export const CANDIDATE_ROLES: readonly TargetRole[] = [
  { name: "AI Product Manager", titles: ["ai product manager", "technical product manager", "product manager ai"] },
  { name: "AI Platform Engineer", titles: ["ai platform engineer", "ml platform engineer", "mlops engineer", "llmops engineer", "machine learning engineer"] },
  { name: "Data Engineer", titles: ["data engineer", "analytics engineer"] },
];

/**
 * The only roles you can pick and save on Career > Target Roles, in your order (20 Nov
 * 2026, the seven role resumes in Notion). Each carries every title it stands for, so the
 * five older roles above fold into them: Solutions and Integration titles count as AI
 * Solutions Engineer, Forward Deployed, Customer and Field titles as AI Forward Deployed
 * Engineer, AI and LLM engineer titles and any other Software Engineer title as Software Engineer 1. The older roles stay
 * defined only so lists saved before today still read; saving keeps the seven.
 */
export const ROLE_OPTIONS: readonly TargetRole[] = [
  {
    // Your #1 role (23 Nov 2026), renamed from AI Software Engineer: any Software Engineer title, and the AI
    // engineer titles it had, except workflow, automation and solutions work (their own roles).
    name: "Software Engineer 1",
    titles: [
      "software engineer 1", "software engineer i", "ai software engineer", "software engineer ai", "applied ai engineer", "ai engineer", "generative ai engineer", "genai engineer", "llm engineer", "ai ml engineer",
      "ai developer", "applied ai developer", "ai full stack engineer", "ai product engineer", "software engineer",
    ],
    exclude: ["workflow", "automation", "solutions"],
  },
  {
    name: "AI Automation Engineer",
    titles: [
      "ai automation engineer", "ai and automation engineer", "intelligent automation engineer", "internal ai engineer", "automation engineer", "ai automation developer", "automation developer",
      "business automation engineer", "ai integration developer", "ai integration engineer", "ai integrations engineer",
      "gtm engineer", "go to market engineer", "gtm systems engineer", "gtm automation engineer", "revenue engineer", "revops engineer", "revenue operations engineer",
      "n8n developer", "n8n engineer", "zapier developer",
    ],
  },
  {
    name: "AI Workflow Engineer",
    titles: ["ai workflow engineer", "workflow automation engineer", "workflow engineer", "ai workflow developer", "ai operations engineer"],
  },
  {
    name: "Agentic Software Engineer",
    titles: ["agentic software engineer", "agentic ai engineer", "agentic engineer", "ai agent engineer", "agent engineer", "agentic"],
  },
  {
    name: "AI Solutions Engineer",
    titles: [
      "ai solutions engineer", "ai solution engineer", "developer ai solutions", "ai solutions developer", "ai solutions architect", "agent architect",
      "solutions engineer", "solution engineer", "technical solutions engineer", "solutions architect", "solutions consultant",
      "sales engineer", "pre sales engineer", "presales engineer",
      "integration engineer", "integrations engineer", "implementation engineer", "technical implementation engineer", "implementation consultant", "onboarding engineer",
      "customer success engineer", "technical success engineer", "ai consultant", "ai solutions consultant", "ai implementation consultant",
    ],
  },
  {
    name: "AI Forward Deployed Engineer",
    titles: [
      "ai forward deployed engineer", "forward deployed ai engineer", "forward deployed engineer", "forward deployed software engineer", "forward deployed", "fde",
      "agent deployment engineer", "ai deployment engineer", "deployed engineer", "deployment engineer", "customer engineer", "field engineer",
    ],
  },
  {
    name: "AI Project Manager",
    titles: ["ai project manager", "ai program manager", "ai implementation manager", "ai delivery manager", "technical project manager ai", "project manager ai", "ai implementation project manager"],
  },
];

/** Your seven roles in your order. Target Roles offers them as one click; nothing changes until you press Save order. */
export const MAIN_ROLES: readonly string[] = ROLE_OPTIONS.map((r) => r.name);

/** The roles you can pick on Target Roles: only the seven. */
export const BUILT_IN_ROLES: readonly TargetRole[] = ROLE_OPTIONS;

/** Every role Atlas can read from a saved list: the seven first, then the older roles and the candidates. */
const KNOWN_ROLES: readonly TargetRole[] = [...ROLE_OPTIONS, ...TARGET_ROLES, ...CANDIDATE_ROLES];

/** Where an older role went among the seven, for "Use my main roles" and for saving. */
export const OPTION_FOR: Readonly<Record<string, string>> = {
  "Solutions Engineer": "AI Solutions Engineer",
  "Forward Deployed Engineer": "AI Forward Deployed Engineer",
  "AI Engineer": "Software Engineer 1",
  "Software Engineer": "Software Engineer 1",
};

/** Role names Atlas used before, and the role each one folded into (19 Nov 2026). */
export const RETIRED_ROLES: Readonly<Record<string, string>> = {
  "ai + automation engineer": "AI Automation Engineer",
  "gtm engineer": "AI Automation Engineer",
  "implementation engineer": "Solutions Engineer",
  "customer success engineer": "Solutions Engineer",
  "developer advocate": "Software Engineer",
  "ai consultant": "AI Engineer",
  "agentic engineer": "Agentic Software Engineer",
  fde: "Forward Deployed Engineer",
  // 23 Nov 2026: the role and its Notion resume row were renamed.
  "ai software engineer": "Software Engineer 1",
  "ai software engineering": "Software Engineer 1",
};

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim();
const plain = (s: string) => key(s).replace(/\+/g, " ").replace(/\s+/g, " ").trim();

/**
 * The role a name stands for today: a built-in role's own spelling, the role a retired
 * name folded into, else the name as typed. "AI Workflow Engineer (uses AI Engineer)" is
 * the AI Automation Engineer, notes in brackets ignored. A name ending in "Engineering", as
 * Notion's resume rows are named ("AI Automation Engineering"), is the Engineer role.
 */
export function canonicalRole(name: string): string {
  const bare = name.replace(/\([^)]*\)/g, " ").trim();
  const k = key(bare);
  if (RETIRED_ROLES[k]) return RETIRED_ROLES[k]!;
  const known = KNOWN_ROLES.find((r) => plain(r.name) === plain(bare)) ?? KNOWN_ROLES.find((r) => plain(r.name) === plain(bare).replace(/ engineering$/, " engineer"));
  return known?.name ?? bare.replace(/\s+/g, " ");
}

/** The roles to hunt for: yours from Settings, mapped onto the built-in title lists, at most seven. */
export function rolesFrom(names: readonly string[] | undefined): TargetRole[] {
  const named = (names ?? []).map(canonicalRole).filter((n) => n.length > 0);
  if (named.length === 0) return [...TARGET_ROLES];
  const seen = new Set<string>();
  const out: TargetRole[] = [];
  for (const n of named) {
    if (seen.has(plain(n))) continue;
    seen.add(plain(n));
    const known = KNOWN_ROLES.find((r) => r.name === n);
    // A role you typed that is not built in matches its own name as a title.
    out.push(known ?? { name: n, titles: [key(n)] });
    if (out.length === MAX_ROLES) break;
  }
  return out;
}

/** Your role names in order, cleaned: canonical, no repeats, at most seven. */
export const roleNames = (names: readonly string[] | undefined): string[] => rolesFrom(names).map((r) => r.name);

/**
 * The list to save: canonical names mapped onto the seven (an older role becomes the option it
 * folded into), repeats and anything else dropped. Empty when none of the names is one of the seven.
 */
export function optionNames(names: readonly string[]): string[] {
  const seven = new Set(ROLE_OPTIONS.map((r) => r.name));
  const out: string[] = [];
  for (const n of names.map(canonicalRole)) {
    const o = OPTION_FOR[n] ?? n;
    if (seven.has(o) && !out.includes(o)) out.push(o);
  }
  return out;
}

/** The roles next to yours that are not already on your list. */
export function candidatesBeyond(targets: readonly TargetRole[]): TargetRole[] {
  const mine = new Set(targets.map((r) => plain(r.name)));
  return CANDIDATE_ROLES.filter((r) => !mine.has(plain(r.name)));
}

/** Move one role up or down your list; the other roles keep their order. */
export function moveRole(names: readonly string[], role: string, by: -1 | 1): string[] {
  const list = [...names];
  const i = list.indexOf(role);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j]!, list[i]!];
  return list;
}
