"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getContext } from "@/lib/context";
import { clearCalendarCache } from "@/lib/connections/googleCalendar";
import { CALENDAR_TAG } from "@/lib/integrations/calendar";
import { rateLimit } from "@/lib/security/rateLimit";
import type { ActionResult } from "./_shared";

/**
 * "Refresh calendar" on Today: reads Google Calendar (or the iCal address) again now, instead of
 * waiting for the five-minute cache. Read-only; it changes nothing in the calendar.
 */
export async function refreshCalendar(): Promise<ActionResult> {
  if (!rateLimit("calendar-refresh", 12, 5 * 60_000).allowed) return { ok: false, error: "Refreshed many times just now. Try again in a minute." };
  await getContext();
  clearCalendarCache();
  updateTag(CALENDAR_TAG);
  revalidatePath("/");
  return { ok: true, message: "Calendar refreshed." };
}
