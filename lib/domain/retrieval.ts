// Ask Atlas, part 2: finding the right passages.
//
// Retrieval is hybrid. Two rankers look at the question:
//   keyword   which passages share its words (Postgres full-text search live, BM25 here
//             for demo mode and the evals)
//   meaning   which passages are closest to it as embeddings (pgvector), so "what do I
//             owe" finds "premium due" with no word in common
// Their two ranked lists are merged with reciprocal rank fusion: a passage near the top
// of either list scores well, one near the top of both scores best. Fusion needs only
// ranks, so the two rankers' very different scores never have to be compared.
//
// Pure: no I/O. The live store returns the two ranked lists; everything after that
// (fusion, picking passages, checking citations, the no-model answer) is this file.

import type { KnowledgeSource } from "./knowledge";

const STOP = new Set(
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our should so than that the their them then there these they this to was we were what when where which who whom why will with would you your about after again all also am any because before being between both did doing down during each few further here more most no nor not now off once only other out over own same some such too under until up very s t just than tell show give find list anything something"
    .split(" "),
);

/** Lowercase words with accents folded and punctuation dropped; stop words removed. */
export function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && w.length <= 40 && !STOP.has(w));
}

/** A small, cautious stemmer: plurals and -ing/-ed, so "interviews" meets "interview". */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es") && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}

export const tokenize = (text: string): string[] => words(text).map(stem);

/**
 * The question's search words for Postgres: unique, letters and digits only, at most
 * `max`. They are joined with OR (any word may match; passages matching more rank
 * higher), because a question is not a list of required words.
 */
export function queryTerms(question: string, max = 12): string[] {
  return [...new Set(words(question))].slice(0, max);
}

/** "interview | acme": the only shape the search function accepts. */
export const toTsQuery = (terms: readonly string[]): string => terms.filter((t) => /^[a-z0-9]+$/.test(t)).join(" | ");

export interface Ranked {
  id: string;
  score: number;
}

/** BM25, the standard keyword ranker: rare words count more, long passages are not favored. */
export function bm25(query: string, docs: readonly { id: string; text: string }[], k1 = 1.2, b = 0.75): Ranked[] {
  const q = [...new Set(tokenize(query))];
  if (q.length === 0 || docs.length === 0) return [];
  const tokens = docs.map((d) => tokenize(d.text));
  const avgLen = tokens.reduce((n, t) => n + t.length, 0) / docs.length || 1;
  const df = new Map<string, number>();
  for (const t of tokens) for (const term of new Set(t)) df.set(term, (df.get(term) ?? 0) + 1);
  const out: Ranked[] = [];
  docs.forEach((d, i) => {
    const t = tokens[i]!;
    const tf = new Map<string, number>();
    for (const term of t) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of q) {
      const f = tf.get(term);
      if (!f) continue;
      const n = df.get(term) ?? 0;
      const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * t.length) / avgLen));
    }
    if (score > 0) out.push({ id: d.id, score });
  });
  return out.sort((x, y) => y.score - x.score);
}

/** The usual constant: large enough that one list's first place cannot drown out agreement. */
export const RRF_K = 60;

/** Reciprocal rank fusion of ranked id lists (best first). */
export function rrf(lists: readonly (readonly string[])[], k: number = RRF_K): Ranked[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].map(([id, s]) => ({ id, score: s })).sort((a, b) => b.score - a.score);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** A passage a search returned. */
export interface Hit {
  id: string;
  source: KnowledgeSource;
  sourceId: string;
  chunkIndex: number;
  title: string;
  content: string;
  href: string;
  occurredAt: string | null;
  /** Cosine similarity to the question (0 to 1), on hits from the meaning search. */
  similarity?: number;
}

export interface SearchLists {
  /** Best keyword matches, best first. */
  lexical: Hit[];
  /** Nearest by meaning, best first. Empty when embeddings are not available. */
  semantic: Hit[];
}

export interface Passage extends Hit {
  /** 1-based number the answer cites. */
  n: number;
  /** Where it placed in each list (1 = best), or null when that ranker did not return it. */
  lexicalRank: number | null;
  semanticRank: number | null;
  score: number;
}

export const MAX_PASSAGES = 6;

