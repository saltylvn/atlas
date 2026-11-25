import "server-only";
import type { Context } from "@/lib/context";
import type { AgentId, AgentRunEvent } from "@/lib/domain/types";
import { logRun, NO_MODEL } from "./log";
import type { Tracer } from "./trace";

// Vercel ends a function at its time limit mid-step, with no chance to log: the run's row says
// "started" and nothing more, and the QA review can only call it "stopped mid-run" (QA, 22 Nov
// 2026: two such runs, no trace to tell why). The watchdog fires a few seconds before the run's
// deadline and logs where the run was, with the trace so far, so the next stop names its step.

/** How long before the deadline the watchdog writes: enough for one database write. */
export const WATCHDOG_MARGIN_MS = 4_000;

/** Arms the watchdog for a run with a deadline. Call the returned function when the run ends. */
export function watchdog(ctx: Pick<Context, "deadline"> & Context, run: { runId: string; agent: AgentId; task: string; trigger: AgentRunEvent["trigger"] }, t: Tracer): () => void {
  if (!ctx.deadline) return () => undefined;
  const wait = ctx.deadline - Date.now() - WATCHDOG_MARGIN_MS;
  if (wait <= 0) return () => undefined;
  const timer = setTimeout(() => {
    const at = t.current();
    void logRun(ctx, {
      ...run,
      status: "failed",
      detail: `Stopped at the time limit${at ? `, during "${at}"` : ""}. The steps before it finished.`,
      ...NO_MODEL,
      ...t.finish(),
    }).catch(() => undefined);
  }, wait);
  return () => clearTimeout(timer);
}
