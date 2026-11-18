import "server-only";
import { randomUUID } from "node:crypto";
import { logRun, NO_MODEL } from "@/lib/agents/log";
import { embedTexts, embeddingsConfigured, EMBED_MODEL } from "@/lib/ai/embeddings";
import type { Context } from "@/lib/context";
import { embedText, toChunks } from "@/lib/domain/knowledge";
import { embedInOrder } from "@/lib/knowledge/embedInOrder";
import { liveEvalSummary, scoreRetrieval, type LiveEvalReport } from "@/lib/domain/retrievalEval";
import { EVAL_CORPUS, EVAL_OFF_TOPIC, EVAL_QUESTIONS } from "@/lib/evals/suites/retrieval";

// The live retrieval eval: the same fictional corpus and questions as the CI suite, but
// embedded by the real model, so keyword, meaning and hybrid search are scored side by
// side. Nothing of yours is read and nothing is stored: the vectors live in memory for
// the length of the run, and only the scores are logged.

/** The activity-log task name. */
export const LIVE_EVAL_TASK = "Retrieval eval (live embeddings)";

/** Leaves room to log the result inside the request's 60 seconds. */
const EMBED_WINDOW_MS = 45_000;

export type LiveEvalOutcome = { ok: true; report: LiveEvalReport; tookMs: number } | { ok: false; why: string };

export async function runLiveEval(ctx: Pick<Context, "store" | "mode">): Promise<LiveEvalOutcome> {
  if (ctx.mode !== "live" || !embeddingsConfigured()) return { ok: false, why: "Embeddings are not set up here, so there is nothing live to score. The keyword scores above still apply." };
  const started = Date.now();
  const runId = randomUUID();
  const chunks = toChunks(EVAL_CORPUS);
  const texts = [...chunks.map(embedText), ...EVAL_QUESTIONS.map(([q]) => q), ...EVAL_OFF_TOPIC];
  // One small request at a time: parallel requests share a worker and trip its CPU limit.
  const vectors = await embedInOrder(texts, (batch) => embedTexts(batch, 15_000), { deadline: started + EMBED_WINDOW_MS });
  if (!vectors || vectors.length !== texts.length) {
    await logRun(ctx, { runId, agent: "chief-of-staff", task: LIVE_EVAL_TASK, status: "failed", trigger: "owner", detail: "The embedding function did not answer", ...NO_MODEL, durationMs: Date.now() - started });
    return { ok: false, why: "The embedding function did not answer. Try again in a minute." };
  }
  const docs = chunks.map((c, i) => ({ id: `${c.source}:${c.sourceId}:${c.chunkIndex}`, record: c.sourceId, text: `${c.title} ${c.content}`, vector: vectors[i]! }));
  const questions = EVAL_QUESTIONS.map(([question, expected], i) => ({ question, expected, vector: vectors[chunks.length + i]! }));
  const report = scoreRetrieval(docs, questions, vectors.slice(chunks.length + questions.length));
  const tookMs = Date.now() - started;
  const s = report.similarity;
  await logRun(ctx, {
    runId,
    agent: "chief-of-staff",
    task: LIVE_EVAL_TASK,
    status: "succeeded",
    trigger: "owner",
    detail: liveEvalSummary(report),
    ...NO_MODEL,
    durationMs: tookMs,
    trace: [
      { name: "Embed the fictional corpus and questions", ms: tookMs, ok: true, note: `${texts.length} texts with ${EMBED_MODEL}` },
      { name: "Keyword search alone", ms: 0, ok: true, note: `top 1: ${report.keyword.top1}, top 3: ${report.keyword.top3} of ${report.questions}, MRR ${report.keyword.mrr}` },
      { name: "Meaning search alone", ms: 0, ok: true, note: `top 1: ${report.meaning.top1}, top 3: ${report.meaning.top3} of ${report.questions}, MRR ${report.meaning.mrr}` },
      { name: "Hybrid (fused)", ms: 0, ok: report.misses.length === 0, note: `top 1: ${report.hybrid.top1}, top 3: ${report.hybrid.top3} of ${report.questions}, MRR ${report.hybrid.mrr}${report.misses.length ? `. Missed: ${report.misses.join("; ")}` : ""}` },
      { name: "Similarity: right answers vs off-topic", ms: 0, ok: true, note: `answers min ${s.answerMin}, median ${s.answerMedian}; off-topic max ${s.offTopicMax}, median ${s.offTopicMedian}; suggested floor ${report.suggestedFloor ?? "none (they overlap)"}` },
    ],
  });
  return { ok: true, report, tookMs };
}
