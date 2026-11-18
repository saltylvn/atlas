import Link from "next/link";
import { briefWeek, type BriefWeekState } from "@/lib/domain/briefSchedule";
import { longDate, weekdayName } from "@/lib/domain/dates";
import type { LocalDate } from "@/lib/domain/types";
import { Icon } from "./Icon";

export interface BriefDay {
  day: LocalDate;
  /** Briefs saved that day. */
  saved: number;
  /** Of those, how many you have not confirmed. */
  unread: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOfMonth = (d: LocalDate) => Number(d.slice(8, 10));
const month = (d: LocalDate) => MONTHS[Number(d.slice(5, 7)) - 1];

/** "Nov 16 – 22", or "Nov 30 – Dec 6" across a month. */
function weekRange(first: LocalDate, last: LocalDate): string {
  return month(first) === month(last) ? `${month(first)} ${dayOfMonth(first)} – ${dayOfMonth(last)}` : `${month(first)} ${dayOfMonth(first)} – ${month(last)} ${dayOfMonth(last)}`;
}

/** Why a day cannot be opened, for its tooltip and screen readers. */
const CLOSED: Partial<Record<BriefWeekState, string>> = {
  "none-saved": "no brief was saved that day",
  "too-old": "too far back to catch up",
  ahead: "coming up",
};

/**
 * The brief calendar on Today: this week, Monday to Sunday. Today and the two days before it
 * (never last week) open that day's briefs; the other days are shown for context only. A day
 * with briefs you have not confirmed shows how many.
 */
export function BriefDays({ today, days, current }: { today: LocalDate; days: BriefDay[]; current: LocalDate }) {
  const week = briefWeek(today, days);
  return (
    <nav aria-label="Briefs by day" className="card px-3 py-3 sm:px-4">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <span className="eyebrow flex items-center gap-1.5">
          <Icon name="clock" size={13} /> Briefs this week
        </span>
        <span className="text-xs text-ink-3">{weekRange(week[0]!.day, week[6]!.day)}</span>
      </div>
      <ol className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {week.map(({ day, state, unread }) => {
          const selected = day === current;
          const isToday = state === "today";
          const body = (
            <>
              <span className="text-[0.7rem] font-medium uppercase tracking-wide opacity-80">{weekdayName(day).slice(0, 3)}</span>
              <span className="h-display text-lg font-semibold leading-none sm:text-xl">{dayOfMonth(day)}</span>
              <span className="flex h-4 items-center text-[0.65rem] font-semibold leading-none">
                {isToday ? (
                  "Today"
                ) : unread > 0 ? (
                  <span className="rounded-full px-1.5 py-0.5" style={{ background: selected ? "color-mix(in oklab, var(--on-brand) 22%, transparent)" : "color-mix(in oklab, var(--c-blue) 16%, transparent)", color: selected ? "var(--on-brand)" : "var(--c-blue)" }}>
                    {unread} new
                  </span>
                ) : null}
              </span>
            </>
          );
          const cell = "flex min-h-[4.25rem] flex-col items-center justify-center gap-1 rounded-lg border text-center transition-colors";
          const label = `${longDate(day)}${isToday ? ", today" : ""}${unread > 0 ? `, ${unread} unread` : ""}`;
          if (state === "today" || state === "open") {
            const look = selected ? "border-brand-border bg-brand-solid text-[var(--on-brand)]" : isToday ? "border-brand-border text-brand hover:bg-brand-soft" : "border-line-strong text-ink hover:bg-surface-2";
            return (
              <li key={day}>
                <Link href={isToday ? "/" : `/?day=${day}`} aria-current={selected ? "page" : undefined} aria-label={label} className={`${cell} ${look}`}>
                  {body}
                </Link>
              </li>
            );
          }
          const why = CLOSED[state]!;
          return (
            <li key={day}>
              <span aria-disabled="true" aria-label={`${label}: ${why}`} title={why[0]!.toUpperCase() + why.slice(1)} className={`${cell} cursor-default text-ink-3 ${state === "none-saved" ? "border-dashed border-line-strong opacity-70" : "border-transparent opacity-45"}`}>
                {body}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
