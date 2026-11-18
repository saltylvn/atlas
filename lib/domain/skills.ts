// Career Agent, part 5c: growth. Which skills keep appearing in the jobs Atlas matches
// for you, which of those you don't have yet, one portfolio project a month to close the
// biggest gap, and LinkedIn tune-ups aligned with your target roles. Pure: no I/O.

import { DROP_SKILLS } from "./careerDirection";
import { coreTitle } from "./similarTitles";
import type { TargetRole } from "./targetRoles";
import type { JobMatch, LocalDate } from "./types";
import { weekdayIndex } from "./dates";

export interface Skill {
  name: string;
  /** Lowercase phrases that mean this skill in a posting. Matched as whole words. */
  terms: string[];
  group: "AI" | "Automation" | "Languages" | "Frameworks" | "Cloud" | "Data" | "Practice";
}

export const SKILLS: readonly Skill[] = [
  { name: "LLM apps", terms: ["llm", "llms", "large language model", "large language models", "generative ai", "genai", "gen ai"], group: "AI" },
  { name: "RAG", terms: ["rag", "retrieval augmented", "retrieval-augmented"], group: "AI" },
  { name: "AI agents", terms: ["ai agent", "ai agents", "agentic", "autonomous agents"], group: "AI" },
  { name: "Multi-agent orchestration", terms: ["multi-agent", "multi agent", "multiagent", "agent orchestration", "orchestrator agent", "supervisor agent", "crewai", "autogen"], group: "AI" },
  { name: "MCP", terms: ["mcp", "model context protocol", "mcp server", "mcp servers"], group: "AI" },
  { name: "Prompt engineering", terms: ["prompt engineering", "prompting", "prompt design"], group: "AI" },
  { name: "OpenAI API", terms: ["openai", "gpt-4", "gpt-5", "chatgpt"], group: "AI" },
  { name: "Claude / Anthropic", terms: ["claude", "anthropic"], group: "AI" },
  { name: "LangChain", terms: ["langchain", "langgraph"], group: "AI" },
  { name: "Vector databases", terms: ["vector database", "vector databases", "pinecone", "weaviate", "pgvector", "embeddings", "qdrant", "chroma"], group: "AI" },
  { name: "Evals & observability", terms: ["evals", "evaluation framework", "llm evaluation", "model evaluation", "observability", "tracing", "langsmith", "langfuse", "arize", "braintrust"], group: "AI" },
  { name: "Machine learning", terms: ["machine learning", "pytorch", "tensorflow", "scikit-learn", "mlops"], group: "AI" },
  { name: "Workflow automation", terms: ["workflow automation", "n8n", "zapier", "make.com", "power automate", "workato"], group: "Automation" },
  { name: "RPA", terms: ["rpa", "uipath", "automation anywhere", "blue prism"], group: "Automation" },
  { name: "APIs & integrations", terms: ["rest api", "rest apis", "restful", "api integration", "api integrations", "integrations", "webhooks", "graphql"], group: "Automation" },
  { name: "Python", terms: ["python"], group: "Languages" },
  { name: "TypeScript", terms: ["typescript"], group: "Languages" },
  { name: "JavaScript", terms: ["javascript", "node.js", "nodejs", "node"], group: "Languages" },
  { name: "SQL", terms: ["sql", "postgres", "postgresql", "mysql"], group: "Languages" },
  { name: "Go", terms: ["golang"], group: "Languages" },
  { name: "Java", terms: ["java", "spring boot"], group: "Languages" },
  { name: "React", terms: ["react", "react.js", "reactjs"], group: "Frameworks" },
  { name: "Next.js", terms: ["next.js", "nextjs"], group: "Frameworks" },
  { name: "FastAPI", terms: ["fastapi", "flask", "django"], group: "Frameworks" },
  { name: "AWS", terms: ["aws", "amazon web services", "lambda", "bedrock"], group: "Cloud" },
  { name: "GCP", terms: ["gcp", "google cloud", "vertex ai"], group: "Cloud" },
  { name: "Azure", terms: ["azure"], group: "Cloud" },
  { name: "Docker", terms: ["docker", "containers"], group: "Cloud" },
  { name: "Kubernetes", terms: ["kubernetes", "k8s"], group: "Cloud" },
  { name: "Terraform", terms: ["terraform", "infrastructure as code"], group: "Cloud" },
  { name: "CI/CD", terms: ["ci/cd", "github actions", "continuous integration"], group: "Cloud" },
  { name: "Data pipelines", terms: ["data pipeline", "data pipelines", "etl", "airflow", "dbt", "spark", "kafka"], group: "Data" },
  { name: "Snowflake / warehouses", terms: ["snowflake", "bigquery", "redshift", "databricks", "data warehouse"], group: "Data" },
  { name: "Salesforce", terms: ["salesforce", "crm integration", "hubspot"], group: "Data" },
  { name: "Customer-facing demos", terms: ["demos", "product demos", "technical demos", "proof of concept", "proofs of concept", "poc", "pocs", "pre-sales", "presales"], group: "Practice" },
  { name: "Solution architecture", terms: ["solution architecture", "solutions architecture", "technical discovery", "architecture design"], group: "Practice" },
  { name: "Security & compliance", terms: ["soc 2", "soc2", "security", "compliance", "hipaa"], group: "Practice" },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const PATTERNS = SKILLS.map((s) => ({ s, re: new RegExp(`(^|[^a-z0-9])(${s.terms.map(esc).join("|")})(?=[^a-z0-9]|$)`, "i") }));

/** The skills a posting asks for, by name. */
export function extractSkills(text: string): string[] {
  const t = ` ${text.toLowerCase()} `;
  return PATTERNS.filter((p) => p.re.test(t)).map((p) => p.s.name);
}

// ---------------------------------------------------------------------------
// Skill gaps

export interface SkillCount {
  skill: string;
  group: Skill["group"];
  /** Matched postings asking for it. */
  count: number;
  /** Which of your roles ask for it, most often first. */
  roles: string[];
  have: boolean;
}

/**
 * How often each skill appears in your matched jobs, weighted toward your higher-priority
 * roles, with the ones you already have marked. `have` holds skill names you said you have.
 */
export function skillDemand(matches: Pick<JobMatch, "role" | "skills">[], roles: TargetRole[], have: readonly string[]): SkillCount[] {
  const mine = new Set(have.map((h) => h.toLowerCase()));
  const tally = new Map<string, { count: number; weight: number; roles: Map<string, number> }>();
  for (const m of matches) {
    const rank = roles.findIndex((r) => r.name === m.role);
    const w = rank < 0 ? 1 : 1 + (roles.length - rank) / roles.length;
    for (const skill of m.skills ?? []) {
      const t = tally.get(skill) ?? { count: 0, weight: 0, roles: new Map() };
      t.count += 1;
      t.weight += w;
      t.roles.set(m.role, (t.roles.get(m.role) ?? 0) + 1);
      tally.set(skill, t);
    }
  }
  return [...tally.entries()]
    .map(([skill, t]) => ({ skill, weight: t.weight, group: SKILLS.find((s) => s.name === skill)?.group ?? "Practice", count: t.count, roles: [...t.roles.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r), have: mine.has(skill.toLowerCase()) }))
    .sort((a, b) => b.weight - a.weight || b.count - a.count || a.skill.localeCompare(b.skill))
    .map(({ weight: _w, ...rest }) => rest);
}

export const skillGaps = (demand: SkillCount[], max = 8) => demand.filter((d) => !d.have).slice(0, max);

// ---------------------------------------------------------------------------
// Monthly portfolio project

export interface PortfolioProject {
  skill: string;
  title: string;
  pitch: string;
  steps: string[];
}

const PROJECTS: Record<string, Omit<PortfolioProject, "skill">> = {
  RAG: { title: "Ask Atlas: a RAG search over your briefs", pitch: "Answer questions about your past briefs and job matches with cited sources.", steps: ["Embed brief history with pgvector in Supabase", "Retrieve the top matches for a question", "Answer with citations to the source brief", "Write it up with a short demo video"] },
  "AI agents": { title: "A multi-step agent that preps an interview pack", pitch: "Given a job link, an agent researches the company and drafts a one-page prep sheet.", steps: ["Define tools: fetch posting, company news, your resume", "Plan → act → check loop with a step limit", "Log every step for review", "Publish the trace as a case study"] },
  "Workflow automation": { title: "Inbox-to-tracker automation in n8n", pitch: "Turn job emails into tracker rows and Slack pings without code.", steps: ["Trigger on new Gmail label", "Parse company and role", "Upsert a row in Supabase or Sheets", "Document the workflow with screenshots"] },
  "Evals & observability": { title: "Evals and tracing for Atlas's agents", pitch: "Answer \"How do you know your agents are working?\" with a test set, scores over time and a trace of every run.", steps: ["Collect 30 real inputs per agent (emails, postings, feeds) with the expected result", "Score each agent's rules against them in CI and fail on regressions", "Trace every run: inputs, decisions, timing, outcome (Mission Control already logs runs)", "Publish the scores table and one trace as a case study"] },
  "Multi-agent orchestration": { title: "Write up Atlas as a supervisor-pattern case study", pitch: "Explain the Chief of Staff routing work to six specialists, in the vocabulary hiring teams use.", steps: ["Draw the supervisor (hierarchical) topology", "Show the Standard Agent Report contract and how failures surface", "Cover pause, Run Now and the activity log", "Publish it with a 3-minute walkthrough video"] },
  MCP: { title: "An MCP server for Atlas", pitch: "Expose Atlas's briefs, renewals and job matches as MCP tools any assistant can use.", steps: ["Define read-only tools with input schemas", "Serve them over MCP with owner-only auth", "Connect it to Claude and record a demo", "Document the tools like a product"] },
  "Vector databases": { title: "Semantic job search over your matched postings", pitch: "Find similar jobs by meaning, not keywords.", steps: ["Embed matched job titles and text", "Store in pgvector", "Query 'jobs like this one'", "Show the results in a small web page"] },
  "APIs & integrations": { title: "A Calendar + Gmail + Slack integration hub", pitch: "One small service that syncs events and messages across tools.", steps: ["Connect two APIs with OAuth or keys", "Normalize events into one schema", "Handle retries and rate limits", "Write integration docs like a product"] },
  "Customer-facing demos": { title: "A 5-minute product demo of Atlas", pitch: "Record a crisp, customer-style demo with a discovery story.", steps: ["Write a one-page customer scenario", "Script the demo around three outcomes", "Record and edit to 5 minutes", "Post it on LinkedIn and Upwork"] },
  "Solution architecture": { title: "Reference architecture for an AI assistant", pitch: "A diagram and design doc a customer could approve.", steps: ["Map requirements and constraints", "Draw the architecture with trade-offs", "Cover security and cost", "Publish the doc as a portfolio PDF"] },
  AWS: { title: "Deploy an Atlas agent on AWS Lambda", pitch: "Run one agent serverlessly with infrastructure as code.", steps: ["Package an agent as a Lambda", "Schedule it with EventBridge", "Store secrets in Secrets Manager", "Write up costs and trade-offs"] },
  Kubernetes: { title: "Run a small AI service on Kubernetes", pitch: "Containerize and deploy a model-backed API with autoscaling.", steps: ["Dockerize a FastAPI service", "Deploy to a local cluster (kind)", "Add health checks and autoscaling", "Document the setup"] },
  Python: { title: "A Python CLI that scores job postings", pitch: "Port Atlas's matching rules to a tested Python package.", steps: ["Write the scoring rules in Python", "Add pytest coverage", "Publish to GitHub with a README", "Show sample output"] },
  "Data pipelines": { title: "A daily job-market pipeline", pitch: "Collect postings daily and chart skill trends.", steps: ["Ingest feeds on a schedule", "Clean and store in Postgres", "Aggregate skills by week", "Publish a small dashboard"] },
};

/** Skills with a specific portfolio plan (the rest get a generic one). */
export const PROJECT_SKILLS: readonly string[] = Object.keys(PROJECTS);

const GENERIC = (skill: string): Omit<PortfolioProject, "skill"> => ({
  title: `A small ${skill} project tied to Atlas`,
  pitch: `Show hands-on ${skill} by adding one real feature to Atlas or a companion tool.`,
  steps: [`Pick one Atlas feature that ${skill} would improve`, "Build the smallest version that works", "Write a README with screenshots", "Add it to LinkedIn and your Upwork portfolio"],
});

/** The project for the month: it closes your biggest gap. */
export function portfolioProject(gaps: SkillCount[]): PortfolioProject | null {
  const top = gaps[0];
  if (!top) return null;
  return { skill: top.skill, ...(PROJECTS[top.skill] ?? GENERIC(top.skill)) };
}

/** The first weekday of a month gets the project in the brief. */
export function isFirstWeekdayOfMonth(day: LocalDate): boolean {
  const d = Number(day.slice(8, 10));
  if (weekdayIndex(day) > 4) return false;
  for (let i = 1; i < d; i++) {
    const earlier = `${day.slice(0, 8)}${String(i).padStart(2, "0")}`;
    if (weekdayIndex(earlier) <= 4) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// LinkedIn tune-up

export interface Tuneup {
  headline: string;
  addSkills: string[];
  learn: string[];
  aboutTips: string[];
}

export function linkedinTuneup(roles: TargetRole[], demand: SkillCount[], matches: Pick<JobMatch, "title" | "role">[]): Tuneup {
  const top = roles.slice(0, 2).map((r) => r.name);
  const haveTop = demand.filter((d) => d.have && !DROP_SKILLS.has(d.skill)).slice(0, 3).map((d) => d.skill);
  const headline = [top.join(" | "), haveTop.length ? haveTop.join(", ") : "Multi-agent orchestration, MCP and API integration"].join(" · ");
  const common = new Map<string, number>();
  for (const m of matches) {
    if (m.role !== roles[0]?.name) continue;
    const t = coreTitle(m.title);
    common.set(t, (common.get(t) ?? 0) + 1);
  }
  const titleWords = [...common.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  return {
    headline: headline.slice(0, 220),
    addSkills: demand.filter((d) => d.have && !DROP_SKILLS.has(d.skill)).slice(0, 8).map((d) => d.skill),
    learn: skillGaps(demand.filter((d) => !DROP_SKILLS.has(d.skill)), 3).map((d) => d.skill),
    aboutTips: [
      `Open with the roles you want, in order: ${roles.map((r) => r.name).slice(0, 3).join(", ")}.`,
      titleWords.length ? `Use the titles employers post for your top role: ${titleWords.join(", ")}.` : "Use the job titles employers actually post for your top role.",
      "Lead with one shipped project (Atlas): what it does, the stack, and the result in numbers (hours saved, cost per run).",
      "Use market vocabulary: multi-agent orchestration (supervisor pattern), MCP and API integration, evals and observability.",
      "Drop \"AI fluent\" and \"prompt engineering\" as headline skills; employers ask for evals and MCP instead.",
      "Name the tools recruiters search for, matching your Skills section.",
    ],
  };
}
