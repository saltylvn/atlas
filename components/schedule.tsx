// Server components for time-blocking. Every number and time here comes from
// lib/domain/schedule.ts; the words around them are display-only.

import Link from "next/link";
import { addDays, shortDate, weekdayName, zonedToUtc } from "@/lib/domain/dates";
import { minutesLabel } from "@/lib/domain/planner";
import { clockLabel, dayInsights, fromMinutes, rollForwardTargets, type DayLoad, type DaySchedule, type MoveSuggestion, type NowNext, type TimelineItem } from "@/lib/domain/schedule";
import type { LocalDate, Task } from "@/lib/domain/types";
import { AcceptPlanButton, Countdown, MoveList, RollButton } from "./client/DayPlan";
import { TaskCheck } from "./client/TaskCheck";
import { Icon } from "./Icon";
import { CardHeader, Empty, PriorityPill } from "./ui";

const iso = (day: LocalDate, min: number, tz: string) => zonedToUtc(day, fromMinutes(min), tz).toISOString();
const range = (i: { start: number; end: number }) => `${clockLabel(i.start)}–${clockLabel(i.end)}`;

export function NowNextCard({
  nn,
  schedule,
  tasks,
  day,
  timeZone,
  now,
}: {
  nn: NowNext;
  schedule: DaySchedule;
  tasks: Task[];
  day: LocalDate;
  timeZone: string;
  now: Date;
}) {
  const serverNow = now.toISOString();
  const suggestionTask = nn.gap?.suggestion?.taskId ? tasks.find((t) => t.id === nn.gap!.suggestion!.taskId) : undefined;
  const unplaced = schedule.overflow.length;
  const rolls = rollForwardTargets(tasks, day, Array.from({ length: 7 }, (_, i) => addDays(day, i + 1)));

  return (
    <section className="card card-pad border-l-4" style={{ borderLeftColor: "var(--brand)" }} aria-label="Now and next">
      <p className="eyebrow mb-2 flex items-center gap-1.5 text-brand">
        <Icon name="clock" size={14} /> Now / Next
      </p>

      {nn.state === "day-off" ? (
        <p className="h-display text-xl font-semibold">Day off. Nothing blocked.</p>
      ) : nn.current ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">Now · {range(nn.current)}</p>
          <p className="h-display mt-0.5 text-xl font-semibold leading-snug">{nn.current.title}</p>
          <p className="mt-0.5 text-sm text-ink-2">
            Ends <Countdown target={iso(day, nn.current.end, timeZone)} serverNow={serverNow} />
          </p>
        </div>
      ) : nn.gap ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">
            {nn.state === "before-work" ? `Work starts ${clockLabel(nn.gap.start)}` : "Right now"}
          </p>
          <p className="h-display mt-0.5 text-2xl font-semibold leading-snug">
            {minutesLabel(nn.gap.minutes)} free{nn.next ? "" : " until end of day"}
          </p>
          {suggestionTask ? (
            <div className="mt-2 flex items-center gap-3 rounded-lg bg-brand-soft px-3 py-2.5">
              <TaskCheck id={suggestionTask.id} done={false} label={suggestionTask.title} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-brand">Do this ({minutesLabel(suggestionTask.estimateMin)})</p>
                <p className="truncate font-medium">{suggestionTask.title}</p>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-2">{unplaced > 0 ? "Too short for anything on your list. Clear quick messages." : "Nothing left to block. Take a break or pull from the backlog."}</p>
          )}
        </div>
      ) : (
        <div>
          <p className="h-display text-xl font-semibold">Work day is done. Shut down.</p>
          <p className="mt-0.5 text-sm text-ink-2">
            {rolls.length > 0
              ? `${rolls.length} unfinished task${rolls.length === 1 ? "" : "s"} can roll to the next workday so tomorrow starts planned.`
              : "Nothing unfinished to carry over."}
          </p>
          <div className="mt-2">
            <RollButton count={rolls.length} label={`Roll ${rolls.length} forward`} />
          </div>
        </div>
      )}

      {nn.next && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3 text-sm">
          <span className="min-w-0">
            <span className="text-ink-3">Next · </span>
            <span className="font-medium">{nn.next.title}</span>
            <span className="text-ink-3"> · {clockLabel(nn.next.start)}</span>
          </span>
          <span className="shrink-0 font-semibold text-brand">
            <Countdown target={iso(day, nn.next.start, timeZone)} serverNow={serverNow} />
          </span>
        </div>
      )}
    </section>
  );
}

