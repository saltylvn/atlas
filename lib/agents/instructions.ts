import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentId } from "@/lib/domain/types";

// Loads an agent's versioned instructions from agents/<id>/instructions.md.
// next.config.ts traces these files into every server bundle.

const cache = new Map<AgentId, string>();

export function instructions(agent: AgentId): string {
  const hit = cache.get(agent);
  if (hit !== undefined) return hit;
  let text = "";
  try {
    text = readFileSync(join(process.cwd(), "agents", agent, "instructions.md"), "utf8");
  } catch {
    // A missing file falls back to the shared rules alone; the run logs it.
    text = "";
  }
  cache.set(agent, text);
  return text;
}
