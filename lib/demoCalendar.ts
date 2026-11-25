import { addDays, weekdayIndex, zonedToUtc } from "@/lib/domain/dates";
import type { CalendarEvent, LocalDate } from "@/lib/domain/types";

/**
 * Fictional meetings for demo mode, so time-blocking has something to work around.
 * Only used when no calendar is configured and the app runs on the in-memory seed.
 */
export function demoCalendar(from: LocalDate, to: LocalDate, timeZone: string): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  const mk = (day: LocalDate, start: string, end: string, title: string, color = "#039be5"): CalendarEvent => ({
    id: `demo:${day}:${start}`,
    title,
    start: zonedToUtc(day, start, timeZone).toISOString(),
    end: zonedToUtc(day, end, timeZone).toISOString(),
    allDay: false,
    location: "",
    source: "calendar",
    color,
  });
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const wd = weekdayIndex(day);
    if (wd >= 5) continue;
    if (wd !== 3) out.push(mk(day, "09:00", "09:15", "Team standup"));
    if (wd === 0 || wd === 2) out.push(mk(day, "11:30", "12:15", "Customer call: Bluebird Health", "#f6bf26"));
    if (wd === 1) out.push(mk(day, "10:00", "15:00", "Onsite workshop: Northwind", "#0b8043"));
    if (wd === 3) out.push(mk(day, "08:00", "17:00", "Northwind offsite"));
    if (wd === 2) out.push(mk(day, "14:00", "15:00", "Northwind demo sync"));
    if (wd !== 3) out.push(mk(day, "16:30", "17:00", "1:1 with Marcus"));
    if (wd === 4) out.push(mk(day, "15:00", "16:00", "Dentist appointment", "#8e24aa"));
    if (wd === 1) out.push(mk(day, "16:00", "16:30", "Northwind Labs interview (Round 2)", "#f4511e"));
  }
  return out;
}
