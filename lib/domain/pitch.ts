// The Tailor's rules (Step 2 of the agent plan, 23 Nov 2026; docs/AGENT-ARCHITECTURE.md).
// Pitch is Atlas's first agent: for one job in the Apply Queue it maps each must-have to your
// best proof, proposes up to three resume line swaps, and drafts a short note. This file holds
// the parts that are code, not judgment. Pure.
//
//   requirementsOf  the job's must-haves, from its kit (the skills it names, the years it asks)
//   traceClaims     every claim must be in your own material: a number or a skill that is not
//                   is flagged, and a packet with a flagged claim cannot be saved
//   reviewPacket    the deterministic review: every must-have answered, nothing flagged, limits
//   rulesPacket     the version that stands when the model cannot run (offline, cap reached)

import { z } from "zod";
import { extractSkills } from "./skills";
import { numbersIn } from "./careerMap";

export const MAX_REQUIREMENTS = 8;
export const MAX_SWAPS = 3;
export const NOTE_MAX_WORDS = 120;

/**
 * The job's must-haves: the skills its kit names (or, before the posting is read, the skills the
 * saved job's description named), then the years it asks, at most eight.
 */
export function requirementsOf(kitDetail: string, title: string, jobSkills: readonly string[] = []): string[] {
  const named = /^Skills it names: (.+)$/m.exec(kitDetail)?.[1]?.split(/,\s*/).map((s) => s.trim()).filter(Boolean) ?? [];
  const skills = named.length ? named : jobSkills.length ? [...jobSkills] : extractSkills(`${title}\n${kitDetail}`);
  const years = /^Asks for: (.+)$/m.exec(kitDetail)?.[1]?.split(/;\s*/).map((s) => s.trim()).filter((s) => /year/i.test(s)) ?? [];
  return [...new Set([...skills, ...years])].slice(0, MAX_REQUIREMENTS);
}

// ---------------------------------------------------------------------------
// The packet the agent returns

export const PitchPacket = z.object({
  /** The resume it tailors (its name, as the Resumes rows name it). */
  resume: z.string().min(1).max(80),
  map: z
    .array(
      z.object({
        requirement: z.string().min(1).max(120),
        status: z.enum(["proven", "gap"]),
        /** Your proof, in your own material's words, for a proven one. */
        evidence: z.string().max(300).default(""),
      }),
    )
    .max(MAX_REQUIREMENTS),
  swaps: z.array(z.object({ from: z.string().min(1).max(300), to: z.string().min(1).max(300), why: z.string().min(1).max(200) })).max(MAX_SWAPS),
  note: z.string().min(1).max(1200),
});
export type PitchPacket = z.infer<typeof PitchPacket>;

/** The packet inside the agent's final answer (JSON), or null when it is not one. */
export function parsePacket(answer: string | undefined): PitchPacket | null {
  if (!answer) return null;
  try {
    const p = PitchPacket.safeParse(JSON.parse(answer));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Truth, in code

export interface Flag {
  text: string;
  why: string;
}

const sentences = (s: string) =>
  s
    .split(/(?<=[.!?])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Claims that are not in your material: a sentence with a number your material never states,
 * or a skill your material never names. `material` is your resumes, projects and skills list.
 */
export function traceClaims(text: string, material: string): Flag[] {
  const haveNumbers = new Set(numbersIn(material));
  const haveSkills = new Set(extractSkills(material).map((s) => s.toLowerCase()));
  const flags: Flag[] = [];
  for (const s of sentences(text)) {
    const missingNumbers = numbersIn(s).filter((n) => !haveNumbers.has(n));
    const missingSkills = extractSkills(s).filter((k) => !haveSkills.has(k.toLowerCase()));
    if (missingNumbers.length) flags.push({ text: s.slice(0, 200), why: `Numbers not in your material: ${missingNumbers.join(", ")}.` });
    else if (missingSkills.length) flags.push({ text: s.slice(0, 200), why: `Skills not in your material: ${missingSkills.join(", ")}.` });
  }
  return flags;
}

export interface PacketReview {
  pass: boolean;
  notes: string;
}

/** The deterministic review, before any judge: every must-have answered, nothing untrue, within limits. */
export function reviewPacket(p: PitchPacket, requirements: readonly string[], material: string, resumeText: string): PacketReview {
  const problems: string[] = [];
  const answered = new Set(p.map.map((m) => m.requirement.toLowerCase()));
  const missing = requirements.filter((r) => !answered.has(r.toLowerCase()));
  if (missing.length) problems.push(`Map every must-have, as proven or gap: missing ${missing.join(", ")}.`);
  for (const m of p.map) if (m.status === "proven" && !m.evidence.trim()) problems.push(`"${m.requirement}" is marked proven with no evidence.`);
  const flags = [...p.swaps.map((s) => s.to), p.note, ...p.map.map((m) => m.evidence)].flatMap((t) => traceClaims(t, material));
  if (flags.length) problems.push(`Unsupported claims: ${flags.slice(0, 3).map((f) => `"${f.text}" (${f.why})`).join("; ")}`);
  const lower = resumeText.toLowerCase();
  for (const s of p.swaps) if (!lower.includes(s.from.toLowerCase().slice(0, 40))) problems.push(`Swap "from" must be a line on the resume: "${s.from.slice(0, 60)}" is not.`);
  const words = p.note.split(/\s+/).filter(Boolean).length;
  if (words > NOTE_MAX_WORDS) problems.push(`The note is ${words} words; keep it to ${NOTE_MAX_WORDS}.`);
  return { pass: problems.length === 0, notes: problems.join(" ") };
}

/** The judge's checklist: what a good packet does, beyond what code can check. */
export const JUDGE_CHECKLIST = [
  "Each proven must-have's evidence actually shows that skill, not a neighbour of it.",
  "Each swap makes the line more specific to this job and keeps it truthful; it does not add buzzwords.",
  "Swaps and the note use the posting's own words for the must-haves the person really has.",
  "The note names the company and one concrete reason this person fits, in plain words, with no flattery.",
  "Gaps are named honestly, not hidden.",
] as const;

export const JudgeOut = z.object({ pass: z.boolean(), issues: z.array(z.string().max(200)).max(4) });

// ---------------------------------------------------------------------------
// The rules' version, when the model cannot run

/** Evidence by keyword, no swaps, a template note: true, plain and always available. */
export function rulesPacket(input: { resume: string; requirements: readonly string[]; evidence: Readonly<Record<string, string>>; company: string; title: string }): PitchPacket {
  const map = input.requirements.map((r) => (input.evidence[r] ? { requirement: r, status: "proven" as const, evidence: input.evidence[r]!.slice(0, 300) } : { requirement: r, status: "gap" as const, evidence: "" }));
  const proven = map.filter((m) => m.status === "proven").map((m) => m.requirement);
  const note = `I'm applying for the ${input.title} role at ${input.company}.${proven.length ? ` My work covers ${proven.slice(0, 3).join(", ")}, shown in the projects on my resume.` : ""} I'd welcome the chance to talk about how I can help the team.`;
  return { resume: input.resume, map, swaps: [], note };
}
