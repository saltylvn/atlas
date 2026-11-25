import Link from "next/link";
import { FitToScreen, HourWindow, HoursPicker, KeepCurrent, LiveClock, NowLine, RefreshCalendar } from "@/components/client/CalendarLive";
import { Icon } from "@/components/Icon";
import { ViewSwitchSlot } from "@/components/ui";
import { weekdayIndex } from "@/lib/domain/dates";
import { clockFull, dayCalendar, gridPercent, hourName, MIN_BLOCK_MIN, WINDOW_CHOICES, WINDOW_DEFAULT, type CalendarBlock, type WindowHours } from "@/lib/domain/dayCalendar";
import { textOn } from "@/lib/domain/googleCalendar";
import { clockLabel } from "@/lib/domain/schedule";
import type { CalendarSource } from "@/lib/scheduling";
import type { LocalDate } from "@/lib/domain/types";

// Today as a calendar, drawn like Google Calendar's day view: only today, only what is on your
// calendar (read-only), in Google's colors. Made to be left up on an iPad or a Mac: on those the
// whole day fits on one screen, a red line marks now, and it refreshes itself.

/** Switches Today between its normal view and the calendar. Links, so each has its own address. */
export function TodayViewToggle({ view }: { view: "today" | "calendar" }) {
  const tab = (on: boolean) => `flex min-h-11 items-center gap-1.5 rounded-md px-3.5 text-sm font-medium ${on ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line-strong)]" : "text-ink-2 hover:text-ink"}`;
  return (
    <nav aria-label="Today's view" className="inline-flex gap-1 rounded-lg bg-surface-2 p-1">
      <Link href="/" aria-current={view === "today" ? "page" : undefined} className={tab(view === "today")}>
        <Icon name="today" size={15} /> Today
      </Link>
      <Link href="/?view=calendar" aria-current={view === "calendar" ? "page" : undefined} className={tab(view === "calendar")}>
        <Icon name="plan" size={15} /> Calendar
      </Link>
    </nav>
  );
}

