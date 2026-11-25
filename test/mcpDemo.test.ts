import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/security/rateLimit";

// The public demo connector (/api/mcp-demo): open to anyone, so it is tested for what it serves
// (fictional data only), what it refuses (off by default, floods, big bodies) and that it says
// it is a demo.

const rpc = async (method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}) => {
  const { POST } = await import("@/app/api/mcp-demo/route");
  const { NextRequest } = await import("next/server");
  const res = await POST(
    new NextRequest("http://localhost:3100/api/mcp-demo", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18", "x-real-ip": "203.0.113.7", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  const raw = await res.text();
  const json = raw.trimStart().startsWith("{") ? raw : (/^data: (.+)$/m.exec(raw)?.[1] ?? "null");
  return { status: res.status, headers: res.headers, body: JSON.parse(json) as { result?: Record<string, unknown>; error?: unknown } | null };
};
const call = async (name: string, args: Record<string, unknown> = {}) => JSON.parse(((await rpc("tools/call", { name, arguments: args })).body!.result as { content: { text: string }[] }).content[0]!.text) as never;

describe("The public demo connector", () => {
  beforeEach(() => {
    resetRateLimits();
    vi.resetModules();
    vi.stubEnv("ATLAS_MCP_DEMO", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is off unless ATLAS_MCP_DEMO is set", async () => {
    vi.stubEnv("ATLAS_MCP_DEMO", "");
    expect((await rpc("tools/list")).status).toBe(404);
  });

  it("says it is a demo with fictional data, and lists the same eleven read-only tools", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
    const r = init.body!.result as { serverInfo: { name: string }; instructions: string };
    expect(r.serverInfo.name).toBe("atlas-demo");
    expect(r.instructions).toMatch(/fictional sample data/);
    const tools = ((await rpc("tools/list")).body!.result as { tools: { name: string; annotations: { readOnlyHint: boolean } }[] }).tools;
    expect(tools).toHaveLength(11);
    expect(tools.every((t) => t.annotations.readOnlyHint)).toBe(true);
  });

  it("has something worth showing in every part: a queue, a tailored job, prep with stories, a proof project, resume search", async () => {
    const queue = (await call("apply_queue")) as { queue: { kitId: string }[] };
    expect(queue.queue.length).toBeGreaterThan(0);
    const jobs = await Promise.all(queue.queue.map((k) => call("job_snapshot", { kitId: k.kitId }) as Promise<{ pitch: unknown }>));
    expect(jobs.some((j) => typeof j.pitch === "object")).toBe(true);
    const [app] = (await call("applications", { status: "interview" })) as { applicationId: string }[];
    const practice = (await call("practice_interview", { applicationId: app!.applicationId })) as { instructions: string; prep: { questions: { story: unknown }[] } };
    expect(practice.prep.questions.filter((q) => q.story).length).toBeGreaterThanOrEqual(2);
    expect(((await call("proof_project")) as { current: { skill: string } }).current.skill).toBe("AWS");
    expect(JSON.stringify(await call("search_material", { query: "TypeScript tests" }))).toContain("Trailhead");
  });

  it("writes nothing: no audit rows, and the data is the same after calls", async () => {
    const { showcaseContext } = await import("@/lib/mcp/showcase");
    const ctx = await showcaseContext();
    const before = [(await ctx.store.audit.recent(50)).length, (await ctx.store.applications.list()).length, JSON.stringify(await ctx.store.settings.get())];
    await call("funnel");
    await call("market");
    expect([(await ctx.store.audit.recent(50)).length, (await ctx.store.applications.list()).length, JSON.stringify(await ctx.store.settings.get())]).toEqual(before);
  });

  it("limits one caller without blocking another, and refuses an oversized body", async () => {
    const { DEMO_LIMIT } = await import("@/app/api/mcp-demo/route");
    for (let i = 0; i < DEMO_LIMIT.perCaller; i++) expect((await rpc("ping")).status).toBe(200);
    const blocked = await rpc("ping");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await rpc("ping", {}, { "x-real-ip": "198.51.100.9" })).status).toBe(200);
    expect((await rpc("ping", {}, { "x-real-ip": "198.51.100.10", "content-length": "50000" })).status).toBe(413);
  });
});
