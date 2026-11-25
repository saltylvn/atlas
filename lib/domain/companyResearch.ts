// The Researcher's rules (24 Nov 2026; docs/AGENT-ARCHITECTURE.md). For one job in
// the Apply Queue the agent (lib/agents/companyResearch.ts) looks the company up on the public
// web, choosing its own next search or page, and writes a brief in which every line cites a
// fact it actually read. This file holds the parts that are code. Pure.
//
//   RESEARCH_LIMITS  what one run may spend: searches, pages, steps, AI calls
//   pageFacts        the few plain sentences kept from a page it read (untrusted text, as data)
//   reviewResearch   the review in code: every item cites a fact it read, numbers included
//   readyJobs        which queued jobs are fully prepared, for the morning card

import { z } from "zod";
import { numbersIn } from "./careerMap";

/** One run's budget. Searches and pages count against Firecrawl's free plan; calls against the daily AI cap. */
export const RESEARCH_LIMITS = { searches: 3, pages: 3, steps: 12, calls: 8 } as const;

export interface Fact {
  /** "f3" (the job), "n1" (a headline), "s2" (a search result), "p4" (a sentence from a page it read). */
  id: string;
  text: string;
}

const Item = z.object({ text: z.string().min(8).max(400), cites: z.array(z.string().max(6)).min(1).max(4) });
export type ResearchItem = z.infer<typeof Item>;

/** What the agent hands back: each line with the ids of the facts it rests on. */
export const ResearchOut = z.object({
  /** What the company does and how it is doing, from what was read. */
  about: z.array(Item).max(4),
  whyThem: z.array(Item).max(4),
  yourAngle: z.array(Item).max(4),
  questions: z.array(Item).max(4),
});
export type ResearchOut = z.infer<typeof ResearchOut>;

export function parseResearchOut(answer: string | undefined): ResearchOut | null {
  if (!answer) return null;
  try {
    const p = ResearchOut.safeParse(JSON.parse(answer));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

const LINK_OR_MARKUP = /https?:\/\/|www\.|[<>*_`#[\]]/i;

/** Why one line cannot stand, or "" when it can: it must cite facts that exist, state no number they lack, and carry no link or markup. */
export function itemProblem(item: ResearchItem, facts: ReadonlyMap<string, string>): string {
  const known = item.cites.filter((c) => facts.has(c));
  if (known.length === 0) return `"${item.text.slice(0, 60)}" cites nothing that was read (${item.cites.join(", ") || "no ids"}).`;
  if (LINK_OR_MARKUP.test(item.text)) return `"${item.text.slice(0, 60)}" has a link or markup: plain words only.`;
  const allowed = new Set(known.flatMap((c) => numbersIn(facts.get(c)!)));
  const extra = numbersIn(item.text).filter((n) => !allowed.has(n));
  return extra.length ? `"${item.text.slice(0, 60)}" states ${extra.join(", ")}, which is not in the facts it cites.` : "";
}

export interface ResearchReview {
  pass: boolean;
  notes: string;
}

/** True for a fact that came from outside the job posting: a headline, a search result or a page. */
const fromTheWeb = (id: string) => /^[nsp]\d+$/.test(id);

/**
 * The review in code. Every line cites facts that were read and states no number they lack; there
 * is something in each of why them, your angle and questions; and "about" rests on the web, not
 * only on the posting (when the web gave anything at all).
 */
export function reviewResearch(out: ResearchOut, facts: readonly Fact[]): ResearchReview {
  const byId = new Map(facts.map((f) => [f.id, f.text]));
  const problems = [...out.about, ...out.whyThem, ...out.yourAngle, ...out.questions].map((i) => itemProblem(i, byId)).filter(Boolean);
  if (out.whyThem.length === 0) problems.push("Give at least one reason this company, citing a fact.");
  if (out.yourAngle.length === 0) problems.push("Give at least one line on the person's angle, citing a fact.");
  if (out.questions.length === 0) problems.push("Give at least one question to ask them, citing a fact.");
  const webRead = facts.some((f) => fromTheWeb(f.id));
  if (webRead && !out.about.some((i) => i.cites.some(fromTheWeb))) problems.push("Say what the company does in \"about\", citing a headline, search result or page you read.");
  if (!webRead && out.about.length > 0) problems.push("Nothing was read from the web, so leave \"about\" empty rather than guess.");
  return { pass: problems.length === 0, notes: problems.slice(0, 5).join(" ") };
}

/** Drops the lines that cannot stand, for the version saved when the budget runs out mid-revision. */
export function keepSound(out: ResearchOut, facts: readonly Fact[]): { out: ResearchOut; dropped: number } {
  const byId = new Map(facts.map((f) => [f.id, f.text]));
  let dropped = 0;
  const keep = (items: readonly ResearchItem[]) =>
    items
      .filter((i) => {
        const ok = !itemProblem(i, byId);
        if (!ok) dropped++;
        return ok;
      })
      .slice(0, 3)
      .map((i) => ({ text: i.text.replace(/\s+/g, " ").trim(), cites: [...new Set(i.cites.filter((c) => byId.has(c)))] }));
  return { out: { about: keep(out.about), whyThem: keep(out.whyThem), yourAngle: keep(out.yourAngle), questions: keep(out.questions) }, dropped };
}

/**
 * The sentences kept from a page: plain, complete, of a readable length, and at most `max`.
 * A page is untrusted text: these are stored and shown as data, and never followed.
 */
export function pageFacts(text: string, max = 5): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < 40 || s.length > 260) continue;
    if (!/^[A-Z0-9"'(]/.test(s) || LINK_OR_MARKUP.test(s)) continue;
    // Navigation, cookie and sign-up text is not a fact about the company.
    if (/\b(cookie|cookies|subscribe|sign up|sign in|log in|privacy policy|terms of (use|service)|all rights reserved|javascript)\b/i.test(s)) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** A search the agent may run: about this company, short, and with nothing that reaches for a person's private details. */
export function searchProblem(query: string, company: string): string {
  const q = query.trim();
  if (q.length < 4 || q.length > 120) return "Use a short search of a few words.";
  const name = company.toLowerCase().split(/\s+/)[0] ?? "";
  if (name.length >= 3 && !q.toLowerCase().includes(name)) return `Search about ${company}: include its name.`;
  if (/\b(home address|phone number|salary of|net worth|wife|husband|girlfriend|boyfriend|family|age)\b/i.test(q)) return "Search for the company, its product, its engineering team and its news: not a person's private details.";
  return "";
}

// ---------------------------------------------------------------------------
// The morning card: which queued jobs are fully prepared

export interface ReadyJob {
  kitId: string;
  title: string;
  url: string;
  researched: boolean;
  /** Proven must-haves of all, when Pitch has tailored it. */
  pitch: { proven: number; of: number } | null;
}

/**
 * Today's picks with what is prepared for each, most prepared first (the order of the picks
 * breaks ties): the jobs to open first are the ones with research and a tailored packet waiting.
 */
export function readyJobs(picks: readonly { kitId: string; title: string; url: string }[], researched: ReadonlySet<string>, pitched: ReadonlyMap<string, { proven: number; of: number }>): ReadyJob[] {
  const rows = picks.map((p, i) => ({ i, job: { kitId: p.kitId, title: p.title, url: p.url, researched: researched.has(p.kitId), pitch: pitched.get(p.kitId) ?? null } }));
  const rank = (j: ReadyJob) => (j.researched ? 1 : 0) + (j.pitch ? 1 : 0);
  return rows.sort((a, b) => rank(b.job) - rank(a.job) || a.i - b.i).map((r) => r.job);
}
