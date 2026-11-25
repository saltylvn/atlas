import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCall } from "@/lib/ai/budget";
import { aiName, structuredWithin } from "@/lib/ai/model";
import type { Usage } from "@/lib/ai/models";
import { formPickData, formPickTask } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { buildPacket } from "@/lib/domain/applyPacket";
import { asFormQuestions, acceptPicks, FORMS_PER_DAY, draftable, forModel, fromPacket, ownerFacts, PickOut, takeForm, type FormAnswer, type FormRequest } from "@/lib/domain/extensionForm";
import { fuse, queryTerms } from "@/lib/domain/retrieval";
import { draftFormAnswer, type FormDrafter } from "@/lib/knowledge/formAnswer";
import { careerPrefs } from "./career";
import { logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// Atlas Autofill asks the Apply Agent to answer one form you are looking at on a job site.
// This is the Apply Agent's own job (answering a form) without its browser: you fill and
// submit in your own browser. No new agent.
//   1. rules: buildPacket, the same rules the Apply Agent uses on Greenhouse;
//   2. Gemini picks options on the lists nobody's rule answers, from your resume passages and
//      the facts you wrote, and each pick is checked (acceptPicks);
//   3. Gemini drafts the open questions from your resumes, as "Draft with AI" does.
// Consent, demographic, money and legal questions are never sent to the model. One form counts
// once against the daily cap, and only when the model is asked.

export const EXTENSION_TASK = "Answer a form for Atlas Autofill";
const PICK_WAIT_MS = 20_000;
/** Open questions drafted per form: the rest are left for you. Each is one model call. */
export const MAX_DRAFTS = 4;

export interface ExtensionAnswersDeps {
  pick?: (input: Parameters<typeof formPickData>[0]) => Promise<{ out: PickOut | null; usage: Usage | null; why: string }>;
  draft?: FormDrafter;
}

export interface ExtensionAnswers {
  answers: FormAnswer[];
  /** What was not done, in plain words, for the panel. */
  notes: string[];
}

export async function answerForm(ctx: Context, persist: Store, req: FormRequest, deps: ExtensionAnswersDeps = {}): Promise<ExtensionAnswers> {
  const runId = randomUUID();
  const t = tracer();
  const used: Usage[] = [];
  const notes: string[] = [];
  await logRun(ctx, { runId, agent: "apply", task: EXTENSION_TASK, status: "started", trigger: "owner", detail: "", ...NO_MODEL });
  try {
    const job = { company: req.company || "the company", role: req.role || req.title || "this role" };
    const packet = buildPacket({ questions: asFormQuestions(req.questions), answers: ctx.settings.careerAnswers, eligibility: ctx.settings.careerEligibility, profile: ctx.settings.careerProfile, job, resumeReady: true });
    let answers = fromPacket(packet.items, packet.stops);
    t.note("Answer from your bank and your Setup answers (rules)", `${answers.filter((a) => a.value || a.source === "resume").length} of ${req.questions.length} answered by rules`);

    const picks = forModel(req.questions, answers);
    const drafts = draftable(req.questions, answers).slice(0, MAX_DRAFTS);
    if (picks.length + drafts.length > 0) {
      const slot = takeForm(ctx.settings.extensionUsage, ctx.today);
      if (!slot) notes.push(`Atlas has answered its ${FORMS_PER_DAY} forms with Gemini today. The lists and open questions are left for you.`);
      else {
        await persist.settings.update({ extensionUsage: slot }).catch(() => undefined);
        if (picks.length) {
          const roles = careerPrefs(ctx.settings).roles.map((r) => r.name);
          const facts = ownerFacts(ctx.settings, roles);
          const lists = await ctx.store.knowledge.search({ terms: queryTerms(`${picks.map((q) => q.label).join(" ")} ${req.role} ${req.resume}`.slice(0, 1200), 20), embedding: null, limit: 16, sources: ["resume"] }).catch(() => null);
          const passages = lists ? fuse(lists, 8, 3) : [];
          const res = await t.step(
            "Pick options from your resume and facts (Gemini)",
            () => (deps.pick ?? pickWithModel(ctx))({ job: { title: req.title, company: req.company, role: req.role, posting: req.posting.slice(0, 4000) }, facts, passages, questions: picks }),
            (r) => (r.out ? `${aiName()} answered` : `not answered: ${r.why}`),
          );
          if (res.usage) used.push(res.usage);
          if (res.out) {
            const citable = new Set([...Object.keys(facts), ...passages.map((p) => String(p.n))]);
            const kept = acceptPicks(res.out, picks, citable);
            t.note("Check each pick against the form's options and its sources", `${kept.length} of ${picks.length} kept`);
            answers = answers.map((a) => kept.find((k) => k.id === a.id) ?? a);
            for (const q of picks) if (!kept.some((k) => k.id === q.id)) {
              const i = answers.findIndex((a) => a.id === q.id);
              const yours = { id: q.id, value: "", source: "none" as const, why: "", yours: "Your resume and facts do not decide this one" };
              if (i >= 0) answers[i] = yours;
              else answers.push(yours);
            }
          } else notes.push(`Gemini did not pick options: ${res.why}`);
        }
        for (const q of drafts) {
          const d = await t.step(`Draft "${q.label.slice(0, 60)}" from your resumes`, () => (deps.draft ?? draftFormAnswer)(ctx, q.label, { title: req.title || req.role, company: req.company, role: req.resume || req.role }), (r) => (r.text ? `drafted, ${r.cited} passages cited` : `not drafted: ${r.why}`));
          if (d.usage) used.push(d.usage);
          answers = answers.map((a) => (a.id === q.id ? (d.text ? { ...a, value: d.text, source: "ai", why: `Gemini draft from your resumes (${d.cited} passage${d.cited === 1 ? "" : "s"}). Read it before you submit.` } : { ...a, yours: `No draft: ${d.why}` }) : a));
        }
      }
    }

    const filled = answers.filter((a) => a.value || a.source === "resume").length;
    const usage = used.at(-1);
    await logRun(ctx, {
      runId,
      agent: "apply",
      task: EXTENSION_TASK,
      status: "succeeded",
      trigger: "owner",
      // The site's host and counts only: no answer, no personal data.
      detail: `${hostOf(req.url)}: ${filled} of ${req.questions.length} answered (${answers.filter((a) => a.source === "ai" && a.value).length} by ${aiName()}), ${answers.filter((a) => a.yours).length} left for you`,
      ...(usage ? { model: usage.model, inputTokens: used.reduce((s, u) => s + u.inputTokens, 0), outputTokens: used.reduce((s, u) => s + u.outputTokens, 0), costUsd: used.reduce((s, u) => s + u.costUsd, 0) } : NO_MODEL),
      ...t.finish(),
    });
    return { answers, notes };
  } catch (err) {
    await logRun(ctx, { runId, agent: "apply", task: EXTENSION_TASK, status: "failed", trigger: "owner", detail: (err as Error).message?.slice(0, 300) || "unknown error", ...NO_MODEL, ...t.finish() });
    throw err;
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.slice(0, 80);
  } catch {
    return "a page";
  }
};

function pickWithModel(ctx: Context): NonNullable<ExtensionAnswersDeps["pick"]> {
  return async (input) => {
    const gate = await takeAiCall(ctx.store, ctx.settings, "extension-picks");
    if (!gate.allowed) return { out: null, usage: null, why: gate.why.replace(/, so the offline drafter ran\.?$/, ".") };
    const res = await structuredWithin(PICK_WAIT_MS, PickOut, formPickTask(), formPickData(input));
    return res.ok ? { out: res.value, usage: res.usage ?? null, why: "" } : { out: null, usage: res.usage ?? null, why: `${aiName()} did not answer (${res.reason})` };
  };
}
