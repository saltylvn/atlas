import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextAction } from "@/lib/agents/runtime/loop";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { parseResearch } from "@/lib/domain/briefResearch";
import type { JobMatch } from "@/lib/domain/types";

// The Company Research agent end to end (24 Nov 2026), with a scripted model and stand-in web:
// it reads the job and the news, recovers from a search that names the wrong thing and a page
// that cannot be read, is sent back once for an uncited number, and saves a cited brief.

let moves: (NextAction | null)[] = [];
vi.mock("@/lib/agents/runtime/decide", () => ({ modelDecider: () => async () => moves.shift() ?? null }));
vi.mock("@/lib/ai/budget", () => ({ takeAiCall: async () => ({ allowed: false, why: "off in tests" }), takeAiCallPaced: async () => ({ allowed: false, why: "off", waitedMs: 0 }) }));

const NOW = new Date("2026-11-24T18:00:00Z");
const match = { id: "m1", key: "k1", title: "Software Engineer I", company: "Larkspur Labs", url: "https://example.com/j", source: "Test", location: "Remote", role: "Software Engineer 1", payText: "$105k-$125k", postedAt: "2026-11-22T00:00:00Z", score: 70, shownOn: "2026-11-23", shownSlot: "morning", rating: 1, status: "pursuing", skills: ["TypeScript", "React"], createdAt: "2026-11-23T00:00:00Z" } as JobMatch;

async function setup() {
  const store = createMemoryStore(seedState(NOW));
  const kit = await store.approvals.create({ kind: "application", title: "Software Engineer I at Larkspur Labs", detail: "Skills it names: TypeScript, React\nAsks for: 1+ years of experience\nTeam: Platform", url: match.url, matchId: match.id, status: "pending", decidedAt: null });
  const settings = { ...(await store.settings.get()), careerSkills: ["TypeScript", "React"] };
  await store.settings.update({ careerSkills: ["TypeScript", "React"] });
  const ctx = { mode: "demo", userId: "", store, settings, now: NOW, today: "2026-11-24", time: "11:00" } as never;
  const searched: string[] = [];
  const deps = {
    news: async () => [{ title: "Larkspur Labs raises $12 million to expand its scheduling platform", url: "https://news.example.com/a", source: "Example News", publishedAt: "2026-11-20T00:00:00Z" }] as never,
    search: async (q: string) => {
      searched.push(q);
      return { ok: true as const, results: [{ title: "Larkspur Labs: scheduling for clinics", url: "https://larkspurlabs.com/about", snippet: "Scheduling software for clinics." }, { title: "Larkspur on LinkedIn", url: "https://www.linkedin.com/company/larkspur", snippet: "x" }, { title: "Larkspur Labs engineering blog", url: "https://larkspurlabs.com/blog", snippet: "How we ship." }] };
    },
    page: async (url: string) => (url.endsWith("/blog") ? ({ ok: false as const, problem: "not_readable" as const }) : { ok: true as const, title: "About", text: "Larkspur Labs builds scheduling software used by 400 clinics across the country. Our engineering team ships to production every day and owns what it builds." }),
  };
  return { store, kit, ctx, deps, searched };
}

const call = (tool: string, input: Record<string, unknown> = {}): NextAction => ({ action: "call", tool, input, why: "" });
const brief = (over: object = {}) =>
  JSON.stringify({
    about: [{ text: "Larkspur Labs builds scheduling software used by 400 clinics.", cites: ["p1"] }],
    whyThem: [{ text: "It just raised $12 million to expand its platform.", cites: ["n1"] }],
    yourAngle: [{ text: "Lead with TypeScript and React, which the posting names.", cites: ["f2"] }],
    questions: [{ text: "What is the Platform team building with the new funding?", cites: ["n1"] }],
    ...over,
  });

describe("The Company Research agent", () => {
  beforeEach(() => {
    moves = [];
  });

  it("reads, searches, recovers twice, is sent back for an uncited number, and saves a cited brief", async () => {
    const { runCompanyResearch, researchRunId } = await import("@/lib/agents/companyResearch");
    const { store, kit, ctx, deps, searched } = await setup();
    moves = [
      call("readJob"),
      call("companyNews"),
      call("searchWeb", { query: "best scheduling software" }), // not about the company: the tool says how to fix it
      call("searchWeb", { query: "Larkspur Labs about engineering" }),
      call("readPage", { result: "s2" }), // the blog cannot be read: the tool says to pick another
      call("readPage", { result: "s1" }),
      { action: "done", answer: brief({ about: [{ text: "Its software is used by 900 clinics.", cites: ["p1"] }] }) }, // sent back: 900 is not in p1
      { action: "done", answer: brief() },
    ];
    const res = await runCompanyResearch(ctx, { kit, match }, { persist: store, deps });
    expect(res).toMatchObject({ status: "done", writer: "model" });
    // LinkedIn never becomes a result it could open.
    expect(res.research!.facts.filter((f) => f.id.startsWith("s")).map((f) => f.text).join(" ")).not.toContain("linkedin");
    expect(searched).toEqual(["Larkspur Labs about engineering"]);
    const steps = res.state!.steps.map((s) => [s.tool, s.ok]);
    expect(steps).toContainEqual(["searchWeb", false]);
    expect(steps).toContainEqual(["readPage", false]);
    expect(steps).toContainEqual(["review", false]);
    expect(steps.at(-1)).toEqual(["review", true]);
    // Saved where the Apply brief, Pitch, Interview Prep and Claude read it.
    const stored = parseResearch((await store.applyBriefs.forKits([kit.id])).get(kit.id)?.data);
    expect(stored).toMatchObject({ by: "agent", company: "Larkspur Labs", team: "Platform" });
    expect(stored!.about![0]!.text).toContain("400 clinics");
    expect(stored!.pages.map((p) => p.url)).toContain("https://larkspurlabs.com/about");
    // One search and two page reads were counted against the reading budget.
    expect((await store.settings.get()).firecrawlUsage).toMatchObject({ today: 3 });
    expect((await store.agentRunState.get(researchRunId(kit.id)))?.status).toBe("done");
  });

  it("with no AI, the rules' angle is saved from the job's own facts, and nothing is searched", async () => {
    const { runCompanyResearch } = await import("@/lib/agents/companyResearch");
    const { store, kit, ctx, deps, searched } = await setup();
    const res = await runCompanyResearch(ctx, { kit, match }, { persist: store, deps });
    expect(res.writer).toBe("rules");
    expect(res.research!.angle.writer).toBe("rules");
    expect(res.research!.about).toBeUndefined();
    expect(searched).toEqual([]);
  });

  it("opens only pages its own search returned, and stops at its budget", async () => {
    const { runCompanyResearch } = await import("@/lib/agents/companyResearch");
    const { store, kit, ctx, deps } = await setup();
    moves = [call("readJob"), call("companyNews"), call("readPage", { result: "s7" }), call("searchWeb", { query: "Larkspur Labs product" }), call("searchWeb", { query: "Larkspur Labs news" }), call("searchWeb", { query: "Larkspur Labs team" }), call("searchWeb", { query: "Larkspur Labs funding" }), { action: "done", answer: brief({ about: [{ text: "Larkspur Labs makes scheduling software for clinics.", cites: ["s1"] }] }) }];
    const res = await runCompanyResearch(ctx, { kit, match }, { persist: store, deps });
    const notes = res.state!.steps.filter((s) => !s.ok).map((s) => s.note).join(" ");
    expect(notes).toContain('There is no search result "s7"');
    // The second and third searches return nothing new; a fourth is over the budget either way.
    expect(notes).toMatch(/Nothing new came up|No searches left/);
  });
});
