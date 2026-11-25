import "server-only";
import { GCalCalendar } from "@/lib/domain/googleCalendar";
import { safeFetchJson } from "@/lib/security/safeFetch";

// The Google Calendar API, read-only (24 Nov 2026). Two scopes, the narrowest that give
// Google's colors: the list of calendars you are subscribed to (each with its color) and the
// events on them. Atlas never creates, edits or deletes an event. Responses are validated in
// lib/domain/googleCalendar.ts before anything is shown.

export const CALENDAR_LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
export const CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
export const CALENDAR_SCOPES = [CALENDAR_LIST_SCOPE, CALENDAR_EVENTS_SCOPE] as const;

const BASE = "https://www.googleapis.com/calendar/v3";
const TIMEOUT_MS = 6_000;

/** True when every calendar scope was granted (Google lets you untick boxes on its consent screen). */
export function hasCalendarScopes(granted: string): boolean {
  const have = new Set(granted.split(" "));
  return CALENDAR_SCOPES.every((s) => have.has(s));
}

/** Your calendar list, each with its color. Entries that do not parse are left out. */
export async function listCalendars(accessToken: string): Promise<GCalCalendar[]> {
  const q = new URLSearchParams({ maxResults: "50", fields: "items(id,summary,backgroundColor,colorId,selected,hidden,primary,accessRole)" });
  const res = await safeFetchJson<{ items?: unknown[] }>(`${BASE}/users/me/calendarList?${q}`, { headers: { authorization: `Bearer ${accessToken}` }, timeoutMs: TIMEOUT_MS });
  return (res.items ?? []).flatMap((i) => {
    const p = GCalCalendar.safeParse(i);
    return p.success ? [p.data] : [];
  });
}

/** One calendar's events between two instants, recurring ones expanded, as Google's raw JSON. */
export async function listEvents(accessToken: string, calendarId: string, timeMin: string, timeMax: string): Promise<unknown[]> {
  const q = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
    fields: "items(id,status,summary,location,colorId,transparency,eventType,start,end,attendees(self,responseStatus))",
  });
  const res = await safeFetchJson<{ items?: unknown[] }>(`${BASE}/calendars/${encodeURIComponent(calendarId)}/events?${q}`, { headers: { authorization: `Bearer ${accessToken}` }, timeoutMs: TIMEOUT_MS });
  return Array.isArray(res.items) ? res.items : [];
}
