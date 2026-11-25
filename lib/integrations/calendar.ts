import "server-only";
import { env } from "@/lib/env";
import { FEED_TIMEOUT_MS, safeFetchText } from "@/lib/security/safeFetch";
import type { CalendarEvent, LocalDate } from "@/lib/domain/types";
import { eventsBetween } from "./ical";

/** The cache tag on the calendar feed: Refresh calendar expires it. */
export const CALENDAR_TAG = "calendar";

export interface CalendarResult {
  events: CalendarEvent[];
  status: "ok" | "not_configured" | "error";
}

/** Reads the owner's calendar from a secret iCal address. Read-only by construction. */
export async function getCalendar(from: LocalDate, to: LocalDate, timeZone: string): Promise<CalendarResult> {
  const url = env().CALENDAR_ICS_URL;
  if (!url) return { events: [], status: "not_configured" };
  try {
    const host = new URL(url).hostname;
    const ics = await safeFetchText(url, { revalidate: 300, tags: [CALENDAR_TAG], timeoutMs: FEED_TIMEOUT_MS.calendar, maxBytes: 5_000_000, extraHosts: [host], accept: "text/calendar" });
    return { events: eventsBetween(ics, from, to, timeZone), status: "ok" };
  } catch {
    // Never echo the URL: it is a credential.
    return { events: [], status: "error" };
  }
}
