import "server-only";
import { z } from "zod";
import { env } from "@/lib/env";
import { HttpError, safeFetchText } from "@/lib/security/safeFetch";
import type { AiResult, StructuredOptions } from "./claude";
import { SYSTEM_RULES } from "./claude";
import { costUsd, GEMINI_MODELS, GEMINI_WATCH, type ModelTier, type Usage } from "./models";
import { fenceData } from "./prompts";

// The one file that talks to Google Gemini. Same contract as lib/ai/claude.ts: a task, a
// block of untrusted data, a zod schema; back comes a validated object or a reason.
// Server-only. No SDK: one https request through the outbound allowlist.
//
// - The key travels in the `x-goog-api-key` header, never in the URL (URLs end up in logs).
// - Untrusted text is fenced in <data> tags, with the fence stripped from the text first.
// - The reply must be JSON matching the schema; it is validated again here with zod.
// - No tools, no search, no code execution are ever requested.
//
// Use a key from a project with billing on. On Google's free tier, prompts may be used
// to improve Google's products; on the paid tier they are not.

const HOST = "generativelanguage.googleapis.com";
const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

export function geminiConfigured(): boolean {
  return Boolean(env().GEMINI_API_KEY);
}

export function geminiModel(tier: ModelTier): string {
  const e = env();
  return (tier === "fast" ? e.ATLAS_GEMINI_MODEL_FAST : e.ATLAS_GEMINI_MODEL_WRITER) ?? GEMINI_MODELS[tier];
}

/**
 * How a request is shaped. Tried in this order, and remembered per model once one works:
 *   schema  JSON Schema enforced by the API, with a low thinking level (fastest, strictest)
 *   plain   JSON mode with the schema spelled out in the task, still low thinking
 *   bare    the same without the thinking setting, for a model that rejects it
 * Dropping the thinking setting is the last resort: without it a thinking model such as
 * gemini-4-hydrogen thinks at its "high" default, which is slow.
 */
export const SHAPES = ["schema", "plain", "bare"] as const;
export type Shape = (typeof SHAPES)[number];

/** The request body for a shape. */
export function geminiBody(schema: z.ZodType, task: string, data: string, effort: "low" | "medium", shape: Shape) {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const withSchema = shape === "schema";
  const ask = withSchema ? task : `${task}\n\nReply with one JSON object that matches this JSON Schema, and nothing else:\n${JSON.stringify(jsonSchema)}`;
  return {
    systemInstruction: { parts: [{ text: SYSTEM_RULES }] },
    contents: [{ role: "user", parts: [{ text: `${ask}\n\n<data>\n${fenceData(data)}\n</data>` }] }],
    generationConfig: {
      responseMimeType: "application/json",
      ...(withSchema ? { responseJsonSchema: jsonSchema } : {}),
      // Thinking counts toward this limit and is billed as output, so it is kept low.
      maxOutputTokens: 4000,
      ...(shape !== "bare" ? { thinkingConfig: { thinkingLevel: effort === "medium" ? "MEDIUM" : "LOW" } } : {}),
    },
  };
}

