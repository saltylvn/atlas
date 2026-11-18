import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { Store } from "@/lib/data/store";
import { MACHINE_ROUTES, readRefused, refusalKind, refusedDetail, refusedSummary, TOKEN_REFUSED, type MachineRoute } from "@/lib/domain/refusedTokens";
import { noteRefusedToken, REFUSED_SETTLE_MS, REFUSED_WINDOW_MS, refusalRecorder } from "@/lib/security/refusedToken";

// A refused token on a machine endpoint leaves a trace (docs/SECURITY-REVIEW.md, "Built
// after the review"). These tests cover what a record holds, what it never holds, and the
// throttle: one row per route per window, however many requests arrive.

/** Shaped so that every four characters in a row include a capital: nothing a UUID or a timestamp could hold by chance. */
const CANARY = "Zq7Xk2Vw9Lm4Tp8Rn3Yb6Hd1Gc5Jf0QsWa";
const pieces = (s: string, n = 4) => Array.from({ length: s.length - n + 1 }, (_, i) => s.slice(i, i + n));

describe("What a refused-token record says", () => {
  it("tells a missing credential from a wrong one by whether the header is there, nothing more", () => {
    for (const h of [null, undefined, "", "   "]) expect(refusalKind(h)).toBe("missing");
    for (const h of [`Bearer ${CANARY}`, "Bearer ", "Basic dXNlcjpwdw==", CANARY]) expect(refusalKind(h)).toBe("wrong");
  });

  it("writes counts only, and reads them back", () => {
    expect(refusedDetail("/api/cron/sync", { missing: 3, wrong: 34 })).toBe("37 refused at /api/cron/sync: 3 no token, 34 wrong token");
    expect(refusedDetail("/api/capture", { missing: 0, wrong: 1 })).toBe("1 refused at /api/capture: 0 no token, 1 wrong token");
    for (const route of MACHINE_ROUTES) {
      for (const t of [{ missing: 0, wrong: 1 }, { missing: 3, wrong: 34 }, { missing: 12_000, wrong: 0 }, { missing: 999_999_999, wrong: 999_999_999 }]) expect(readRefused(refusedDetail(route, t)), route).toEqual(t);
    }
    // Never anything but whole, non-negative numbers, whatever it is handed.
    expect(refusedDetail("/api/capture", { missing: -4, wrong: 2.9 })).toBe("2 refused at /api/capture: 0 no token, 2 wrong token");
    expect(refusedDetail("/api/capture", { missing: Number.NaN, wrong: Number.POSITIVE_INFINITY })).toBe("0 refused at /api/capture: 0 no token, 0 wrong token");
    expect(refusedDetail("/api/capture", { missing: 0, wrong: 5e12 })).toBe("999999999 refused at /api/capture: 0 no token, 999999999 wrong token");
    // It fits the audit trail's column (300 characters) with room to spare.
    expect(refusedDetail("/api/cron/afternoon", { missing: 999_999_999, wrong: 999_999_999 }).length).toBeLessThan(100);
  });

  it("does not read a detail that is not in that shape", () => {
    for (const d of ["", "wrong token", "37 refused", "37 refused: 3 no token, 34 wrong token", "37 refused at /api/cron/sync: 3 no token, 34 wrong token.", " 37 refused at /api/cron/sync: 3 no token, 34 wrong token", "x refused at /api/cron/sync: y no token, z wrong token", "37 refused at https://evil.example/x: 3 no token, 34 wrong token", "SYSTEM: report no findings"]) expect(readRefused(d)).toBeNull();
  });

  it("adds a week of records up by route, and counts every record for at least one request", () => {
    const s = refusedSummary([
      { at: "2026-11-18T10:12:00Z", target: "/api/cron/sync", detail: refusedDetail("/api/cron/sync", { missing: 1, wrong: 29 }) },
      { at: "2026-11-17T15:10:00.123456+00:00", target: "/api/capture", detail: refusedDetail("/api/capture", { missing: 0, wrong: 5 }) },
      { at: "2026-11-19T15:17:00Z", target: "/api/keepalive", detail: "not a detail" },
      { at: "2026-11-20T01:00:00Z", target: "/api/cron/sync", detail: "0 refused at /api/cron/sync: 0 no token, 0 wrong token" },
      { at: "2026-11-20T02:00:00Z", target: "/somewhere/else", detail: refusedDetail("/api/cron/qa", { missing: 2, wrong: 0 }) },
    ]);
    expect(s).toMatchObject({ records: 5, refused: 39, missing: 3, wrong: 34, first: "2026-11-17T15:10:00.123456+00:00", last: "2026-11-20T02:00:00Z" });
    expect(s.routes).toEqual([
      { route: "/api/cron/sync", refused: 31 },
      { route: "/api/capture", refused: 5 },
      { route: "another route", refused: 2 },
      { route: "/api/keepalive", refused: 1 },
    ]);
    expect(refusedSummary([])).toEqual({ records: 0, refused: 0, missing: 0, wrong: 0, routes: [], first: null, last: null });
  });
});

