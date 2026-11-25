import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAction } from "@/lib/agents/runtime/loop";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { Approval } from "@/lib/domain/types";

// The Pitch agent end to end (Step 2, 23 Nov 2026), with a scripted model in place of Gemini:
// it reads, searches, recovers from a search that found nothing, checks its claims, is sent
// back by the reviewer once, and finishes with a packet that passes.

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
let moves: (NextAction | null)[] = [];
vi.mock("@/lib/agents/runtime/decide", () => ({ modelDecider: () => async () => moves.shift() ?? null }));
vi.mock("@/lib/ai/budget", () => ({ takeAiCall: async () => ({ allowed: false, why: "off in tests" }), takeAiCallPaced: async () => ({ allowed: false, why: "off", waitedMs: 0 }) }));

const RESUME = "Software Engineer 1\nBuilt Atlas, a Next.js and TypeScript app with 1,400 tests and CI on every PR.\nAtlas UI in React with accessible components.";

async function setup() {
  const store = createMemoryStore(seedState(new Date("2026-11-23T18:00:00Z")));
  await store.knowledge.upsert([{ source: "resume", sourceId: "r1", chunkIndex: 0, title: "Resume: Software Engineer 1", content: RESUME, href: "", occurredAt: "2026-11-20", hash: "h1" }]);
  const kit: Approval = { id: "k1", kind: "application", title: "Software Engineer I at Acme", detail: "Skills it names: TypeScript, React, AWS", url: "https://example.com/j", matchId: null, status: "pending", decidedAt: null, createdAt: "2026-11-23T00:00:00Z" };
  const settings = { ...(await store.settings.get()), careerSkills: ["TypeScript", "React"] };
  const ctx = { mode: "demo", userId: "", store, settings, now: new Date("2026-11-23T18:00:00Z"), today: "2026-11-23", time: "18:00" } as never;
  return { store, kit, ctx };
}

const call = (tool: string, input: Record<string, unknown> = {}): NextAction => ({ action: "call", tool, input, why: "" });
const packet = (over: object = {}) =>
  JSON.stringify({
    resume: "Software Engineer 1",
    map: [
      { requirement: "TypeScript", status: "proven", evidence: "Built Atlas, a Next.js and TypeScript app with 1,400 tests." },
      { requirement: "React", status: "proven", evidence: "Atlas UI in React with accessible components." },
      { requirement: "AWS", status: "gap", evidence: "" },
    ],
    swaps: [],
    note: "I'm applying for Software Engineer I at Acme. I built Atlas in TypeScript and React, with 1,400 tests.",
    ...over,
  });

describe("The Pitch agent", () => {
  beforeEach(() => {
    moves = [];
  });

  it("works toward the goal: reads, searches, recovers, checks its claims, revises after review, and finishes", async () => {
    const { runPitch } = await import("@/lib/agents/pitch");
    const { store, kit, ctx } = await setup();
    moves = [
      call("readJob"),
      call("readResume"),
      call("findEvidence", { requirement: "TypeScript" }),
      call("findEvidence", { requirement: "AWS" }), // nothing: the tool says how to recover
      call("findEvidence", { requirement: "cloud" }), // a related term, still nothing
      call("checkClaims", { text: "I built Atlas in TypeScript and React, with 1,400 tests." }),
      { action: "done", answer: packet({ map: [] }) }, // sent back: must-haves left out
      { action: "done", answer: packet() },
    ];
    const res = await runPitch(ctx, { kit, match: null }, { persist: store });
    expect(res).toMatchObject({ status: "done", writer: "model" });
    expect(res.packet?.map.map((m) => m.status)).toEqual(["proven", "proven", "gap"]);
    const steps = res.state!.steps.map((s) => [s.tool, s.ok]);
    expect(steps).toContainEqual(["findEvidence", false]);
    expect(steps).toContainEqual(["review", false]);
    expect(steps.at(-1)).toEqual(["review", true]);
    expect(res.state!.steps.find((s) => s.tool === "review" && !s.ok)!.note).toContain("Map every must-have");
    expect((await store.agentRunState.get("pitch:k1"))?.status).toBe("done");
  });

  it("an invented number never gets through: the reviewer sends it back", async () => {
    const { runPitch } = await import("@/lib/agents/pitch");
    const { store, kit, ctx } = await setup();
    moves = [call("readJob"), call("readResume"), { action: "done", answer: packet({ note: "I cut deploy time by 85% at Acme." }) }, { action: "done", answer: packet() }];
    const res = await runPitch(ctx, { kit, match: null }, { persist: store });
    expect(res.packet?.note).not.toContain("85%");
    expect(res.state!.steps.find((s) => s.tool === "review" && !s.ok)!.note).toContain("Numbers not in your material: 85%");
  });

  it("with no AI, the rules' version stands: proof by keyword, gaps named, no swaps", async () => {
    const { runPitch } = await import("@/lib/agents/pitch");
    const { store, kit, ctx } = await setup();
    const res = await runPitch(ctx, { kit, match: null }, { persist: store });
    expect(res.writer).toBe("rules");
    expect(res.packet?.map.find((m) => m.requirement === "TypeScript")?.status).toBe("proven");
    expect(res.packet?.map.find((m) => m.requirement === "AWS")?.status).toBe("gap");
    expect(res.packet?.swaps).toEqual([]);
  });

  it("is an owner action with input validation and a rate limit, and shows on each queued job", () => {
    expect(read("app/actions/pitch.ts")).toMatch(/id\.safeParse\(kitId\)[\s\S]*rateLimit\("pitch"/);
    expect(read("components/ApprovalQueue.tsx")).toContain("<PitchPanel kitId={a.id}");
  });
});
