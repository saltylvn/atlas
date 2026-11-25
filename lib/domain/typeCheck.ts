// The AI check of the engineering-type labels (owner's request, 23 Nov 2026). Rules label every job
// (familyOf in techMarket.ts); once a day, and when you press "Check now", an AI model reads a
// sample of job titles on its own and says which type each one is. This file picks the sample,
// validates the model's answer and measures how often it agrees with the rules.
//
// Display-only: the AI never changes a label. Disagreements are shown so you can see where the
// rules may be wrong, and fix the rules. Pure: no I/O here.

import { z } from "zod";
import { ENG_TYPE_INFO, ENG_TYPES, engTypeOf, type EngType } from "./engTypes";
import type { TechPosting } from "./techMarket";

/** What a job can be judged as: one of the five types, product and program work, or not a tech job. */
export const JUDGE_LABELS = [...ENG_TYPES, "product", "not-tech"] as const;
export type JudgeLabel = (typeof JUDGE_LABELS)[number];
export const JUDGE_LABEL_NAME: Record<JudgeLabel, string> = {
  ...(Object.fromEntries(ENG_TYPES.map((t) => [t, ENG_TYPE_INFO[t].label])) as Record<EngType, string>),
  product: "Product and program",
  "not-tech": "Not a tech job",
};

/** Jobs in one check: one model call. */
export const CHECK_SAMPLE = 40;
/** Fewer active jobs than this, and the check is not run: the rate would mean little. */
export const CHECK_MIN = 10;

/** The rules' label for a stored job. */
export const rulesLabel = (p: Pick<TechPosting, "family">): JudgeLabel => engTypeOf(p.family) ?? "product";

/** A stable pseudo-random order, so the same day picks the same sample. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/**
 * The sample: an even share from each rules label (so a small type is checked too), then filled
 * from the rest, in a stable order for the day.
 */
export function checkSample(active: readonly TechPosting[], day: string, n = CHECK_SAMPLE): TechPosting[] {
  const order = [...active].sort((a, b) => hash(`${day}|${a.fingerprint}`) - hash(`${day}|${b.fingerprint}`));
  const groups = JUDGE_LABELS.map((l) => order.filter((p) => rulesLabel(p) === l)).filter((g) => g.length);
  const per = Math.ceil(n / Math.max(1, groups.length));
  const picked = groups.flatMap((g) => g.slice(0, per));
  const rest = order.filter((p) => !picked.includes(p));
  return [...picked, ...rest].slice(0, n);
}

/** The model's answer: a label for each numbered title. */
export const TypeCheckOut = z.object({ items: z.array(z.object({ i: z.number().int().min(0).max(199), type: z.enum(JUDGE_LABELS) })).max(200) });

const Disagreement = z.object({ title: z.string().max(200), company: z.string().max(160), rules: z.enum(JUDGE_LABELS), ai: z.enum(JUDGE_LABELS) });
export const TypeCheckSchema = z.object({
  at: z.string().max(40),
  model: z.string().max(40),
  sample: z.number().int().min(0),
  judged: z.number().int().min(0),
  agree: z.number().int().min(0),
  byType: z.array(z.object({ type: z.enum(JUDGE_LABELS), n: z.number().int().min(0), agree: z.number().int().min(0) })).max(10),
  disagreements: z.array(Disagreement).max(12),
});
export type TypeCheck = z.infer<typeof TypeCheckSchema>;

/** What the model is shown: a number, the title and the company. Nothing else from the posting. */
export const checkItems = (sample: readonly TechPosting[]) => sample.map((p, i) => ({ i, title: p.title.slice(0, 160), company: p.company.slice(0, 80) }));

/** The model's labels against the rules': agreement overall and per rules label, and where they differ. */
export function compareLabels(sample: readonly TechPosting[], out: z.infer<typeof TypeCheckOut>, at: string, model: string): TypeCheck {
  const ai = new Map<number, JudgeLabel>();
  for (const it of out.items) if (it.i < sample.length && !ai.has(it.i)) ai.set(it.i, it.type);
  const byType = new Map<JudgeLabel, { n: number; agree: number }>();
  const disagreements: TypeCheck["disagreements"] = [];
  let agree = 0;
  sample.forEach((p, i) => {
    const a = ai.get(i);
    if (!a) return;
    const r = rulesLabel(p);
    const row = byType.get(r) ?? { n: 0, agree: 0 };
    row.n++;
    if (a === r) {
      row.agree++;
      agree++;
    } else if (disagreements.length < 12) disagreements.push({ title: p.title.slice(0, 200), company: p.company.slice(0, 160), rules: r, ai: a });
    byType.set(r, row);
  });
  return {
    at,
    model: model.slice(0, 40),
    sample: sample.length,
    judged: ai.size,
    agree,
    byType: JUDGE_LABELS.flatMap((type) => (byType.has(type) ? [{ type, ...byType.get(type)! }] : [])),
    disagreements,
  };
}
