import "server-only";
import type { z } from "zod";
import { env } from "@/lib/env";
import { claudeConfigured, structured as structuredClaude, type AiResult, type StructuredOptions } from "./claude";
import { geminiConfigured, structuredGemini } from "./gemini";

// The front door for every model call. Callers ask for a validated object and never
// know which provider wrote it: Claude (lib/ai/claude.ts) or Gemini (lib/ai/gemini.ts).
//
// Which one runs: ATLAS_AI_PROVIDER when it is set and that provider has a key;
// otherwise whichever key is present, Claude first. One provider per deployment, so
// costs, limits and what leaves the server are easy to reason about.

export type Provider = "anthropic" | "gemini";

export const PROVIDER_NAME: Record<Provider, string> = { anthropic: "Claude", gemini: "Gemini" };
export const PROVIDER_KEY: Record<Provider, string> = { anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" };

export function activeProvider(): Provider | null {
  const has: Record<Provider, boolean> = { anthropic: claudeConfigured(), gemini: geminiConfigured() };
  const want = env().ATLAS_AI_PROVIDER;
  if (want) return has[want] ? want : null;
  return has.anthropic ? "anthropic" : has.gemini ? "gemini" : null;
}

export function aiConfigured(): boolean {
  return activeProvider() !== null;
}

/** "Claude", "Gemini", or "AI" when no key is set. For labels. */
export function aiName(): string {
  const p = activeProvider();
  return p ? PROVIDER_NAME[p] : "AI";
}

/** What to add to turn AI on, for setup hints. */
export function aiMissing(): string {
  const want = env().ATLAS_AI_PROVIDER;
  return want ? PROVIDER_KEY[want] : "ANTHROPIC_API_KEY or GEMINI_API_KEY";
}

export async function structured<S extends z.ZodType>(schema: S, task: string, data: string, opts: StructuredOptions = {}): Promise<AiResult<z.infer<S>>> {
  const p = activeProvider();
  if (p === "gemini") return structuredGemini(schema, task, data, opts);
  if (p === "anthropic") return structuredClaude(schema, task, data, opts);
  return { ok: false, reason: "not_configured" };
}

export type { AiResult, StructuredOptions };

/**
 * Why a model call gave no answer, in words for a trace note: "no answer in time",
 * "busy (503)". Mission Control reads these back to say why an agent used its rules.
 */
export function whyNoAnswer(r: { reason: "not_configured" | "refused" | "invalid" | "error"; status?: number; detail?: string }): string {
  if (r.reason === "not_configured") return "not set up";
  if (r.reason === "refused") return "declined";
  if (r.reason === "invalid") return "answer failed its check";
  const s = r.status;
  // The provider's own code, when it gave one: "RESOURCE_EXHAUSTED", "INVALID_ARGUMENT".
  const code = r.detail?.split(":")[0]?.trim();
  const tag = (n: number) => (code ? `${n} ${code}` : `${n}`);
  if (s === undefined || s === 408) return "no answer in time";
  if (s === 429) return `rate-limited (${tag(s)})`;
  if (s >= 500) return `busy (${tag(s)})`;
  if (s === 401 || s === 403) return `key refused (${tag(s)})`;
  if (s === 404) return `model not found (${tag(s)})`;
  return `request refused (${tag(s)})`;
}

/**
 * A model call with a deadline. An agent inside a scheduled run must not hold the run
 * open for a slow model: after `ms` the caller gets an error result and takes its rules
 * path. (The request itself is left to finish or time out on its own.)
 */
export async function structuredWithin<S extends z.ZodType>(ms: number, schema: S, task: string, data: string, opts: StructuredOptions = {}): Promise<AiResult<z.infer<S>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<AiResult<z.infer<S>>>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, reason: "error" }), ms);
  });
  try {
    // The provider is told the deadline too, so Gemini can fall back to its fast model in time.
    return await Promise.race([structured(schema, task, data, { budgetMs: Math.max(3_000, ms - 300), ...opts }), late]);
  } finally {
    clearTimeout(timer);
  }
}
