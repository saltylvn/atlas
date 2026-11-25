// Rerank (docs/AGENT-ARCHITECTURE.md, lever 2): after keyword and meaning search are fused,
// keep only the few passages that best answer one requirement. Rules, no AI (owner's choice,
// 23 Nov 2026): the fused score, plus how many of the requirement's own terms a passage names,
// plus a little for recency. A model rerank comes only if evals show it helps. Pure.

import type { Passage } from "./retrieval";

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").split(" ").filter((w) => w.length > 1));
const STOP = new Set(["and", "or", "the", "of", "to", "in", "with", "for", "on", "a", "an", "experience", "years", "using", "work", "working"]);

/** The requirement's meaningful terms ("3+ years of TypeScript and React" -> typescript, react). */
export function requirementTerms(requirement: string): string[] {
  return [...words(requirement)].filter((w) => !STOP.has(w) && !/^\d+\+?$/.test(w));
}

export interface Ranked extends Passage {
  rerank: number;
  /** The requirement's terms this passage names. */
  matched: string[];
}

/** The `keep` passages that best answer `requirement`, best first. A passage naming none of its terms ranks below every one that names some. */
export function rerankPassages(passages: readonly Passage[], requirement: string, today: string, keep = 3): Ranked[] {
  const terms = requirementTerms(requirement);
  return passages
    .map((p) => {
      const have = words(`${p.title} ${p.content}`);
      const matched = terms.filter((t) => have.has(t));
      const coverage = terms.length ? matched.length / terms.length : 0;
      const ageDays = p.occurredAt ? Math.max(0, (Date.parse(today) - Date.parse(p.occurredAt)) / 86_400_000) : 365;
      const recency = Math.max(0, 1 - ageDays / 730);
      return { ...p, matched, rerank: (matched.length > 0 ? 1 : 0) + coverage * 2 + p.score + recency * 0.2 };
    })
    .sort((a, b) => b.rerank - a.rerank)
    .slice(0, keep);
}
