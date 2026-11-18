import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import { demoCalendar } from "@/lib/demoCalendar";
import { aheadUntil, SLOT_LABEL } from "@/lib/domain/briefSchedule";
import { calendarAgentReport, type CalendarAgentResult, type CalendarInterview } from "@/lib/domain/calendarAgent";
import type { CalendarMissing } from "@/lib/domain/chiefOfStaff";
import type { AgentRunEvent, BriefSlot } from "@/lib/domain/types";
import { getCalendar } from "@/lib/integrations/calendar";
import { isPaused, logRun, NO_MODEL } from "./log";
import { NO_TRACE, tracer, type Tracer } from "./trace";

// The Calendar Agent at run time: read Google Calendar (read-only, through the secret
// iCal address), then hand the pure report builder the events and the interviews the
// Chief of Staff passed in. Rules only, no model call, so every run costs $0.

/** The agent's work without logging. Today's live preview uses this directly. */
export async function calendarAgentWork(ctx: Context, slot: BriefSlot, interviews: CalendarInterview[], t: Tracer = NO_TRACE): Promise<CalendarAgentResult> {
  const { today, settings } = ctx;
  const until = aheadUntil(today, slot);
  let cal = await t.step(
    "Read Google Calendar (secret iCal address, read-only)",
    () => getCalendar(today, until, settings.timezone),
    (c) => (c.status === "ok" ? `${c.events.length} events from ${today} to ${until}` : c.status === "error" ? "The calendar could not be read" : "No calendar connected"),
  );
  // Demo mode on the in-memory seed shows fictional meetings so the brief has something in it.
  if (ctx.mode === "demo" && cal.status === "not_configured") cal = { events: demoCalendar(today, until, settings.timezone), status: "ok" };
  const events = cal.events;
  const status = cal.status;
  return t.step(
    "Review: conflicts, appointments, interviews",
    () => calendarAgentReport({ slot, forDate: today, aheadUntil: until, timeZone: settings.timezone, events, status, interviews }),
    (r) => `${r.section?.conflicts.length ?? 0} conflicts, ${r.section?.important?.length ?? 0} to keep in mind, ${interviews.length} tracked interviews checked`,
  );
}

export interface CalendarRunOptions {
  trigger: AgentRunEvent["trigger"];
  interviews: CalendarInterview[];
  /** Scheduled and Chief of Staff runs honor Pause; the agent's own Run Now does not. */
  honorPause: boolean;
}

/** One logged Calendar Agent run. Never throws: a failure comes back as `missing`. */
export async function runCalendarAgent(ctx: Context, slot: BriefSlot, opts: CalendarRunOptions): Promise<CalendarAgentResult | CalendarMissing> {
  const agent = "calendar" as const;
  const runId = randomUUID();
  const task = `Calendar review for the ${SLOT_LABEL[slot]}`;
  const { trigger } = opts;

  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }

  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const result = await calendarAgentWork(ctx, slot, opts.interviews, t);
    if (result.status === "not_configured") {
      await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "No calendar connected (CALENDAR_ICS_URL)", ...NO_MODEL, ...t.finish() });
    } else if (result.status === "error") {
      // The calendar could not be read: logged as a failure so it shows in Errors & alerts.
      await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: "Calendar could not be read", ...NO_MODEL, ...t.finish() });
    } else {
      const s = result.section!;
      const detail = [
        `${s.today.length} today`,
        `${s.ahead.reduce((n, d) => n + d.events.length, 0)} ahead`,
        s.conflicts.length ? `${s.conflicts.length} conflict${s.conflicts.length === 1 ? "" : "s"}` : "",
        s.interviews?.length ? `${s.interviews.length} interview${s.interviews.length === 1 ? "" : "s"}` : "",
        result.report.needsApproval.length ? `${result.report.needsApproval.length} to approve` : "",
      ]
        .filter(Boolean)
        .join(", ");
      await logRun(ctx, { runId, agent, task, status: "succeeded", trigger, detail, ...NO_MODEL, ...t.finish() });
    }
    return result;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
