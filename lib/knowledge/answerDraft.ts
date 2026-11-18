import "server-only";
import { randomUUID } from "node:crypto";
import { logRun, NO_MODEL } from "@/lib/agents/log";
import { tracer } from "@/lib/agents/trace";
import { takeAiCall } from "@/lib/ai/budget";
import { embedTexts, embeddingsConfigured } from "@/lib/ai/embeddings";
import { aiName, structuredWithin } from "@/lib/ai/model";
import type { Usage } from "@/lib/ai/models";
import { bringData, bringTask, BringOut } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import { fitQuery } from "@/lib/domain/jobFit";
import { numbersGrounded } from "@/lib/domain/market";
import { checkCitations, fuse, queryTerms, type Passage } from "@/lib/domain/retrieval";
import type { JobMatch } from "@/lib/domain/types";

// The answer bank's one model call: "what I'd bring" to one job, written by Gemini (or
// Claude) from your own resume passages. Retrieval, then judgment, then a check:
//   - the passages are your resumes only, searched with the job's title and skills;
//   - the draft must cite at least one passage it was given;
//   - every number in it must appear in those passages.
// A draft that fails either check is not shown. It is never stored or sent: you copy it.

export const BRING_TASK = "Draft an application answer";
const MODEL_WAIT_MS = 15_000;

export type BringResult = { ok: true; text: string; passages: Passage[]; cited: number[] } | { ok: false; why: string };

export async function draftBring(ctx: Context, match: JobMatch): Promise<BringResult> {
  const runId = randomUUID();
  const t = tracer();
  let usage: Usage | null = null;
  const finish = async (result: BringResult, detail: string) => {
    await logRun(ctx, {
      runId,
      agent: "career",
      task: BRING_TASK,
      status: "succeeded",
      trigger: "owner",
      // Counts only: the draft itself is shown to you and kept nowhere.
      detail,
      ...(usage ? { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } : NO_MODEL),
      ...t.finish(),
    });
    return result;
  };

  const query = fitQuery(match);
  const embedding = embeddingsConfigured() && ctx.mode === "live" ? await t.step("Embed the job", async () => (await embedTexts([query], 8_000))?.[0] ?? null, (v) => (v ? "embedded" : "embedding unavailable: keyword search only")) : null;
  const lists = await t.step("Search your resumes", () => ctx.store.knowledge.search({ terms: queryTerms(query, 15), embedding, limit: 12, sources: ["resume"] }), (l) => `${l.lexical.length} keyword matches, ${l.semantic.length} by meaning`);
  const passages = fuse(lists, 6, 3);
  if (passages.length === 0) return finish({ ok: false, why: "No resume text is indexed yet, so there is nothing to draft from. Press Index on Ask Atlas." }, "no resume passages");

  const gate = await takeAiCall(ctx.store, ctx.settings, "answer-draft");
  if (!gate.allowed) return finish({ ok: false, why: gate.why.replace(", so the offline drafter ran", "") }, `no draft: ${gate.why}`);

  const res = await t.step(
    "Draft from the passages",
    () => structuredWithin(MODEL_WAIT_MS, BringOut, bringTask(), bringData({ title: match.title, company: match.company, role: match.role, skills: match.skills ?? [] }, passages)),
    (r) => (r.ok ? `${aiName()} cited ${r.value.citations.length}` : `no draft (${r.reason})`),
  );
  usage = res.usage ?? null;
  if (!res.ok) return finish({ ok: false, why: res.reason === "error" && res.status === 429 ? `${aiName()}'s free-tier request limit was reached. Try again in a minute.` : `${aiName()} did not answer. Try again.` }, `no draft (${res.reason})`);

  const cited = checkCitations(res.value.citations, passages.length);
  const text = res.value.text.replace(/\s+/g, " ").trim();
  if (cited.length === 0) return finish({ ok: false, why: "The draft cited none of your resume passages, so it was not shown." }, "draft rejected: no valid citation");
  if (!numbersGrounded([text], passages.map((p) => p.content))) {
    t.note("Check the numbers against the passages", "a number in the draft is not in your resume", false);
    return finish({ ok: false, why: "The draft quoted a number that is not in your resume, so it was not shown." }, "draft rejected: ungrounded number");
  }
  return finish({ ok: true, text, passages, cited }, `draft of ${text.length} characters from ${cited.length} passage${cited.length === 1 ? "" : "s"}, by ${aiName()}`);
}
