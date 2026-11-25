// The Weekly Strategist's rules (24 Nov 2026; docs/AGENT-ARCHITECTURE.md). Each Sunday night the
// agent (lib/agents/weeklyStrategist.ts) reads your job search the way Claude does (the same
// read-only tools), and proposes exactly three moves for the week, each resting on numbers it
// read. You approve the plan; only then are its moves added to your days as tasks. Pure.
//
//   PlanOut        what the agent hands back: a headline and moves, each citing facts
//   reviewPlan     the review in code: exactly three moves, every number from a cited fact
//   rulesPlan      the plan by rules, when no model answers
//   tasksForPlan   the tasks an approved plan becomes, one per move, on its day
//   lastWeek       what happened to the previous plan's moves: the agent's memory

import { z } from "zod";
import { numbersIn } from "./careerMap";
import { itemProblem, type Fact } from "./companyResearch";
import { addDays, mondayOf, weekdayIndex, weekdayName } from "./dates";
import type { LocalDate, Task } from "./types";

/** One run's budget: steps of the loop, and calls against the daily AI cap. */
export const STRATEGIST_LIMITS = { steps: 12, calls: 9 } as const;
/** A week's plan is exactly this many moves: enough to matter, few enough to do. */
export const MOVES = 3;
/** The plan's moves together may ask for at most this much of your week. */
export const WEEK_MINUTES_MAX = 600;

const Move = z.object({
  /** What to do, starting with a verb: "Apply to your five top picks". */
  title: z.string().min(8).max(90),
  /** Why this, from the numbers. */
  why: z.string().min(12).max(260),
  cites: z.array(z.string().max(6)).min(1).max(4),
  /** The day to do it: 0 = Monday ... 4 = Friday. */
  day: z.number().int().min(0).max(4),
  minutes: z.number().int().min(15).max(240),
});
export type PlanMove = z.infer<typeof Move>;

export const PlanOut = z.object({
  /** The week's focus in a sentence. */
  headline: z.string().min(12).max(200),
  moves: z.array(Move).min(1).max(5),
});
export type PlanOut = z.infer<typeof PlanOut>;

