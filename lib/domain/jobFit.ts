// Career Agent: how a job match fits your resume, without a model.
//
// The search finds the resume passages closest to the job. These rules then say which
// of the job's skills those passages mention and which resume they mostly come from. It
// is the fallback when no model is available, and the facts a model's wording is checked
// against. Pure.

import type { JobMatch } from "./types";
import type { Passage } from "./retrieval";

export interface JobFit {
  /** model: worded by the AI model from the passages. rules: the skill overlap below, no model. */
  mode: "model" | "rules";
  fit: "strong" | "partial" | "weak" | "unknown";
  reasons: string[];
  gaps: string[];
  /** The resume to send, e.g. "AI Engineer", or "". */
  resume: string;
  citations: number[];
}

/** What to search the resumes for: the job's title, the role it matched and its skills. */
export const fitQuery = (m: Pick<JobMatch, "title" | "role" | "skills">) => [m.title, m.role, ...(m.skills ?? [])].join(" ").slice(0, 300);

const mentions = (text: string, skill: string) => new RegExp(`(^|[^a-z0-9])${skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text.toLowerCase());

/** "Resume: AI Engineer" -> "AI Engineer" */
export const resumeName = (title: string) => title.replace(/^Resume:\s*/i, "").trim();

/** The resume most of the passages come from (the Master Resume only when nothing else matched). */
export function bestResume(passages: readonly Passage[]): string {
  const count = new Map<string, number>();
  passages.forEach((p, i) => count.set(resumeName(p.title), (count.get(resumeName(p.title)) ?? 0) + (passages.length - i)));
  const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  return ranked.find((n) => !/^(master|general|base)\b/i.test(n)) ?? ranked[0] ?? "";
}

export function rulesFit(match: Pick<JobMatch, "skills" | "role">, passages: readonly Passage[]): JobFit {
  if (passages.length === 0) {
    return { mode: "rules", fit: "unknown", reasons: [], gaps: [], resume: "", citations: [] };
  }
  const skills = [...new Set(match.skills ?? [])];
  const text = passages.map((p) => p.content).join("\n");
  const have = skills.filter((s) => mentions(text, s));
  const missing = skills.filter((s) => !have.includes(s));
  const share = skills.length ? have.length / skills.length : 0;
  const cited = passages.filter((p) => have.some((s) => mentions(p.content, s))).map((p) => p.n);
  return {
    mode: "rules",
    fit: !skills.length ? "unknown" : share >= 0.6 ? "strong" : share >= 0.3 ? "partial" : "weak",
    reasons: have.length ? [`Your resume mentions ${have.length} of the ${skills.length} skills this posting lists: ${have.join(", ")}.`] : skills.length ? ["None of the skills this posting lists appear in the closest parts of your resume."] : ["This posting lists no skills to compare; the closest parts of your resume are below."],
    gaps: missing.slice(0, 3).map((s) => `${s} is listed in the posting and not in these passages.`),
    resume: bestResume(passages),
    citations: cited.length ? cited : passages.slice(0, 2).map((p) => p.n),
  };
}
