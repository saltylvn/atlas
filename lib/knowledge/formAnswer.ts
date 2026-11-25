import "server-only";
import { takeAiCall } from "@/lib/ai/budget";
import { aiName, structuredWithin } from "@/lib/ai/model";
import type { Usage } from "@/lib/ai/models";
import { formAnswerData, formAnswerTask, FormAnswerOut } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import { numbersGrounded } from "@/lib/domain/market";
import { checkCitations, fuse, queryTerms } from "@/lib/domain/retrieval";

// The Apply Agent's one model call: an answer to a question the form asks that your answer
// bank does not cover, drafted from your own resume passages (docs/design.md, 5.5).
// Retrieval, then judgment, then the same checks "Draft with AI" uses:
//   - the passages are your resumes only (contact details are never in them);
//   - the draft must cite a passage it was given, and every number in it must be in them.
// A draft that fails a check is dropped, and the question waits for you in the review. The
// question is the job board's text: it goes in as data, never as an instruction.

const MODEL_WAIT_MS = 15_000;

export type FormDraft = { text: string; cited: number; why: string; usage: Usage | null };

export type FormDrafter = (ctx: Pick<Context, "store" | "settings">, question: string, job: { title: string; company: string; role: string }) => Promise<FormDraft>;

const none = (why: string, usage: Usage | null = null): FormDraft => ({ text: "", cited: 0, why, usage });

export const draftFormAnswer: FormDrafter = async (ctx, question, job) => {
  const query = `${question} ${job.title} ${job.role}`.slice(0, 600);
  const lists = await ctx.store.knowledge.search({ terms: queryTerms(query, 15), embedding: null, limit: 12, sources: ["resume"] });
  const passages = fuse(lists, 6, 3);
  if (passages.length === 0) return none("no resume text is indexed to draft from");

  const gate = await takeAiCall(ctx.store, ctx.settings, "apply-answer");
  if (!gate.allowed) return none(gate.why.replace(", so the offline drafter ran", ""));

  const res = await structuredWithin(MODEL_WAIT_MS, FormAnswerOut, formAnswerTask(), formAnswerData(question.slice(0, 600), job, passages));
  const usage = res.usage ?? null;
  if (!res.ok) return none(`${aiName()} did not answer (${res.reason})`, usage);

  const text = res.value.text.replace(/\s+/g, " ").trim();
  if (!text) return none(`${aiName()} found nothing in your resume that answers it`, usage);
  const cited = checkCitations(res.value.citations, passages.length);
  if (cited.length === 0) return none("the draft cited none of your resume passages", usage);
  if (!numbersGrounded([text], passages.map((p) => p.content))) return none("the draft quoted a number that is not in your resume", usage);
  return { text, cited: cited.length, why: "", usage };
};
