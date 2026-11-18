import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore, seedState, type MemoryState } from "@/lib/data/memory";
import type { Store } from "@/lib/data/store";
import { MACHINE_ROUTES, TOKEN_REFUSED, type MachineRoute } from "@/lib/domain/refusedTokens";
import { noteRefusedToken, REFUSED_SETTLE_MS, resetRefusedTokens } from "@/lib/security/refusedToken";
import * as capture from "@/app/api/capture/route";
import * as afternoon from "@/app/api/cron/afternoon/route";
import * as evening from "@/app/api/cron/evening/route";
import * as morning from "@/app/api/cron/morning/route";
import * as qa from "@/app/api/cron/qa/route";
import * as sync from "@/app/api/cron/sync/route";
import * as keepalive from "@/app/api/keepalive/route";

// The seven machine endpoints themselves, called the way the scheduler, the Shortcut and a
// stranger would call them: a missing or wrong token answers 401 at once, and leaves a
// record afterwards. The database is the in-memory store; the tokens are made up here.

const h = vi.hoisted(() => ({
  live: true,
  store: null as unknown,
  /** What the platform's after() does with a task. Null: there is no request scope, as in any test. */
  after: null as null | ((task: () => Promise<void>) => void),
  /** The value each route expects, made up here: forty of one letter. */
  right: { cron: "c".repeat(40), keepalive: "k".repeat(40), capture: "s".repeat(40) },
}));

vi.mock("@/lib/env", () => ({
  env: () => ({
    NODE_ENV: "test",
    CRON_SECRET: h.right.cron,
    ATLAS_KEEPALIVE_TOKEN: h.right.keepalive,
    ATLAS_CAPTURE_TOKEN: h.right.capture,
  }),
  mode: () => (h.live ? "live" : "demo"),
}));
vi.mock("@/lib/owner", async (orig) => ({
  ...(await orig<typeof import("@/lib/owner")>()),
  serviceReady: () => h.live,
  ownerServiceStore: () => h.store as Store,
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (task: () => Promise<void>) => {
    if (!h.after) throw new Error("`after` was called outside a request scope.");
    h.after(task);
  },
}));
vi.mock("@/lib/security/refusedToken", async (orig) => {
  const real = await orig<typeof import("@/lib/security/refusedToken")>();
  return { ...real, noteRefusedToken: vi.fn(real.noteRefusedToken) };
});

type Handler = (request: NextRequest) => Response | NextResponse | Promise<Response | NextResponse>;
const ROUTES: { path: MachineRoute; method: "GET" | "POST"; handler: Handler; expects: keyof typeof h.right }[] = [
  { path: "/api/capture", method: "POST", handler: capture.POST, expects: "capture" },
  { path: "/api/keepalive", method: "POST", handler: keepalive.POST, expects: "keepalive" },
  { path: "/api/cron/morning", method: "GET", handler: morning.GET, expects: "cron" },
  { path: "/api/cron/afternoon", method: "GET", handler: afternoon.GET, expects: "cron" },
  { path: "/api/cron/evening", method: "GET", handler: evening.GET, expects: "cron" },
  { path: "/api/cron/qa", method: "GET", handler: qa.GET, expects: "cron" },
  { path: "/api/cron/sync", method: "GET", handler: sync.GET, expects: "cron" },
];
const WRONG = `Bearer wrong-${"w".repeat(34)}`;

function call(r: (typeof ROUTES)[number], authorization?: string) {
  // A query string and a body like the ones a prober might send: neither is ever recorded.
  const init = { method: r.method, headers: { ...(authorization ? { authorization } : {}), "user-agent": "probe/1.0", "x-forwarded-for": "203.0.113.9" }, ...(r.method === "POST" ? { body: "{\"text\":\"hello\"}" } : {}) };
  return r.handler(new NextRequest(`https://atlas.test${r.path}?probe=in-the-query`, init));
}

let state: MemoryState;
const rows = () => state.audit.filter((e) => e.action === TOKEN_REFUSED).map((e) => `${e.target} | ${e.detail} | ${e.outcome}`);

