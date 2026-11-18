// The week planner. Deterministic on purpose: the same backlog gives the same plan,
// it is testable, and it costs nothing to run. The AI writes prose about a plan;
// it never decides where a task goes.

import { addDays, weekdayIndex } from "./dates";
import type { Area, LocalDate, Priority, Recurrence, Task } from "./types";

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const WEEKEND_AREAS: ReadonlySet<Area> = new Set(["family", "home", "health", "personal", "finance"]);

export interface PlanInput {
  tasks: Task[];
  today: LocalDate;
  /** The days the planner may use, in order. Usually today through Sunday. */
  days: LocalDate[];
  dailyCapacityMin: number;
}

export interface Placement {
  taskId: string;
  day: LocalDate;
}

export interface PlanResult {
  placements: Placement[];
  /** Tasks that did not fit anywhere this week. */
  unplaced: string[];
  /** Planned minutes per day after placement. */
  load: Record<LocalDate, number>;
}

export function isWeekend(day: LocalDate): boolean {
  return weekdayIndex(day) >= 5;
}

export function capacityFor(day: LocalDate, dailyCapacityMin: number): number {
  return isWeekend(day) ? Math.round(dailyCapacityMin / 2) : dailyCapacityMin;
}

/** Tasks the planner should (re)place: unscheduled, or overdue and still open. */
export function needsPlacement(task: Task, today: LocalDate): boolean {
  if (task.status === "done") return false;
  return task.day === null || task.day < today;
}

export function comparePriority(a: Task, b: Task): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    b.estimateMin - a.estimateMin ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

export function planWeek(input: PlanInput): PlanResult {
  const { tasks, today, days, dailyCapacityMin } = input;
  const load: Record<LocalDate, number> = Object.fromEntries(days.map((d) => [d, 0]));

  for (const t of tasks) {
    if (t.status !== "done" && t.day !== null && t.day >= today && t.day in load) {
      load[t.day] = (load[t.day] ?? 0) + t.estimateMin;
    }
  }

  const queue = tasks.filter((t) => needsPlacement(t, today)).sort(comparePriority);
  const placements: Placement[] = [];
  const unplaced: string[] = [];

  for (const task of queue) {
    const allowed = days.filter((d) => d >= today && (!isWeekend(d) || WEEKEND_AREAS.has(task.area)));
    const fits = allowed.filter(
      (d) => (load[d] ?? 0) + task.estimateMin <= capacityFor(d, dailyCapacityMin),
    );
    if (fits.length === 0) {
      unplaced.push(task.id);
      continue;
    }
    // Urgent work goes as early as possible; the rest balances the week.
    const urgent = task.priority === "critical" || task.priority === "high";
    const day = urgent
      ? fits[0]!
      : fits.reduce((best, d) => {
          const room = capacityFor(d, dailyCapacityMin) - (load[d] ?? 0);
          const bestRoom = capacityFor(best, dailyCapacityMin) - (load[best] ?? 0);
          return room > bestRoom ? d : best;
        });
    load[day] = (load[day] ?? 0) + task.estimateMin;
    placements.push({ taskId: task.id, day });
  }

  return { placements, unplaced, load };
}

/** The next date a recurring task should appear after `from`. */
export function nextOccurrence(from: LocalDate, recurrence: Recurrence): LocalDate | null {
  switch (recurrence) {
    case "none":
      return null;
    case "daily":
      return addDays(from, 1);
    case "weekly":
      return addDays(from, 7);
    case "weekdays": {
      let next = addDays(from, 1);
      while (isWeekend(next)) next = addDays(next, 1);
      return next;
    }
  }
}

export function minutesLabel(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** Whether the planner may put `task` on `day` (weekends are for life areas only). */
export function allowedOn(day: LocalDate, task: Pick<Task, "area">): boolean {
  return !isWeekend(day) || WEEKEND_AREAS.has(task.area);
}
