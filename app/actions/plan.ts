"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { MINUTES_SAVED } from "@/lib/domain/agents";
import { addDays, mondayOf, weekOf } from "@/lib/domain/dates";
import { nextOccurrence, planWeek } from "@/lib/domain/planner";
import { fromMinutes, rollForwardTargets } from "@/lib/domain/schedule";
import { loadTodaySchedule } from "@/lib/scheduling";
import { AREAS, ENERGY, PRIORITIES, RECURRENCE, TASK_STATUSES } from "@/lib/domain/types";
import { firstIssue, formObject, id, localDay, type ActionResult } from "./_shared";

const NewTask = z.object({
  title: z.string().trim().min(1).max(200),
  priority: z.enum(PRIORITIES).default("medium"),
  area: z.enum(AREAS).default("work"),
  estimateMin: z.coerce.number().int().min(5).max(600).default(30),
  energy: z.enum(ENERGY).default("shallow"),
  recurrence: z.enum(RECURRENCE).default("none"),
  day: z.union([localDay, z.literal("")]).default(""),
  startTime: z.union([z.string().regex(/^[0-2]\d:[0-5]\d$/), z.literal("")]).default(""),
});

function refresh() {
  revalidatePath("/");
  revalidatePath("/plan");
}

export async function createTask(_: unknown, fd: FormData): Promise<ActionResult> {
  const parsed = NewTask.safeParse(formObject(fd));
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { store } = await getContext();
  const t = parsed.data;
  await store.tasks.create({
    title: t.title,
    notes: "",
    status: "todo",
    priority: t.priority,
    area: t.area,
    day: t.day || null,
    startTime: t.startTime || null,
    estimateMin: t.estimateMin,
    energy: t.energy,
    recurrence: t.recurrence,
    completedAt: null,
  });
  refresh();
  return { ok: true, message: "Added" };
}

export async function setTaskStatus(taskId: string, status: string): Promise<ActionResult> {
  const p = z.object({ taskId: id, status: z.enum(TASK_STATUSES) }).safeParse({ taskId, status });
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, today } = await getContext();
  const task = await store.tasks.get(p.data.taskId);
  if (!task) return { ok: false, error: "Task not found" };
  const done = p.data.status === "done";
  await store.tasks.update(task.id, { status: p.data.status, completedAt: done ? new Date().toISOString() : null });
  // A finished recurring task schedules its next occurrence.
  if (done && task.status !== "done" && task.recurrence !== "none") {
    const next = nextOccurrence(task.day && task.day > today ? task.day : today, task.recurrence);
    if (next) {
      const { id: _id, createdAt: _c, ...rest } = task;
      await store.tasks.create({ ...rest, status: "todo", day: next, completedAt: null });
    }
  }
  refresh();
  return { ok: true };
}

export async function moveTask(taskId: string, where: "today" | "tomorrow" | "backlog" | string): Promise<ActionResult> {
  const p = z.object({ taskId: id, where: z.union([z.enum(["today", "tomorrow", "backlog"]), localDay]) }).safeParse({ taskId, where });
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, today } = await getContext();
  const day = p.data.where === "today" ? today : p.data.where === "tomorrow" ? addDays(today, 1) : p.data.where === "backlog" ? null : p.data.where;
  await store.tasks.update(p.data.taskId, { day });
  refresh();
  return { ok: true };
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const p = id.safeParse(taskId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  await store.tasks.remove(p.data);
  await audit(store, { actor: "owner", action: "task.delete", target: p.data, detail: "", outcome: "success" });
  refresh();
  return { ok: true };
}

export async function autoPlanWeek(): Promise<ActionResult<{ placed: number; unplaced: number }>> {
  const { store, today, settings } = await getContext();
  const tasks = await store.tasks.list();
  const days = weekOf(today).filter((d) => d >= today);
  // Late in the week, look one week further so Friday's backlog has somewhere to go.
  if (days.length <= 2) days.push(...weekOf(addDays(mondayOf(today), 7)));
  const plan = planWeek({ tasks, today, days, dailyCapacityMin: settings.dailyCapacityMin });
  for (const p of plan.placements) await store.tasks.update(p.taskId, { day: p.day });
  if (plan.placements.length > 0) {
    await store.ledger.add({ agent: "chief-of-staff", activity: `Planned ${plan.placements.length} tasks`, minutesSaved: MINUTES_SAVED.weekPlanned });
  }
  await audit(store, { actor: "owner", action: "plan.auto", target: "tasks", detail: `placed=${plan.placements.length} unplaced=${plan.unplaced.length}`, outcome: "success" });
  refresh();
  return { ok: true, data: { placed: plan.placements.length, unplaced: plan.unplaced.length } };
}

export async function addGoal(_: unknown, fd: FormData): Promise<ActionResult> {
  const p = z.object({ title: z.string().trim().min(1).max(200), area: z.enum(AREAS).default("work") }).safeParse(formObject(fd));
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, today } = await getContext();
  const goals = (await store.goals.list()).filter((g) => g.weekOf === mondayOf(today));
  if (goals.length >= 5) return { ok: false, error: "Five goals a week is the limit. Fewer is better." };
  await store.goals.create({ weekOf: mondayOf(today), title: p.data.title, area: p.data.area, done: false });
  refresh();
  return { ok: true };
}

