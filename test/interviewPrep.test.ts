import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAction } from "@/lib/agents/runtime/loop";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { likelyQuestions, parsePrep, reviewPrep, rulesPrep, type PrepPacket } from "@/lib/domain/interviewPrep";
import type { Application } from "@/lib/domain/types";

// Interview Prep (Step 4, 24 Nov 2026): the rules, and the agent end to end with a scripted model.

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
let moves: (NextAction | null)[] = [];
vi.mock("@/lib/agents/runtime/decide", () => ({ modelDecider: () => async () => moves.shift() ?? null }));
vi.mock("@/lib/ai/budget", () => ({ takeAiCall: async () => ({ allowed: false, why: "off in tests" }), takeAiCallPaced: async () => ({ allowed: false, why: "off", waitedMs: 0 }) }));

const MATERIAL = "Built Atlas, a Next.js and TypeScript app with 1,400 tests and CI on every PR.\nAtlas UI in React with accessible components.";
const REQS = ["TypeScript", "AWS"];
const good: PrepPacket = {
  questions: [
    { question: "Walk me through something you built with TypeScript.", kind: "technical", requirement: "TypeScript", story: { situation: "I wanted one place for my job search.", task: "Build Atlas.", action: "Built Atlas, a Next.js and TypeScript app with CI on every PR.", result: "It has 1,400 tests." }, source: "Resume: Software Engineer 1" },
    { question: "Tell me about a project you're proud of.", kind: "behavioral", requirement: "", story: null, source: "" },
  ],
  gaps: [{ requirement: "AWS", plan: "Say I have not used AWS in production and name what I deploy on today." }],
  ask: ["What would I work on in my first 90 days?"],
};

describe("Interview Prep rules", () => {
  it("one technical question per skill must-have, then the behavioral round", () => {
    const q = likelyQuestions(["TypeScript", "3+ years of experience"]);
    expect(q.map((x) => x.kind)).toEqual(["technical", "behavioral", "behavioral", "behavioral"]);
    expect(q[0]!.question).toContain("TypeScript");
  });

  it("a complete, true packet passes", () => {
    expect(reviewPrep(good, REQS, MATERIAL)).toEqual({ pass: true, notes: "" });
  });

  it("sends back a must-have left out, an invented result, an unsourced story and a non-question", () => {
    expect(reviewPrep({ ...good, gaps: [] }, REQS, MATERIAL).notes).toContain("missing AWS");
    const invented = { ...good, questions: [{ ...good.questions[0]!, story: { ...good.questions[0]!.story!, result: "Cut load time by 85%." } }, good.questions[1]!] };
    expect(reviewPrep(invented, REQS, MATERIAL).notes).toContain("85%");
    expect(reviewPrep({ ...good, questions: [{ ...good.questions[0]!, source: "" }, good.questions[1]!] }, REQS, MATERIAL).notes).toContain("names no source");
    expect(reviewPrep({ ...good, ask: ["Tell me about the team."] }, REQS, MATERIAL).notes).toContain("should be questions");
  });

  it("the rules' version invents no story, points to your proof, and names gaps honestly", () => {
    const p = rulesPrep({ requirements: REQS, evidence: { TypeScript: { title: "Resume", text: "Built Atlas in TypeScript" } }, company: "Acme", team: "Platform", reportsTo: "" });
    expect(p.questions.every((q) => q.story === null)).toBe(true);
    expect(p.questions[0]!.source).toContain("Built Atlas");
    expect(p.gaps.map((g) => g.requirement)).toEqual(["AWS"]);
    expect(p.ask[0]).toContain("Platform team");
    expect(reviewPrep(p, REQS, MATERIAL).pass).toBe(true);
  });
});

async function setup() {
  const store = createMemoryStore(seedState(new Date("2026-11-24T18:00:00Z")));
  await store.knowledge.upsert([{ source: "resume", sourceId: "r1", chunkIndex: 0, title: "Resume: Software Engineer 1", content: MATERIAL, href: "", occurredAt: "2026-11-20", hash: "h1" }]);
  const app = await store.applications.create({ company: "Acme", role: "Software Engineer I", targetRole: "Software Engineer 1", source: "x", url: "", payText: "", tier: "semi", status: "interview", appliedOn: "2026-11-10", statusAt: "2026-11-24T00:00:00Z", notes: "", origin: "atlas", externalId: "t:1" } as Omit<Application, "id" | "createdAt">);
  const settings = { ...(await store.settings.get()), careerSkills: ["TypeScript", "React"] };
  const ctx = { mode: "demo", userId: "", store, settings, now: new Date("2026-11-24T18:00:00Z"), today: "2026-11-24", time: "18:00" } as never;
  return { store, app, ctx };
}

const call = (tool: string, input: Record<string, unknown> = {}): NextAction => ({ action: "call", tool, input, why: "" });

describe("The Interview Prep agent", () => {
  beforeEach(() => {
    moves = [];
  });

  it("reads, recovers from a search that finds nothing, finds a story, checks it, is sent back once, and finishes", async () => {
    const { runInterviewPrep, prepRunId } = await import("@/lib/agents/interviewPrep");
    const { store, app, ctx } = await setup();
    moves = [
      call("readJob"),
      call("readCompany"), // no research: a fact, and the check closes
      call("findStory", { topic: "AWS" }), // nothing: the tool says how to recover
      call("findStory", { topic: "TypeScript" }),
      call("checkClaims", { text: "Built Atlas, a Next.js and TypeScript app with CI on every PR." }),
      { action: "done", answer: JSON.stringify({ ...good, questions: [good.questions[0]!] }) }, // sent back: no behavioral question
      { action: "done", answer: JSON.stringify(good) },
    ];
    const res = await runInterviewPrep(ctx, app, { persist: store });
    expect(res).toMatchObject({ status: "done", writer: "model" });
    const steps = res.state!.steps.map((s) => [s.tool, s.ok]);
    expect(steps).toContainEqual(["readCompany", true]);
    expect(steps).toContainEqual(["findStory", false]);
    expect(steps).toContainEqual(["review", false]);
    expect(steps.at(-1)).toEqual(["review", true]);
    expect((await store.agentRunState.get(prepRunId(app.id)))?.status).toBe("done");
  });

  it("with no AI, the rules' version stands", async () => {
    const { runInterviewPrep } = await import("@/lib/agents/interviewPrep");
    const { store, app, ctx } = await setup();
    const res = await runInterviewPrep(ctx, app, { persist: store });
    expect(res.writer).toBe("rules");
    expect(parsePrep(res.state?.answer ?? JSON.stringify(res.packet))?.questions.length).toBeGreaterThan(0);
  });

  it("the sync prepares a new interview once, and the page and action are wired", async () => {
    const { prepNewInterviews } = await import("@/lib/agents/interviewPrep");
    const { store, ctx } = await setup();
    const first = await prepNewInterviews(ctx, store, Date.now() + 30_000);
    expect(first.prepared).toContain("Acme");
    // Every seeded interview gets one prep, then nothing is left.
    let left = first.waiting;
    while (left > 0) left = (await prepNewInterviews(ctx, store, Date.now() + 30_000)).waiting;
    expect((await prepNewInterviews(ctx, store, Date.now() + 30_000)).prepared).toBeNull();
    expect(read("app/actions/prep.ts")).toMatch(/id\.safeParse\(appId\)[\s\S]*rateLimit\("prep"/);
    expect(read("app/(app)/(career)/applications/[id]/page.tsx")).toContain("<PrepPanel appId={app.id}");
    expect(read("lib/agents/sync.ts")).toContain("prepNewInterviews(ctx, persist");
  });
});
