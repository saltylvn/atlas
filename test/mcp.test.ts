import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bearer, decideMcp, isAuthorizationId, resourceMetadata } from "@/lib/mcp/auth";
import { isPublicPath } from "@/lib/supabase/gate";

// Atlas's MCP connector (Step 4, 24 Nov 2026): who may use it, what it may do, and real MCP
// requests against the route in demo mode.

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const OWNER = { id: "owner-1", email: "Owner@Example.com" };
const NOW = 1_800_000_000;
const good = { sub: "owner-1", email: "owner@example.com", client_id: "c-1", exp: NOW + 600 };

describe("Who may use the MCP endpoint", () => {
  it("lets in an OAuth token for the owner, with Claude access on", () => {
    expect(decideMcp(good, OWNER, true, NOW)).toEqual({ ok: true, clientId: "c-1" });
  });

  it("refuses a browser session token, another account, an expired token, and access turned off", () => {
    expect(decideMcp(null, OWNER, true, NOW)).toMatchObject({ ok: false, status: 401 });
    expect(decideMcp({ ...good, client_id: null }, OWNER, true, NOW)).toMatchObject({ ok: false, status: 401 });
    expect(decideMcp({ ...good, sub: "someone-else" }, OWNER, true, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(decideMcp({ ...good, email: "other@example.com" }, OWNER, true, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(decideMcp({ ...good, exp: NOW - 1 }, OWNER, true, NOW)).toMatchObject({ ok: false, status: 401 });
    expect(decideMcp(good, OWNER, false, NOW)).toMatchObject({ ok: false, status: 403 });
    expect(decideMcp(good, { id: null, email: undefined }, true, NOW)).toMatchObject({ ok: false, status: 403 });
  });

  it("reads only a well-formed bearer token and a well-formed consent id", () => {
    expect(bearer("Bearer abcdefghijklmnopqrstuvwxyz.123")).toBe("abcdefghijklmnopqrstuvwxyz.123");
    expect(bearer("Basic abc")).toBeNull();
    expect(bearer("Bearer short")).toBeNull();
    expect(isAuthorizationId("a1b2c3d4-e5f6")).toBe(true);
    expect(isAuthorizationId("x\"><script>")).toBe(false);
  });

  it("points Claude at Supabase Auth, and the endpoint skips the browser session gate", () => {
    expect(resourceMetadata("https://atlas.example.com", "https://ref.supabase.co/")).toEqual({ resource: "https://atlas.example.com/api/mcp", authorization_servers: ["https://ref.supabase.co/auth/v1"], bearer_methods_supported: ["header"], resource_name: "Atlas" });
    expect(isPublicPath("/api/mcp")).toBe(true);
    expect(isPublicPath("/.well-known/oauth-protected-resource/api/mcp")).toBe(true);
    // The consent page is not public: the gate requires the owner and the second factor.
    expect(isPublicPath("/oauth/consent")).toBe(false);
  });
});

describe("What the tools may do", () => {
  it("are read-only by construction: the tools file never calls a write", () => {
    const src = read("lib/mcp/tools.ts");
    expect(src).not.toMatch(/store\.[A-Za-z]+\.(create|update|save|add|delete|remove|setStatus|upsert|record|replace|append|confirm|prune)\(/);
    expect(src).not.toMatch(/persist|ownerWriteStore|runPitch|runInterviewPrep|takeAiCall/);
  });

  it("redact email addresses and phone numbers, keeping links only in url fields", async () => {
    const { redact } = await import("@/lib/mcp/tools");
    expect(redact({ note: "Write to jane@acme.com or 801-555-0100", url: "https://acme.com/jobs/1" })).toEqual({ note: "Write to [email removed] or ", url: "https://acme.com/jobs/1" });
  });
});

describe("Each tool's contract", () => {
  it("every tool says when to use it in one short line, and has a unique snake_case name", async () => {
    const { TOOLS } = await import("@/lib/mcp/tools");
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name, t.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(t.description, t.name).toMatch(/^Use when /);
      expect(t.description.length, t.name).toBeLessThanOrEqual(220);
    }
  });

  it("every tool answers on demo data, within the size cap, with no email address or phone number", async () => {
    const { TOOLS, asText, MAX_OUTPUT } = await import("@/lib/mcp/tools");
    const { demoStore } = await import("@/lib/data/memory");
    const store = demoStore();
    const settings = await store.settings.get();
    const ctx = { mode: "demo", userId: "demo", store, settings, now: new Date("2026-11-24T18:00:00Z"), today: "2026-11-24", time: "18:00" } as never;
    const [app] = (await store.applications.list()).filter((a) => a.status !== "saved");
    const [kit] = (await store.approvals.list()).filter((k) => k.kind === "application");
    const args: Record<string, unknown> = { job_snapshot: { kitId: kit?.id ?? "none" }, applications: { status: "all" }, interview_prep: { applicationId: app!.id }, practice_interview: { applicationId: app!.id }, search_material: { query: "TypeScript" } };
    for (const t of TOOLS) {
      const input = t.input.parse(args[t.name] ?? {});
      const text = asText(await (t.run as (c: never, i: unknown) => Promise<unknown>)(ctx, input));
      expect(text.length, t.name).toBeLessThanOrEqual(MAX_OUTPUT);
      expect(text, t.name).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    }
  });

  it("a slow tool is cut off instead of holding the request", async () => {
    const { withTimeout } = await import("@/lib/mcp/server");
    await expect(withTimeout(new Promise(() => undefined), 20)).rejects.toThrow(/over 20 ms/);
    await expect(withTimeout(Promise.resolve(1), 20)).resolves.toBe(1);
  });
});

describe("The MCP route, end to end (demo mode)", () => {
  const rpc = async (method: string, params: Record<string, unknown> = {}, id = 1) => {
    const { POST } = await import("@/app/api/mcp/route");
    const { NextRequest } = await import("next/server");
    const res = await POST(
      new NextRequest("http://localhost:3100/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      }),
    );
    // The handler answers as JSON or as a one-message event stream; read either.
    const raw = await res.text();
    const json = raw.trimStart().startsWith("{") ? raw : (/^data: (.+)$/m.exec(raw)?.[1] ?? "null");
    return { status: res.status, body: JSON.parse(json) as { result?: Record<string, unknown>; error?: unknown } | null };
  };

  it("initializes, lists the read-only tools, and answers a tool call", async () => {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.status).toBe(200);
    expect((init.body?.result as { serverInfo?: { name?: string } })?.serverInfo?.name).toBe("atlas");

    const list = await rpc("tools/list", {}, 2);
    const tools = (list.body?.result as { tools: { name: string; annotations?: { readOnlyHint?: boolean } }[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(["apply_queue", "job_snapshot", "applications", "funnel", "market", "proof_project", "interview_prep", "practice_interview", "weekly_plan", "my_projects", "search_material"]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);

    const call = await rpc("tools/call", { name: "applications", arguments: { status: "interview" } }, 3);
    const text = ((call.body?.result as { content: { text: string }[] }).content[0]!.text);
    const apps = JSON.parse(text) as { applicationId: string; status: string }[];
    expect(apps.length).toBeGreaterThan(0);
    expect(apps.every((a) => a.status === "interview")).toBe(true);

    const practice = await rpc("tools/call", { name: "practice_interview", arguments: { applicationId: apps[0]!.applicationId } }, 4);
    const out = JSON.parse(((practice.body?.result as { content: { text: string }[] }).content[0]!.text)) as { instructions: string; likelyQuestions?: string[]; prep?: unknown };
    expect(out.instructions).toContain("one question at a time");
    expect(out.prep ?? out.likelyQuestions).toBeTruthy();
  });

  it("refuses GET: the endpoint is stateless POST only", async () => {
    const { GET } = await import("@/app/api/mcp/route");
    expect((await GET()).status).toBe(405);
  });
});

describe("Mission Control shows the MCP layer", () => {
  it("draws Supabase Auth, Claude, the MCP server and Atlas data in their own row, inside the canvas", async () => {
    const { MAP_EDGES, MAP_GROUPS, MAP_NODES, MAP_SIZE, MCP_NODE, NODE_FACTS } = await import("@/lib/domain/orchestration");
    const row = MAP_GROUPS.find((g) => g.id === "connector")!;
    const ids = ["mcp-auth", "mcp-claude", MCP_NODE, "mcp-data"];
    for (const id of ids) {
      const n = MAP_NODES.find((x) => x.id === id)!;
      expect(n.x - n.w / 2 >= row.x && n.x + n.w / 2 <= row.x + row.w && n.y - n.h / 2 >= row.y && n.y + n.h / 2 <= row.y + row.h, id).toBe(true);
      expect(NODE_FACTS[id]?.length, id).toBeGreaterThan(0);
    }
    expect(row.y + row.h).toBeLessThanOrEqual(MAP_SIZE.h);
    expect(MAP_EDGES.filter((e) => e.kind === "connect").map((e) => e.id)).toEqual(["mcp-claude>mcp-auth", `mcp-claude>${MCP_NODE}`, `${MCP_NODE}>mcp-data`]);
  });

  it("lights the MCP box from today's audit rows: reading, done, failed, idle or off", async () => {
    const { mcpLive } = await import("@/lib/domain/orchestration");
    const now = new Date("2026-11-24T18:00:00Z");
    const since = "2026-11-24T07:00:00Z";
    const row = (at: string, outcome = "success", action = "mcp.funnel") => ({ action, outcome, at });
    expect(mcpLive(true, [row("2026-11-24T17:59:30Z")], now, since)).toMatchObject({ state: "running", calls: 1 });
    expect(mcpLive(true, [row("2026-11-24T12:00:00Z"), row("2026-11-24T11:00:00Z", "error")], now, since)).toMatchObject({ state: "ok", calls: 2, errors: 1, lastAt: "2026-11-24T12:00:00Z" });
    expect(mcpLive(true, [row("2026-11-24T12:00:00Z", "error")], now, since).state).toBe("failed");
    // Yesterday's reads, consent decisions and other audit rows do not count.
    expect(mcpLive(true, [row("2026-11-23T12:00:00Z"), row("2026-11-24T12:00:00Z", "success", "mcp.consent.approve"), row("2026-11-24T12:00:00Z", "success", "career.save-job"), row("2026-11-24T12:00:00Z", "success", "mcp.enabled"), row("2026-11-24T12:00:00Z", "success", "mcp.revoke")], now, since)).toMatchObject({ state: "idle", calls: 0 });
    expect(mcpLive(false, [row("2026-11-24T17:59:30Z")], now, since).state).toBe("paused");
  });
});