export async function toggleGoal(goalId: string): Promise<ActionResult> {
  const p = id.safeParse(goalId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  const g = await store.goals.get(p.data);
  if (g) await store.goals.update(g.id, { done: !g.done });
  refresh();
  return { ok: true };
}

export async function toggleRoutine(routineId: string): Promise<ActionResult> {
  const p = id.safeParse(routineId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store, today } = await getContext();
  const r = await store.routines.get(p.data);
  if (!r) return { ok: false, error: "Not found" };
  // Daily routines reset each day; the weekly review resets each Monday.
  const since = r.slot === "weekly-review" ? mondayOf(today) : today;
  const isDone = (r.lastDoneOn ?? "") >= since;
  await store.routines.update(r.id, { lastDoneOn: isDone ? null : today });
  if (!isDone && r.slot === "weekly-review") {
    const all = await store.routines.list();
    const weekly = all.filter((x) => x.slot === "weekly-review");
    if (weekly.every((x) => x.id === r.id || (x.lastDoneOn ?? "") >= since)) {
      await store.ledger.add({ agent: "chief-of-staff", activity: "Weekly review completed", minutesSaved: MINUTES_SAVED.weeklyReview });
    }
  }
  refresh();
  return { ok: true };
}

// ---- time-blocking (lib/domain/schedule.ts decides; these only apply or undo) ----

const Previous = z
  .array(z.object({ taskId: id, day: z.union([localDay, z.null()]), startTime: z.union([z.string().regex(/^[0-2]\d:[0-5]\d$/), z.null()]) }))
  .max(100);
export type PreviousTimes = z.infer<typeof Previous>;

/** Pins today's suggested focus blocks onto the tasks. In-app only; returns what to restore for Undo. */
export async function acceptDayPlan(): Promise<ActionResult<{ previous: PreviousTimes; count: number }>> {
  const ctx = await getContext();
  const { schedule, tasks } = await loadTodaySchedule(ctx);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const previous: PreviousTimes = [];
  for (const b of schedule.blocks) {
    const t = byId.get(b.taskId);
    if (!t) continue;
    previous.push({ taskId: t.id, day: t.day, startTime: t.startTime });
    await ctx.store.tasks.update(t.id, { day: ctx.today, startTime: fromMinutes(b.start) });
  }
  if (previous.length > 0) {
    await ctx.store.ledger.add({ agent: "chief-of-staff", activity: `Blocked ${previous.length} tasks into today`, minutesSaved: MINUTES_SAVED.dayBlocked });
  }
  await audit(ctx.store, { actor: "owner", action: "plan.day.accept", target: "tasks", detail: `blocked=${previous.length}`, outcome: "success" });
  refresh();
  return { ok: true, data: { previous, count: previous.length }, message: previous.length ? `Blocked ${previous.length} task${previous.length === 1 ? "" : "s"}` : "Nothing to block" };
}

/** Undo for acceptDayPlan / applyMoves: puts each task back where it was. */
export async function restoreTaskTimes(previous: PreviousTimes): Promise<ActionResult> {
  const p = Previous.safeParse(previous);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store } = await getContext();
  for (const x of p.data) await store.tasks.update(x.taskId, { day: x.day, startTime: x.startTime });
  await audit(store, { actor: "owner", action: "plan.undo", target: "tasks", detail: `restored=${p.data.length}`, outcome: "success" });
  refresh();
  return { ok: true, message: "Undone" };
}

const Moves = z.array(z.object({ taskId: id, to: localDay })).min(1).max(50);

/** Moves overflow tasks to the suggested days (clearing any start time). Returns Undo data. */
export async function applyMoves(moves: { taskId: string; to: string }[]): Promise<ActionResult<{ previous: PreviousTimes }>> {
  const p = Moves.safeParse(moves);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, today } = await getContext();
  const previous: PreviousTimes = [];
  for (const m of p.data) {
    if (m.to < today) continue;
    const t = await store.tasks.get(m.taskId);
    if (!t || t.status === "done") continue;
    previous.push({ taskId: t.id, day: t.day, startTime: t.startTime });
    await store.tasks.update(t.id, { day: m.to, startTime: null });
  }
  await audit(store, { actor: "owner", action: "plan.rebalance", target: "tasks", detail: `moved=${previous.length}`, outcome: "success" });
  refresh();
  return { ok: true, data: { previous }, message: `Moved ${previous.length}` };
}

/** End-of-day shutdown: unfinished tasks from today (and earlier) move to the next allowed day. */
export async function rollForwardUnfinished(): Promise<ActionResult<{ previous: PreviousTimes }>> {
  const { store, today } = await getContext();
  const tasks = await store.tasks.list();
  const next = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
  const previous: PreviousTimes = [];
  for (const m of rollForwardTargets(tasks, today, next)) {
    const t = tasks.find((x) => x.id === m.taskId)!;
    previous.push({ taskId: t.id, day: t.day, startTime: t.startTime });
    await store.tasks.update(t.id, { day: m.to, startTime: null });
  }
  await audit(store, { actor: "owner", action: "plan.rollforward", target: "tasks", detail: `moved=${previous.length}`, outcome: "success" });
  refresh();
  return { ok: true, data: { previous }, message: previous.length ? `Rolled ${previous.length} forward` : "Nothing to roll" };
}
