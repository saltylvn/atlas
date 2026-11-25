// A run has a hard stop: Vercel ends the function at its maxDuration, mid-step, with no
// chance to save or log. So every model call inside a run waits only as long as the time
// left allows, minus what the run still has to do after it. When too little is left, the
// model is skipped and the rules' version stands: a plainer brief beats no brief.

/** Vercel stops a page or a server action after this long (`maxDuration = 60` on the pages). Someone is waiting. */
export const FUNCTION_LIMIT_MS = 60_000;

/**
 * Vercel stops a scheduled run after this long: `maxDuration = 300` on the cron routes, the
 * Hobby plan's limit with Fluid compute. Nobody is waiting on a 7 AM run, so it may take
 * its time with a slow free-tier model.
 */
export const SCHEDULED_LIMIT_MS = 300_000;

/** The longest one model call waits inside a scheduled run. */
export const SCHEDULED_AI_CAP_MS = 60_000;

/** A model call's cap: its own when someone is waiting, a minute in a scheduled run. The deadline still cuts it. */
export const aiCap = (ctx: { patient?: boolean }, interactiveMs: number): number => (ctx.patient ? Math.max(interactiveMs, SCHEDULED_AI_CAP_MS) : interactiveMs);

/** Below this, a model call is not worth starting. */
export const MIN_MODEL_WAIT_MS = 4_000;

/** Kept back by a specialist's model call: the brief still has to be assembled, saved and logged. */
export const AFTER_SPECIALIST_MS = 10_000;

/** Kept back by the brief's own wording: saving the wording, logging the run, the phone ping. */
export const AFTER_WORDING_MS = 5_000;

/**
 * How long a model call may wait: its own cap, cut to the time left before `deadline`
 * minus `reserveMs`. 0 means skip the model. With no deadline, the cap stands.
 */
export function modelWait(capMs: number, deadline: number | undefined, now: number, reserveMs: number): number {
  if (deadline === undefined) return capMs;
  const ms = Math.min(capMs, deadline - now - reserveMs);
  return ms >= MIN_MODEL_WAIT_MS ? ms : 0;
}

/** Added to the per-minute limit's wait, so the next call lands after the minute has turned. */
export const PACE_SLACK_MS = 500;

/**
 * How long a run waits for the per-minute AI limit to allow calls again, or null to not wait:
 * only a scheduled (patient) run with a deadline waits, and only when, after the wait, there is
 * still `reserveMs` (the call and what follows it) plus a model call's minimum before the deadline.
 */
export function paceWait(retryAfterMs: number, patient: boolean, deadline: number | undefined, now: number, reserveMs: number): number | null {
  if (!patient || deadline === undefined) return null;
  const ms = Math.max(0, retryAfterMs) + PACE_SLACK_MS;
  return deadline - now - ms - reserveMs >= MIN_MODEL_WAIT_MS ? ms : null;
}

/** What the trace says when the model was skipped for time. */
export const NO_TIME_FOR_MODEL = "Too little time left in this run to wait for the model.";
