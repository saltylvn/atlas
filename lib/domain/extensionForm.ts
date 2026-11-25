// Atlas Autofill, Atlas's side: the key the extension signs in with, the shape of a form it
// sends, and the checks on what Gemini picks for it. Pure: no I/O.
//
// Who answers a question the extension reads from a job site:
//   your answer bank, eligibility answers and Gender     rules (buildPacket, as the Apply Agent)
//   a choice list nobody's rule covers                  Gemini picks one of the form's own options,
//                                                        and must cite your resume or your facts
//   an open question                                    Gemini drafts it from your resumes
//   demographic, consent and legal questions            nobody: left for you
// The form's text is untrusted: it is matched against fixed patterns and sent to the model as
// data. The model never sees a question it may not answer.

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FormQuestion } from "./applyPacket";
import type { LocalDate, PacketItem, Settings } from "./types";

// ---------------------------------------------------------------------------
// The key

/** Prefix that marks an Atlas Autofill key, so a stray paste of something else is refused early. */
export const KEY_PREFIX = "atlas_ext_";
export const keyHash = (key: string): string => createHash("sha256").update(key, "utf8").digest("hex");
/** What Settings shows of a key: its start, so you can tell keys apart. */
export const keyLabel = (key: string): string => `${key.slice(0, KEY_PREFIX.length + 4)}…`;

/** True when `header` is "Bearer <key>" for the key whose hash is stored. Constant-time. */
export function keyMatches(header: string | null, stored: Settings["extensionKey"]): boolean {
  if (!stored?.hash || !header?.startsWith(`Bearer ${KEY_PREFIX}`)) return false;
  const given = header.slice(7).trim();
  if (given.length < 30 || given.length > 120) return false;
  const a = Buffer.from(keyHash(given), "hex");
  const b = Buffer.from(stored.hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// What the extension sends

/** Forms per day Atlas answers with Gemini for the extension. Rules-only answers are not counted. */
export const FORMS_PER_DAY = 20;
export const MAX_QUESTIONS = 80;

const text = (max: number) => z.string().transform((s) => s.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max));

export const FormRequest = z.object({
  /** The page the form is on. https only. */
  url: z.string().url().max(800).refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "https only"),
  title: text(300).default(""),
  /** The posting's text as the page shows it, when the extension found one. Used as context only. */
  posting: text(8000).default(""),
  /** The job, as you confirmed it in the popup or as Atlas's queue names it. */
  company: text(160).default(""),
  role: text(160).default(""),
  /** Your target role, which picks the resume. */
  resume: text(80).default(""),
  questions: z
    .array(
      z.object({
        id: z.string().regex(/^[A-Za-z0-9:_-]{1,40}$/),
        label: text(400),
        required: z.boolean().default(false),
        kind: z.enum(["text", "textarea", "select", "multiselect", "checkbox", "typeahead", "file"]),
        options: z.array(text(200)).max(200).default([]),
      }),
    )
    .min(1)
    .max(MAX_QUESTIONS),
});
export type FormRequest = z.infer<typeof FormRequest>;

/** The extension's questions as the Apply Agent's rules read them. */
export function asFormQuestions(questions: FormRequest["questions"]): FormQuestion[] {
  return questions.map((q) => ({ name: q.id, label: q.label, required: q.required, kind: q.kind, ...(q.options.length ? { options: q.options.map((o) => ({ label: o, value: o })) } : {}) }));
}

// ---------------------------------------------------------------------------
// Questions that are yours alone, beyond the packet's own list

/** Consent, attestations and agreements: accepting them is yours, every time. */
export const CONSENT = /\bi agree\b|\bi consent\b|\bi acknowledge\b|\bi certify\b|\bi confirm\b|\battest|terms (of|and)|privacy (policy|notice)|data (processing|retention)|true,? (and )?(correct|complete|accurate)|electronic signature|\bsms\b|text messages?|opt[ -]?in|marketing/i;
/** Questions about money and legal standing that Gemini never answers, whatever the options say. */
export const NOT_FOR_AI = /salary|compensation|\bpay\b|wage|rate|relocat|commute|on-?site|in-office|in office|office .{0,30}days|days .{0,20}office|travel|start date|notice period|available to start|background check|drug|felony|convict|clearance|citizen|visa|sponsor|authori[sz]|referr|employee refer|how did you (hear|find)|source/i;

