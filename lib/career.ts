import "server-only";
import type { Context } from "@/lib/context";
import { demoCalendar } from "@/lib/demoCalendar";
import { careerSnapshot } from "@/lib/domain/careerSnapshot";
import { addDays } from "@/lib/domain/dates";
import type { CareerSnapshot } from "@/lib/domain/types";
import { getCalendar } from "@/lib/integrations/calendar";

/**
 * The career tracker as of now: the Applications board plus interviews on your Google
 * Calendar from two weeks back (for thank-you notes) to two weeks ahead (for prep).
 * Read-only. Returns null when there is nothing to track yet.
 */
export async function loadCareerSnapshot(ctx: Pick<Context, "store" | "settings" | "today" | "now" | "mode">): Promise<CareerSnapshot | null> {
  const tz = ctx.settings.timezone;
  const from = addDays(ctx.today, -14);
  const to = addDays(ctx.today, 14);
  const [apps, cal] = await Promise.all([ctx.store.applications.list().catch(() => []), getCalendar(from, to, tz)]);
  const events = ctx.mode === "demo" && cal.status === "not_configured" ? demoCalendar(from, to, tz) : cal.events;
  return careerSnapshot(apps, events, ctx.now);
}
