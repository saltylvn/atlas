import "server-only";
import { env } from "@/lib/env";
import type { Store } from "@/lib/data/store";
import type { Settings } from "@/lib/domain/types";
import { rateLimit } from "@/lib/security/rateLimit";
import { NO_TIME_FOR_MODEL, paceWait } from "@/lib/domain/deadline";

/** The burst limit: model calls per minute, per server instance, across every agent. */
const AI_PER_MINUTE = 10;
import { aiConfigured } from "./model";

/** `retryAfterMs` is set only when the per-minute limit refused: the wait until it allows calls again. */
export type Gate = { allowed: true } | { allowed: false; why: string; retryAfterMs?: number };

/** A gate after pacing: `waitedMs` is how long the run waited for the per-minute limit, 0 when it did not. */
export type PacedGate = Gate & { waitedMs: number };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The gate for a scheduled run that makes several calls in a row (the Career Map: one per type).
 * The evening run's agents share the per-minute limit, so the later calls can find it used up.
 * When it is, and the run has time to wait for the minute to turn and still make the call
 * (`reserveMs`: the call's own wait plus what the run does after it), it waits once and asks
 * again. Someone waiting on a button does not wait: the rules' version stands, as before.
 */
export async function takeAiCallPaced(
  ctx: { store: Store; settings: Settings; deadline?: number; patient?: boolean },
  purpose: string,
  reserveMs: number,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<PacedGate> {
  const gate = await takeAiCall(ctx.store, ctx.settings, purpose);
  if (gate.allowed || gate.retryAfterMs === undefined) return { ...gate, waitedMs: 0 };
  const ms = paceWait(gate.retryAfterMs, ctx.patient === true, ctx.deadline, Date.now(), reserveMs);
  if (ms === null) return { ...gate, waitedMs: 0 };
  await wait(ms);
  return { ...(await takeAiCall(ctx.store, ctx.settings, purpose)), waitedMs: ms };
}

/**
 * The gate for a model call inside a run with a deadline: `waitMs` comes from `modelWait`.
 * When no time is left, the call is not allowed and nothing is counted against today's limit.
 */
export async function takeAiCallWithin(store: Store, settings: Settings, purpose: string, waitMs: number): Promise<Gate> {
  if (waitMs <= 0) return { allowed: false, why: NO_TIME_FOR_MODEL };
  return takeAiCall(store, settings, purpose);
}

/** Every AI call passes this: kill switch, key present, burst limit, daily cap. */
export async function takeAiCall(store: Store, settings: Settings, purpose: string): Promise<Gate> {
  if (!settings.aiEnabled || !settings.outboundEnabled) return { allowed: false, why: "AI is switched off in Settings." };
  if (!aiConfigured()) return { allowed: false, why: "No AI key is set, so the offline drafter ran." };
  const burst = rateLimit("ai", AI_PER_MINUTE, 60_000);
  if (!burst.allowed) return { allowed: false, why: "Too many AI requests this minute.", retryAfterMs: burst.retryAfterSec * 1000 };
  const used = await store.aiUsage.countToday();
  if (used >= env().ATLAS_AI_DAILY_LIMIT) return { allowed: false, why: "Daily AI limit reached." };
  await store.aiUsage.record(purpose);
  return { allowed: true };
}
