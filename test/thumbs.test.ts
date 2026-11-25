import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyThumb, queueThumbsWithoutKit } from "@/lib/applyQueue";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { thumbStep, thumbsWithoutKit } from "@/lib/domain/applications";
import type { JobMatch } from "@/lib/domain/types";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const NOW = new Date("2026-11-17T22:00:00Z");

describe("What a thumb means", () => {
  const m = (status: JobMatch["status"] = "new") => ({ id: "m1", status });
  const kit = (status: "pending" | "approved" | "rejected", id = `a-${status}`) => ({ id, matchId: "m1", status });

  it("👍 queues the apply kit once", () => {
    expect(thumbStep(m(), [], 1)).toEqual({ queue: true, withdraw: [], status: "pursuing", note: "Added to your apply queue." });
    expect(thumbStep(m("pursuing"), [kit("pending")], 1)).toEqual({ queue: false, withdraw: [], status: "pursuing", note: "Already in your apply queue." });
    // Taken back earlier: a new 👍 queues it again.
    expect(thumbStep(m(), [kit("rejected")], 1).queue).toBe(true);
  });

  it("clearing the 👍, or a 👎, takes back a kit still waiting", () => {
    expect(thumbStep(m("pursuing"), [kit("pending")], 0)).toEqual({ queue: false, withdraw: ["a-pending"], status: "new", note: "Taken out of your apply queue." });
    expect(thumbStep(m("pursuing"), [kit("pending")], -1)).toMatchObject({ withdraw: ["a-pending"], status: "new" });
    expect(thumbStep(m(), [], -1)).toEqual({ queue: false, withdraw: [], status: "new", note: "" });
  });

  it("never touches a job you already acted on", () => {
    expect(thumbStep(m("applied"), [], 1)).toEqual({ queue: false, withdraw: [], status: "applied", note: "It is already on your Applications board." });
    expect(thumbStep(m("pursuing"), [kit("approved")], -1)).toEqual({ queue: false, withdraw: [], status: "pursuing", note: "" });
    expect(thumbStep(m("applied"), [kit("approved")], 0).withdraw).toEqual([]);
  });

  it("only looks at this job's kits", () => {
    expect(thumbStep(m(), [{ id: "x", matchId: "other", status: "pending" }], 1).queue).toBe(true);
  });
});

function demo() {
  const state = seedState(NOW);
  const store = createMemoryStore(state);
  const match: JobMatch = { id: "m1", key: "k1", title: "AI Engineer", company: "Acme", url: "https://example.com/jobs/1", source: "Greenhouse", location: "Remote", role: "AI Engineer", payText: "$150k", postedAt: null, score: 80, shownOn: "2026-11-17", shownSlot: "morning", rating: 0, status: "new", createdAt: NOW.toISOString() };
  (state.jobMatches ??= []).push(match);
  return { state, store, match };
}
const kitsFor = async (store: ReturnType<typeof createMemoryStore>) => (await store.approvals.list()).filter((a) => a.matchId === "m1");

describe("A thumb, carried out", () => {
  it("👍 puts one apply kit in the queue, 👍 again adds nothing, clearing takes it back, 👍 queues it again", async () => {
    const { store, match } = demo();
    await applyThumb(store, {}, match, 1, NOW);
    expect(await kitsFor(store)).toEqual([expect.objectContaining({ kind: "application", status: "pending", url: match.url, title: expect.stringContaining("Acme") })]);
    expect(await store.jobMatches.get("m1")).toMatchObject({ rating: 1, status: "pursuing" });

    await applyThumb(store, {}, (await store.jobMatches.get("m1"))!, 1, NOW);
    expect(await kitsFor(store)).toHaveLength(1);

    await applyThumb(store, {}, (await store.jobMatches.get("m1"))!, 0, NOW);
    expect((await kitsFor(store)).map((a) => a.status)).toEqual(["rejected"]);
    expect(await store.jobMatches.get("m1")).toMatchObject({ rating: 0, status: "new" });

    await applyThumb(store, {}, (await store.jobMatches.get("m1"))!, 1, NOW);
    expect((await kitsFor(store)).map((a) => a.status).sort()).toEqual(["pending", "rejected"]);
  });

  it("a job goes in as an application, and the audit trail says what happened", async () => {
    const { store, match } = demo();
    await applyThumb(store, {}, match, 1, NOW);
    expect((await kitsFor(store))[0]!.kind).toBe("application");
    await applyThumb(store, {}, (await store.jobMatches.get("m1"))!, -1, NOW);
    const trail = (await store.audit.recent(10)).map((e) => e.action);
    expect(trail).toEqual(expect.arrayContaining(["career.queue", "career.withdraw"]));
  });

  it("a second tap the database refuses is not an error when the first one queued it", async () => {
    const { store, match } = demo();
    await applyThumb(store, {}, match, 1, NOW);
    // Another tab read the queue before the first tap saved, so it tries to queue too; the
    // database's one-waiting-kit rule refuses the insert.
    let reads = 0;
    const racing = { ...store, approvals: { ...store.approvals, list: async () => (reads++ === 0 ? [] : store.approvals.list()), create: async () => Promise.reject(new Error("duplicate key value violates unique constraint")) } };
    await expect(applyThumb(racing as never, {}, match, 1, NOW)).resolves.toMatchObject({ queue: true, status: "pursuing" });
    expect(await kitsFor(store)).toHaveLength(1);
  });

  it("any other failure to queue is reported, not swallowed", async () => {
    const { store, match } = demo();
    const broken = { ...store, approvals: { ...store.approvals, create: async () => Promise.reject(new Error("database unavailable")) } };
    await expect(applyThumb(broken as never, {}, match, 1, NOW)).rejects.toThrow("database unavailable");
    // Nothing half-done: the match is not marked as queued.
    expect(await store.jobMatches.get("m1")).toMatchObject({ rating: 0, status: "new" });
  });

  it("has no Pursue left, and the database allows one waiting kit per job", () => {
    expect(read("components/client/CareerActions.tsx")).not.toMatch(/Pursue|pursueMatch/);
    expect(read("app/actions/career.ts")).not.toMatch(/export async function pursueMatch/);
    const migration = read("supabase/migrations/20261117225845_one_waiting_kit.sql");
    expect(migration).toMatch(/create unique index[\s\S]*\(owner_id, match_id\)[\s\S]*where status = 'pending'/);
  });
});

