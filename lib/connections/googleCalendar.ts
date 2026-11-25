import "server-only";
import { addDays, zonedToUtc } from "@/lib/domain/dates";
import { dedupe, shownCalendars, toEvents } from "@/lib/domain/googleCalendar";
import type { CalendarEvent, LocalDate } from "@/lib/domain/types";
import { refreshAccessToken, revokeToken } from "@/lib/integrations/google";
import { listCalendars, listEvents } from "@/lib/integrations/googleCalendar";
import { createServiceClient } from "@/lib/supabase/server";
import { HttpError } from "@/lib/security/safeFetch";
import { googleClient, googleMissing, loadConnection, markSync, saveConnection } from "./google";
import { ownerUserId, serviceReady } from "@/lib/owner";

// Google Calendar as a connection (24 Nov 2026): its own stored row ("google_calendar"), so the
// Gmail connection is untouched. The refresh token is sealed like Gmail's (lib/security/vault.ts)
// and opened only here, for one read. Events are read live and kept in memory for five minutes,
// never stored in the database.

const CACHE_MS = 5 * 60_000;
const TOKEN_MS = 50 * 60_000;

export type GoogleCalendarResult = { status: "ok"; events: CalendarEvent[] } | { status: "not_connected" } | { status: "error"; message: string };

let token: { value: string; until: number } | null = null;
const cache = new Map<string, { at: number; events: CalendarEvent[] }>();

/** Forgets the in-memory token and events: after connecting or disconnecting. */
export function clearCalendarCache(): void {
  token = null;
  cache.clear();
}

export function saveCalendarConnection(input: { email: string; scopes: string; refreshToken: string }): Promise<void> {
  clearCalendarCache();
  return saveConnection("google_calendar", { email: input.email, scopes: input.scopes, secret: input.refreshToken });
}

/** True when Google Calendar can be connected here: live mode with the Google settings set. */
export const calendarConnectable = () => googleMissing().length === 0;

/**
 * Your Google calendars' events between two days, in Google's colors. "not_connected" when you
 * have not connected it (the iCal address is used instead).
 */
export async function googleCalendarEvents(from: LocalDate, to: LocalDate, timeZone: string): Promise<GoogleCalendarResult> {
  if (!ownerUserId() || !serviceReady() || !calendarConnectable()) return { status: "not_connected" };
  const key = `${from}|${to}|${timeZone}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return { status: "ok", events: hit.events };

  const conn = await loadConnection("google_calendar").catch(() => null);
  if (!conn) return { status: "not_connected" };
  try {
    if (!token || token.until < Date.now()) token = { value: await refreshAccessToken(googleClient(), conn.secret), until: Date.now() + TOKEN_MS };
  } catch (err) {
    token = null;
    const message = err instanceof HttpError && (err.status === 400 || err.status === 401) ? "Google Calendar access expired or was revoked. Reconnect it." : "Could not reach Google.";
    await markSync("google_calendar", false, message).catch(() => undefined);
    return { status: "error", message };
  }
  try {
    const timeMin = zonedToUtc(from, "00:00", timeZone).toISOString();
    const timeMax = zonedToUtc(addDays(to, 1), "00:00", timeZone).toISOString();
    const calendars = shownCalendars(await listCalendars(token.value));
    // One calendar failing (a shared one you lost access to) leaves the others showing.
    const lists = await Promise.all(calendars.map((c) => listEvents(token!.value, c.id, timeMin, timeMax).then((raw) => toEvents(raw, c, timeZone)).catch(() => [] as CalendarEvent[])));
    const events = dedupe(lists.flat()).sort((a, b) => a.start.localeCompare(b.start));
    cache.set(key, { at: Date.now(), events });
    await markSync("google_calendar", true).catch(() => undefined);
    return { status: "ok", events };
  } catch {
    const message = "Reading Google Calendar failed. It tries again in a few minutes.";
    await markSync("google_calendar", false, message).catch(() => undefined);
    return { status: "error", message };
  }
}

/** Forgets the Google Calendar connection, revoking its token at Google. Gmail is untouched. */
export async function disconnectCalendar(): Promise<void> {
  const id = ownerUserId();
  if (!id || !serviceReady()) throw new Error("Owner service access is not configured");
  const conn = await loadConnection("google_calendar").catch(() => null);
  if (conn) await revokeToken(conn.secret);
  clearCalendarCache();
  const { error } = await createServiceClient().from("connections").delete().eq("owner_id", id).eq("provider", "google_calendar");
  if (error) throw new Error(`Removing the Google Calendar connection failed (${error.code ?? "error"})`);
}
