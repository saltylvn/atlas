import { z } from "zod";

// A tool built for the model, not for a human (docs/AGENT-ARCHITECTURE.md, lever 3):
//   - a one-line "use when", shown in the menu; the full input schema only once it is picked
//   - zod on the way in, so a bad input comes back as how to fix it
//   - never throws at the agent: a failure is { ok: false, fix }, saying what to change
//   - a summary of the result in a line, plus a fact the agent may cite

export type ToolResult<O> = { ok: true; data: O } | { ok: false; fix: string };

export interface AgentTool<I extends z.ZodType = z.ZodType, O = unknown> {
  name: string;
  /** When to use it, in one line: the menu the model chooses from. */
  useWhen: string;
  input: I;
  run(input: z.infer<I>): Promise<ToolResult<O>>;
  /** The result in a line, the fact worth keeping, and the checks it settles. */
  summarize(out: O): { note: string; fact?: string; closes?: string[] };
}

export const defineTool = <I extends z.ZodType, O>(t: AgentTool<I, O>): AgentTool<I, O> => t;

/** The menu: one line per tool. Detailed schemas are disclosed only when a tool is picked. */
export function toolMenu(tools: readonly AgentTool[]): string {
  return tools.map((t) => `${t.name}: ${t.useWhen}`).join("\n");
}

/** The input a tool expects, as JSON Schema, for the model once it has chosen that tool. */
export function toolSchema(t: AgentTool): string {
  try {
    return JSON.stringify(z.toJSONSchema(t.input));
  } catch {
    return "{}";
  }
}

export type ToolOutcome = { ok: true; note: string; fact?: string; closes: string[] } | { ok: false; note: string };

/**
 * Runs one tool for the agent. A bad input, an unknown failure or a thrown error all come back
 * as a plain fix the agent can act on next cycle; nothing raw (no stack, no reply body) reaches it.
 */
export async function runTool(t: AgentTool, raw: unknown): Promise<ToolOutcome> {
  const parsed = t.input.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 4)
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    return { ok: false, note: `The input did not fit (${issues}). Send it in this shape: ${toolSchema(t).slice(0, 600)}` };
  }
  try {
    const r = await t.run(parsed.data);
    if (!r.ok) return { ok: false, note: r.fix };
    const s = t.summarize(r.data);
    return { ok: true, note: s.note, ...(s.fact ? { fact: s.fact } : {}), closes: s.closes ?? [] };
  } catch {
    return { ok: false, note: `${t.name} failed unexpectedly. Try it once more with a narrower input, or use another tool for the same fact.` };
  }
}
