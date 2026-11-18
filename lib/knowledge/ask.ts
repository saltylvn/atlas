import "server-only";
import { randomUUID } from "node:crypto";
import { logRun, NO_MODEL } from "@/lib/agents/log";
import { tracer } from "@/lib/agents/trace";
import { takeAiCall } from "@/lib/ai/budget";
import { aiName, structured } from "@/lib/ai/model";
import { embedTexts, embeddingsConfigured } from "@/lib/ai/embeddings";
import type { Usage } from "@/lib/ai/models";
import { answerData, answerTask, AnswerOut } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import { localDate, longDate } from "@/lib/domain/dates";
import { hasFilters, parseFilters } from "@/lib/domain/askFilters";
import { SOURCE_LABEL } from "@/lib/domain/knowledge";
import { checkCitations, fuse, passagesAnswer, queryTerms, type Answer, type Passage } from "@/lib/domain/retrieval";

// Ask Atlas: one question, answered from your own data.
//
//   1. Retrieve   the question is embedded and searched two ways at once: by its words
//                 (Postgres full-text search) and by its meaning (pgvector).
//   2. Fuse       the two rankings are merged (reciprocal rank fusion) and the best few
//                 passages are kept.
//   3. Answer     with AI on, Claude writes a short answer from those passages only and
//                 says which ones it used. With AI off, or if the call fails, the
//                 closest passages are quoted instead. Either way you see the sources.
//
// "Claude" below means the configured model: Claude or Gemini (lib/ai/model.ts).
//
// The answer is display-only: it is plain text, it triggers nothing, and its citations
// are checked against what was actually retrieved. Links are built by Atlas from the
// record's kind, never taken from a model or from the data.

/** The activity-log task name. The log holds counts and timings, never the question or the answer. */
export const ASK_TASK = "Answer a question";

export interface AskResult {
  answer: Answer;
  passages: Passage[];
  /** hybrid: words and meaning. keyword: words only (demo mode, or embeddings unavailable). */
  search: "hybrid" | "keyword";
  /** Why Claude did not write the answer, when it did not. */
  note: string;
  /** Who writes answers here: "Claude", "Gemini", or "AI" when no key is set. */
  writer: string;
  /** The filter read from the question and applied ("emails, last week"), or "". */
  narrowed: string;
  tookMs: number;
}

const WHY: Record<string, string> = {
  not_configured: "No AI key is set, so the closest passages are shown.",
  refused: "The model declined to answer, so the closest passages are shown.",
  invalid: "The model's reply could not be checked, so the closest passages are shown.",
  error: "The model could not be reached, so the closest passages are shown.",
};

export async function ask(ctx: Context, question: string): Promise<AskResult> {
  const runId = randomUUID();
  const t = tracer();
  let usage: Usage | null = null;
  try {
    const terms = queryTerms(question);
    const embedding = embeddingsConfigured() && ctx.mode === "live" ? await t.step("Embed the question", async () => (await embedTexts([question], 8_000))?.[0] ?? null, (v) => (v ? "gte-small, 384 numbers" : "embedding unavailable: keyword search only")) : null;
    const filters = parseFilters(question, ctx.today, ctx.settings.timezone);
    let narrowed = hasFilters(filters) ? filters.label : "";
    let lists = await t.step(
      "Search by words and by meaning",
      () => ctx.store.knowledge.search({ terms, embedding, limit: 12, sources: filters.sources, since: filters.since, until: filters.until }),
      (l) => `${l.lexical.length} keyword matches, ${l.semantic.length} by meaning${narrowed ? ` (narrowed to ${narrowed})` : ""}`,
    );
    let passages = fuse(lists);
    if (passages.length === 0 && narrowed) {
      // The filter was a guess from the wording. Nothing matched inside it: search everything.
      lists = await t.step("Search again without the filter", () => ctx.store.knowledge.search({ terms, embedding, limit: 12 }), (l) => `${l.lexical.length} keyword matches, ${l.semantic.length} by meaning`);
      passages = fuse(lists);
      narrowed = "";
    }
    t.note("Fuse the two rankings", `${passages.length} passages kept from ${new Set(passages.map((p) => `${p.source}:${p.sourceId}`)).size} records`);
    const search = embedding ? "hybrid" : "keyword";

    let answer = passagesAnswer(question, passages);
    let note = "";
    if (passages.length > 0) {
      const gate = await takeAiCall(ctx.store, ctx.settings, "ask");
      if (!gate.allowed) note = gate.why.replace("so the offline drafter ran", "so the closest passages are shown");
      else {
        const res = await t.step(
          "Write the answer from the passages",
          () =>
            structured(
              AnswerOut,
              answerTask(question, `${longDate(ctx.today)} ${ctx.today.slice(0, 4)} (${ctx.today})`),
              answerData(passages.map((p) => ({ n: p.n, kind: SOURCE_LABEL[p.source], date: p.occurredAt ? localDate(new Date(p.occurredAt), ctx.settings.timezone) : "", title: p.title, content: p.content }))),
            ),
          (r) => (r.ok ? `${r.value.found ? "answered" : "not in the passages"}, cites ${r.value.citations.length}` : `no answer (${r.reason})`),
        );
        usage = res.usage ?? null;
        if (res.ok) {
          const citations = checkCitations(res.value.citations, passages.length);
          // An answer that claims to be found but rests on no retrieved passage is not shown as one.
          if (res.value.found && citations.length === 0) note = "The model's answer cited no passage, so the closest passages are shown.";
          else answer = { mode: "model", found: res.value.found, text: res.value.answer, citations };
        } else note = res.reason === "error" && res.status === 429 ? `${aiName()}'s request limit was reached, so the closest passages are shown. Try again in a minute.` : (WHY[res.reason] ?? WHY.error!);
      }
    }

    const done = t.finish();
    await logRun(ctx, {
      runId,
      agent: "chief-of-staff",
      task: ASK_TASK,
      status: "succeeded",
      trigger: "owner",
      detail: `${search} search, ${passages.length} passages, ${answer.mode === "model" ? (answer.found ? `answered by ${aiName()}` : `${aiName()} found no answer`) : "passages shown"}`,
      ...(usage ? { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } : NO_MODEL),
      ...done,
    });
    return { answer, passages, search, note, writer: aiName(), narrowed, tookMs: done.durationMs };
  } catch (err) {
    await logRun(ctx, { runId, agent: "chief-of-staff", task: ASK_TASK, status: "failed", trigger: "owner", detail: (err as Error).message?.slice(0, 200) || "unknown error", ...NO_MODEL, ...t.finish() });
    throw err;
  }
}
