import { z } from "zod";
import { addDays } from "./dates";
import { LESSON_DAYS, type Lesson } from "./agentState";
import type { MarketPosting } from "./market";
import type { MentorInsight } from "./mentor";
import { levelOf, type Finding } from "./outcomes";
import { isShown, type PortfolioRepo, type SkillEvidence } from "./portfolio";
import type { LocalDate } from "./types";

// Step 3 of the agent plan (24 Nov 2026): the Career Mentor closes your gaps, one at a time.
//   rankGaps       the skills your top role's postings ask for that nothing of yours shows yet,
//                  weighted toward junior and unstated-level postings (the ones you can win)
//   nextProof      one proof project at a time: kept until a GitHub repo pushed after it was
//                  assigned shows the skill, then closed and the next gap assigned
//   gradeInsight   the critique half of draft -> critique -> refine for the Mentor's advice
//   lessonsToSave  memory: funnel findings and your Action Taken notes, kept while results confirm them
// Pure: no I/O. The Analyst (lib/agents/analyst.ts) runs these daily; the Mentor reads the result.

// ---------------------------------------------------------------------------
// Gap ranking

export interface RankedGap {
  skill: string;
  /** Share of your top role's postings that name skills and ask for it, 0 to 1. */
  share: number;
  /** The same share among its junior or unstated-level postings. */
  earlyShare: number;
  /** How many postings the shares come from: those that name at least one skill. */
  postings: number;
  score: number;
}

export const MIN_GAP_POSTINGS = 5;

/**
 * Skills the role asks for that no project or resume of yours shows, most worth closing first.
 * Junior and unstated-level postings count more: those are the jobs a proof project helps you win.
 * Shares are over postings that name a skill: many postings are read by title only, and counting
 * them would make every skill look rare (found on the demo's live feed, 24 Nov 2026).
 */
export function rankGaps(postings: readonly Pick<MarketPosting, "title" | "role" | "skills">[], role: string, evidence: ReadonlyMap<string, SkillEvidence>, max = 3): RankedGap[] {
  const mine = postings.filter((p) => p.role === role && p.skills.length > 0);
  if (mine.length < MIN_GAP_POSTINGS) return [];
  const early = mine.filter((p) => {
    const l = levelOf(p.title);
    return l === "early" || l === "unstated";
  });
  const count = (rows: readonly { skills: string[] }[]) => {
    const m = new Map<string, { skill: string; n: number }>();
    for (const r of rows) for (const s of new Set(r.skills.map((x) => x.trim()).filter(Boolean))) {
      const k = s.toLowerCase();
      const e = m.get(k) ?? { skill: s, n: 0 };
      e.n++;
      m.set(k, e);
    }
    return m;
  };
  const all = count(mine);
  const ear = count(early);
  return [...all.entries()]
    .filter(([k]) => !isShown(evidence.get(k)))
    .map(([k, { skill, n }]) => {
      const share = n / mine.length;
      const earlyShare = early.length ? (ear.get(k)?.n ?? 0) / early.length : share;
      return { skill, share, earlyShare, postings: mine.length, score: Math.round((earlyShare * 0.6 + share * 0.4) * 1000) / 1000 };
    })
    .filter((g) => g.share >= 0.1)
    .sort((a, b) => b.score - a.score || a.skill.localeCompare(b.skill))
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// One proof project at a time

export interface ProofProject {
  skill: string;
  role: string;
  /** Share of the role's postings that asked for it when it was assigned, 0 to 1. */
  share: number;
  assignedOn: LocalDate;
  brief: string;
  writer: "model" | "rules";
  /** Set when a repo pushed on or after `assignedOn` shows the skill. */
  closedOn: LocalDate | null;
  repo: string | null;
}

export interface ProofPlan {
  current: ProofProject | null;
  /** Closed projects, newest first, at most 10. */
  done: ProofProject[];
}

export const EMPTY_PLAN: ProofPlan = { current: null, done: [] };

export const ProofPlanSchema = z.object({
  current: z
    .object({ skill: z.string(), role: z.string(), share: z.number(), assignedOn: z.string(), brief: z.string(), writer: z.enum(["model", "rules"]), closedOn: z.string().nullable(), repo: z.string().nullable() })
    .nullable(),
  done: z.array(z.any()).max(10),
});

export function proofPlan(raw: unknown): ProofPlan {
  const p = ProofPlanSchema.safeParse(raw);
  return p.success ? { current: p.data.current as ProofProject | null, done: p.data.done as ProofProject[] } : EMPTY_PLAN;
}

/** The repo that closes a project: pushed on or after the day it was assigned, and showing the skill. */
export function closingRepo(p: Pick<ProofProject, "skill" | "assignedOn">, repos: readonly Pick<PortfolioRepo, "name" | "skills" | "pushedAt">[]): string | null {
  const k = p.skill.toLowerCase();
  const hit = [...repos]
    .filter((r) => (r.pushedAt ?? "").slice(0, 10) >= p.assignedOn && r.skills.some((s) => s.toLowerCase() === k))
    .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""))[0];
  return hit?.name ?? null;
}

