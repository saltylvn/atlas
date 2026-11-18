// Answer-bank drafts from your own resumes, by rules. Pure.
//
// Two sources, both your words:
//   - a resume page's text as Atlas reads it from Notion (one line per block, headings
//     closed with a full stop): drafts for the answer bank, offered in the form and saved
//     only when you press Save;
//   - the first search passage of each resume ("Summary. ... Skills. ..."): the summary of
//     the resume that matches a job, offered in that job's apply kit.
// Nothing here invents a fact: every draft is sentences lifted from a resume.

const SECTIONS = ["summary", "skills", "experience", "projects", "prior career", "education", "certifications"] as const;
type SectionName = (typeof SECTIONS)[number];

export interface ResumeEntry {
  /** "Integration Analyst | Northwind Health | 2024 – Present" split on the bars. */
  parts: string[];
  /** The tools line under a project title, when there is one. */
  stack: string;
  bullets: string[];
}

export interface ParsedResume {
  summary: string;
  skills: string[];
  experience: ResumeEntry[];
  projects: ResumeEntry[];
  prior: ResumeEntry[];
}

const sectionOf = (line: string): SectionName | null => {
  const name = line.replace(/\.$/, "").trim().toLowerCase();
  return (SECTIONS as readonly string[]).includes(name) ? (name as SectionName) : null;
};
const isEntryTitle = (line: string) => / \| /.test(line);
const unstop = (line: string) => line.replace(/\.$/, "").trim();

/** "Northwind Health | 2024 – Present": the line under a job title, when the title stands on its own line. */
const isEmployerLine = (line: string) => isEntryTitle(line) && /\b(19|20)\d{2}\b/.test(line);

/**
 * A resume page's text (as `blocksToText` returns it) split into its sections. A job is
 * written one of two ways, and both are read:
 *   "Support Analyst | Acme | 2025 – Present."          the title, employer and dates on one line
 *   "Support Analyst." then "Acme | 2025 – Present"     as the resume sync mirrors it from Figma
 */
export function parseResumeText(text: string): ParsedResume {
  const out: ParsedResume = { summary: "", skills: [], experience: [], projects: [], prior: [] };
  let section: SectionName | null = null;
  let entry: ResumeEntry | null = null;
  const lists: Partial<Record<SectionName, ResumeEntry[]>> = { experience: out.experience, projects: out.projects, "prior career": out.prior };
  const lines = text
    .split("\n")
    .slice(0, 400)
    .map((raw) => raw.replace(/\s+/g, " ").trim().slice(0, 600))
    .filter(Boolean);
  const bars = (line: string) => unstop(line).split(/\s+\|\s+/).map((p) => p.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const next = sectionOf(line);
    if (next) {
      section = next;
      entry = null;
      continue;
    }
    if (section === "summary") out.summary = `${out.summary} ${line}`.trim();
    else if (section === "skills") out.skills.push(...line.split(/,\s*/).map((s) => s.replace(/\.$/, "").trim()).filter(Boolean));
    else if (section && lists[section]) {
      const jobs = section !== "projects";
      const following = lines[i + 1] ?? "";
      if (jobs && !isEntryTitle(line) && isEmployerLine(following) && !sectionOf(following)) {
        // A title on its own line, with its employer and dates on the next.
        entry = { parts: [unstop(line), ...bars(following)], stack: "", bullets: [] };
        lists[section]!.push(entry);
        i++;
      } else if (isEntryTitle(line)) {
        entry = { parts: bars(line), stack: "", bullets: [] };
        lists[section]!.push(entry);
      } else if (entry && !entry.stack && entry.bullets.length === 0 && !jobs) entry.stack = unstop(line);
      else if (entry) entry.bullets.push(line);
    }
  }
  out.skills = [...new Set(out.skills)].slice(0, 30);
  return out;
}

const AI_SKILL = /\b(ai|llm|rag|mcp|evals?|agents?|claude|gemini|prompt|vector|orchestration|langchain|openai)\b/i;
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

/** Drafts for the answer bank, by question id. A question with nothing to draft from is left out. */
export function draftAnswers(resume: ParsedResume, displayName = ""): Record<string, string> {
  const drafts: Record<string, string> = {};
  const job = resume.experience[0];
  const projects = resume.projects.slice(0, 3);
  const projectNames = projects.map((p) => p.parts[0]!).filter(Boolean);

  if (resume.summary) {
    const now = job && job.parts.length >= 2 ? ` I'm currently ${article(job.parts[0]!)} ${job.parts[0]} at ${job.parts[1]}` : "";
    const built = projectNames.length ? `${now ? ", and" : " I've"} built ${list(projectNames)}` : "";
    drafts.intro = `${resume.summary}${now}${built}${now || built ? "." : ""}`.trim();
  }

  const history = [...resume.experience, ...resume.prior].map((e) => [e.parts.join(", "), ...e.bullets.map((b) => `- ${b}`)].join("\n"));
  if (history.length) drafts.workHistory = history.join("\n\n");

  const lead = projects[0];
  if (lead) {
    const what = lead.parts.slice(1).join(", ");
    drafts.project = [`${lead.parts[0]}${what ? ` (${what})` : ""}${lead.stack ? `, built with ${lead.stack}` : ""}.`, ...lead.bullets.slice(0, 3)].join(" ");
  }

  const aiSkills = resume.skills.filter((s) => AI_SKILL.test(s));
  const aiBullets = projects.flatMap((p) => p.bullets.filter((b) => AI_SKILL.test(b)).slice(0, 1).map((b) => `${p.parts[0]}: ${b}`));
  if (aiSkills.length || aiBullets.length) drafts.aiExperience = [aiSkills.length ? `Hands-on with ${list(aiSkills)}.` : "", ...aiBullets.slice(0, 3).map(sentence)].filter(Boolean).join(" ");

  if (resume.summary) {
    const first = resume.summary.split(/(?<=[.!?])\s+/)[0] ?? resume.summary;
    const proof = lead?.bullets[0] ? ` Recent work: ${lead.parts[0]}. ${lead.bullets[0]}` : "";
    drafts.proposalOpener = `Hi, I'm ${displayName || "[your name]"}. I can help with {role}. ${sentence(first)}${proof}`.trim();
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// The matching resume's summary, from the search index.

/** "Summary. X. Y. Skills. ..." -> "X. Y." (the first passage of an indexed resume). */
export function summaryFromPassage(content: string): string {
  const m = /(?:^|\s)Summary\.\s+([\s\S]+?)(?:\s+(?:Skills|Experience|Projects)\.\s|$)/.exec(content);
  return m ? m[1]!.trim().slice(0, 1200) : "";
}

const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9+]+/g, " ").trim();

/**
 * The summary of the resume for a target role, from the indexed resume passages
 * (`knowledge.bySource("resume")`, first passage of each). Null when that role has no
 * resume indexed. The Master Resume is never a match: it is not a role.
 */
export function roleSummary(passages: readonly { title: string; content: string }[], role: string): { resume: string; text: string } | null {
  const want = norm(role);
  if (!want) return null;
  for (const p of passages) {
    const name = p.title.replace(/^Resume:\s*/i, "").trim();
    if (norm(name) !== want || /^(master|general|base)\b/i.test(name)) continue;
    const text = summaryFromPassage(p.content);
    if (text) return { resume: name, text };
  }
  return null;
}
