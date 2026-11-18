import "server-only";
import { randomUUID } from "node:crypto";
import { logRun, NO_MODEL } from "@/lib/agents/log";
import { tracer } from "@/lib/agents/trace";
import { takeAiCall } from "@/lib/ai/budget";
import { embedTexts, embeddingsConfigured } from "@/lib/ai/embeddings";
import { aiName, structured } from "@/lib/ai/model";
import type { Usage } from "@/lib/ai/models";
import { fitData, fitTask, FitOut } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import { bestResume, fitQuery, resumeName, rulesFit, type JobFit } from "@/lib/domain/jobFit";
import { checkCitations, fuse, queryTerms, type Passage } from "@/lib/domain/retrieval";
import type { JobMatch } from "@/lib/domain/types";

// Career Agent: "how do I fit this job, and which resume do I send?"
//
// Retrieval, then judgment. The job's title and skills are searched against your resume
// passages only (hybrid search). With AI on, the model words the fit from those passages
// and is checked against them; otherwise the skill overlap is computed by rules. It
// drafts nothing and sends nothing: it is a read to help you decide whether to pursue.

export const FIT_TASK = "Match a job to your resume";

export interface FitResult {
  fit: JobFit;
  passages: Passage[];
  note: string;
}

export async function jobFit(ctx: Context, match: JobMatch): Promise<FitResult> {
  const runId = randomUUID();
  const t = tracer();
  let usage: Usage | null = null;
  const query = fitQuery(match);
  const embedding = embeddingsConfigured() && ctx.mode === "live" ? await t.step("Embed the job", async () => (await embedTexts([query], 8_000))?.[0] ?? null, (v) => (v ? "embedded" : "embedding unavailable: keyword search only")) : null;
  const lists = await t.step("Search your resumes", () => ctx.store.knowledge.search({ terms: queryTerms(query, 15), embedding, limit: 12, sources: ["resume"] }), (l) => `${l.lexical.length} keyword matches, ${l.semantic.length} by meaning`);
  // Up to three passages from one resume: the point is to see which resume matches.
  const passages = fuse(lists, 6, 3);
  let fit = rulesFit(match, passages);
  let note = passages.length === 0 ? "No resume text is indexed yet. Put each resume's text in its page in Notion's Resumes database, then press Index on Ask Atlas." : "";
  if (passages.length > 0) {
    const gate = await takeAiCall(ctx.store, ctx.settings, "job-fit");
    if (!gate.allowed) note = gate.why.replace("so the offline drafter ran", "so the skills were compared by rules");
    else {
      const res = await t.step(
        "Judge the fit from the passages",
        () => structured(FitOut, fitTask(), fitData({ title: match.title, company: match.company, role: match.role, location: match.location, payText: match.payText, skills: match.skills ?? [] }, passages)),
        (r) => (r.ok ? `${r.value.fit}, cites ${r.value.citations.length}` : `no judgment (${r.reason})`),
      );
      usage = res.usage ?? null;
      if (res.ok) {
        const citations = checkCitations(res.value.citations, passages.length);
        const names = new Set(passages.map((p) => resumeName(p.title)));
        // The resume it names must be one that was retrieved; otherwise the rules' pick stands.
        if (citations.length > 0) fit = { mode: "model", fit: res.value.fit, reasons: res.value.reasons, gaps: res.value.gaps, resume: names.has(res.value.resume) ? res.value.resume : bestResume(passages), citations };
        else note = "The model cited no resume passage, so the skills were compared by rules.";
      } else note = res.reason === "error" && res.status === 429 ? `${aiName()}'s request limit was reached, so the skills were compared by rules.` : "The model did not answer, so the skills were compared by rules.";
    }
  }
  await logRun(ctx, {
    runId,
    agent: "career",
    task: FIT_TASK,
    status: "succeeded",
    trigger: "owner",
    detail: `${passages.length} resume passages, fit ${fit.fit}, judged by ${fit.mode === "model" ? aiName() : "rules"}`,
    ...(usage ? { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } : NO_MODEL),
    ...t.finish(),
  });
  return { fit, passages, note };
}