export type AnswerSource = "bank" | "eligibility" | "resume" | "ai" | "none";

export interface FormAnswer {
  id: string;
  /** The answer: text, or for a list the option's label exactly as the form shows it. */
  value: string;
  /** For a multi-select: every option to tick. */
  values?: string[];
  source: AnswerSource;
  /** Why: which rule or which passage. Shown in the panel. */
  why: string;
  /** Yours to answer, and why: never filled by Atlas. */
  yours?: string;
  /** The answer-bank question this is, when you may save your correction to it ("Save to my answers"). */
  bankId?: string;
}

/**
 * Answer-bank questions a correction on a form may be saved to, and how a form asks them. Your
 * name, links and "why this company" are left out: one form's wording must not overwrite them.
 */
const LEARNABLE: readonly [string, RegExp][] = [
  ["intro", /about yourself|tell us about you|introduce yourself|\bsummary\b|\bbio\b/i],
  ["whyLooking", /why are you (looking|leaving)|reason for (leaving|looking)/i],
  ["project", /project (you are|you're) proud|proudest|describe a project/i],
  ["aiExperience", /\b(ai|llms?|machine learning|generative)\b.*\bexperience\b|\bexperience\b.*\b(ai|llms?|machine learning|generative)\b/i],
  ["workHistory", /work history|employment history|previous (roles|positions|employers)/i],
  ["salary", /desired (salary|pay|compensation)|salary expectation|expected (salary|pay|compensation)/i],
  ["startDate", /start date|available to start|when (can|could) you start|notice period/i],
  ["yearsExperience", /years of (relevant |professional |total )?experience|how many years/i],
  ["phone", /\bphone\b|mobile|telephone/i],
  ["city", /\bcity\b|where do you live|current location/i],
];

/** The answer-bank question a form's question is, when a correction may be saved to it. */
export function bankIdFor(label: string, kind: string): string | undefined {
  if (kind !== "text" && kind !== "textarea") return undefined;
  if (CONSENT.test(label)) return undefined;
  return LEARNABLE.find(([, re]) => re.test(label))?.[0];
}

/** The packet's items as the extension's answers. A locked or unanswered question says why it is yours. */
/** The packet's reasons, in the panel's words. */
const YOURS: readonly [RegExp, string][] = [
  [/^has no answer in your answer bank yet/, "Not in your answer bank yet"],
  [/^is a question with no approved answer/, "No saved answer for this one"],
  [/^is an eligibility question you have not answered/, "Answer it once in Atlas Setup (eligibility)"],
  [/^offers choices, and your saved answer is not one of them/, "Your saved answer is not one of its choices"],
  [/^needs your city/, "Add your city to your answer bank"],
  [/^needs your name/, "Add your name to your answer bank"],
  [/^has options that are not a plain Yes or No/, "Its choices are not a plain Yes or No"],
  [/^asks for a cover letter file/, "A cover letter file: attach it yourself"],
  [/^asks for a file Atlas does not have/, "A file Atlas does not have"],
  [/^needs an answer drafted from your resume/, "Open question: Gemini drafts it, or you write it"],
];

export function fromPacket(items: readonly PacketItem[], stops: readonly string[]): FormAnswer[] {
  return items.map((i) => {
    const head = `"${i.label.slice(0, 80)}" `;
    const stop = stops.find((s) => s.startsWith(head));
    const why = i.source === "bank" ? "Your answer bank" : i.source === "eligibility" ? "Your answers in Setup" : i.source === "resume" ? "The resume for this role, from Notion" : "";
    const bankId = bankIdFor(i.label, i.kind);
    const answer: FormAnswer = { id: i.name, value: i.kind === "file" ? "" : i.value, source: i.source === "you" ? "bank" : i.source, why, ...(bankId ? { bankId } : {}) };
    if (i.locked) answer.yours = "A question Atlas never answers for you";
    else if (i.source === "none" && stop) {
      const why = stop.slice(head.length);
      answer.yours = YOURS.find(([re]) => re.test(why))?.[1] ?? why.charAt(0).toUpperCase() + why.slice(1);
    }
    return answer;
  });
}

/** Questions Gemini may pick an option for: a list nobody's rule answered, and nothing in the never-lists. */
export function forModel(questions: FormRequest["questions"], answers: readonly FormAnswer[]): FormRequest["questions"] {
  return questions.filter((q) => {
    if (q.kind !== "select" && q.kind !== "multiselect") return false;
    if (q.options.length < 2) return false;
    const a = answers.find((x) => x.id === q.id);
    if (a && (a.value || a.source !== "none" || a.yours === "A question Atlas never answers for you")) return false;
    return !CONSENT.test(q.label) && !NOT_FOR_AI.test(q.label);
  });
}

/** Open questions Gemini may draft from your resumes: not consent, not money or legal standing. */
export function draftable(questions: FormRequest["questions"], answers: readonly FormAnswer[]): FormRequest["questions"] {
  return questions.filter((q) => {
    if (q.kind !== "textarea" && q.kind !== "text") return false;
    const a = answers.find((x) => x.id === q.id);
    if (!a || a.value || a.source !== "ai") return false;
    return !CONSENT.test(q.label) && !NOT_FOR_AI.test(q.label);
  });
}

export const PickOut = z.object({
  picks: z
    .array(
      z.object({
        id: z.string().max(40),
        /** Option labels copied exactly. One for a single choice; any number for a multi-select. Empty when the facts do not decide it. */
        choose: z.array(z.string().max(200)).max(20),
        /** Passage numbers and fact names the pick rests on. */
        cites: z.array(z.string().max(20)).max(8),
        why: z.string().max(240),
      }),
    )
    .max(MAX_QUESTIONS),
});
export type PickOut = z.infer<typeof PickOut>;

/**
 * Gemini's picks, checked: each option must be one the form offers, exactly; a single-choice
 * question gets one; every pick cites a passage or a fact it was given; a question it was not
 * asked is ignored. Anything that fails is dropped and the question stays yours.
 */
export function acceptPicks(out: PickOut, asked: FormRequest["questions"], citable: ReadonlySet<string>): FormAnswer[] {
  const kept: FormAnswer[] = [];
  for (const p of out.picks) {
    const q = asked.find((x) => x.id === p.id);
    if (!q) continue;
    const chosen = [...new Set(p.choose.map((c) => q.options.find((o) => o === c.trim())).filter((c): c is string => Boolean(c)))];
    if (chosen.length === 0 || chosen.length !== p.choose.length) continue;
    if (q.kind === "select" && chosen.length !== 1) continue;
    const cites = p.cites.filter((c) => citable.has(c));
    if (cites.length === 0 || !p.why.trim()) continue;
    kept.push({ id: q.id, value: chosen[0]!, ...(q.kind === "multiselect" ? { values: chosen } : {}), source: "ai", why: `Gemini: ${p.why.trim().slice(0, 240)}` });
  }
  return kept;
}

/** Today's count after one more form, or null when the daily cap is reached. */
export function takeForm(usage: Settings["extensionUsage"], today: LocalDate): { day: string; forms: number } | null {
  const forms = usage?.day === today ? usage.forms : 0;
  return forms >= FORMS_PER_DAY ? null : { day: today, forms: forms + 1 };
}

/** Facts about you the picker may rest on, each with a name it can cite. Only what you wrote. */
export function ownerFacts(settings: Pick<Settings, "careerAnswers" | "careerSkills">, roles: readonly string[]): Record<string, string> {
  const a = settings.careerAnswers ?? {};
  const facts: Record<string, string> = {};
  const put = (k: string, v: string | undefined) => {
    const t = (v ?? "").replace(/\s+/g, " ").trim();
    if (t) facts[k] = t.slice(0, 600);
  };
  put("years", a.yearsExperience);
  put("city", a.city);
  put("location", a.location);
  put("intro", a.intro);
  put("ai", a.aiExperience);
  put("project", a.project);
  put("history", a.workHistory);
  put("skills", (settings.careerSkills ?? []).join(", "));
  put("roles", roles.slice(0, 5).join(", "));
  return facts;
}
