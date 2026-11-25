// Your projects on GitHub, as evidence of what you can do. Pure.
//
// The Scout reads each repository's description, topics, languages, the start of its
// README and its dependency files (lib/integrations/github.ts). This file turns that into
// the project's stack and the skills it demonstrates, using the same skill list the
// market report uses, so "what a role asks for" and "what you have built" are compared in
// the same words. No source code is read, stored or sent anywhere.

import { extractSkills } from "./skills";
import type { LocalDate } from "./types";

/** One repository as GitHub returned it. */
export interface RawRepo {
  fullName: string;
  name: string;
  description: string;
  url: string;
  isPrivate: boolean;
  fork: boolean;
  archived: boolean;
  pushedAt: string | null;
  topics: string[];
  /** Language name to bytes of code. */
  languages: Record<string, number>;
  /** The start of the README, or "". */
  readme: string;
  /** Dependency files found at the root: package.json, requirements.txt, pyproject.toml. */
  manifests: { path: string; text: string }[];
  /** Names of the files and folders at the root. */
  rootPaths: string[];
}

export interface PortfolioRepo {
  id: string;
  /** "owner/name": unique per owner. */
  repo: string;
  name: string;
  description: string;
  url: string;
  isPrivate: boolean;
  /** Languages by share of code, largest first. */
  languages: string[];
  topics: string[];
  /** Notable tools found in its dependency files and layout: "Next.js", "Supabase", "Docker". */
  stack: string[];
  /** Skills from the shared list (lib/domain/skills.ts) that this project demonstrates. */
  skills: string[];
  /** The project's own name, from the README's top heading ("DEVELOP"), or "" when it has none or it is the repository name. */
  title: string;
  /** The opening of the README, cleaned: prose and headings, one item per line. Never code, images or HTML. */
  readme: string;
  pushedAt: string | null;
  checkedOn: LocalDate;
  createdAt: string;
}

export type NewPortfolioRepo = Omit<PortfolioRepo, "id" | "createdAt">;

export const MAX_REPOS = 20;

/** A dependency (or part of its name) and the tool it stands for. Matched on whole package names. */
const DEPENDENCIES: readonly [RegExp, string][] = [
  [/^next$/, "Next.js"],
  [/^react$/, "React"],
  [/^typescript$/, "TypeScript"],
  [/^@supabase\//, "Supabase"],
  [/^supabase$/, "Supabase"],
  [/^(pg|postgres|psycopg2?(-binary)?|asyncpg)$/, "Postgres"],
  [/^tailwindcss$/, "Tailwind CSS"],
  [/^zod$/, "Zod"],
  [/^pydantic$/, "Pydantic"],
  [/^(vitest|jest|pytest|playwright|@playwright\/test)$/, "Automated tests"],
  [/^fastapi$/, "FastAPI"],
  [/^flask$/, "Flask"],
  [/^django$/, "Django"],
  [/^express$/, "Express"],
  [/^(@anthropic-ai\/sdk|anthropic)$/, "Claude API"],
  [/^(@google\/genai|@google\/generative-ai|google-generativeai|google-genai)$/, "Gemini API"],
  [/^openai$/, "OpenAI API"],
  [/^(langchain|langgraph|@langchain\/.+)$/, "LangChain"],
  [/^(@modelcontextprotocol\/sdk|mcp)$/, "MCP"],
  [/^(@slack\/web-api|@slack\/bolt|slack-sdk|slack_sdk|slack-bolt)$/, "Slack API"],
  [/^(@hubspot\/api-client|hubspot-api-client)$/, "HubSpot API"],
  [/^(pgvector|@pinecone-database\/pinecone|chromadb|qdrant-client)$/, "Vector database"],
  [/^(httpx|requests|axios)$/, "REST APIs"],
  [/^(boto3|@aws-sdk\/.+)$/, "AWS"],
  [/^(@google-cloud\/.+|google-cloud-.+)$/, "GCP"],
  [/^(pandas|numpy)$/, "Data analysis"],
  [/^(scikit-learn|torch|tensorflow)$/, "Machine learning"],
];

/** What a stack label means in the shared skill list's words, where the label alone would not match. */
const STACK_WORDS: Record<string, string> = {
  "Claude API": "claude anthropic llm",
  "Gemini API": "llm generative ai",
  "OpenAI API": "openai llm",
  "Vector database": "vector database embeddings",
  "Automated tests": "",
  Postgres: "postgres sql",
  Supabase: "postgres sql",
  "Slack API": "api integration",
  "HubSpot API": "hubspot api integration",
  "GitHub Actions": "github actions ci/cd",
  "REST APIs": "rest api",
};

/** Package names declared in a dependency file. Versions and comments are ignored. */
export function dependencyNames(path: string, text: string): string[] {
  const body = text.slice(0, 60_000);
  const file = path.split("/").at(-1)!.toLowerCase();
  if (file === "package.json") {
    try {
      const pkg = JSON.parse(body) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
      return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})].map((d) => d.toLowerCase());
    } catch {
      return [];
    }
  }
  if (file === "requirements.txt") {
    return body
      .split("\n")
      .map((l) => l.replace(/#.*$/, "").trim().split(/[\s<>=!~;[]/)[0]!.toLowerCase())
      .filter((l) => /^[a-z0-9][a-z0-9._-]*$/.test(l));
  }
  if (file === "pyproject.toml") {
    // Quoted requirement strings: "fastapi>=0.110", 'pydantic[email]'.
    return [...body.matchAll(/["']([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?:[<>=!~^][^"']*)?["']/g)].map((m) => m[1]!.toLowerCase());
  }
  return [];
}

const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

export const MAX_README = 4000;
const MAX_TITLE = 120;

/** Markdown inline formatting out of one line: links keep their text, images and badges go. */
const inline = (l: string) =>
  l
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "") // a badge: an image inside a link
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // an image
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // a link: its text
    .replace(/<[^>]*>/g, "") // inline HTML
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)(?<=\S)\1/g, "$2")
    .replace(/\s+/g, " ")
    .trim();

