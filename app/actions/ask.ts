"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getContext } from "@/lib/context";
import type { Answer, Passage } from "@/lib/domain/retrieval";
import { ask } from "@/lib/knowledge/ask";
import type { LiveEvalReport } from "@/lib/domain/retrievalEval";
import { indexKnowledge, type IndexOutcome } from "@/lib/knowledge/indexer";
import { runLiveEval } from "@/lib/knowledge/liveEval";
import { rateLimit } from "@/lib/security/rateLimit";
import type { ActionResult } from "./_shared";

const Question = z
  .string()
  .trim()
  .min(3, "Ask a fuller question")
  .max(300, "Keep it under 300 characters");

export interface AskReply {
  question: string;
  answer: Answer;
  passages: Passage[];
  search: "hybrid" | "keyword";
  note: string;
  writer: string;
  narrowed: string;
  tookMs: number;
}

/** Answers one question from the owner's own indexed data. Display-only: it changes nothing. */
export async function askAtlas(question: string): Promise<ActionResult<AskReply>> {
  const p = Question.safeParse(question);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Bad input" };
  const ctx = await getContext();
  if (!rateLimit("ask", 20, 60_000).allowed) return { ok: false, error: "That is a lot of questions. Try again in a minute." };
  try {
    const r = await ask(ctx, p.data);
    return { ok: true, data: { question: p.data, ...r } };
  } catch {
    return { ok: false, error: "The search did not finish. Try again." };
  }
}

/**
 * Brings the index up to date and embeds the next batch of passages. The page calls it
 * again while passages are still waiting, so a first-time index finishes in a few rounds.
 */
export async function indexNow(): Promise<ActionResult<IndexOutcome>> {
  const ctx = await getContext();
  if (!rateLimit("ask-index", 40, 10 * 60_000).allowed) return { ok: false, error: "Indexed a lot just now. Try again in a few minutes." };
  try {
    const outcome = await indexKnowledge(ctx.store, ctx.settings.timezone, ctx.now, { embedBudget: 64, deadline: Date.now() + 25_000 });
    revalidatePath("/ask");
    return { ok: true, data: outcome };
  } catch {
    return { ok: false, error: "The index could not be updated. Try again." };
  }
}

/**
 * Scores keyword, meaning and hybrid search on the fictional eval corpus with the real
 * embedding model. Reads none of the owner's data and stores only the scores.
 */
export async function runRetrievalEval(): Promise<ActionResult<{ report: LiveEvalReport; tookMs: number }>> {
  const ctx = await getContext();
  if (!rateLimit("ask-live-eval", 6, 10 * 60_000).allowed) return { ok: false, error: "Ran it a few times just now. Try again in a few minutes." };
  try {
    const r = await runLiveEval(ctx);
    if (!r.ok) return { ok: false, error: r.why };
    revalidatePath("/evals");
    return { ok: true, data: { report: r.report, tookMs: r.tookMs } };
  } catch {
    return { ok: false, error: "The eval did not finish. Try again." };
  }
}
