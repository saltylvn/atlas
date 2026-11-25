import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAgent, type NextAction, type Review } from "@/lib/agents/runtime/loop";
import { defineTool, runTool, toolMenu } from "@/lib/agents/runtime/tool";
import { activeLessons, outOfBudget, recordStep, startState, stateForModel, trajectory, type AgentState } from "@/lib/domain/agentState";
import { rerankPassages, requirementTerms } from "@/lib/domain/rerank";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { Passage } from "@/lib/domain/retrieval";

// The agent runtime (docs/AGENT-ARCHITECTURE.md, 23 Nov 2026). These tests are the definition
// of "agent" in Atlas: it loops toward a goal, picks its own tools, recovers from failures,
// and stays inside its guardrails.

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

// A small world: a posting's requirements, and your evidence for each.
const EVIDENCE: Record<string, string> = { typescript: "Built Atlas in TypeScript (1,400 tests)", react: "Atlas UI in React and Next.js" };
const requirements = defineTool({
  name: "requirements",
  useWhen: "Read a posting's must-have skills.",
  input: z.object({ postingId: z.string().min(1) }),
  run: async ({ postingId }) => (postingId === "p1" ? { ok: true as const, data: ["typescript", "react"] } : { ok: false as const, fix: `No posting "${postingId}". The posting id is "p1".` }),
  summarize: (reqs: string[]) => ({ note: `Requires ${reqs.join(", ")}`, fact: `Must-haves: ${reqs.join(", ")}`, closes: ["read the requirements"] }),
});
const evidence = defineTool({
  name: "evidence",
  useWhen: "Find your best proof for one skill.",
  input: z.object({ skill: z.string().min(1) }),
  run: async ({ skill }) => (EVIDENCE[skill] ? { ok: true as const, data: EVIDENCE[skill]! } : { ok: false as const, fix: `No evidence for "${skill}"; mark it a gap.` }),
  summarize: (e: string) => ({ note: e, fact: e, closes: [] }),
});

/** A scripted model: replies in order, so each behaviour is tested without a network. */
const scripted = (moves: (NextAction | null)[]) => {
  let i = 0;
  const seen: string[] = [];
  return { decide: async (p: { state: string; menu: string; disclosed: string }) => (seen.push(p.state), moves[i++] ?? null), seen };
};
const call = (tool: string, input: Record<string, unknown>): NextAction => ({ action: "call", tool, input, why: "" });
const done = (answer = "Mapped"): NextAction => ({ action: "done", answer });

const run = (moves: (NextAction | null)[], over: { review?: (s: AgentState) => Promise<Review>; budget?: { steps: number; calls: number }; resume?: AgentState } = {}) => {
  const m = scripted(moves);
  const saves: string[] = [];
  let t = 0;
  return runAgent({
    runId: "r1",
    agent: "pitch",
    goal: "Map every must-have to evidence",
    checks: ["read the requirements"],
    tools: [requirements, evidence],
    budget: over.budget ?? { steps: 10, calls: 10 },
    decide: m.decide,
    save: async (status) => void saves.push(status),
    now: () => (t += 1000),
    ...(over.review ? { review: over.review } : {}),
    ...(over.resume ? { resume: over.resume } : {}),
  }).then((r) => ({ ...r, saves, seen: m.seen }));
};