/**
 * The meaning search always returns its nearest passages, however far away they are, so
 * an off-topic question would still get six "sources". A match below this similarity is
 * dropped before fusion. 0 = no floor.
 *
 * Measured by the live retrieval eval on 2026-11-14 (gte-small, 26 questions, 6 off-topic):
 *   right answers   lowest 0.786, typical 0.871
 *   off-topic       highest 0.774, typical 0.763
 * The gap is narrow (0.012), so the floor sits just above the highest off-topic match
 * instead of in the middle: a right answer that is dropped is lost, while a weak passage
 * that is kept still has to get past keyword agreement and the model's own "not found".
 * Run the eval again before moving it, and after changing the embedding model.
 */
export const SEMANTIC_FLOOR = 0.775;

/** The meaning hits worth keeping. A hit with no similarity (older data, demo) is kept. */
export function aboveFloor<T extends { similarity?: number }>(hits: readonly T[], floor: number = SEMANTIC_FLOOR): T[] {
  return hits.filter((h) => h.similarity === undefined || h.similarity >= floor);
}

/**
 * Fuses the two lists and picks the passages an answer may use: the best `limit`, with
 * at most `perRecord` from any one record so a long brief cannot fill every slot.
 */
export function fuse(lists: SearchLists, limit: number = MAX_PASSAGES, perRecord = 2, floor: number = SEMANTIC_FLOOR): Passage[] {
  const semantic = aboveFloor(lists.semantic, floor);
  const byId = new Map<string, Hit>();
  // Meaning hits first, so a passage found both ways keeps its similarity.
  for (const h of [...semantic, ...lists.lexical]) if (!byId.has(h.id)) byId.set(h.id, h);
  const lex = lists.lexical.map((h) => h.id);
  const sem = semantic.map((h) => h.id);
  const taken = new Map<string, number>();
  const out: Passage[] = [];
  for (const r of rrf([lex, sem])) {
    const h = byId.get(r.id)!;
    const record = `${h.source}:${h.sourceId}`;
    const count = taken.get(record) ?? 0;
    if (count >= perRecord) continue;
    taken.set(record, count + 1);
    const l = lex.indexOf(r.id);
    const s = sem.indexOf(r.id);
    out.push({ ...h, n: out.length + 1, lexicalRank: l < 0 ? null : l + 1, semanticRank: s < 0 ? null : s + 1, score: r.score });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Keeps only citations that point at a passage that was really retrieved: whole
 * numbers from 1 to `count`, each once, in the order given. A model can only ever
 * cite what the search handed it.
 */
export function checkCitations(citations: readonly number[], count: number): number[] {
  const out: number[] = [];
  for (const c of citations) if (Number.isInteger(c) && c >= 1 && c <= count && !out.includes(c)) out.push(c);
  return out;
}

/** The sentences of a passage that share the most words with the question, in reading order. */
export function bestSentences(question: string, text: string, max = 2): string {
  const q = new Set(tokenize(question));
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length <= max) return text;
  const scored = sentences.map((s, i) => ({ s, i, hits: new Set(tokenize(s).filter((t) => q.has(t))).size }));
  const top = [...scored].sort((a, b) => b.hits - a.hits || a.i - b.i).slice(0, max);
  if (top.every((t) => t.hits === 0)) return sentences.slice(0, max).join(" ");
  return top.sort((a, b) => a.i - b.i).map((t) => t.s).join(" ");
}

export interface Answer {
  /** model: written by the model (Claude or Gemini) from the passages. passages: no model ran; the closest passages are shown. */
  mode: "model" | "passages";
  /** False when nothing in the index answers the question. */
  found: boolean;
  text: string;
  /** Passage numbers the answer rests on. */
  citations: number[];
}

/**
 * The answer with no model: nothing is written, the best-matching lines of the top
 * passages are quoted. Used in demo mode, when AI is off, and when a model call fails.
 */
export function passagesAnswer(question: string, passages: readonly Passage[], max = 3): Answer {
  if (passages.length === 0) {
    return { mode: "passages", found: false, text: "Nothing in your Atlas data matches that yet. Try other words, or index again if you just added it.", citations: [] };
  }
  const top = passages.slice(0, max);
  return {
    mode: "passages",
    found: true,
    text: top.map((p) => `[${p.n}] ${p.title}. ${bestSentences(question, p.content)}`).join("\n"),
    citations: top.map((p) => p.n),
  };
}