describe("A thumbs-up you have not applied to is always in a queue", () => {
  const m = (id: string, rating: number, status: JobMatch["status"]) => ({ id, rating, status });
  const kit = (matchId: string, status: "pending" | "approved" | "rejected") => ({ matchId, status });

  it("finds the thumbs-ups that have no kit", () => {
    const matches = [m("no-kit", 1, "new"), m("lost-kit", 1, "pursuing"), m("waiting", 1, "pursuing"), m("taken-back", 1, "new")];
    const kits = [kit("waiting", "pending"), kit("taken-back", "rejected")];
    expect(thumbsWithoutKit(matches, kits).map((x) => x.id)).toEqual(["no-kit", "lost-kit", "taken-back"]);
  });

  it("leaves alone what has moved on, and what you never wanted", () => {
    const matches = [m("applied", 1, "applied"), m("dismissed", 1, "dismissed"), m("on-board", 1, "pursuing"), m("undecided", 0, "new"), m("no", -1, "new")];
    expect(thumbsWithoutKit(matches, [kit("on-board", "approved")])).toEqual([]);
  });

  it("puts each one back in a queue once, however often it runs", async () => {
    const { store, match } = demo();
    // A thumbs-up whose kit was never made: rated, but in no queue.
    await store.jobMatches.update(match.id, { rating: 1, status: "new" });
    const waiting = async () => (await store.approvals.list()).filter((a) => a.matchId === match.id && a.status === "pending").length;
    const before = await waiting();
    expect(await queueThumbsWithoutKit(store, {}, "2026-11-17", NOW)).toBeGreaterThanOrEqual(1);
    expect(await waiting()).toBe(before + 1);
    expect((await store.jobMatches.get(match.id))!.status).toBe("pursuing");
    expect(await queueThumbsWithoutKit(store, {}, "2026-11-17", NOW)).toBe(0);
    expect(await waiting()).toBe(before + 1);
  });
});

describe("Not a Good Fit on a job in your apply queue (23 Nov 2026)", () => {
  it("takes it out of the queue and the Tracker for good, and counts as a 👎", async () => {
    const { huntBoard } = await import("@/lib/domain/huntBoard");
    const { notAGoodFit } = await import("@/lib/applyQueue");
    const { store, match } = demo();
    await applyThumb(store, {}, match, 1, NOW);
    const kit = (await kitsFor(store))[0]!;
    const board = async () => huntBoard({ apps: await store.applications.list(), approvals: await store.approvals.list(), matches: [(await store.jobMatches.get("m1"))!], today: "2026-11-17" });
    const onBoard = (b: Awaited<ReturnType<typeof board>>) => Object.values(b.stages).flat().some((c) => c.id === kit.id || c.id === "m1");
    expect(onBoard(await board())).toBe(true);

    expect(await notAGoodFit(store, kit.id, NOW)).toMatchObject({ ok: true });
    expect((await kitsFor(store)).map((a) => a.status)).toEqual(["rejected"]);
    expect(await store.jobMatches.get("m1")).toMatchObject({ rating: -1, status: "dismissed" });
    expect(onBoard(await board())).toBe(false);

    // The sync's self-healing never puts it back, and a second press says it is done.
    expect(await queueThumbsWithoutKit(store, {}, "2026-11-17", NOW)).toBe(0);
    expect(await kitsFor(store)).toHaveLength(1);
    expect(await notAGoodFit(store, kit.id, NOW)).toEqual({ ok: false, why: "Already decided." });
  });

  it("a job already applied to keeps its place on your board; only the kit closes", async () => {
    const { notAGoodFit } = await import("@/lib/applyQueue");
    const { store, match } = demo();
    await applyThumb(store, {}, match, 1, NOW);
    const kit = (await kitsFor(store))[0]!;
    await store.jobMatches.update("m1", { status: "applied" });
    await notAGoodFit(store, kit.id, NOW);
    expect(await store.jobMatches.get("m1")).toMatchObject({ status: "applied" });
  });

  it("the queue offers Not a Good Fit, through an action that validates its input", () => {
    expect(read("components/client/CareerActions.tsx")).toContain("Not a Good Fit");
    expect(read("app/actions/career.ts")).toMatch(/export async function markNotAGoodFit[\s\S]{0,200}id\.safeParse/);
  });

  it("the Apply Queue stays open however long it is, so every job's buttons show", () => {
    expect(read("components/ApprovalQueue.tsx")).toMatch(/<QueueFold [^>]*alwaysOpen>/);
    expect(read("components/ui.tsx")).toContain("defaultOpen={alwaysOpen || count <= FOLD_OVER}");
  });
});