/** What to build for a skill when no model writes the brief: small, public, finished in a week. */
export function rulesBrief(skill: string, role: string): string {
  return `Build one small public project that uses ${skill} the way ${role} postings ask for it: a working feature, a README that says what it does and why, and tests. Keep it to a week, push it to GitHub, and add one resume line with what it does.`;
}

export const PROOF_BRIEF_MAX = 600;

/** A model's brief is kept only if it is short, names the skill, and carries no links. */
export function briefOk(brief: string, skill: string): boolean {
  const b = brief.trim();
  return b.length >= 40 && b.length <= PROOF_BRIEF_MAX && b.toLowerCase().includes(skill.toLowerCase()) && !/https?:\/\/|www\./i.test(b);
}

export type ProofStep = { kind: "keep"; plan: ProofPlan } | { kind: "closed"; plan: ProofPlan; closed: ProofProject } | { kind: "assign"; plan: ProofPlan; gap: RankedGap } | { kind: "none"; plan: ProofPlan };

/**
 * The daily step: close the current project if GitHub now shows it, and assign the top gap when
 * nothing is open. An assignment is returned for the caller to word (a model brief or the rules').
 */
export function nextProof(plan: ProofPlan, gaps: readonly RankedGap[], repos: readonly Pick<PortfolioRepo, "name" | "skills" | "pushedAt">[], today: LocalDate): ProofStep {
  if (plan.current) {
    const repo = closingRepo(plan.current, repos);
    if (!repo) return { kind: "keep", plan };
    const closed = { ...plan.current, closedOn: today, repo };
    const after: ProofPlan = { current: null, done: [closed, ...plan.done].slice(0, 10) };
    return { kind: "closed", plan: after, closed };
  }
  const done = new Set(plan.done.map((d) => d.skill.toLowerCase()));
  const gap = gaps.find((g) => !done.has(g.skill.toLowerCase()));
  return gap ? { kind: "assign", plan, gap } : { kind: "none", plan };
}

export function assign(plan: ProofPlan, gap: RankedGap, role: string, brief: { text: string; writer: "model" | "rules" }, today: LocalDate): ProofPlan {
  return { ...plan, current: { skill: gap.skill, role, share: Math.round(gap.share * 100) / 100, assignedOn: today, brief: brief.text, writer: brief.writer, closedOn: null, repo: null } };
}

// ---------------------------------------------------------------------------
// Grading the Mentor's advice: the critique step of draft -> critique -> refine