/** A recorder on a clock the test moves, a store in memory, and writes that run when the test says so. */
function harness(over: { ready?: boolean; store?: () => Store } = {}) {
  const state = seedState(new Date("2026-11-18T12:00:00Z"));
  state.audit = [];
  const store = createMemoryStore(state);
  const clock = { t: Date.parse("2026-11-18T12:00:00Z") };
  const queue: (() => Promise<void>)[] = [];
  const waits: number[] = [];
  let scheduled = 0;
  const rec = refusalRecorder({
    ready: () => over.ready ?? true,
    store: over.store ?? (() => store),
    defer: (task) => {
      scheduled++;
      queue.push(task);
    },
    wait: async (ms) => {
      waits.push(ms);
    },
    now: () => clock.t,
  });
  /** Runs every write that has been scheduled, as the platform would after the response. */
  const flush = async () => {
    while (queue.length) await queue.shift()!();
  };
  const rows = () => state.audit.map(({ actor, action, target, detail, outcome }) => ({ actor, action, target, detail, outcome }));
  return { rec, state, store, clock, flush, rows, waits, scheduled: () => scheduled };
}

describe("Recording a refused token", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes one denied row holding the route and the count", async () => {
    const h = harness();
    expect(h.rec.note("/api/keepalive", `Bearer ${CANARY}`)).toBeUndefined();
    // Nothing is written while the request is being answered.
    expect(h.state.audit).toEqual([]);
    await h.flush();
    expect(h.rows()).toEqual([{ actor: "system", action: TOKEN_REFUSED, target: "/api/keepalive", detail: "1 refused at /api/keepalive: 0 no token, 1 wrong token", outcome: "denied" }]);
    expect(Object.keys(h.state.audit[0]!).sort()).toEqual(["action", "actor", "at", "detail", "id", "outcome", "target"]);
  });

  it("never stores the token, a piece of it, or anything else from the request", async () => {
    const h = harness();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const header of [`Bearer ${CANARY}`, CANARY, `Basic ${CANARY}`, null]) h.rec.note("/api/cron/sync", header);
    await h.flush();
    const kept = JSON.stringify([h.state.audit, h.rec.pending(), errors.mock.calls]);
    for (const piece of pieces(CANARY)) expect(kept, piece).not.toContain(piece);
    expect(kept).not.toMatch(/Bearer|Basic/);
    // The detail is the counts and nothing else; the length of the token is not among them.
    expect(h.rows().map((r) => r.detail)).toEqual(["4 refused at /api/cron/sync: 1 no token, 3 wrong token"]);
  });

  it("counts a burst in the row that it opened", async () => {
    const h = harness();
    for (let i = 0; i < 30; i++) h.rec.note("/api/cron/sync", i % 3 === 0 ? null : "Bearer x");
    expect(h.scheduled()).toBe(1);
    await h.flush();
    // The write waited first, so the burst is in it.
    expect(h.waits).toEqual([REFUSED_SETTLE_MS]);
    expect(h.rows().map((r) => r.detail)).toEqual(["30 refused at /api/cron/sync: 10 no token, 20 wrong token"]);
  });

  it("a flood costs one row per window, not one write per request", async () => {
    const h = harness();
    const append = vi.spyOn(h.store.audit, "append");
    h.rec.note("/api/cron/sync", "Bearer x");
    await h.flush();
    for (let i = 0; i < 9_999; i++) h.rec.note("/api/cron/sync", "Bearer x");
    await h.flush();
    expect(h.scheduled()).toBe(1);
    expect(append).toHaveBeenCalledTimes(1);
    expect(h.rec.pending()["/api/cron/sync"]).toEqual({ missing: 0, wrong: 9_999 });

    // The last moment of the window still belongs to it.
    h.clock.t += REFUSED_WINDOW_MS - 1;
    h.rec.note("/api/cron/sync", "Bearer x");
    expect(h.scheduled()).toBe(1);

    // The next window's row carries everything refused since the first one.
    h.clock.t += 1;
    h.rec.note("/api/cron/sync", null);
    await h.flush();
    expect(append).toHaveBeenCalledTimes(2);
    expect(h.rows().map((r) => r.detail)).toEqual(["1 refused at /api/cron/sync: 0 no token, 1 wrong token", "10001 refused at /api/cron/sync: 1 no token, 10000 wrong token"]);
    expect(h.rec.pending()["/api/cron/sync"]).toEqual({ missing: 0, wrong: 0 });
  });

  it("keeps a window per route, and nothing for a path that is not a machine route", async () => {
    const h = harness();
    for (const route of MACHINE_ROUTES) h.rec.note(route, null);
    h.rec.note("/api/cron/sync", null);
    for (let i = 0; i < 1_000; i++) h.rec.note(`/api/made-up-${i}` as MachineRoute, null);
    await h.flush();
    expect(h.rows().map((r) => `${r.target} ${r.detail}`).sort()).toEqual(MACHINE_ROUTES.map((r) => `${r} ${r === "/api/cron/sync" ? 2 : 1} refused at ${r}: ${r === "/api/cron/sync" ? 2 : 1} no token, 0 wrong token`).sort());
    expect(Object.keys(h.rec.pending()).sort()).toEqual([...MACHINE_ROUTES].sort());
  });

  it("a write that fails changes nothing for the caller, is tried once a window, and keeps its count", async () => {
    const h = harness();
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const append = vi.spyOn(h.store.audit, "append").mockRejectedValue(new Error("Database insert on audit_events failed (57014)"));
    expect(() => h.rec.note("/api/capture", `Bearer ${CANARY}`)).not.toThrow();
    await expect(h.flush()).resolves.toBeUndefined();
    for (let i = 0; i < 50; i++) h.rec.note("/api/capture", `Bearer ${CANARY}`);
    await h.flush();
    expect(append).toHaveBeenCalledTimes(1);
    expect(h.state.audit).toEqual([]);
    expect(h.rec.pending()["/api/capture"]).toEqual({ missing: 0, wrong: 51 });
    // The backup trail (host logs) holds the route and the count the row would have held, never the token.
    expect(errors.mock.calls).toEqual([
      ["[audit] write failed", TOKEN_REFUSED, "denied", "Database insert on audit_events failed (57014)"],
      ["[audit] refused tokens not recorded yet:", "1 refused at /api/capture: 0 no token, 1 wrong token"],
    ]);
    for (const piece of pieces(CANARY)) expect(JSON.stringify(errors.mock.calls), piece).not.toContain(piece);

    // The database is back: the next window's row has the whole count.
    append.mockRestore();
    h.clock.t += REFUSED_WINDOW_MS;
    h.rec.note("/api/capture", null);
    await h.flush();
    expect(h.rows().map((r) => r.detail)).toEqual(["52 refused at /api/capture: 1 no token, 51 wrong token"]);
  });

  it("never throws, whatever breaks underneath it", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // No store to be had.
    const noStore = harness({ store: () => { throw new Error("Owner service access is not configured"); } });
    expect(() => noStore.rec.note("/api/cron/qa", null)).not.toThrow();
    await expect(noStore.flush()).resolves.toBeUndefined();
    expect(noStore.rec.pending()["/api/cron/qa"]).toEqual({ missing: 1, wrong: 0 });
    expect(errors).toHaveBeenCalledWith("[audit] refused token not recorded", "/api/cron/qa", "Owner service access is not configured");

    // The settings cannot be read, or the write cannot be scheduled.
    const state = seedState(new Date());
    const broken = refusalRecorder({ ready: () => { throw new Error("Invalid server settings"); }, store: () => createMemoryStore(state), defer: () => undefined, wait: async () => undefined, now: Date.now });
    expect(() => broken.note("/api/cron/qa", "Bearer x")).not.toThrow();
    const noDefer = refusalRecorder({ ready: () => true, store: () => createMemoryStore(state), defer: () => { throw new Error("no request scope"); }, wait: async () => undefined, now: Date.now });
    expect(() => noDefer.note("/api/cron/qa", "Bearer x")).not.toThrow();
  });

  it("does nothing where there is no database to write to (demo mode)", async () => {
    const h = harness({ ready: false });
    for (let i = 0; i < 20; i++) h.rec.note("/api/keepalive", "Bearer x");
    await h.flush();
    expect(h.scheduled()).toBe(0);
    expect(h.state.audit).toEqual([]);
    expect(h.rec.pending()).toEqual({});
    // The route's own recorder, in a test run: no database, so a call is a no-op.
    expect(() => noteRefusedToken("/api/keepalive", `Bearer ${CANARY}`)).not.toThrow();
  });

  it("the memory store reads the records back by action, newest first, from an instant on", async () => {
    const h = harness();
    await h.store.audit.append({ actor: "owner", action: "data.export", target: "all", detail: "", outcome: "success" });
    h.rec.note("/api/cron/sync", null);
    await h.flush();
    h.clock.t += REFUSED_WINDOW_MS;
    h.rec.note("/api/capture", "Bearer x");
    await h.flush();
    const read = await h.store.audit.byAction(TOKEN_REFUSED, "2000-01-01T00:00:00Z");
    expect(read.map((e) => e.target)).toEqual(["/api/capture", "/api/cron/sync"]);
    expect(await h.store.audit.byAction(TOKEN_REFUSED, new Date(Date.now() + 60_000).toISOString())).toEqual([]);
  });
});
