// The 15-minute watch: when it runs and how much it does (docs/design-pipeline.md, 5.8).
// Pure: no I/O.
//
// Supabase Cron calls /api/cron/watch every 15 minutes, every day. The owner's local time
// decides whether it runs: 7 AM to 9 PM, the hours a push may be sent, so 7 AM stays 7 AM
// through daylight saving changes.

import { inQuietHours } from "./heardBack";

/** The task the watch logs under, as a run of the Applications Agent. */
export const WATCH_TASK = "Heard back watch";

/** Time the whole run may take. The route allows 60 seconds; this leaves the end of a run room to save. */
export const WATCH_LIMIT_MS = 50_000;

/** The watch runs in the hours a push may be sent: 7 AM up to, not including, 9 PM. */
export const isWatchTime = (hhmm: string): boolean => !inQuietHours(hhmm);

const minute = (hhmm: string) => Number(hhmm.slice(3, 5)) || 0;

/**
 * After Gmail refused or failed, the watch backs off to every 30 minutes: it tries on the
 * ticks at :00 and :30 only, until a sync works again (the 2-hour sync keeps running too).
 */
export const triesGmail = (hhmm: string, gmailInError: boolean): boolean => !gmailInError || minute(hhmm) % 30 < 15;

/** Mail that arrived this long before the last sync still counts as new: the two can overlap. */
const OVERLAP_MS = 2 * 60_000;

/**
 * Whether this tick reads and tracks job mail, or stops after the headers. It does the
 * whole pass when Gmail holds mail newer than the last sync that worked, and always on the
 * tick at the top of the hour, so a read that failed is tried again within the hour. A
 * quiet tick costs one Gmail login and a few small queries.
 */
export function wholePass(hhmm: string, newestMailAt: string | null, lastSyncAt: string | null): boolean {
  if (minute(hhmm) < 15) return true;
  if (!newestMailAt) return false;
  return !lastSyncAt || Date.parse(newestMailAt) > Date.parse(lastSyncAt) - OVERLAP_MS;
}