export interface Grade {
  pass: boolean;
  /** What to fix, in words a rewrite can act on. Empty when it passes. */
  notes: string[];
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);
/** Overlap of the longer words, 0 to 1: how close two pieces of advice are. */
export function similarity(a: string, b: string): number {
  const x = new Set(words(a));
  const y = new Set(words(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}

const LATER = /\b(this|next) (week|month)\b|\bover the (next|coming)\b|\bin the coming\b|\beventually\b|\bsomeday\b/i;

/**
 * One concrete step, backed by evidence, doable today, and not something you already did.
 * `done` holds what you did lately, in your words (Action Taken notes) or the actions you checked off.
 */
export function gradeInsight(i: Pick<MentorInsight, "action" | "evidence">, done: readonly string[] = []): Grade {
  const notes: string[] = [];
  const sentences = i.action.split(/[.!?]+\s/).filter((s) => s.trim()).length;
  if (i.action.split(/\s+/).length > 45 || sentences > 2) notes.push("Make the action one concrete step, in at most two sentences.");
  if (i.evidence.length === 0) notes.push("Rest it on at least one observation you were shown.");
  if (LATER.test(i.action)) notes.push("Make it something that can be done today, not this week or later.");
  const repeat = done.find((d) => similarity(i.action, d) >= 0.6);
  if (repeat) notes.push(`They already did this ("${repeat.slice(0, 80)}"): build the next step on it instead.`);
  return { pass: notes.length === 0, notes };
}

/** Rewrites a day may spend on advice below the bar. */
export const REWRITES_A_DAY = 2;
/** The slots that may rewrite: two a day at most. */
export const REWRITE_SLOTS = new Set(["morning", "evening"]);

// ---------------------------------------------------------------------------
// Memory: lessons kept while results confirm them

export interface LessonCandidate {
  agent: string;
  /** Stable id of what it rests on ("funnel:fast-screen", "action:<insight id>"); stored in `evidence`. */
  key: string;
  lesson: string;
  detail: string;
}

/** A generic lesson per funnel finding: the numbers stay in the evidence, so a later run can confirm it. */
const FUNNEL_LESSON: Record<string, string> = {
  "fast-screen": "Most rejections come within 10 days: a screen says no before a person reads closely. Tailor to the posting's words and apply at your level.",
  "senior-silent": "Senior, staff and lead titles have not replied. Junior, associate and level I roles are the better bet.",
  "level-unstated": "Most applications go to titles with no level. Check the years asked before applying.",
  tailored: "Compare tailored and untailored replies before deciding how much time tailoring is worth.",
  warm: "Warm applications (you knew someone) are tracked separately: ask for referrals where you can.",
};

/** Lessons worth remembering from today's funnel and from what you did (Action Taken notes, last 30 days). */
export function lessonCandidates(findings: readonly Finding[], insights: readonly Pick<MentorInsight, "id" | "status" | "ownerNote" | "title" | "forDate">[], today: LocalDate): LessonCandidate[] {
  const out: LessonCandidate[] = [];
  for (const f of findings) {
    const lesson = FUNNEL_LESSON[f.id];
    if (lesson) out.push({ agent: "mentor", key: `funnel:${f.id}`, lesson, detail: f.text });
  }
  const since = addDays(today, -30);
  for (const i of insights) {
    const note = i.ownerNote?.trim();
    if (i.status !== "done" || !note || i.forDate < since) continue;
    out.push({ agent: "mentor", key: `action:${i.id}`, lesson: `On ${i.forDate} you acted on "${i.title.slice(0, 80)}": ${note.slice(0, 200)}`, detail: "Your Action Taken note" });
  }
  return out;
}

const keyOf = (l: Pick<Lesson, "evidence">) => l.evidence.split(" | ")[0] ?? "";

/**
 * What to write: a new lesson for each candidate not yet remembered, and a confirmation (a fresh
 * expiry) for a funnel lesson that today's funnel says again. A note is remembered once.
 */
export function lessonsToSave(existing: readonly Lesson[], candidates: readonly LessonCandidate[], today: LocalDate): { add: Omit<Lesson, "id" | "confirmed">[]; confirm: { id: string; expiresOn: LocalDate }[] } {
  const live = new Map(existing.filter((l) => l.expiresOn >= today).map((l) => [keyOf(l), l]));
  const ever = new Set(existing.map(keyOf));
  const expiresOn = addDays(today, LESSON_DAYS);
  const add: Omit<Lesson, "id" | "confirmed">[] = [];
  const confirm: { id: string; expiresOn: LocalDate }[] = [];
  for (const c of candidates) {
    const hit = live.get(c.key);
    if (hit) {
      // A funnel finding seen again confirms the lesson; a note is never "confirmed" by itself.
      if (c.key.startsWith("funnel:") && hit.expiresOn < expiresOn) confirm.push({ id: hit.id, expiresOn });
      continue;
    }
    if (c.key.startsWith("action:") && ever.has(c.key)) continue;
    add.push({ agent: c.agent, lesson: c.lesson, evidence: `${c.key} | ${c.detail}`.slice(0, 400), expiresOn });
  }
  return { add, confirm };
}

/** The lessons as one block of text for a model to read. */
export function lessonsText(lessons: readonly Pick<Lesson, "lesson" | "confirmed">[]): string {
  return lessons.map((l) => `- ${l.lesson}${l.confirmed > 0 ? ` (confirmed ${l.confirmed}x by your results)` : ""}`).join("\n");
}
