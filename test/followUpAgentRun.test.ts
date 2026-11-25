import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAction } from "@/lib/agents/runtime/loop";
import { createMemoryStore, seedState } from "@/lib/data/memory";

// The Follow-up agent end to end (24 Nov 2026), with a scripted model: it may not finish before
// reading the application and looking for a hook; it is sent back once for the wrong greeting;
// it then replaces the template in the Apply Queue. When the model is silent, the template stands.

let moves: (NextAction | null)[] = [];
vi.mock("@/lib/agents/runtime/decide", () => ({ modelDecider: () => async () => moves.shift() ?? null }));
vi.mock("@/lib/ai/budget", () => ({ takeAiCall: async () => ({ allowed: false, why: "off in tests" }), takeAiCallPaced: async () => ({ allowed: false, why: "off", waitedMs: 0 }) }));

const NOW = new Date("2026-11-24T18:00:00Z");

async function setup() {
  const store = createMemoryStore(seedState(NOW));
  const app = await store.applications.create({ company: "Larkspur Labs", role: "Software Engineer I", status: "applied", appliedOn: "2026-11-12", statusAt: "2026-11-12T16:00:00Z", url: "https://example.com/j", notes: "", source: "email" } as never);
  const approval = await store.approvals.create({ kind: "follow-up", title: "Follow up with Larkspur Labs", detail: "Subject: Following up\n\nHi,\n\nTemplate.\n\nThank you,\nTyler", url: "", matchId: null, applicationId: app.id, status: "pending", decidedAt: null });
  await store.settings.update({ displayName: "Tyler" });
  const settings = await store.settings.get();
  const ctx = { mode: "demo", userId: "", store, settings, now: NOW, today: "2026-11-24", time: "11:00" } as never;
  return { store, app, approval, ctx };
}

const call = (tool: string): NextAction => ({ action: "call", tool, input: {}, why: "" });
const mail = (hello: string) =>
  JSON.stringify({
    subject: "Following up on my Software Engineer I application",
    body: `${hello}\n\nI applied for the Software Engineer I role at Larkspur Labs on November 12 and wanted to follow up. I am still very interested in the role and in the work your engineering team is doing. I would be glad to share more about my background, or to find a short time to talk this week if that suits you.\n\nThank you,\nTyler`,
    hook: { text: "I applied for the Software Engineer I role at Larkspur Labs on November 12.", cites: ["a1"] },
  });

describe("The Follow-up agent", () => {
  beforeEach(() => {
    moves = [];
  });

  it("reads first, is sent back for the greeting, then replaces the template", async () => {
    const { runFollowUp, followUpRunId } = await import("@/lib/agents/followUp");
    const { store, app, approval, ctx } = await setup();
    moves = [
      { action: "done", answer: mail("Hi,") }, // too early: nothing read yet
      call("readApplication"),
      call("readResearch"), // nothing saved: an answer, not a failure
      call("findPerson"),
      { action: "done", answer: mail("Hello there,") }, // wrong greeting: sent back
      { action: "done", answer: mail("Hi,") },
    ];
    const res = await runFollowUp(ctx, { approval, app }, { persist: store });
    expect(res.writer).toBe("model");
    const saved = await store.approvals.get(approval.id);
    expect(saved!.detail).toMatch(/^Subject: Following up on my Software Engineer I application\n\nHi,/);
    expect((await store.agentRunState.get(followUpRunId(approval.id)))!.status).toBe("done");
    const steps = res.state.steps.map((s) => `${s.tool}:${s.ok ? "ok" : "no"}`);
    expect(steps[0]).toBe("done:no");
    expect(steps.filter((s) => s === "review:no")).toHaveLength(1);
  });

  it("keeps the template when the model does not answer, and remembers it tried", async () => {
    const { runFollowUp, followUpRunId } = await import("@/lib/agents/followUp");
    const { store, app, approval, ctx } = await setup();
    moves = [null];
    const res = await runFollowUp(ctx, { approval, app }, { persist: store });
    expect(res.writer).toBe("rules");
    expect((await store.approvals.get(approval.id))!.detail).toContain("Template.");
    expect((await store.agentRunState.get(followUpRunId(approval.id)))!.status).toBe("stopped");
  });
});
