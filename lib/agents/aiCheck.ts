import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import { takeAiCall } from "@/lib/ai/budget";
import { checkGemini, type ModelCheck } from "@/lib/ai/gemini";
import { activeProvider, whyNoAnswer } from "@/lib/ai/model";
import { audit } from "@/lib/audit";
import { AI_CHECK_TASK } from "@/lib/domain/aiCheck";
import { logRun, NO_MODEL } from "./log";

// The AI connection check, from Mission Control: a tiny request to each Gemini model on
// its own, timed, logged as a run so the AI card shows the last result. No personal data
// is sent: the request is a fixed "connection check" sentence.

const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** One model's line in the check's trace. */
export function checkLine(c: ModelCheck): { name: string; ms: number; ok: boolean; note: string } {
  const name = `${c.role === "writer" ? "Writer" : c.role === "fast" ? "Fast" : "Not in use"}: ${c.model}`;
  if (c.ok) return { name, ms: c.ms, ok: true, note: `answered in ${secs(c.ms)}${c.shape && c.shape !== "schema" ? ` (accepts ${c.shape === "plain" ? "plain JSON" : "no thinking setting"} only)` : ""}` };
  const why = whyNoAnswer({ reason: "error", ...(c.status !== undefined ? { status: c.status } : {}), ...(c.detail ? { detail: c.detail } : {}) });
  const message = c.detail?.split(":").slice(1).join(":").trim();
  return { name, ms: c.ms, ok: false, note: `${why} after ${secs(c.ms)}${message ? `: ${message}` : ""}` };
}

export type CheckOutcome = { ok: true; checks: ModelCheck[] } | { ok: false; why: string };

export async function runAiCheck(ctx: Context): Promise<CheckOutcome> {
  if (activeProvider() !== "gemini") return { ok: false, why: "The connection check is for Gemini, and Gemini is not the model in use." };
  // Counted once against Atlas's own daily AI limit (two small requests).
  const gate = await takeAiCall(ctx.store, ctx.settings, "check");
  if (!gate.allowed) return { ok: false, why: gate.why };
  const started = Date.now();
  const checks = await checkGemini(20_000);
  if (!checks) return { ok: false, why: "No Gemini key is set." };
  const lines = checks.map(checkLine);
  // The run's outcome is about the models in use; a watched one only informs.
  const inUse = checks.filter((c) => c.role !== "watch");
  const answered = inUse.filter((c) => c.ok);
  const detail = answered.length === inUse.length ? "Both models answered" : answered.length ? `${answered.map((c) => c.role).join(", ")} model answered; ${inUse.filter((c) => !c.ok).map((c) => c.role).join(", ")} did not` : "No model answered";
  await logRun(ctx, { runId: randomUUID(), agent: "chief-of-staff", task: AI_CHECK_TASK, status: answered.length ? "succeeded" : "failed", trigger: "run-now", detail, ...NO_MODEL, trace: lines, durationMs: Date.now() - started });
  await audit(ctx.store, { actor: "owner", action: "ai.check", target: "gemini", detail, outcome: answered.length ? "success" : "error" });
  return { ok: true, checks };
}
