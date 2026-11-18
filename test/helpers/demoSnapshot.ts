import { seedState } from "@/lib/data/memory";
import { careerSnapshot } from "@/lib/domain/careerSnapshot";
import { addDays, localDate } from "@/lib/domain/dates";
import type { CalendarEvent, CareerSnapshot } from "@/lib/domain/types";

/** The demo career tracker: the seeded applications plus a Northwind interview two days out. */
export function demoSnapshot(now: Date): CareerSnapshot {
  const s = seedState(now);
  const day = addDays(localDate(now, "America/Denver"), 2);
  const interview: CalendarEvent = {
    id: "demo-interview",
    title: "Northwind Labs interview (Round 2)",
    start: `${day}T21:00:00.000Z`,
    end: `${day}T22:00:00.000Z`,
    allDay: false,
    location: "https://example.com/meet/northwind",
    source: "calendar",
  };
  return careerSnapshot(s.applications ?? [], [interview], now)!;
}
