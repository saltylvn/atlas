import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "@/lib/domain/ttlCache";
import { boardCacheKey, trimRaw, TRIM, type Raw } from "@/lib/integrations/jobBoards";

describe("ttl cache", () => {
  it("serves fresh values and expires them", () => {
    let t = 0;
    const c = createTtlCache<number>({ ttlMs: 100, now: () => t });
    c.set("a", 1);
    t = 99;
    expect(c.get("a")).toBe(1);
    t = 100;
    expect(c.get("a")).toBeUndefined();
    expect(c.size()).toBe(0);
  });

  it("loads once while fresh and de-duplicates concurrent loads", async () => {
    let t = 0;
    const c = createTtlCache<string>({ ttlMs: 1000, now: () => t });
    const load = vi.fn(async () => "board");
    const [a, b] = await Promise.all([c.getOrLoad("k", load), c.getOrLoad("k", load)]);
    expect([a, b]).toEqual(["board", "board"]);
    await c.getOrLoad("k", load);
    expect(load).toHaveBeenCalledTimes(1);
    t = 1000;
    await c.getOrLoad("k", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache failures", async () => {
    const c = createTtlCache<string>({ ttlMs: 1000 });
    await expect(c.getOrLoad("k", () => Promise.reject(new Error("down")))).rejects.toThrow("down");
    expect(await c.getOrLoad("k", async () => "ok")).toBe("ok");
  });

  it("evicts the oldest entries past maxEntries", () => {
    const c = createTtlCache<number>({ ttlMs: 1000, maxEntries: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("c")).toBe(3);
    expect(c.size()).toBe(2);
  });
});

describe("board trimming", () => {
  const raw = (r: Partial<Raw>): Raw => ({ id: "1", title: "Solutions Engineer", url: "https://jobs.example.com/1", location: "Remote", updatedAt: null, ...r });

  it("drops non-http urls and caps field lengths", () => {
    const out = trimRaw([raw({ url: "javascript:alert(1)" }), raw({ title: "x".repeat(500), location: "y".repeat(500), id: "z".repeat(200) }), raw({ url: "https://e.com/" + "a".repeat(600) })]);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toHaveLength(TRIM.title);
    expect(out[0]!.location).toHaveLength(TRIM.location);
    expect(out[0]!.id).toHaveLength(TRIM.id);
  });

  it("caps the number of jobs kept per board", () => {
    const many = Array.from({ length: TRIM.maxJobs + 50 }, (_, i) => raw({ id: String(i) }));
    expect(trimRaw(many)).toHaveLength(TRIM.maxJobs);
  });

  it("keys the cache by board and slug", () => {
    expect(boardCacheKey({ board: "ashby", slug: "openai" })).toBe("ashby:openai");
  });
});
