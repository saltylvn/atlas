import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import { AGENTS } from "@/lib/domain/agents";
import type { AgentRunEvent } from "@/lib/domain/types";
import { EVAL_TASK, evalSummary, runEvals, type EvalReport } from "@/lib/evals";
import { logRun, NO_MODEL } from "./log";

// The daily eval run. Before each scheduled morning brief the Chief of Staff scores every
// agent's rules against its labeled cases and logs the result, so the Evals page shows
// accuracy over time and a suite that slips below its threshold lands in Errors & alerts.
// Pure rules on fixed cases: a few milliseconds, no network, $0.

const nameOf = (id: string) => AGENTS.find((a) => a.id === id)?.name.replace(/ Agent$/, "") ?? id;

export async function logEvalRun(ctx: Pick<Context, "store">, trigger: AgentRunEvent["trigger"]): Promise<EvalReport> {
  const report = runEvals();
  await logRun(ctx, {
    runId: randomUUID(),
    agent: "chief-of-staff",
    task: EVAL_TASK,
    status: report.ok ? "succeeded" : "failed",
    trigger,
    detail: evalSummary(report, nameOf),
    ...NO_MODEL,
    durationMs: report.tookMs,
    trace: report.suites.map((s) => ({
      name: `${nameOf(s.agent)}: ${s.title}`,
      ms: 0,
      ok: s.ok,
      note: `${s.passed}/${s.total} pass (needs ${Math.round(s.threshold * 100)}%)${s.failures.length ? `. Missed: ${s.failures.map((f) => f.name).join("; ")}` : ""}`,
    })),
  });
  return report;
}
