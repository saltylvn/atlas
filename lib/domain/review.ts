// Weekly review: rules-based metrics from data Atlas already has, plus three concrete
// recommendations. Pure: no I/O. Display-only; nothing here changes your data.

import { addDays, daysBetween, mondayOf } from "./dates";
import { ACTIVE_STAGES } from "./jobs";
import { contactsDue } from "./relationships";
import type { Contact, CareerSnapshot, LedgerEntry, LocalDate, Task } from "./types";

export interface Trend {
  current: number;
  previous: number;
  /** current - previous */
  delta: number;
}

export interface WeeklyReview {
  /** Monday of the week under review. */
  weekOf: LocalDate;
  timeSaved: Trend & { daily: { day: LocalDate; minutes: number }[] };
  tasks: { planned: number; completed: number; rate: number; plannedMin: number; completedMin: number };
  overdue: { count: number; minutes: number; oldestDays: number; titles: string[] };
  keepInTouch: { due: number; overdueDays: number; names: string[] };
  pipeline: {
    appliedThisWeek: number;
    appliedLastWeek: number;
    movedThisWeek: number;
    active: number;
    responseRate: number;
    awaitingReply: number;
    avgDaysWaiting: number;
  } | null;
}

export interface ReviewInput {
  today: LocalDate;
  /** Local date of each ledger entry is derived with this. */
  toLocal: (iso: string) => LocalDate;
  ledger: LedgerEntry[];
  tasks: Task[];
  contacts: Contact[];
  snapshot: CareerSnapshot | null;
}

const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));
const trend = (current: number, previous: number): Trend => ({ current, previous, delta: current - previous });

/** Rolling 7-day windows ending today, so the review reads the same any day of the week. */
export function weeklyReview(input: ReviewInput): WeeklyReview {
  const { today, toLocal, ledger, tasks, contacts, snapshot } = input;
  const start = addDays(today, -6);
  const prevStart = addDays(today, -13);
  const inWeek = (d: LocalDate) => d >= start && d <= today;
  const inPrev = (d: LocalDate) => d >= prevStart && d < start;

  // Time saved
  const daily = Array.from({ length: 7 }, (_, i) => ({ day: addDays(start, i), minutes: 0 }));
  let cur = 0;
  let prev = 0;
  for (const e of ledger) {
    const d = toLocal(e.at);
    if (inWeek(d)) {
      cur += e.minutesSaved;
      const slot = daily.find((x) => x.day === d);
      if (slot) slot.minutes += e.minutesSaved;
    } else if (inPrev(d)) prev += e.minutesSaved;
  }

  // Tasks planned (scheduled on a day in the window) vs completed. Today's open tasks
  // are not counted against you yet; today's finished ones count.
  const planned = tasks.filter((t) => t.day && inWeek(t.day) && (t.day < today || t.status === "done"));
  const done = planned.filter((t) => t.status === "done");
  const sum = (ts: Task[]) => ts.reduce((n, t) => n + t.estimateMin, 0);

  // Overdue debt: scheduled before today and not done.
  const overdueTasks = tasks
    .filter((t) => t.day && t.day < today && t.status !== "done")
    .sort((a, b) => (a.day ?? "").localeCompare(b.day ?? ""));

  // Keep-in-touch debt: cadence contacts that are due (birthdays are not debt).
  const due = contactsDue(contacts, today).filter((d) => d.reason !== "birthday");

  let pipeline: WeeklyReview["pipeline"] = null;
  if (snapshot) {
    const apps = snapshot.applications.filter((a) => a.stage !== "Draft" && a.appliedDate);
    const appliedOn = (a: (typeof apps)[number]) => a.appliedDate.slice(0, 10);
    const responded = apps.filter((a) => a.stage !== "Applied" && a.stage !== "Withdrawn");
    const waiting = apps.filter((a) => a.stage === "Applied");
    pipeline = {
      appliedThisWeek: apps.filter((a) => inWeek(appliedOn(a))).length,
      appliedLastWeek: apps.filter((a) => inPrev(appliedOn(a))).length,
      movedThisWeek: apps.filter((a) => a.stage !== "Applied" && a.stageUpdatedAt && inWeek(toLocal(a.stageUpdatedAt))).length,
      active: apps.filter((a) => ACTIVE_STAGES.includes(a.stage)).length,
      responseRate: pct(responded.length, apps.length),
      awaitingReply: waiting.length,
      avgDaysWaiting: waiting.length
        ? Math.round(waiting.reduce((n, a) => n + Math.max(0, daysBetween(appliedOn(a), today)), 0) / waiting.length)
        : 0,
    };
  }

  return {
    weekOf: mondayOf(today),
    timeSaved: { ...trend(cur, prev), daily },
    tasks: {
      planned: planned.length,
      completed: done.length,
      rate: pct(done.length, planned.length),
      plannedMin: sum(planned),
      completedMin: sum(done),
    },
    overdue: {
      count: overdueTasks.length,
      minutes: sum(overdueTasks),
      oldestDays: overdueTasks[0]?.day ? daysBetween(overdueTasks[0].day, today) : 0,
      titles: overdueTasks.slice(0, 3).map((t) => t.title),
    },
    keepInTouch: {
      due: due.length,
      overdueDays: due.reduce((n, d) => n + d.days, 0),
      names: due.slice(0, 3).map((d) => d.contact.name),
    },
    pipeline,
  };
}

export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  /** Where to act. */
  href: string;
  /** Estimated minutes saved or recovered per week by acting on it. */
  minutesPerWeek: number;
  /** Higher sorts first. */
  weight: number;
}

