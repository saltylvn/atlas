// Interview Prep's rules (Step 4 of the agent plan, 24 Nov 2026; docs/AGENT-ARCHITECTURE.md).
// For one application at the interview stage, the agent (lib/agents/interviewPrep.ts) builds a
// packet: likely questions, a true story for each from your own material (situation, task,
// action, result), the gaps to prepare an honest answer for, and questions to ask them. This
// file holds the parts that are code. Pure.
//
//   likelyQuestions  the questions the job's must-haves and the usual behavioral round suggest
//   reviewPrep       the deterministic review: every must-have covered, every story true and sourced
//   rulesPrep        the version that stands when the model cannot run

import { z } from "zod";
import { traceClaims } from "./pitch";

export const MAX_QUESTIONS = 8;
export const MAX_GAPS = 4;
export const MAX_ASK = 5;

/** The behavioral questions nearly every early-career interview asks. */
export const BEHAVIORAL = ["Tell me about a project you're proud of and your part in it.", "Tell me about a time something you built broke, and what you did.", "Tell me about a time you had to learn something new quickly."] as const;

const Story = z.object({
  situation: z.string().min(1).max(300),
  task: z.string().min(1).max(300),
  action: z.string().min(1).max(500),
  result: z.string().min(1).max(300),
});

export const PrepPacket = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().min(5).max(240),
        kind: z.enum(["technical", "behavioral", "company"]),
        /** The must-have it tests, when it tests one. */
        requirement: z.string().max(120).default(""),
        /** A true story from your material, or null when there is none (then it belongs in gaps). */
        story: Story.nullable(),
        /** Where the story comes from: the resume or project passage's title. */
        source: z.string().max(160).default(""),
      }),
    )
    .min(1)
    .max(MAX_QUESTIONS),
  gaps: z.array(z.object({ requirement: z.string().min(1).max(120), plan: z.string().min(1).max(300) })).max(MAX_GAPS),
  ask: z.array(z.string().min(5).max(240)).max(MAX_ASK),
});
export type PrepPacket = z.infer<typeof PrepPacket>;

export function parsePrep(answer: string | undefined): PrepPacket | null {
  if (!answer) return null;
  try {
    const p = PrepPacket.safeParse(JSON.parse(answer));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** One technical question per must-have (skills first, years left out), then the behavioral round. */
export function likelyQuestions(requirements: readonly string[]): { question: string; kind: "technical" | "behavioral"; requirement: string }[] {
  const skills = requirements.filter((r) => !/year/i.test(r)).slice(0, MAX_QUESTIONS - BEHAVIORAL.length);
  return [...skills.map((r) => ({ question: `Walk me through something you built with ${r}. What would you do differently?`, kind: "technical" as const, requirement: r })), ...BEHAVIORAL.map((q) => ({ question: q, kind: "behavioral" as const, requirement: "" }))];
}

const storyText = (s: z.infer<typeof Story>) => [s.situation, s.task, s.action, s.result].join(" ");

export interface PrepReview {
  pass: boolean;
  notes: string;
}

/** The review in code: every must-have covered by a question or named a gap, each story sourced and true, limits kept. */
export function reviewPrep(p: PrepPacket, requirements: readonly string[], material: string): PrepReview {
  const problems: string[] = [];
  const covered = new Set([...p.questions.map((q) => q.requirement.toLowerCase()), ...p.gaps.map((g) => g.requirement.toLowerCase())]);
  const missing = requirements.filter((r) => !/year/i.test(r) && !covered.has(r.toLowerCase()));
  if (missing.length) problems.push(`Cover every must-have with a question or a gap: missing ${missing.join(", ")}.`);
  for (const q of p.questions) if (q.story && !q.source.trim()) problems.push(`The story for "${q.question.slice(0, 60)}" names no source: give the resume or project passage it comes from.`);
  const flags = p.questions.flatMap((q) => (q.story ? traceClaims(storyText(q.story), material) : []));
  if (flags.length) problems.push(`Unsupported claims in stories: ${flags.slice(0, 3).map((f) => `"${f.text}" (${f.why})`).join("; ")}`);
  if (!p.questions.some((q) => q.kind === "behavioral")) problems.push("Include at least one behavioral question.");
  for (const a of p.ask) if (!a.trim().endsWith("?")) problems.push(`Questions to ask should be questions: "${a.slice(0, 60)}".`);
  if ([...p.ask, ...p.gaps.map((g) => g.plan)].some((t) => /https?:\/\/|www\./i.test(t))) problems.push("No links.");
  return { pass: problems.length === 0, notes: problems.join(" ") };
}

export const PREP_JUDGE_CHECKLIST = [
  "Each story actually answers its question and shows the must-have, not a neighbour of it.",
  "Each result says what changed, in the person's own material's terms; nothing is inflated.",
  "Each gap's plan is honest (what they would do to learn it, or a related thing they did), not a bluff.",
  "Questions to ask are specific to this company or team, not generic.",
] as const;

/** The rules' version: likely questions, the best passage per must-have as a pointer (no invented story), honest gaps. */
export function rulesPrep(input: { requirements: readonly string[]; evidence: Readonly<Record<string, { title: string; text: string }>>; company: string; team: string; reportsTo: string }): PrepPacket {
  const qs = likelyQuestions(input.requirements);
  const questions = qs.map((q) => {
    const ev = q.requirement ? input.evidence[q.requirement] : undefined;
    return { ...q, story: null, source: ev ? `${ev.title}: ${ev.text.slice(0, 120)}` : "" };
  });
  const gaps = input.requirements
    .filter((r) => !/year/i.test(r) && !input.evidence[r])
    .slice(0, MAX_GAPS)
    .map((r) => ({ requirement: r, plan: `Say plainly you have not used ${r} in production, name the closest thing you have built, and how you would get up to speed in your first weeks.` }));
  const ask = [
    input.team ? `What is the ${input.team} team working on this quarter, and where would I help first?` : `What would I work on in my first 90 days at ${input.company}?`,
    input.reportsTo ? `How does the ${input.reportsTo} measure success for this role?` : "How do you measure success for this role in the first six months?",
    "How do code review and mentoring work for early-career engineers here?",
  ];
  return { questions: questions.slice(0, MAX_QUESTIONS), gaps, ask };
}
