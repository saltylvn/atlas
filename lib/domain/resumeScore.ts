// Resume Optimization, part 1: a rules scorecard for each of your resumes (owner's request,
// 23 Nov 2026). Each resume is read as the Monday sync indexed it from Figma, and measured
// against what that role's job postings ask for. Pure: no AI, nothing written anywhere.
//
//   keywords   the 20 skills postings for the role name most often (last 60 days), each on
//              your resume or missing; a missing one you have elsewhere (your skills list or
//              another of your resumes) is an easy add, the rest are real gaps
//   headline   whether the resume names the role near the top
//   bullets    how many lines carry a number, and how many open weakly ("Responsible for")
//   length     a one-page resume reads about 350 to 800 words

import { canonicalRole } from "./targetRoles";
import { addDays } from "./dates";
import { LENS_LABEL, lensForRole, lensOf, type Lens } from "./roleLens";
import { extractSkills } from "./skills";
import type { TechPosting } from "./techMarket";
import type { LocalDate } from "./types";

export const KEYWORDS = 20;
export const SCORE_DAYS = 60;
const WORDS = { min: 350, max: 800 };
const WEAK = /^(responsible for|worked on|helped( to)?|assisted( with| in)?|participated in|duties included|tasked with|involved in)\b/i;

export interface ResumeText {
  /** The resume's name as its Notion row names it ("Software Engineer 1", "Master Resume"). */
  name: string;
  text: string;
}

export interface Keyword {
  skill: string;
  /** Share of the role's postings that name it. */
  share: number;
  onResume: boolean;
  /** Missing here, but on your skills list or another of your resumes: an easy add. */
  haveElsewhere: boolean;
}

export interface ResumeScorecard {
  name: string;
  /** The role it is measured against, or null for the Master Resume (all six roles together). */
  lens: Lens | null;
  against: string;
  postings: number;
  score: number;
  keywords: Keyword[];
  /** Postings' weight the resume covers: the sum of the shares of the keywords it names, over all 20. */
  coverage: number;
  headline: { ok: boolean; wanted: string };
  bullets: { lines: number; quantified: number; weak: string[] };
  words: number;
}

/** One resume's text from its indexed passages (titles "Resume: <name>"), in order. */
export function resumeTexts(rows: readonly { title: string; content: string }[]): ResumeText[] {
  const by = new Map<string, string[]>();
  for (const r of rows) {
    const name = r.title.replace(/^Resume:\s*/i, "").trim();
    if (!name) continue;
    by.set(name, [...(by.get(name) ?? []), r.content]);
  }
  return [...by].map(([name, parts]) => ({ name, text: parts.join("\n") }));
}

const lineList = (text: string) =>
  text
    .split(/\n+/)
    .map((l) => l.replace(/^[\s•●▪◦\-–—*]+/, "").trim())
    .filter(Boolean);

/** Bullet-like lines: sentences of a description, not headings or contact lines. */
const isBullet = (l: string) => l.length >= 40 && l.split(/\s+/).length >= 7;

export function scoreResume(resume: ResumeText, input: { postings: readonly TechPosting[]; today: LocalDate; mySkills: readonly string[]; otherResumes: readonly ResumeText[] }): ResumeScorecard {
  const lens = lensForRole(canonicalRole(resume.name));
  const since = addDays(input.today, -(SCORE_DAYS - 1));
  const pool = input.postings.filter((p) => p.lastSeen >= since && (lens ? lensOf(p.title) === lens : lensOf(p.title) !== null));

  const counts = new Map<string, number>();
  for (const p of pool) for (const s of new Set(p.skills)) counts.set(s, (counts.get(s) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, KEYWORDS);

  const onMine = new Set(extractSkills(resume.text).map((s) => s.toLowerCase()));
  const elsewhere = new Set([...input.mySkills.map((s) => s.toLowerCase()), ...input.otherResumes.flatMap((r) => extractSkills(r.text).map((s) => s.toLowerCase()))]);
  const keywords: Keyword[] = top.map(([skill, n]) => {
    const on = onMine.has(skill.toLowerCase());
    return { skill, share: pool.length ? n / pool.length : 0, onResume: on, haveElsewhere: !on && elsewhere.has(skill.toLowerCase()) };
  });
  const totalWeight = keywords.reduce((s, k) => s + k.share, 0);
  const coverage = totalWeight ? keywords.filter((k) => k.onResume).reduce((s, k) => s + k.share, 0) / totalWeight : 0;

  const lines = lineList(resume.text);
  const bullets = lines.filter(isBullet);
  const wanted = lens ? LENS_LABEL[lens] : "your target role";
  const head = lines.slice(0, 6).join(" ").toLowerCase();
  const headline = { ok: lens ? head.includes(LENS_LABEL[lens].toLowerCase().replace(/ engineer$/, "")) : true, wanted };
  const quantified = bullets.filter((l) => /\d/.test(l)).length;
  const weak = bullets.filter((l) => WEAK.test(l)).slice(0, 5);
  const words = resume.text.split(/\s+/).filter(Boolean).length;

  // 100 points: keywords 50, numbers in bullets 20, no weak openings 10, headline 10, length 10.
  const quantShare = bullets.length ? quantified / bullets.length : 0;
  const score = Math.round(
    50 * coverage + 20 * Math.min(1, quantShare / 0.6) + 10 * (bullets.length ? 1 - weak.length / bullets.length : 0) + (headline.ok ? 10 : 0) + (words >= WORDS.min && words <= WORDS.max ? 10 : 5),
  );

  return { name: resume.name, lens, against: lens ? LENS_LABEL[lens] : "all six of your roles", postings: pool.length, score, keywords, coverage, headline, bullets: { lines: bullets.length, quantified, weak }, words };
}

/** Every resume's scorecard: your #1 role first, the Master Resume last. */
export function resumeScorecards(resumes: readonly ResumeText[], input: { postings: readonly TechPosting[]; today: LocalDate; mySkills: readonly string[]; roleOrder: readonly string[] }): ResumeScorecard[] {
  const cards = resumes.map((r) => scoreResume(r, { ...input, otherResumes: resumes.filter((o) => o !== r) }));
  const rank = (c: ResumeScorecard) => {
    if (!c.lens) return 1000;
    const i = input.roleOrder.findIndex((n) => lensForRole(canonicalRole(n)) === c.lens);
    return i < 0 ? 500 : i;
  };
  return cards.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The words a length verdict uses. */
export const lengthNote = (words: number) => (words < WORDS.min ? `${words} words: room to add` : words > WORDS.max ? `${words} words: likely past one page` : `${words} words: one page`);
