import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOOP_AGENTS, TOOL_REACH } from "@/lib/domain/registry";

// The tools each agent really defines (lib/agents), so the list on Your team never drifts.
const FILE: Record<string, string> = { pitch: "pitch", research: "companyResearch", prep: "interviewPrep", strategist: "weeklyStrategist", followup: "followUp" };

function definedTools(file: string): string[] {
  const src = readFileSync(join(__dirname, "..", "lib", "agents", `${file}.ts`), "utf8");
  const named = [...src.matchAll(/name: "(\w+)",\s*\n\s*useWhen/g)].map((m) => m[1]!);
  const readers = [...src.matchAll(/reader\("(\w+)"/g)].map((m) => m[1]!);
  return [...new Set([...readers, ...named])];
}

describe("AI agents on Your team", () => {
  it.each(LOOP_AGENTS.map((a) => [a.name, a] as const))("%s lists exactly the tools it can call", (_, a) => {
    expect(FILE[a.id], `map ${a.id} to its file`).toBeDefined();
    expect([...a.tools.map((t) => t.name)].sort()).toEqual(definedTools(FILE[a.id]!).sort());
  });

  it("every tool says what it does and what it reaches, in a line", () => {
    for (const a of LOOP_AGENTS)
      for (const t of a.tools) {
        expect(t.does.length, `${a.name}.${t.name}`).toBeGreaterThan(10);
        expect(t.does.length, `${a.name}.${t.name}`).toBeLessThan(110);
        expect(TOOL_REACH[t.reach]).toBeDefined();
      }
  });

  it("each agent ends on a rules check before finishing", () => {
    for (const a of LOOP_AGENTS) expect(a.tools.some((t) => t.reach === "check"), a.name).toBe(true);
  });
});
