import { z } from "zod";
import { closeCheck, countCall, outOfBudget, recordStep, stateForModel, startState, triedAndFailed, type AgentState } from "@/lib/domain/agentState";
import { runTool, toolMenu, toolSchema, type AgentTool } from "./tool";

// The agent loop (docs/AGENT-ARCHITECTURE.md): what makes something an agent in Atlas.
//
//   goal-directed   after each step it checks the goal: open checks left, or a review not
//                   passed, means another cycle instead of a half-answer
//   dynamic         the model picks the next tool and its input from what it just found
//   recovery        a failed tool returns how to fix the input; the same failed call twice is
//                   refused, so the agent must change its input or its approach
//   scoped          its own tools only, a step cap, a model-call budget, the run's deadline;
//                   it drafts, and nothing leaves Atlas without Tyler
//
// State is saved after every step, so a run cut off by the function's time limit resumes at
// the next sync from where it stopped.

/** What the model returns each cycle: call a tool, or declare the goal met. */
export const NextAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("call"), tool: z.string().min(1).max(60), input: z.record(z.string(), z.unknown()), why: z.string().max(200) }),
  z.object({ action: z.literal("done"), answer: z.string().min(1).max(4000) }),
]);
export type NextAction = z.infer<typeof NextAction>;

export interface Review {
  pass: boolean;
  /** What to fix, when it did not pass: given to the agent as its next cycle's feedback. */
  notes: string;
}

export interface RunInput {
  runId: string;
  agent: string;
  goal: string;
  /** Checks that must be settled before "done" is accepted (e.g. "every requirement mapped"). */
  checks: string[];
  tools: readonly AgentTool[];
  budget: { steps: number; calls: number };
  /** The model's next action, or null when it could not answer (cap reached, timeout, bad output). */
  decide: (prompt: { state: string; menu: string; disclosed: string }) => Promise<NextAction | null>;
  /** The reviewer: deterministic checks first, a judge model if it has one. */
  review?: (s: AgentState) => Promise<Review>;
  save: (status: "running" | "done" | "stopped" | "failed", s: AgentState) => Promise<void>;
  /** A run saved earlier, to resume. */
  resume?: AgentState | null;
  /** Stop cleanly before this time (ms since epoch). */
  deadline?: number;
  now: () => number;
}

export interface RunResult {
  status: "done" | "stopped" | "failed";
  state: AgentState;
  why: string;
}

const MARGIN_MS = 15_000;

export async function runAgent(input: RunInput): Promise<RunResult> {
  let s = input.resume ?? startState(input.agent, input.goal, input.checks, input.budget, new Date(input.now()).toISOString());
  const byName = new Map(input.tools.map((t) => [t.name, t]));
  const menu = toolMenu(input.tools);
  let disclosed = "";

  const stop = async (status: RunResult["status"], why: string): Promise<RunResult> => {
    await input.save(status === "done" ? "done" : status, s);
    return { status, state: s, why };
  };

  for (;;) {
    const over = outOfBudget(s);
    if (over) return stop("stopped", over);
    if (input.deadline && input.now() > input.deadline - MARGIN_MS) {
      await input.save("running", s);
      return { status: "stopped", state: s, why: "Out of time for this run; it resumes at the next sync." };
    }

    const started = input.now();
    const next = await input.decide({ state: stateForModel(s), menu, disclosed });
    s = countCall(s);
    if (!next) return stop("stopped", "The model did not answer; the rules' version stands.");

    if (next.action === "done") {
      // Goal-directed: "done" with checks still open is not done.
      if (s.open.length > 0) {
        s = recordStep(s, { tool: "done", input: "", ok: false, note: `Not done yet. Still to do: ${s.open.join("; ")}.`, ms: input.now() - started });
        await input.save("running", s);
        continue;
      }
      s = { ...s, answer: next.answer };
      if (input.review) {
        const r = await input.review(s);
        if (!r.pass) {
          s = recordStep(s, { tool: "review", input: "", ok: false, note: `The reviewer sent it back: ${r.notes}`, ms: input.now() - started });
          await input.save("running", s);
          continue;
        }
        s = recordStep(s, { tool: "review", input: "", ok: true, note: "Passed review.", ms: 0 });
      }
      return stop("done", "Goal met.");
    }

    const tool = byName.get(next.tool);
    const argLine = JSON.stringify(next.input);
    if (!tool) {
      s = recordStep(s, { tool: next.tool, input: argLine, ok: false, note: `There is no tool named "${next.tool}". Use one of: ${[...byName.keys()].join(", ")}.`, ms: 0 });
    } else if (triedAndFailed(s, tool.name, argLine)) {
      s = recordStep(s, { tool: tool.name, input: argLine, ok: false, note: "That exact call already failed. Change the input, or reach the same fact with another tool.", ms: 0 });
    } else {
      // Progressive disclosure: the chosen tool's full schema is shown on the next cycle.
      disclosed = `${tool.name} input schema: ${toolSchema(tool)}`;
      const out = await runTool(tool, next.input);
      s = recordStep(s, { tool: tool.name, input: argLine, ok: out.ok, note: out.note, ms: input.now() - started }, out.ok ? out.fact : undefined);
      if (out.ok) for (const c of out.closes) s = closeCheck(s, c);
    }
    await input.save("running", s);
  }
}