describe("What makes it an agent", () => {
  it("goal-directed: 'done' with a check still open is refused, and it keeps going", async () => {
    const r = await run([done(), call("requirements", { postingId: "p1" }), done()]);
    expect(r.status).toBe("done");
    expect(r.state.steps.map((s) => [s.tool, s.ok])).toEqual([
      ["done", false],
      ["requirements", true],
    ]);
    expect(r.state.steps[0]!.note).toContain("Still to do: read the requirements");
  });

  it("dynamic: it picks the tool, and the facts it found feed the next choice", async () => {
    const r = await run([call("requirements", { postingId: "p1" }), call("evidence", { skill: "typescript" }), call("evidence", { skill: "react" }), done()]);
    expect(r.state.facts).toEqual(["Must-haves: typescript, react", EVIDENCE.typescript, EVIDENCE.react]);
    expect(r.seen[1]).toContain("Must-haves: typescript, react");
  });

  it("recovery: a failed tool says how to fix it, the same failed call is refused, and a changed input succeeds", async () => {
    const r = await run([call("requirements", { postingId: "p9" }), call("requirements", { postingId: "p9" }), call("requirements", { postingId: "p1" }), done()]);
    expect(r.state.steps.map((s) => s.ok)).toEqual([false, false, true]);
    expect(r.state.steps[0]!.note).toContain('The posting id is "p1"');
    expect(r.state.steps[1]!.note).toContain("That exact call already failed");
    expect(trajectory(r.state)).toMatchObject({ failed: 2, repeats: 1, recovered: 1 });
  });

  it("recovery: a bad input or an unknown tool comes back as what to send instead", async () => {
    const r = await run([call("requirements", {}), call("search", {}), call("requirements", { postingId: "p1" }), done()]);
    expect(r.state.steps[0]!.note).toMatch(/did not fit \(postingId: .*\)\. Send it in this shape: \{/);
    expect(r.state.steps[1]!.note).toContain('There is no tool named "search". Use one of: requirements, evidence');
  });

  it("verification: a reviewer that sends the answer back makes it revise, not finish", async () => {
    let reviews = 0;
    const review = async () => (++reviews === 1 ? { pass: false, notes: "react has no evidence cited" } : { pass: true, notes: "" });
    const r = await run([call("requirements", { postingId: "p1" }), done("v1"), call("evidence", { skill: "react" }), done("v2")], { review });
    expect(r.status).toBe("done");
    expect(r.state.answer).toBe("v2");
    expect(r.state.steps.map((s) => s.tool)).toEqual(["requirements", "review", "evidence", "review"]);
  });

  it("scoped: it stops at its step cap or call budget, and when the model does not answer", async () => {
    const loopForever = Array.from({ length: 20 }, () => call("evidence", { skill: "typescript" }));
    expect((await run(loopForever, { budget: { steps: 3, calls: 10 } })).why).toBe("Reached its 3-step limit.");
    expect((await run(loopForever, { budget: { steps: 10, calls: 2 } })).why).toBe("Used its 2 model calls.");
    expect((await run([null])).why).toContain("The model did not answer");
  });

  it("saves its state after every step, and resumes from a saved state", async () => {
    const first = await run([call("requirements", { postingId: "p1" }), null]);
    expect(first.saves).toEqual(["running", "stopped"]);
    const second = await run([done()], { resume: first.state });
    expect(second.status).toBe("done");
    expect(second.state.steps[0]!.tool).toBe("requirements");
  });
});

describe("Tools, state and memory", () => {
  it("the menu is one line per tool; a tool never throws at the agent", async () => {
    expect(toolMenu([requirements, evidence])).toBe("requirements: Read a posting's must-have skills.\nevidence: Find your best proof for one skill.");
    const boom = defineTool({ name: "boom", useWhen: "x", input: z.object({}), run: async () => { throw new Error("secret stack"); }, summarize: () => ({ note: "" }) });
    const out = await runTool(boom, {});
    expect(out).toMatchObject({ ok: false });
    expect(out.note).not.toContain("secret stack");
  });

  it("the model sees the goal, what remains and the last five steps, never the whole history", () => {
    let s = startState("pitch", "g", ["a"], { steps: 20, calls: 20 }, "2026-11-23T00:00:00Z");
    for (let i = 0; i < 8; i++) s = recordStep(s, { tool: "t", input: String(i), ok: true, note: "n", ms: 1 });
    const seen = JSON.parse(stateForModel(s));
    expect(seen.recentSteps).toHaveLength(5);
    expect(seen.stillToDo).toEqual(["a"]);
    expect(outOfBudget(s)).toBeNull();
  });

  it("lessons expire unless confirmed; the most confirmed come first", async () => {
    const store = createMemoryStore(seedState(new Date("2026-11-23T00:00:00Z")));
    const a = await store.agentMemory.add({ agent: "pitch", lesson: "Fintech rejects untailored fast", evidence: "2 of 2", expiresOn: "2026-12-14" });
    await store.agentMemory.add({ agent: "pitch", lesson: "Old", evidence: "", expiresOn: "2026-11-01" });
    await store.agentMemory.confirm(a.id, "2027-01-04");
    const live = activeLessons(await store.agentMemory.list("pitch"), "pitch", "2026-11-23");
    expect(live.map((l) => [l.lesson, l.confirmed])).toEqual([["Fintech rejects untailored fast", 1]]);
    await store.agentRunState.save("r9", "pitch", "running", startState("pitch", "g", [], { steps: 1, calls: 1 }, "x"));
    expect((await store.agentRunState.get("r9"))?.status).toBe("running");
  });

  it("the tables: you read them, only the server writes", () => {
    const sql = read("supabase/migrations/20261124030000_agent_runtime.sql");
    expect(sql).toContain("create table if not exists public.agent_state");
    expect(sql).toContain("create table if not exists public.agent_memory");
    expect(sql).toMatch(/grant select on public\.agent_state to authenticated;/);
    expect(sql).not.toMatch(/grant (insert|update|delete)/);
  });
});

describe("Rerank", () => {
  const p = (n: number, content: string, score: number, occurredAt: string | null = "2026-11-01"): Passage => ({ id: `p${n}`, n, source: "resume", sourceId: "s", chunkIndex: 0, title: "Resume", content, href: "", occurredAt, lexicalRank: null, semanticRank: null, score });

  it("keeps the passages that name the requirement's own terms, ahead of a higher fused score that names none", () => {
    expect(requirementTerms("3+ years of TypeScript and React experience")).toEqual(["typescript", "react"]);
    const ranked = rerankPassages([p(1, "Led a team offsite", 0.9), p(2, "Built a React app in TypeScript", 0.3), p(3, "Wrote TypeScript services", 0.4)], "TypeScript and React", "2026-11-23", 2);
    expect(ranked.map((r) => r.id)).toEqual(["p2", "p3"]);
    expect(ranked[0]!.matched).toEqual(["typescript", "react"]);
  });
});