function itemStyle(i: TimelineItem): { bar: string; label: string } {
  if (i.kind === "event") return { bar: i.source === "interview" ? "var(--c-pink)" : "var(--c-grey)", label: i.source === "interview" ? "Interview" : "Meeting" };
  if (i.kind === "pinned") return { bar: "var(--brand)", label: i.deep ? "Deep work · scheduled" : "Scheduled" };
  return { bar: "var(--brand)", label: i.deep ? "Deep work · suggested" : "Suggested" };
}

export function DayTimeline({
  schedule,
  tasks,
  nowMin,
  calendarNote,
}: {
  schedule: DaySchedule;
  tasks: Task[];
  nowMin: number;
  calendarNote?: string;
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const items = schedule.timeline.filter((i) => i.end > schedule.work.start - 60 && i.start < schedule.work.end + 120);
  const conflictIds = new Set(schedule.conflicts.map((c) => c.taskId));
  const insights = dayInsights(schedule);
  const overflowMoves = rollForwardTargets(
    tasks.filter((t) => schedule.overflow.some((o) => o.taskId === t.id)),
    schedule.day,
    Array.from({ length: 7 }, (_, i) => addDays(schedule.day, i + 1)),
  );
  const hint = [
    `${minutesLabel(schedule.freeMin)} free`,
    `${minutesLabel(schedule.meetingMin)} meetings`,
    `${minutesLabel(schedule.blockedMin)} of ${minutesLabel(schedule.capacityMin)} tasks`,
    calendarNote,
  ]
    .filter(Boolean)
    .join(" · ");

  // Free gaps between items, so open time is visible too.
  const rows: ({ type: "item"; item: TimelineItem } | { type: "gap"; start: number; end: number })[] = [];
  let cursor = Math.max(schedule.work.start, Math.min(nowMin, schedule.work.end));
  for (const item of items) {
    if (item.start - cursor >= schedule.work.minSlotMin && item.start > nowMin) rows.push({ type: "gap", start: cursor, end: item.start });
    rows.push({ type: "item", item });
    cursor = Math.max(cursor, item.end);
  }
  if (schedule.work.end - cursor >= schedule.work.minSlotMin) rows.push({ type: "gap", start: cursor, end: schedule.work.end });

  return (
    <section className="card card-pad" aria-label="Your day, blocked">
      <CardHeader title="Your day, blocked" icon="plan" hint={hint} />

      {insights.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {insights.map((x) => (
            <li
              key={x.text}
              className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${x.level === "warn" ? "bg-[color-mix(in_srgb,var(--c-orange)_14%,transparent)]" : "bg-brand-soft"}`}
            >
              <Icon name={x.level === "warn" ? "alert" : "sparkle"} size={15} className={`mt-0.5 shrink-0 ${x.level === "warn" ? "text-[var(--c-orange)]" : "text-brand"}`} />
              <span>{x.text}</span>
            </li>
          ))}
        </ul>
      )}

      {schedule.allDay.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {schedule.allDay.map((e) => (
            <span key={e.id} className="chip">
              All day · {e.title}
            </span>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <Empty>{schedule.dayOff ? "Day off: nothing to block." : "Nothing on the calendar and nothing to block."}</Empty>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r) => {
            if (r.type === "gap") {
              return (
                <li key={`gap-${r.start}`} className="flex items-center gap-3 px-1 py-1 text-xs text-ink-3">
                  <span className="w-[58px] shrink-0 text-right tabular-nums">{clockLabel(r.start)}</span>
                  <span className="h-px flex-1 border-t border-dashed border-line" />
                  <span>Free {minutesLabel(r.end - r.start)}</span>
                </li>
              );
            }
            const i = r.item;
            const s = itemStyle(i);
            const past = i.end <= nowMin;
            const live = i.start <= nowMin && nowMin < i.end;
            const t = i.taskId ? byId.get(i.taskId) : undefined;
            return (
              <li
                key={i.id}
                className={`flex items-stretch gap-3 rounded-lg ${past ? "opacity-50" : ""} ${live ? "bg-brand-soft" : ""}`}
              >
                <span className="w-[58px] shrink-0 pt-2 text-right text-xs font-semibold tabular-nums text-ink-2">{clockLabel(i.start)}</span>
                <span
                  className={`my-1 w-1 shrink-0 rounded-full ${i.kind === "focus" ? "opacity-60" : ""}`}
                  style={{ background: s.bar }}
                  aria-hidden
                />
                <div className={`min-w-0 flex-1 rounded-lg px-3 py-2 ${i.kind === "focus" ? "border border-dashed border-[var(--brand)]" : i.kind === "pinned" ? "bg-surface-2" : ""}`}>
                  <div className="flex items-start gap-2">
                    {t && <TaskCheck id={t.id} done={t.status === "done"} label={t.title} />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{i.title}</p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                        <span>{range(i)}</span>
                        <span>· {s.label}</span>
                        {live && <span className="font-semibold text-brand">· now</span>}
                        {i.taskId && conflictIds.has(i.taskId) && <span className="font-semibold text-bad">· clashes with a meeting</span>}
                      </p>
                    </div>
                    {i.priority && i.priority !== "medium" && i.priority !== "low" && (
                      <span className="hidden sm:inline">
                        <PriorityPill priority={i.priority} />
                      </span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {schedule.overflow.length > 0 && (
        <div className="mt-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
          <p className="font-semibold">Won&apos;t fit today ({schedule.overflow.length})</p>
          <ul className="mt-1 space-y-0.5 text-ink-2">
            {schedule.overflow.map((o) => {
              const t = byId.get(o.taskId);
              return (
                <li key={o.taskId} className="truncate">
                  {t?.title} <span className="text-ink-3">· {t ? minutesLabel(t.estimateMin) : ""} · {o.reason === "capacity" ? "over capacity" : "no gap long enough"}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <RollButton count={overflowMoves.length} label={`Move ${overflowMoves.length} to next workday`} moves={overflowMoves} />
            <Link href="/plan" className="inline-flex min-h-[44px] items-center gap-1 text-sm font-semibold text-brand">
              Rebalance on Plan <Icon name="arrow" size={14} />
            </Link>
          </div>
        </div>
      )}

      {schedule.timeline.some((i) => i.kind !== "event") && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-ink-3">
            {schedule.blocks.length > 0 ? "Accept pins the suggested times on your tasks in Atlas. Your calendar is not changed." : "Today's tasks have times. Change one from Plan, or undo below."}
          </p>
          <AcceptPlanButton count={schedule.blocks.length} />
        </div>
      )}
    </section>
  );
}

export function WeekLoadCard({ loads, moves, tasks, today, week }: { loads: DayLoad[]; moves: MoveSuggestion[]; tasks: Task[]; today: LocalDate; week: LocalDate[] }) {
  const byDay = new Map(loads.map((l) => [l.day, l]));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const over = loads.filter((l) => l.day >= today && l.overMin > 0);

  return (
    <section className="card card-pad" aria-label="Free time vs planned">
      <CardHeader
        title="Free time vs planned"
        icon="clock"
        hint="Free = work hours minus meetings (capped at your daily capacity)."
      />
      <ul className="space-y-2">
        {week.map((d) => {
          const l = byDay.get(d);
          if (!l) return null;
          const past = d < today;
          const scale = Math.max(l.availableMin, l.plannedMin, 60);
          const fillPct = Math.min(100, Math.round((Math.min(l.plannedMin, l.availableMin) / scale) * 100));
          const overPct = Math.min(100 - fillPct, Math.round((l.overMin / scale) * 100));
          const freePct = Math.max(0, Math.round((l.availableMin / scale) * 100) - fillPct);
          return (
            <li key={d} className={`grid grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-3 ${past ? "opacity-45" : ""}`}>
              <span className={`whitespace-nowrap text-sm font-semibold ${d === today ? "text-brand" : "text-ink-2"}`}>
                {weekdayName(d).slice(0, 3)} <span className="text-ink-3">{Number(d.slice(8))}</span>
              </span>
              <span className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
                <span className="h-full" style={{ width: `${fillPct}%`, background: "var(--c-green)" }} />
                <span className="h-full" style={{ width: `${freePct}%`, background: "transparent" }} />
                <span className="h-full" style={{ width: `${overPct}%`, background: "var(--c-red)" }} />
              </span>
              <span className={`text-right text-xs tabular-nums ${l.overMin > 0 ? "font-semibold text-bad" : "text-ink-3"}`}>
                {l.dayOff ? "Day off" : past ? "—" : `${minutesLabel(l.plannedMin)} / ${minutesLabel(l.availableMin)}`}
                {l.overMin > 0 && <span className="block">+{minutesLabel(l.overMin)} over</span>}
                {!past && !l.dayOff && l.meetingMin >= 240 && <span className="block text-[var(--c-orange)]">{minutesLabel(l.meetingMin)} meetings</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {over.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">Every day fits in its free time.</p>
      ) : moves.length === 0 ? (
        <p className="mt-3 text-sm text-bad">
          {over.map((l) => shortDate(l.day)).join(", ")} {over.length === 1 ? "is" : "are"} overbooked and no other day has room. Drop or shrink a task.
        </p>
      ) : null}
      <MoveList
        rows={moves.map((m) => ({
          taskId: m.taskId,
          to: m.to,
          title: byId.get(m.taskId)?.title ?? m.taskId,
          detail: `${minutesLabel(m.minutes)} · ${shortDate(m.from)}`,
          toLabel: shortDate(m.to),
        }))}
      />
    </section>
  );
}