/** On a phone the six-hour window is this tall per hour. On an iPad or a Mac it fills the screen. */
const PHONE_HOUR_PX = 80;
/** Google's blue, for today's date. */
const TODAY_BLUE = "#1a73e8";
const WEEKDAY = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export function DayCalendar({ calendar, day, dateLabel, timeZone, nowMin, hours = WINDOW_DEFAULT }: { calendar: CalendarSource; day: LocalDate; dateLabel: string; timeZone: string; nowMin: number; hours?: WindowHours }) {
  const view = dayCalendar(calendar.events, day, timeZone);
  const span = view.to - view.from;
  const next = view.blocks.find((b) => b.end > nowMin && !b.declined);
  const source = calendar.via === "google" ? "Google Calendar" : calendar.via === "demo" ? "Sample events (demo mode)" : "iCal address · connect Google Calendar in Connectors for its colors";
  return (
    <div className="space-y-3">
      <KeepCurrent />
      <ViewSwitchSlot>
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <TodayViewToggle view="calendar" />
          <div className="flex flex-wrap items-center gap-2">
            <RefreshCalendar />
            <HoursPicker hours={hours} choices={WINDOW_CHOICES} />
          </div>
        </div>
      </ViewSwitchSlot>

      {/* Google's day header: the weekday, today's date in a blue circle; then the clock and what is now or next. */}
      <header className="!mt-0 flex items-center gap-4">
        <div className="flex w-14 shrink-0 flex-col items-center md:w-[4.5rem]">
          <span className="text-xs font-medium" style={{ color: TODAY_BLUE }}>
            {WEEKDAY[weekdayIndex(day)]}
          </span>
          <span className="mt-0.5 flex h-11 w-11 items-center justify-center rounded-full text-[1.4rem] font-medium text-white" style={{ background: TODAY_BLUE }}>
            {Number(day.slice(8, 10))}
          </span>
        </div>
        <div className="min-w-0">
          <p className="h-display whitespace-nowrap text-[1.6rem] font-medium leading-none md:text-[2rem]">
            <LiveClock timeZone={timeZone} initial={clockFull(nowMin)} />
          </p>
          <p className="mt-1 truncate text-sm text-ink-2">
            {calendar.status !== "ok"
              ? dateLabel
              : next
                ? next.start <= nowMin
                  ? `Now: ${next.title}, until ${clockLabel(next.end)}`
                  : `Next: ${next.title} at ${clockLabel(next.start)}`
                : view.blocks.length
                  ? "Nothing else on the calendar today"
                  : "Nothing on the calendar today"}
          </p>
        </div>
        <p className="ml-auto hidden shrink-0 text-xs text-ink-3 lg:block">{source}</p>
      </header>

      {calendar.status === "not_configured" && <p className="card card-pad text-sm text-ink-2">No calendar is connected. Connect Google Calendar in Connectors, and today&apos;s events appear here.</p>}
      {calendar.status === "error" && <p className="card card-pad text-sm text-ink-2">Your calendar could not be read just now. This page tries again every five minutes.</p>}

      <FitToScreen label={`Calendar for ${dateLabel}`} className="card flex flex-col overflow-hidden" fallbackPx={hours * PHONE_HOUR_PX + (view.allDay.length ? 36 : 0)}>
        {/* All-day events sit in a row above the hours, as in Google. */}
        {view.allDay.length > 0 && (
          <ul aria-label="All day" className="flex shrink-0 flex-wrap gap-1 border-b border-line py-1.5 pl-[3.75rem] pr-2 md:pl-[4.5rem]">
            {view.allDay.map((e) => (
              <li key={e.id} className="max-w-full truncate rounded px-2 py-0.5 text-xs font-medium" style={e.color ? { background: e.color, color: textOn(e.color) } : { background: "color-mix(in oklab, var(--c-blue) 13%, var(--surface))", color: "var(--ink)" }}>
                {e.title}
              </li>
            ))}
          </ul>
        )}
        <HourWindow from={view.from} to={view.to} nowMin={nowMin} hours={hours} timeZone={timeZone}>
        <div className="grid h-full grid-cols-[3.75rem_minmax(0,1fr)] md:grid-cols-[4.5rem_minmax(0,1fr)]">
          {/* Hour labels, beside their line. */}
          <div aria-hidden className="relative">
            {view.hours.slice(1, -1).map((m) => (
              <span key={m} className="absolute right-2 -translate-y-1/2 text-xs text-ink-3 tabular-nums" style={{ top: `${gridPercent(view, m)}%` }}>
                {hourName(m)}
              </span>
            ))}
          </div>
          {/* The day: hour lines, fainter half hours, the events, and the line at now. */}
          <div className="relative border-l border-line">
            {view.hours.slice(1, -1).map((m) => (
              <span key={m} aria-hidden className="absolute -left-2 right-0 h-px bg-line" style={{ top: `${gridPercent(view, m)}%` }} />
            ))}
            {view.halves.map((m) => (
              <span key={m} aria-hidden className="absolute inset-x-0 h-px bg-line opacity-40" style={{ top: `${gridPercent(view, m)}%` }} />
            ))}
            <NowLine timeZone={timeZone} from={view.from} to={view.to} initialMin={nowMin} />
            <ol className="contents">
              {view.blocks.map((b) => {
                const top = ((b.start - view.from) / span) * 100;
                const tall = ((Math.max(b.end, b.start + MIN_BLOCK_MIN) - b.start) / span) * 100;
                const past = b.end <= nowMin;
                const short = b.end - b.start < 45;
                const tiny = b.end - b.start <= 20;
                return (
                  <li
                    key={b.id}
                    className={`absolute overflow-hidden rounded-md border px-2 ${tiny ? "py-0 text-[11px] leading-none" : "py-0.5 text-[13px] leading-tight"}`}
                    style={{
                      top: `calc(${top}% + 1px)`,
                      height: `calc(${tall}% - 2px)`,
                      left: `calc(${(b.col / b.cols) * 100}% + 2px)`,
                      width: `calc(${100 / b.cols}% - 12px)`,
                      ...blockLook(b),
                      // Google dims what is already over.
                      opacity: past ? 0.55 : 1,
                    }}
                  >
                    {short ? (
                      <p className="truncate">
                        <span className={`font-medium ${b.declined ? "line-through" : ""}`}>{b.title}</span>
                        <span className="opacity-90">, {clockLabel(b.start)}</span>
                      </p>
                    ) : (
                      <>
                        <p className={`truncate font-medium ${b.declined ? "line-through" : ""}`}>{b.title}</p>
                        <p className="truncate text-xs opacity-90">
                          {b.label}
                          {b.location ? ` · ${b.location}` : ""}
                        </p>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        </HourWindow>
      </FitToScreen>
      <p className="text-xs text-ink-3 md:hidden">{source}. Today only; refreshes every five minutes.</p>
    </div>
  );
}

/**
 * How one event is drawn, as Google draws it: filled in its color with white (or dark, on a
 * light color) text and a thin border in the page color between neighbours; Free, a pale fill;
 * declined, outlined. Without a color (iCal), Atlas blue, or orange for an interview Atlas added.
 */
function blockLook(b: CalendarBlock): Record<string, string> {
  if (b.color) {
    if (b.declined) return { background: "var(--surface)", borderColor: b.color, color: b.color };
    if (b.free) return { background: `color-mix(in oklab, ${b.color} 20%, var(--surface))`, borderColor: "var(--surface)", color: "var(--ink)" };
    return { background: b.color, borderColor: "var(--surface)", color: textOn(b.color) };
  }
  const hue = b.interview ? "var(--c-career)" : "var(--c-daily)";
  return { background: `color-mix(in oklab, ${hue} ${b.free ? 8 : 18}%, var(--surface))`, borderColor: "var(--surface)", color: "var(--ink)" };
}