/** Targets the rules compare against. */
export const REVIEW_TARGETS = {
  completionRate: 70,
  appliesPerWeek: 5,
  maxOverdue: 3,
  maxKeepInTouch: 3,
  minResponseRate: 15,
} as const;

/** All matching rules, strongest first. Take the top 3 for display. */
export function recommendations(r: WeeklyReview, max = 3): Recommendation[] {
  const out: Recommendation[] = [];
  const T = REVIEW_TARGETS;

  if (r.overdue.count > T.maxOverdue || r.overdue.oldestDays >= 7) {
    out.push({
      id: "overdue",
      title: `Clear ${r.overdue.count} overdue tasks in one 30-minute sweep`,
      detail: `${r.overdue.minutes} min of carried-over work, oldest ${r.overdue.oldestDays} days. Do, reschedule, or delete each one; anything carried twice goes back to the backlog.`,
      href: "/plan",
      minutesPerWeek: 30,
      weight: 60 + r.overdue.count * 4 + Math.min(r.overdue.oldestDays, 14),
    });
  } else if (r.overdue.count > 0) {
    out.push({
      id: "overdue-small",
      title: `Reschedule ${r.overdue.count} overdue task${r.overdue.count === 1 ? "" : "s"}`,
      detail: `${r.overdue.titles.join(", ")}. Small now, but carried tasks cost re-reading every morning.`,
      href: "/plan",
      minutesPerWeek: 10,
      weight: 30 + r.overdue.count * 4,
    });
  }

  if (r.tasks.planned >= 3 && r.tasks.rate < T.completionRate) {
    const perDay = Math.max(30, Math.round((r.tasks.completedMin * 1.2) / 5 / 15) * 15);
    out.push({
      id: "overplanned",
      title: "Plan less: you finished " + r.tasks.rate + "% of what you planned",
      detail: `Planned ${r.tasks.plannedMin} min, finished ${r.tasks.completedMin} min. Plan about ${perDay} min of tasks per weekday next week and leave the rest in the backlog.`,
      href: "/plan",
      minutesPerWeek: 20,
      weight: 50 + (T.completionRate - r.tasks.rate) / 2,
    });
  }

  if (r.pipeline) {
    const p = r.pipeline;
    if (p.appliedThisWeek < T.appliesPerWeek) {
      const gap = T.appliesPerWeek - p.appliedThisWeek;
      out.push({
        id: "apply-cadence",
        title: `Apply to ${gap} more role${gap === 1 ? "" : "s"} this week`,
        detail: `${p.appliedThisWeek} applications in 7 days (target ${T.appliesPerWeek}). Batch them: block 90 minutes and work the Apply items on Jobs.`,
        href: "/jobs",
        minutesPerWeek: 25,
        weight: 55 + gap * 5,
      });
    }
    if (p.awaitingReply >= 2 && p.avgDaysWaiting >= 7) {
      out.push({
        id: "follow-ups",
        title: `Follow up on ${p.awaitingReply} quiet applications`,
        detail: `Waiting ${p.avgDaysWaiting} days on average. Use the copy-ready drafts in Do next; each takes about 2 minutes to send.`,
        href: "/jobs",
        minutesPerWeek: 15,
        weight: 52 + p.avgDaysWaiting,
      });
    }
    if (p.active + p.awaitingReply >= 5 && p.responseRate < T.minResponseRate) {
      out.push({
        id: "response-rate",
        title: "Tighten targeting: response rate is " + p.responseRate + "%",
        detail: "Apply to fewer, higher-scoring roles (85+) and tailor the first resume bullet to the posting's top requirement.",
        href: "/settings",
        minutesPerWeek: 30,
        weight: 45,
      });
    }
  }

  if (r.keepInTouch.due > 0) {
    out.push({
      id: "keep-in-touch",
      title: `Batch ${r.keepInTouch.due} check-in${r.keepInTouch.due === 1 ? "" : "s"} in one sitting`,
      detail: `${r.keepInTouch.names.join(", ")}${r.keepInTouch.due > 3 ? " and more" : ""} are due. Draft them back to back in People; 10 minutes covers it.`,
      href: "/people",
      minutesPerWeek: 10,
      weight: (r.keepInTouch.due > T.maxKeepInTouch ? 48 : 35) + Math.min(r.keepInTouch.overdueDays, 20) / 2,
    });
  }

  if (r.timeSaved.current < r.timeSaved.previous) {
    out.push({
      id: "time-saved-drop",
      title: "Read the morning brief daily",
      detail: `Time saved fell from ${r.timeSaved.previous} to ${r.timeSaved.current} min. The brief alone is worth about 20 min a day.`,
      href: "/",
      minutesPerWeek: 60,
      weight: 40,
    });
  }

  // Fallbacks so there are always three concrete suggestions.
  const fallbacks: Recommendation[] = [
    { id: "weekly-reset", title: "Keep the Sunday reset", detail: "25 minutes to clear the backlog and set three goals keeps next week's plan honest.", href: "/plan", minutesPerWeek: 30, weight: 10 },
    { id: "batch-messages", title: "Batch messages twice a day", detail: "Draft replies in People at 11:30 and 16:30 instead of switching all day.", href: "/people", minutesPerWeek: 30, weight: 9 },
    { id: "deep-block", title: "Protect one 90-minute deep-work block a day", detail: "Schedule your top deep task first thing; shallow work fills the rest.", href: "/plan", minutesPerWeek: 45, weight: 8 },
  ];
  for (const f of fallbacks) if (out.length < max) out.push(f);

  return out.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)).slice(0, max);
}