export function parsePlanOut(answer: string | undefined): PlanOut | null {
  if (!answer) return null;
  try {
    const p = PlanOut.safeParse(JSON.parse(answer));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Why one move cannot stand, or "" when it can. */
export function moveProblem(m: PlanMove, facts: ReadonlyMap<string, string>): string {
  return itemProblem({ text: `${m.title}. ${m.why}`, cites: m.cites }, facts);
}

/**
 * The review in code. Exactly three moves; each cites facts that were read and states no number
 * they lack; no two say the same thing; none repeats a move finished last week; and together
 * they fit in the week. `doneLastWeek` is the titles of last week's moves that were completed.
 */
export function reviewPlan(out: PlanOut, facts: readonly Fact[], doneLastWeek: readonly string[] = []): { pass: boolean; notes: string } {
  const byId = new Map(facts.map((f) => [f.id, f.text]));
  const problems: string[] = [];
  if (out.moves.length !== MOVES) problems.push(`Give exactly ${MOVES} moves, not ${out.moves.length}.`);
  problems.push(...out.moves.map((m) => moveProblem(m, byId)).filter(Boolean));
  if (/https?:\/\/|www\.|[<>*_`#[\]]/i.test(out.headline)) problems.push("The headline has a link or markup: plain words only.");
  const allowed = new Set(facts.flatMap((f) => numbersIn(f.text)));
  const stray = numbersIn(out.headline).filter((n) => !allowed.has(n));
  if (stray.length) problems.push(`The headline states ${stray.join(", ")}, which is in no fact you read.`);
  const titles = out.moves.map((m) => norm(m.title));
  if (new Set(titles).size !== titles.length) problems.push("Two moves say the same thing: make each one different.");
  const done = new Set(doneLastWeek.map(norm));
  for (const m of out.moves) if (done.has(norm(m.title))) problems.push(`"${m.title.slice(0, 60)}" was finished last week: choose what comes next instead.`);
  const total = out.moves.reduce((n, m) => n + m.minutes, 0);
  if (total > WEEK_MINUTES_MAX) problems.push(`The moves add up to ${total} minutes; keep the week's plan to ${WEEK_MINUTES_MAX} or less.`);
  return { pass: problems.length === 0, notes: problems.slice(0, 5).join(" ") };
}

// ---------------------------------------------------------------------------
// The saved plan

const SavedMove = Move.extend({ id: z.string().min(1).max(12) });
const WeeklyPlanSchema = z.object({
  /** Monday of the week the plan is for. */
  weekOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.string(),
  writer: z.enum(["model", "rules"]),
  headline: z.string().max(200),
  moves: z.array(SavedMove).max(MOVES),
  /** The facts its moves cite, kept so the card can show the evidence. */
  facts: z.array(z.object({ id: z.string().max(6), text: z.string().max(400) })).max(60),
  /** proposed: waiting for you. approved: its moves are tasks on your days. dismissed: you passed. */
  status: z.enum(["proposed", "approved", "dismissed"]),
  approvedAt: z.string().optional(),
  /** The task each move became, in the moves' order. */
  taskIds: z.array(z.string()).max(MOVES).optional(),
  /** What happened to the plan before this one: the agent's memory. */
  previous: z.object({ weekOf: z.string(), moves: z.array(z.object({ title: z.string(), done: z.boolean() })).max(MOVES) }).optional(),
});
export type WeeklyPlan = z.infer<typeof WeeklyPlanSchema>;

/** The plan in Settings (`weeklyPlan`), or null when there is none or it does not parse. */
export function weeklyPlanOf(raw: unknown): WeeklyPlan | null {
  const p = WeeklyPlanSchema.safeParse(raw);
  return p.success ? p.data : null;
}

/** The week a plan written today is for: this week from Monday to Friday, next week on Saturday and Sunday. */
export function planWeek(today: LocalDate): LocalDate {
  return weekdayIndex(today) >= 5 ? addDays(mondayOf(today), 7) : mondayOf(today);
}

/** True when the Sunday-night run should write a plan: it is Sunday and next week has none yet. */
export function strategistDue(raw: unknown, today: LocalDate): boolean {
  if (weekdayIndex(today) !== 6) return false;
  return weeklyPlanOf(raw)?.weekOf !== planWeek(today);
}

/** The day a move lands on: its weekday in the plan's week, or today when that day has passed. */
export function moveDay(weekOf: LocalDate, day: number, today: LocalDate): LocalDate {
  const d = addDays(weekOf, day);
  return d < today ? today : d;
}

/** Turns the agent's answer into the plan that is saved, waiting for approval. */
export function toPlan(out: PlanOut, facts: readonly Fact[], o: { weekOf: LocalDate; createdAt: string; writer: "model" | "rules"; previous?: WeeklyPlan["previous"] }): WeeklyPlan {
  const cited = new Set(out.moves.flatMap((m) => m.cites));
  return {
    weekOf: o.weekOf,
    createdAt: o.createdAt,
    writer: o.writer,
    headline: out.headline.replace(/\s+/g, " ").trim(),
    moves: out.moves.slice(0, MOVES).map((m, i) => ({ ...m, id: `m${i + 1}`, title: m.title.replace(/\s+/g, " ").trim(), why: m.why.replace(/\s+/g, " ").trim() })),
    facts: facts.filter((f) => cited.has(f.id)).map((f) => ({ id: f.id, text: f.text.slice(0, 400) })),
    status: "proposed",
    ...(o.previous ? { previous: o.previous } : {}),
  };
}

/** The tasks an approved plan becomes: one per move, on its day, in the Career area. */
export function tasksForPlan(plan: Pick<WeeklyPlan, "weekOf" | "moves">, today: LocalDate): Omit<Task, "id" | "createdAt">[] {
  return plan.moves.map((m) => ({
    title: m.title,
    notes: `This week's plan: ${m.why}`,
    status: "todo",
    priority: "high",
    area: "career",
    day: moveDay(plan.weekOf, m.day, today),
    startTime: null,
    estimateMin: m.minutes,
    energy: m.minutes >= 60 ? "deep" : "shallow",
    recurrence: "none",
    completedAt: null,
  }));
}

/** What happened to a plan's moves, from the tasks they became. A plan never approved has nothing done. */
export function lastWeek(plan: WeeklyPlan | null, tasks: readonly Pick<Task, "id" | "status">[]): NonNullable<WeeklyPlan["previous"]> | null {
  if (!plan) return null;
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  return { weekOf: plan.weekOf, moves: plan.moves.map((m, i) => ({ title: m.title, done: plan.status === "approved" && status.get(plan.taskIds?.[i] ?? "") === "done" })) };
}

/** "Monday", for a move's day. */
export const moveDayName = (weekOf: LocalDate, day: number) => weekdayName(addDays(weekOf, day));

// ---------------------------------------------------------------------------
// The facts the agent reads, as lines it can cite

export interface WeekSnapshot {
  funnel: { sent: number; judged: number; replied: number; rejected: number; replyRate: number; findings: string[] };
  queue: { waiting: number; aboveYourLevel: number; picks: { title: string; why: string }[]; prepared: number };
  applications: { applied: number; interview: number; offer: number; interviews: string[] };
  market: { headline: string; focus: string[] } | null;
  proof: { skill: string; assignedOn: string } | null;
  proofDone: number;
}

export type SnapshotPart = "funnel" | "queue" | "applications" | "market" | "proof";

/** One part of the snapshot as plain lines. Each becomes a fact with an id. */
export function snapshotLines(s: WeekSnapshot, part: SnapshotPart): string[] {
  if (part === "funnel") {
    const f = s.funnel;
    return [`Applications sent: ${f.sent}. With a result so far: ${f.judged}. Replies: ${f.replied}. Rejections: ${f.rejected}. Reply rate: ${Math.round(f.replyRate * 100)}%.`, ...f.findings.slice(0, 4).map((x) => `Finding: ${x}`)];
  }
  if (part === "queue") {
    const q = s.queue;
    return [
      `Apply Queue: ${q.waiting} jobs waiting; ${q.aboveYourLevel} above your level. Today's top picks: ${q.picks.length}, of which ${q.prepared} are researched and tailored.`,
      ...q.picks.slice(0, 5).map((p, i) => `Top pick ${i + 1}: ${p.title}. ${p.why}`.slice(0, 300)),
    ];
  }
  if (part === "applications") {
    const a = s.applications;
    return [`Applications waiting on a reply: ${a.applied}. At interview stage: ${a.interview}. Offers: ${a.offer}.`, ...a.interviews.slice(0, 3).map((x) => `Interview stage: ${x}`)];
  }
  if (part === "market") return s.market ? [`Market report: ${s.market.headline}`, ...s.market.focus.slice(0, 3).map((x) => `Market focus: ${x}`)] : ["No market report yet."];
  return [s.proof ? `Open proof project: ${s.proof.skill}, assigned ${s.proof.assignedOn}. Proof projects finished: ${s.proofDone}.` : `No proof project is open. Proof projects finished: ${s.proofDone}.`];
}

const PREFIX: Record<SnapshotPart | "last", string> = { funnel: "a", queue: "q", applications: "i", market: "k", proof: "b", last: "w" };
export const factPrefix = (part: SnapshotPart | "last") => PREFIX[part];

/** Last week's moves as lines the agent can cite. */
export function lastWeekLines(prev: WeeklyPlan["previous"] | null): string[] {
  if (!prev || prev.moves.length === 0) return ["There was no plan last week."];
  const done = prev.moves.filter((m) => m.done).length;
  return [`Last week's plan: ${done} of ${prev.moves.length} moves finished.`, ...prev.moves.map((m) => `Last week, ${m.done ? "finished" : "not finished"}: ${m.title}`)];
}

/**
 * The plan by rules, when no model answers: apply to the picks that are waiting, then the next
 * thing the numbers point at (an interview to prepare, an unfinished move, the proof project),
 * then a look at what the applications say. `facts` must hold the funnel and queue lines.
 */
export function rulesPlan(s: WeekSnapshot, facts: readonly Fact[], prev: WeeklyPlan["previous"] | null = null): PlanOut {
  const first = (prefix: string, match?: RegExp) => facts.find((f) => f.id.startsWith(prefix) && (!match || match.test(f.text)))?.id;
  const q = first("q") ?? facts[0]?.id ?? "q1";
  const a = first("a") ?? q;
  const moves: PlanMove[] = [];
  const picks = Math.min(5, s.queue.picks.length);
  moves.push(
    picks > 0
      ? { title: "Apply to your top picks, most prepared first", why: "These are the jobs at your level that Atlas ranked first, and the ones it researched and tailored overnight are quickest to send.", cites: [q], day: 0, minutes: 120 }
      : { title: "Refill the Apply Queue from Good fits", why: "Nothing at your level is waiting in the queue, so the week starts by choosing jobs worth applying to.", cites: [q], day: 0, minutes: 60 },
  );
  const interview = first("i", /^Interview stage/);
  const unfinished = prev?.moves.find((m) => !m.done);
  const w = first("w", /not finished/);
  if (interview) moves.push({ title: "Prepare for your interview with the Coach", why: "An application is at interview stage, and preparing true stories for its questions is the best use of an hour.", cites: [interview], day: 1, minutes: 90 });
  else if (unfinished && w) moves.push({ title: unfinished.title.slice(0, 90), why: "This move from last week's plan was not finished, so it carries over before anything new.", cites: [w], day: 1, minutes: 60 });
  else if (s.proof) moves.push({ title: `Work on your ${s.proof.skill} proof project`.slice(0, 90), why: "A proof project is open, and finishing it closes a skill gap the postings keep asking about.", cites: [first("b") ?? q], day: 1, minutes: 120 });
  else moves.push({ title: "Follow up on applications with no reply", why: "A short, polite follow-up is the cheapest way to turn a silent application into an answer.", cites: [first("i") ?? a], day: 1, minutes: 45 });
  moves.push({ title: "Review what your applications say and adjust", why: "The funnel shows which applications get replies; reading it midweek keeps the rest of the week aimed at what works.", cites: [a], day: 3, minutes: 30 });
  return { headline: picks > 0 ? "Send your best-prepared applications early, then build on what the replies show." : "Fill the queue with jobs at your level, then apply.", moves };
}
