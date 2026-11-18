// Model choice and cost, per the plan: a cheaper, faster model for simple work
// (sorting, tagging) and a stronger one for writing (briefs, cover letters, prep).
// Prices are USD per million tokens from Anthropic's published pricing; costs are
// estimates for Mission Control, not a bill.

export type ModelTier = "fast" | "writer";

export const MODELS: Record<ModelTier, string> = {
  fast: "claude-haiku-5-5",
  writer: "claude-opus-5-5",
};

interface Price {
  input: number;
  output: number;
  cacheRead: number;
}

/**
 * Gemini defaults; ATLAS_GEMINI_MODEL_FAST / _WRITER override them without a code change.
 * The writer was gemini-4-hydrogen until 17 Nov 2026: on the free tier it answered "503
 * high demand" or not at all within 20 s, while the Flash models answered in about a second.
 */
export const GEMINI_MODELS: Record<ModelTier, string> = {
  fast: "gemini-3.5-flash-lite",
  writer: "gemini-3.8-flash",
};

/** Models the connection check also tries, though not in use, so you can see when one is worth switching back to. */
export const GEMINI_WATCH: readonly string[] = ["gemini-4-hydrogen"];

const PRICES: Record<string, Price> = {
  // Google's published paid-tier prices (14 Nov 2026). Thinking tokens bill as output.
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cacheRead: 0.03 },
  "gemini-3.8-flash": { input: 0.75, output: 3.75, cacheRead: 0.075 },
  "gemini-4-hydrogen": { input: 1.5, output: 7.5, cacheRead: 0.075 },
  "gemini-4-carbon": { input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
};

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number;
}

/** Cache writes bill at 1.25x input; reads at the cache-read rate. Unknown models cost 0 (and show as such). */
export function costUsd(model: string, t: { input: number; output: number; cacheWrite?: number; cacheRead?: number }): number {
  const p = PRICES[model];
  if (!p) return 0;
  const dollars = (t.input * p.input + t.output * p.output + (t.cacheWrite ?? 0) * p.input * 1.25 + (t.cacheRead ?? 0) * p.cacheRead) / 1_000_000;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
