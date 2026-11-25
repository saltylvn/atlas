// The Follow-up agent's rules (24 Nov 2026; docs/AGENT-ARCHITECTURE.md). For an application quiet
// for a week, the agent (lib/agents/followUp.ts) writes the follow-up a good candidate would: one
// specific, true reason to reply, drawn from the company research or the tailored pitch Atlas
// already saved, addressed to a person when Atlas knows one. You send it yourself. Pure.
//
//   FollowUpAgentOut   what the agent hands back: subject, body, and the hook with its citations
//   reviewFollowUp     the review in code: the existing follow-up rules, plus a cited, used hook
//   nightPicks         which waiting follow-ups the night shift rewrites, oldest first
//   followUpReplies    the measure: replies heard within a week of a follow-up you sent

import { z } from "zod";
import { numbersIn } from "./careerMap";
import { acceptPolish, type FollowUp } from "./careerPrep";
import { itemProblem, type Fact } from "./companyResearch";
import { daysBetween } from "./dates";
import type { Application, Approval, LocalDate } from "./types";

/** One run's budget: steps of the loop and calls against the daily AI cap. */
export const FOLLOWUP_LIMITS = { steps: 10, calls: 6 } as const;
/** Follow-ups the night shift rewrites in one night, at most. */
export const NIGHT_FOLLOWUPS = 2;
/** The body's length in words: long enough to say something, short enough to be read. */
export const WORDS = { min: 50, max: 120 } as const;

export const FollowUpAgentOut = z.object({
  subject: z.string().min(8).max(110),
  body: z.string().min(120).max(1100),
  /** The one specific reason to reply, and the facts it rests on. */
  hook: z.object({ text: z.string().min(12).max(300), cites: z.array(z.string().max(6)).min(1).max(3) }),
});
export type FollowUpAgentOut = z.infer<typeof FollowUpAgentOut>;

export function parseFollowUpOut(answer: string | undefined): FollowUpAgentOut | null {
  if (!answer) return null;
  try {
    const p = FollowUpAgentOut.safeParse(JSON.parse(answer));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

const words = (s: string): string[] => [...(s.toLowerCase().match(/[a-z']+/g) ?? [])];

/** The greeting a follow-up opens with: the person's first name when Atlas knows them, else "Hi,". */
export const greeting = (person: string | null) => {
  const first = (person ?? "").trim().split(/\s+/)[0]?.replace(/[^A-Za-z'-]/g, "") ?? "";
  return first.length >= 2 ? `Hi ${first},` : "Hi,";
};

/**
 * The review in code. Everything the existing follow-up rules check (company and role named,
 * your name at the end, no link, email address, placeholder, doubled word or new number), plus:
 * the hook cites facts that were read and states no number they lack; the body actually uses
 * the hook; it opens with the right greeting; and it is 50 to 120 words.
 */
export function reviewFollowUp(
  out: FollowUpAgentOut,
  facts: readonly Fact[],
  base: { draft: FollowUp; company: string; role: string; name: string; person: string | null },
): { pass: boolean; notes: string; mail: FollowUp | null } {
  const byId = new Map(facts.map((f) => [f.id, f.text]));
  const problems: string[] = [];
  const hookProblem = itemProblem(out.hook, byId);
  if (hookProblem) problems.push(`The hook: ${hookProblem}`);
  const cited = out.hook.cites.filter((c) => byId.has(c)).flatMap((c) => numbersIn(byId.get(c)!)).map((n) => n.replace(/[^\d]/g, "")).filter(Boolean);
  const mail = acceptPolish(base.draft, { subject: out.subject, body: out.body }, { company: base.company, role: base.role, name: base.name }, cited);
  if (!mail) problems.push(`Keep the company (${base.company})${base.role ? `, the role (${base.role})` : ""} and end with "${base.name}"; no links, email addresses, placeholders, doubled words or numbers the facts lack; 35 to 130 words.`);
  const body = mail?.body ?? out.body;
  const n = words(body).length;
  if (n < WORDS.min || n > WORDS.max) problems.push(`Write ${WORDS.min} to ${WORDS.max} words; this is ${n}.`);
  const hookWords = [...new Set(words(out.hook.text).filter((w) => w.length > 4))];
  const used = hookWords.filter((w) => words(body).includes(w)).length;
  if (hookWords.length > 0 && used < Math.min(3, hookWords.length)) problems.push("Use the hook in the email itself: say the specific thing, not a general line.");
  const hello = greeting(base.person);
  if (!body.trim().startsWith(hello)) problems.push(`Open with "${hello}".`);
  return { pass: problems.length === 0, notes: problems.slice(0, 4).join(" "), mail: problems.length === 0 ? mail : null };
}

/** Waiting follow-ups the agent has not written yet, oldest first: what the night shift rewrites. */
export function nightPicks(approvals: readonly Pick<Approval, "id" | "kind" | "status" | "createdAt">[], written: ReadonlySet<string>, max = NIGHT_FOLLOWUPS): string[] {
  return approvals
    .filter((a) => a.kind === "follow-up" && a.status === "pending" && !written.has(a.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, max)
    .map((a) => a.id);
}

/**
 * The measure of whether follow-ups work: of the follow-ups you marked sent at least a week ago
 * (or since), how many applications heard back within 7 days. `agent` splits them by who wrote them.
 */
export function followUpReplies(
  approvals: readonly Pick<Approval, "id" | "kind" | "status" | "decidedAt" | "applicationId">[],
  apps: readonly Pick<Application, "id" | "lastHeardAt">[],
  agentWritten: ReadonlySet<string>,
  today: LocalDate,
): { sent: number; replied: number; agent: { sent: number; replied: number } } {
  const heard = new Map(apps.map((a) => [a.id, a.lastHeardAt ?? null]));
  const out = { sent: 0, replied: 0, agent: { sent: 0, replied: 0 } };
  for (const a of approvals) {
    if (a.kind !== "follow-up" || a.status !== "approved" || !a.decidedAt || !a.applicationId) continue;
    const sentOn = a.decidedAt.slice(0, 10);
    const h = heard.get(a.applicationId) ?? null;
    const replied = Boolean(h && h >= a.decidedAt && daysBetween(sentOn, h.slice(0, 10)) <= 7);
    // A follow-up sent less than a week ago and not yet answered is still open: not counted yet.
    if (!replied && daysBetween(sentOn, today) < 7) continue;
    out.sent++;
    if (replied) out.replied++;
    if (agentWritten.has(a.id)) {
      out.agent.sent++;
      if (replied) out.agent.replied++;
    }
  }
  return out;
}