const count = z.number().int().nonnegative().optional();
const Reply = z.looseObject({
  candidates: z.array(z.looseObject({ content: z.looseObject({ parts: z.array(z.looseObject({ text: z.string().optional(), thought: z.boolean().optional() })).optional() }).optional(), finishReason: z.string().optional() })).optional(),
  promptFeedback: z.looseObject({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z.looseObject({ promptTokenCount: count, candidatesTokenCount: count, thoughtsTokenCount: count, cachedContentTokenCount: count }).optional(),
});

/** Reads a generateContent reply: usage, refusals, then the JSON checked against the schema. */
export function readGeminiReply<S extends z.ZodType>(schema: S, raw: string, model: string): AiResult<z.infer<S>> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  const reply = Reply.safeParse(json);
  if (!reply.success) return { ok: false, reason: "invalid" };
  const u = reply.data.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  // promptTokenCount includes cached tokens; thinking is billed as output.
  const input = Math.max(0, (u.promptTokenCount ?? 0) - cached);
  const output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  const usage: Usage = { model, inputTokens: input, outputTokens: output, cacheWriteTokens: 0, cacheReadTokens: cached, costUsd: costUsd(model, { input, output, cacheRead: cached }) };
  const first = reply.data.candidates?.[0];
  if (reply.data.promptFeedback?.blockReason || (first?.finishReason && BLOCKED.has(first.finishReason))) return { ok: false, reason: "refused", usage };
  const text = (first?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
  if (!text) return { ok: false, reason: "invalid", usage };
  let parsed: unknown;
  try {
    // Tolerate a fenced block: some models wrap JSON in ```json even in JSON mode.
    parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return { ok: false, reason: "invalid", usage };
  }
  const checked = schema.safeParse(parsed);
  return checked.success ? { ok: true, value: checked.data, usage } : { ok: false, reason: "invalid", usage };
}

/** Errors worth one more try on the other model: no answer in time, overloaded, or rate-limited. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
export const retryable = (r: AiResult<unknown>): boolean => !r.ok && r.reason === "error" && (r.status === undefined || RETRYABLE.has(r.status));

/** The shape that last worked for each model, so later calls skip the ones it rejects. Per server instance. */
const shapeOf = new Map<string, Shape>();
export const rememberedShape = (model: string): Shape => shapeOf.get(model) ?? "schema";

/** How long one more try on a busy or rate-limited model waits, at most, and how much time it needs left. */
const RETRY_WAIT_MS = 1_500;
const RETRY_NEEDS_MS = 3_000;

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * One model, until `deadlineAt`: the remembered shape first, a simpler shape after a 400,
 * and, when `retryOnce`, one more try after a busy or rate-limit answer if time allows.
 */
async function attempt<S extends z.ZodType>(
  schema: S,
  task: string,
  data: string,
  model: string,
  effort: "low" | "medium",
  deadlineAt: number,
  key: string,
  opts: { signal?: AbortSignal; retryOnce?: boolean } = {},
): Promise<AiResult<z.infer<S>>> {
  const url = `https://${HOST}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  let i = SHAPES.indexOf(rememberedShape(model));
  let retried = false;
  for (;;) {
    const shape = SHAPES[i]!;
    const left = deadlineAt - Date.now();
    if (left < 1_500 || opts.signal?.aborted) return { ok: false, reason: "error", model };
    try {
      const raw = await safeFetchText(url, {
        method: "POST",
        body: JSON.stringify(geminiBody(schema, task, data, effort, shape)),
        headers: { "x-goog-api-key": key, "content-type": "application/json" },
        accept: "application/json",
        timeoutMs: left,
        signal: opts.signal,
        errorDetail: true,
      });
      shapeOf.set(model, shape);
      return readGeminiReply(schema, raw, model);
    } catch (err) {
      if (err instanceof HttpError) {
        // 400 usually means this model does not accept something in the shape: try a simpler one.
        if (err.status === 400 && i < SHAPES.length - 1) {
          i++;
          continue;
        }
        // Busy or rate-limited: once, after the wait the API asked for (capped), if time is left.
        const wait = Math.min(RETRY_WAIT_MS, err.retryAfterMs ?? 600);
        if (opts.retryOnce && !retried && RETRYABLE.has(err.status) && deadlineAt - Date.now() - wait >= RETRY_NEEDS_MS) {
          retried = true;
          await pause(wait, opts.signal);
          continue;
        }
        // Status and the API's error code only: the request, the reply and the key are never logged.
        console.warn("[ai] gemini api error", err.status, err.detail?.split(":")[0] ?? "");
        return { ok: false, reason: "error", status: err.status, model, ...(err.detail ? { detail: err.detail } : {}) };
      }
      if (!opts.signal?.aborted) console.warn("[ai] gemini request failed or timed out", model);
      return { ok: false, reason: "error", model };
    }
  }
}

/**
 * After the writer model times out, fails busy or rate-limited, or loses the race to the
 * fast model, it rests this long: the calls that follow (the Mentor after the Analyst, in
 * one brief) go straight to the fast model with their whole time. Per server instance.
 */
export const WRITER_REST_MS = 30 * 60_000;
let writerRestsUntil = 0;
export const writerResting = (now = Date.now()) => now < writerRestsUntil;
const restWriter = () => {
  writerRestsUntil = Date.now() + WRITER_REST_MS;
};

/** The least time the fast model is left once it starts. */
const FAST_NEEDS_MS = 2_500;

/**
 * How long the writer model has alone before the fast model starts alongside it: 45% of
 * the wait, at least 3 s and at most 30 s, and always leaving the fast model 2.5 s. A
 * scheduled run waits a minute, so a slow but working writer gets about 27 s to itself.
 */
export function headStart(totalMs: number): number {
  return Math.max(1_000, Math.min(30_000, Math.max(3_000, Math.round(totalMs * 0.45)), totalMs - FAST_NEEDS_MS));
}

/** The more useful of two failures: one with a status (and the API's reason) beats a silent timeout. */
const worse = <T,>(a: AiResult<T>, b: AiResult<T>): AiResult<T> => (!b.ok && b.status !== undefined ? b : a);

/**
 * One call, as fast and as sure as the free tier allows. The writer model is asked first.
 * If it has not answered after its head start, or fails busy or rate-limited, the same
 * request goes to the fast model alongside it; the first good answer wins and the other
 * request is cancelled. A writer that is resting is skipped. The usage says which model
 * answered. Nothing else changes: same prompt, same schema, same checks afterwards.
 */
export async function structuredGemini<S extends z.ZodType>(schema: S, task: string, data: string, opts: StructuredOptions = {}): Promise<AiResult<z.infer<S>>> {
  const { effort = "low", tier = "writer", budgetMs = 40_000 } = opts;
  const key = env().GEMINI_API_KEY;
  if (!key) return { ok: false, reason: "not_configured" };
  const total = Math.max(4_000, budgetMs);
  const deadlineAt = Date.now() + total;
  const primary = geminiModel(tier);
  const backup = tier === "writer" && geminiModel("fast") !== primary ? geminiModel("fast") : null;
  if (!backup) return attempt(schema, task, data, primary, effort, deadlineAt, key, { retryOnce: true });
  if (writerResting()) return attempt(schema, task, data, backup, effort, deadlineAt, key, { retryOnce: true });

  type R = AiResult<z.infer<S>>;
  const writerStop = new AbortController();
  const fastStop = new AbortController();
  return new Promise<R>((resolve) => {
    let settled = false;
    let fastStarted = false;
    let writerDone: R | null = null;
    let fastDone: R | null = null;
    const finish = (r: R) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      writerStop.abort();
      fastStop.abort();
      resolve(r);
    };
    const startFast = () => {
      if (fastStarted || settled) return;
      fastStarted = true;
      console.warn("[ai] gemini writer model slow or failing; asking the fast model alongside it");
      void attempt(schema, task, data, backup, effort, deadlineAt, key, { signal: fastStop.signal, retryOnce: true }).then((r) => {
        fastDone = r;
        if (r.ok) {
          // The writer did not answer first: let it rest, so the next calls go straight to the fast model.
          if (!writerDone?.ok) restWriter();
          finish(r);
        } else if (writerDone) finish(worse(writerDone, r));
      });
    };
    const timer = setTimeout(startFast, headStart(total));
    void attempt(schema, task, data, primary, effort, deadlineAt, key, { signal: writerStop.signal }).then((r) => {
      writerDone = r;
      if (r.ok) return finish(r);
      // A refusal or a bad key (401): the fast model would say the same. A 403 can be one
      // model refused on the free tier, so it hands over like any other failure.
      if (r.reason === "refused" || r.status === 401) return finish(r);
      // Slow, busy, rate-limited, missing (404) or rejecting every shape: rest it. A bad answer is not the model's health.
      if (r.reason === "error") restWriter();
      if (!fastStarted) startFast();
      else if (fastDone) finish(worse(r, fastDone));
    });
  });
}

/** One model's answer to the connection check. */
export interface ModelCheck {
  model: string;
  /** writer: asked first; fast: the fallback; watch: not in use, checked to see if it is worth switching back to. */
  role: "writer" | "fast" | "watch";
  ok: boolean;
  ms: number;
  /** The request shape it accepted. */
  shape?: Shape;
  status?: number;
  detail?: string;
}

const Ping = z.object({ ok: z.boolean() });

/**
 * The connection check: a tiny request to each model on its own, in parallel, timed. No
 * personal data is sent. It says which model answers, how fast, in which shape, and why
 * not. Each model is asked once: the writer, the fast model, and any watched model not in
 * use (GEMINI_WATCH), so a check costs at most three free-tier requests.
 */
export async function checkGemini(timeoutMs = 20_000): Promise<ModelCheck[] | null> {
  const key = env().GEMINI_API_KEY;
  if (!key) return null;
  const models: { model: string; role: ModelCheck["role"] }[] = [{ model: geminiModel("writer"), role: "writer" }];
  if (geminiModel("fast") !== models[0]!.model) models.push({ model: geminiModel("fast"), role: "fast" });
  for (const model of GEMINI_WATCH) if (!models.some((m) => m.model === model)) models.push({ model, role: "watch" });
  return Promise.all(
    models.map(async ({ model, role }) => {
      const started = Date.now();
      const r = await attempt(Ping, "This is a connection check. Reply with ok set to true.", "ping", model, "low", started + timeoutMs, key);
      const ms = Date.now() - started;
      if (r.ok) return { model, role, ok: true, ms, shape: rememberedShape(model) };
      return { model, role, ok: false, ms, ...(r.status !== undefined ? { status: r.status } : {}), ...(r.detail ? { detail: r.detail } : {}) };
    }),
  );
}
