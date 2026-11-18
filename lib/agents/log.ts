import "server-only";
import type { Context } from "@/lib/context";
import type { AgentRunEvent } from "@/lib/domain/types";

/** Writes one activity-log row. A failed log write is reported to platform logs, never thrown. */
export async function logRun(ctx: Pick<Context, "store">, row: Omit<AgentRunEvent, "id" | "at">): Promise<void> {
  const base = { ...row, task: row.task.slice(0, 200), detail: row.detail.slice(0, 500) };
  try {
    await ctx.store.agentRuns.append(base);
  } catch (err) {
    console.error("[agents] activity log write failed", row.agent, row.status, (err as Error).message);
    if (row.trace === undefined && row.durationMs === undefined) return;
    // The run itself matters more than its trace: write the row again without it.
    const { trace: _trace, durationMs: _durationMs, ...plain } = base;
    await ctx.store.agentRuns.append(plain).catch(() => undefined);
  }
}

/** Usage for a run that made no model call. */
export const NO_MODEL = Object.freeze({ model: "", inputTokens: 0, outputTokens: 0, costUsd: 0 });

/** True when the owner paused this agent in Mission Control. A failed read counts as not paused. */
export async function isPaused(ctx: Pick<Context, "store">, agent: AgentRunEvent["agent"]): Promise<boolean> {
  const state = await ctx.store.agentState.list().catch(() => []);
  return state.some((s) => s.agent === agent && s.paused);
}
