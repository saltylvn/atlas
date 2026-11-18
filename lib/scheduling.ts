import "server-only";
import type { Context } from "@/lib/context";
import { demoCalendar } from "@/lib/demoCalendar";
import { addDays, localTime, mondayOf, weekOf } from "@/lib/domain/dates";
import {
  blockDay,
  nowNext,
  suggestMoves,
  toMinutes,
  weekLoad,
  workHoursFrom,
  type DayLoad,
  type DaySchedule,
  type MoveSuggestion,
  type NowNext,
} from "@/lib/domain/schedule";
import type { CalendarEvent, LocalDate, Task } from "@/lib/domain/types";
import { getCalendar } from "@/lib/integrations/calendar";

export interface CalendarSource {
  events: CalendarEvent[];
  status: "ok" | "not_configured" | "error";
  /** True when demo mode filled in a fictional calendar. */
  sample: boolean;
}

/** The owner's calendar for a date range (interviews are already on it). */
export async function calendarFor(ctx: Context, from: LocalDate, to: LocalDate): Promise<CalendarSource> {
  const tz = ctx.settings.timezone;
  const cal = await getCalendar(from, to, tz);
  if (ctx.mode === "demo" && cal.status === "not_configured") {
    return { events: demoCalendar(from, to, tz), status: "ok", sample: true };
  }
  return { events: cal.events, status: cal.status, sample: false };
}

export function nowMinutes(ctx: Pick<Context, "now" | "settings">): number {
  return toMinutes(localTime(ctx.now, ctx.settings.timezone));
}

export interface TodaySchedule {
  schedule: DaySchedule;
  nowNext: NowNext;
  nowMin: number;
  tasks: Task[];
  calendar: CalendarSource;
}

/** Today's blocked day. `tasks` can be passed in when the caller already loaded them. */
export async function loadTodaySchedule(ctx: Context, tasks?: Task[]): Promise<TodaySchedule> {
  const [list, calendar] = await Promise.all([tasks ? Promise.resolve(tasks) : ctx.store.tasks.list(), calendarFor(ctx, ctx.today, ctx.today)]);
  const nowMin = nowMinutes(ctx);
  const schedule = blockDay({
    day: ctx.today,
    timeZone: ctx.settings.timezone,
    events: calendar.events,
    tasks: list,
    work: workHoursFrom(ctx.settings),
    dailyCapacityMin: ctx.settings.dailyCapacityMin,
    nowMin,
  });
  return { schedule, nowNext: nowNext(schedule, nowMin), nowMin, tasks: list, calendar };
}

export interface WeekSchedule {
  loads: DayLoad[];
  moves: MoveSuggestion[];
  calendar: CalendarSource;
}

export async function loadWeekSchedule(ctx: Context, tasks: Task[]): Promise<WeekSchedule> {
  const week = weekOf(ctx.today);
  // Late in the week, look one week further so overflow has somewhere to go (as autoPlanWeek does).
  const days = week.filter((d) => d >= ctx.today).length <= 2 ? [...week, ...weekOf(addDays(mondayOf(ctx.today), 7))] : week;
  const calendar = await calendarFor(ctx, days[0]!, days[days.length - 1]!);
  const loads = weekLoad({
    days,
    today: ctx.today,
    nowMin: nowMinutes(ctx),
    timeZone: ctx.settings.timezone,
    events: calendar.events,
    tasks,
    work: workHoursFrom(ctx.settings),
    dailyCapacityMin: ctx.settings.dailyCapacityMin,
  });
  return { loads, moves: suggestMoves(loads, tasks, ctx.today), calendar };
}