beforeEach(() => {
  vi.useFakeTimers();
  state = seedState(new Date());
  state.audit = [];
  h.store = createMemoryStore(state);
  h.live = true;
  h.after = null;
  resetRefusedTokens();
  vi.mocked(noteRefusedToken).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("A refused token on a machine endpoint", () => {
  it("the list of machine routes is the seven routes exercised here", () => {
    expect(ROUTES.map((r) => r.path).sort()).toEqual([...MACHINE_ROUTES].sort());
  });

  it("answers 401 at once on every route, and leaves one record per route afterwards", async () => {
    for (const r of ROUTES) {
      for (const authorization of [undefined, WRONG]) {
        const res = await call(r, authorization);
        expect(res.status, r.path).toBe(401);
        expect(await res.json(), r.path).toEqual({ error: "unauthorized" });
      }
    }
    // Every answer above came back before anything was written: the clock has not moved.
    expect(state.audit).toEqual([]);
    expect(vi.mocked(noteRefusedToken).mock.calls.map((c) => c[0])).toEqual(ROUTES.flatMap((r) => [r.path, r.path]));

    await vi.advanceTimersByTimeAsync(REFUSED_SETTLE_MS);
    expect(rows().sort()).toEqual(ROUTES.map((r) => `${r.path} | 2 refused at ${r.path}: 1 no token, 1 wrong token | denied`).sort());
    // The route, the counts, who wrote it and when. Nothing of the request.
    const kept = JSON.stringify(state.audit);
    for (const leaked of ["wrong-", "Bearer", "probe/1.0", "203.0.113.9", "in-the-query", "hello", "atlas.test"]) expect(kept, leaked).not.toContain(leaked);
    expect(state.audit.every((e) => e.actor === "system")).toBe(true);
  });

  it("a flood at one route is one record, and the 401s keep coming", async () => {
    const route = ROUTES.find((r) => r.path === "/api/cron/sync")!;
    const append = vi.spyOn((h.store as Store).audit, "append");
    for (let i = 0; i < 500; i++) expect((await call(route, WRONG)).status).toBe(401);
    await vi.advanceTimersByTimeAsync(REFUSED_SETTLE_MS);
    for (let i = 0; i < 500; i++) expect((await call(route, WRONG)).status).toBe(401);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(rows()).toEqual(["/api/cron/sync | 500 refused at /api/cron/sync: 0 no token, 500 wrong token | denied"]);
    // One write, not a thousand. The second 500 wait in memory for the next window's record.
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("on the platform the write is handed to after(), so the response never waits for it", async () => {
    const tasks: (() => Promise<void>)[] = [];
    h.after = (task) => tasks.push(task);
    const res = await call(ROUTES.find((r) => r.path === "/api/keepalive")!, WRONG);
    expect(res.status).toBe(401);
    expect(tasks).toHaveLength(1);
    expect(state.audit).toEqual([]);
    const done = tasks[0]!();
    await vi.advanceTimersByTimeAsync(REFUSED_SETTLE_MS);
    await done;
    expect(rows()).toEqual(["/api/keepalive | 1 refused at /api/keepalive: 0 no token, 1 wrong token | denied"]);
  });

  it("still answers 401, and nothing else changes, when the database refuses the write", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn((h.store as Store).audit, "append").mockRejectedValue(new Error("Database insert on audit_events failed (57014)"));
    for (const r of ROUTES) {
      const res = await call(r, WRONG);
      expect(res.status, r.path).toBe(401);
      expect(await res.json(), r.path).toEqual({ error: "unauthorized" });
    }
    await vi.advanceTimersByTimeAsync(REFUSED_SETTLE_MS);
    expect(state.audit).toEqual([]);
    // Host logs are the backup trail: one line per route with what the row would have held.
    expect(errors.mock.calls.filter((c) => c[0] === "[audit] refused tokens not recorded yet:").map((c) => c[1]).sort()).toEqual(ROUTES.map((r) => `1 refused at ${r.path}: 0 no token, 1 wrong token`).sort());
    expect(errors).toHaveBeenCalledTimes(ROUTES.length * 2);
    for (const leaked of ["wrong-", "Bearer", "probe/1.0", "203.0.113.9", "in-the-query", "hello"]) expect(JSON.stringify(errors.mock.calls), leaked).not.toContain(leaked);
  });

  it("checks the token before it says anything else, and does not record a right one", async () => {
    // Not configured (demo mode): a stranger still hears 401, not how the deployment is set up.
    h.live = false;
    for (const r of ROUTES) expect((await call(r, WRONG)).status, r.path).toBe(401);
    vi.mocked(noteRefusedToken).mockClear();
    // The right token gets past the check (and then hears "not configured" here).
    for (const r of ROUTES) {
      const res = await call(r, `Bearer ${h.right[r.expects]}`);
      expect(res.status, r.path).toBe(503);
    }
    expect(noteRefusedToken).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REFUSED_SETTLE_MS);
    expect(state.audit).toEqual([]);
  });
});
