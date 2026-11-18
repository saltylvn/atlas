import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyThumb } from "@/lib/applyQueue";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { thumbStep } from "@/lib/domain/applications";
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
  const match: JobMatch = { id: "m1", key: "k1", type: "full-time", title: "AI Engineer", company: "Acme", url: "https://example.com/jobs/1", source: "Greenhouse", location: "Remote", role: "AI Engineer", payText: "$150k", postedAt: null, score: 80, shownOn: "2026-11-17", shownSlot: "morning", rating: 0, status: "new", createdAt: NOW.toISOString() };
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

  it("a gig goes in as a gig proposal, and the audit trail says what happened", async () => {
    const { store, match } = demo();
    await applyThumb(store, {}, { ...match, type: "gig" }, 1, NOW);
    expect((await kitsFor(store))[0]!.kind).toBe("gig-proposal");
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
