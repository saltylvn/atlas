import "server-only";
import { env } from "@/lib/env";
import type { Store } from "@/lib/data/store";
import type { Settings } from "@/lib/domain/types";
import { rateLimit } from "@/lib/security/rateLimit";
import { NO_TIME_FOR_MODEL } from "@/lib/domain/deadline";
import { aiConfigured } from "./model";

export type Gate = { allowed: true } | { allowed: false; why: string };

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
  if (!rateLimit("ai", 10, 60_000).allowed) return { allowed: false, why: "Too many AI requests this minute." };
  const used = await store.aiUsage.countToday();
  if (used >= env().ATLAS_AI_DAILY_LIMIT) return { allowed: false, why: "Daily AI limit reached." };
  await store.aiUsage.record(purpose);
  return { allowed: true };
}