/** README lines outside code blocks, with HTML comments and whole image or table blocks removed. */
function proseLines(md: string): string[] {
  const body = md
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(picture|table|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  const out: string[] = [];
  let fence: string | null = null;
  for (const line of body.split("\n")) {
    const mark = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (mark) {
      if (!fence) fence = mark[0]!;
      else if (mark[0] === fence) fence = null;
      continue;
    }
    if (!fence) out.push(line);
  }
  return out;
}

/**
 * The README's opening as plain lines: headings and prose kept, code blocks, HTML, images,
 * badges, tables and rules dropped. One item per line, so the index cuts passages between
 * items. A README is the project's own words: treated as data wherever it is shown.
 */
export function cleanReadme(md: string): string {
  let out = "";
  for (const raw of proseLines(md)) {
    if (/^\s*\|/.test(raw) || /^\s*[-=*_]{3,}\s*$/.test(raw)) continue;
    const l = inline(raw.replace(/^\s{0,3}#{1,6}\s+/, "").replace(/^\s*>\s?/, "").replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, ""));
    if (!/[A-Za-z0-9]/.test(l)) continue;
    if (out.length + l.length + 1 > MAX_README) break;
    out += (out ? "\n" : "") + l;
  }
  return out;
}

const plainName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The project's own name: the README's first top-level heading, unless it only repeats the repository name. */
export function readmeTitle(md: string, repoName: string): string {
  const lines = proseLines(md);
  const h1 = lines.map((l) => l.match(/^\s{0,3}#\s+(.+?)[\s#]*$/)?.[1]).find(Boolean) ?? lines.join("\n").match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "";
  const title = inline(h1).replace(/[^\p{L}\p{N}\s.,:&()'+/-]/gu, "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return title && plainName(title) !== plainName(repoName) ? title : "";
}

/** How a project is named everywhere: "DEVELOP (wellness-tracker)", or the repository name alone. */
export const projectName = (r: Pick<PortfolioRepo, "title" | "name">): string => (r.title ? `${r.title} (${r.name})` : r.name);

/** A repository as a portfolio entry: its stack and the skills it demonstrates. */
export function describeRepo(raw: RawRepo, today: LocalDate): NewPortfolioRepo {
  const bytes = Object.values(raw.languages).reduce((n, b) => n + b, 0) || 1;
  // A language under 3% of the code is tooling, not the project.
  const languages = Object.entries(raw.languages)
    .filter(([, b]) => b / bytes >= 0.03)
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 6);
  const deps = new Set(raw.manifests.flatMap((m) => dependencyNames(m.path, m.text)));
  const stack = new Set<string>();
  for (const d of deps) for (const [re, label] of DEPENDENCIES) if (re.test(d)) stack.add(label);
  const roots = new Set(raw.rootPaths.map((p) => p.toLowerCase()));
  if (roots.has("dockerfile") || roots.has("docker-compose.yml") || roots.has("compose.yaml")) stack.add("Docker");
  if (roots.has(".github")) stack.add("GitHub Actions");
  if (roots.has("supabase")) stack.add("Supabase");
  if (roots.has("vercel.json")) stack.add("Vercel");

  const topics = raw.topics.map((t) => clip(t, 40)).filter(Boolean).slice(0, 24);
  // What the project says about itself, in the order of how much it can be trusted:
  // code facts (languages, dependencies), then its own labels, then the README's opening.
  const text = [
    languages.join(" "),
    [...stack].map((s) => `${s} ${STACK_WORDS[s] ?? ""}`).join(" . "),
    topics.map((t) => t.replace(/-/g, " ")).join(" . "),
    raw.description,
    raw.readme.slice(0, 1500),
  ].join(" . ");
  return {
    repo: clip(raw.fullName, 140),
    name: clip(raw.name, 100),
    description: clip(raw.description, 300),
    url: raw.url.startsWith("https://github.com/") ? raw.url.slice(0, 300) : "",
    isPrivate: raw.isPrivate,
    languages,
    topics,
    stack: [...stack].sort().slice(0, 20),
    skills: extractSkills(text).slice(0, 30),
    title: readmeTitle(raw.readme, raw.name),
    readme: cleanReadme(raw.readme),
    pushedAt: raw.pushedAt,
    checkedOn: today,
  };
}

/** The repositories worth describing: your own work, most recently pushed first. */
export function portfolioFrom(raws: readonly RawRepo[], login: string, today: LocalDate): NewPortfolioRepo[] {
  return raws
    .filter((r) => !r.fork && !r.archived && r.name.toLowerCase() !== login.toLowerCase())
    .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""))
    .slice(0, MAX_REPOS)
    .map((r) => describeRepo(r, today))
    .filter((r) => r.languages.length > 0 || r.skills.length > 0);
}

// ---------------------------------------------------------------------------
// Evidence: where each of your skills shows up.

export interface SkillEvidence {
  skill: string;
  /** Projects that demonstrate it, most recently pushed first. */
  projects: string[];
  /** It appears in your resume text. */
  resume: boolean;
  /** You ticked it on Growth. */
  ticked: boolean;
}

/**
 * Every skill you can point to, and where. A skill is "shown" when a project or a resume
 * backs it; one you only ticked is a claim with nothing behind it yet.
 */
export function skillEvidence(repos: readonly Pick<PortfolioRepo, "name" | "skills" | "pushedAt">[], resumeSkills: readonly string[], ticked: readonly string[]): Map<string, SkillEvidence> {
  const out = new Map<string, SkillEvidence>();
  const at = (skill: string) => {
    const k = skill.toLowerCase();
    if (!out.has(k)) out.set(k, { skill, projects: [], resume: false, ticked: false });
    return out.get(k)!;
  };
  for (const r of [...repos].sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""))) for (const s of r.skills) at(s).projects.push(r.name);
  for (const s of resumeSkills) at(s).resume = true;
  for (const s of ticked) at(s).ticked = true;
  return out;
}

export const isShown = (e: SkillEvidence | undefined): boolean => Boolean(e && (e.projects.length > 0 || e.resume));
