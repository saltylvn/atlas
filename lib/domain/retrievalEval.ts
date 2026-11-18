// Scoring retrieval on real embeddings.
//
// The CI suite (lib/evals/suites/retrieval.ts) scores keyword search only, because CI
// does not run the embedding model. This scores all three ways on the same fictional
// questions once the vectors are in hand: keyword alone, meaning alone, and the fused
// hybrid that Ask Atlas uses. It also measures how similar a question is to its right
// answer versus how similar an off-topic question is to anything at all, which is what
// a similarity floor has to separate.
//
// Pure: vectors in, numbers out. The embedding calls live in lib/knowledge/liveEval.ts.

import { bm25, cosine, queryTerms, rrf } from "./retrieval";

export interface EvalDoc {
  /** Passage id. */
  id: string;
  /** The record it belongs to; a question names the record that answers it. */
  record: string;
  text: string;
  vector: number[];
}

export interface EvalQuestion {
  question: string;
  expected: string;
  vector: number[];
}

export interface ModeScore {
  /** Right record ranked first. */
  top1: number;
  /** Right record in the first three: the number the CI suite also reports. */
  top3: number;
  /** Mean reciprocal rank: 1 when always first, 0.5 when always second. */
  mrr: number;
}

export interface LiveEvalReport {
  questions: number;
  passages: number;
  keyword: ModeScore;
  meaning: ModeScore;
  hybrid: ModeScore;
  /** Questions the hybrid still misses in its top three. */
  misses: string[];
  similarity: {
    /** Question to the passage that answers it. */
    answerMin: number;
    answerMedian: number;
    /** Off-topic question to its nearest passage. */
    offTopicMax: number;
    offTopicMedian: number;
  };
  /**
   * A floor that keeps every right answer and drops every off-topic match, or null when
   * the two overlap and no single number separates them.
   */
  suggestedFloor: number | null;
}

const DEPTH = 12;
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};

function score(ranks: number[]): ModeScore {
  const n = ranks.length || 1;
  return { top1: ranks.filter((r) => r === 1).length, top3: ranks.filter((r) => r >= 1 && r <= 3).length, mrr: round(ranks.reduce((s, r) => s + (r > 0 ? 1 / r : 0), 0) / n) };
}

export function scoreRetrieval(docs: readonly EvalDoc[], questions: readonly EvalQuestion[], offTopic: readonly number[][]): LiveEvalReport {
  const recordOf = new Map(docs.map((d) => [d.id, d.record]));
  /** 1-based rank of the expected record in a ranked passage list, counting each record once; 0 when absent. */
  const rankOf = (ids: string[], expected: string) => [...new Set(ids.map((id) => recordOf.get(id)!))].indexOf(expected) + 1;
  const nearest = (v: readonly number[]) => docs.map((d) => ({ id: d.id, sim: cosine(v, d.vector) })).sort((a, b) => b.sim - a.sim);

  const kw: number[] = [];
  const sem: number[] = [];
  const hyb: number[] = [];
  const misses: string[] = [];
  const answerSims: number[] = [];
  for (const q of questions) {
    const lexical = bm25(queryTerms(q.question).join(" "), docs).slice(0, DEPTH).map((r) => r.id);
    const near = nearest(q.vector);
    const semantic = near.slice(0, DEPTH).map((r) => r.id);
    const fused = rrf([lexical, semantic]).map((r) => r.id);
    kw.push(rankOf(lexical, q.expected));
    sem.push(rankOf(semantic, q.expected));
    const h = rankOf(fused, q.expected);
    hyb.push(h);
    if (h < 1 || h > 3) misses.push(q.question);
    const best = near.find((r) => recordOf.get(r.id) === q.expected);
    if (best) answerSims.push(best.sim);
  }
  const offSims = offTopic.map((v) => nearest(v)[0]?.sim ?? 0);
  const answerMin = answerSims.length ? Math.min(...answerSims) : 0;
  const offTopicMax = offSims.length ? Math.max(...offSims) : 0;
  return {
    questions: questions.length,
    passages: docs.length,
    keyword: score(kw),
    meaning: score(sem),
    hybrid: score(hyb),
    misses,
    similarity: { answerMin: round(answerMin), answerMedian: round(median(answerSims)), offTopicMax: round(offTopicMax), offTopicMedian: round(median(offSims)) },
    suggestedFloor: offSims.length && answerSims.length && offTopicMax < answerMin ? round((offTopicMax + answerMin) / 2) : null,
  };
}

/** "hybrid 26/26 in the top 3 (keyword 23, meaning 25), MRR 0.94" */
export function liveEvalSummary(r: LiveEvalReport): string {
  return `hybrid ${r.hybrid.top3}/${r.questions} in the top 3 (keyword ${r.keyword.top3}, meaning ${r.meaning.top3}), MRR ${r.hybrid.mrr} (keyword ${r.keyword.mrr}, meaning ${r.meaning.mrr})`;
}
