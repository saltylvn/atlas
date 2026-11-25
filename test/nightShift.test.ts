import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { JobMatch } from "@/lib/domain/types";
type NewJobMatch = Omit<JobMatch, "id" | "createdAt">;

// The night shift (24 Nov 2026): clears jobs above your level by rules, then prepares today's
// picks with the Company Research and Pitch agents. Here the model is off, so the agents fall
// back to their rules' versions; what is tested is the workflow around them.

vi.mock("@/lib/agents/runtime/decide", () => ({ modelDecider: () => async () => null }));
vi.mock("@/lib/ai/budget", () => ({ takeAiCall: async () => ({ allowed: false, why: "off in tests" }), takeAiCallPaced: async () => ({ allowed: false, why: "off", waitedMs: 0 }) }));
vi.mock("@/lib/integrations/firecrawl", async (orig) => ({ ...(await orig<typeof import("@/lib/integrations/firecrawl")>()), firecrawlConfigured: () => false }));
vi.mock("@/lib/security/safeFetch", () => ({ safeFetchText: async () => "<rss><channel></channel></rss>" }));

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const NOW = new Date("2026-11-25T05:10:00Z"); // 10:10 PM in Denver, on the 24th

const job = (key: string, title: string, company: string): NewJobMatch =>
  ({ key, title, company, url: `https://example.com/${key}`, source: "Test", location: "Remote", role: "Software Engineer 1", payText: "$105k-$125k", postedAt: "2026-11-23T00:00:00Z", score: 70, shownOn: "2026-11-24", shownSlot: "morning", rating: 0, status: "new", skills: ["TypeScript"] }) as NewJobMatch;

async function setup() {
  const store = createMemoryStore(seedState(NOW));
  const [junior, senior, seniorFit, plainFit] = (await store.jobMatches.add([job("j1", "Software Engineer I", "Larkspur Labs"), job("j2", "Senior Software Engineer", "Bigco"), job("j3", "Staff Software Engineer", "Megacorp"), job("j4", "Software Engineer", "Smallco")])) as JobMatch[];
  for (const m of [junior!, senior!]) await store.jobMatches.update(m.id, { rating: 1, status: "pursuing" });
  const kit = (m: JobMatch, detail: string) => store.approvals.create({ kind: "application", title: `${m.title} at ${m.company}`, detail, url: m.url, matchId: m.id, status: "pending", decidedAt: null });
  const juniorKit = await kit(junior!, "Skills it names: TypeScript\nAsks for: 2+ years of experience");
  const seniorKit = await kit(senior!, "Skills it names: TypeScript");
  const settings = await store.settings.get();
  const ctx = { mode: "demo", userId: "", store, settings, now: NOW, today: "2026-11-24", time: "22:10", deadline: Date.now() + 280_000 } as never;
  return { store, ctx, junior: junior!, senior: senior!, seniorFit: seniorFit!, plainFit: plainFit!, juniorKit, seniorKit };
}

describe("The night shift", () => {
  it("clears senior jobs from the Apply Queue and Good fits by rules, and keeps the rest", async () => {
    const { sweepAboveLevel } = await import("@/lib/levelSweep");
    const { store, junior, senior, seniorFit, plainFit, juniorKit, seniorKit } = await setup();
    const r = await sweepAboveLevel(store, await store.settings.get(), "2026-11-24", NOW, "system");
    expect(r.queue).toEqual(["Senior Software Engineer at Bigco"]);
    expect(r.fits).toEqual(["Staff Software Engineer at Megacorp"]);
    expect((await store.approvals.get(seniorKit.id))?.status).toBe("rejected");
    expect((await store.approvals.get(juniorKit.id))?.status).toBe("pending");
    expect([(await store.jobMatches.get(senior.id))?.status, (await store.jobMatches.get(seniorFit.id))?.status, (await store.jobMatches.get(plainFit.id))?.status, (await store.jobMatches.get(junior.id))?.status]).toEqual(["dismissed", "dismissed", "new", "pursuing"]);
    // Dismissed, not thumbed down: the company is not held against later matches.
    expect((await store.jobMatches.get(senior.id))?.rating).toBe(1);
    const audit = (await store.audit.recent(5)).find((a) => a.action === "career.clear-above-level")!;
    expect(audit).toMatchObject({ actor: "system", outcome: "success" });
    // A second sweep finds nothing and writes no audit row.
    expect(await sweepAboveLevel(store, await store.settings.get(), "2026-11-24", NOW, "system")).toEqual({ queue: [], fits: [] });
  });

  it("sweeps first, then prepares each pick with Company Research and Pitch, and logs one traced run", async () => {
    const { runNightShift, loadReady, NIGHT_TASK } = await import("@/lib/agents/nightShift");
    const { store, ctx, juniorKit } = await setup();
    const res = await runNightShift(ctx, { trigger: "schedule", persist: store, honorPause: true });
    expect(res).toMatchObject({ cleared: 2, stopped: "done" });
    const run = (await store.agentRuns.recent(20)).find((r) => r.task === NIGHT_TASK && r.status === "succeeded")!;
    expect(run.agent).toBe("career");
    expect(run.trace!.map((s) => s.name)).toEqual(["Clear jobs above your level from the Apply Queue and Good fits", "Find today's picks and what is already prepared", "Research Larkspur Labs", "Tailor Software Engineer I at Larkspur Labs"]);
    // The senior job was never researched or tailored: it was gone before the agents started.
    expect(run.trace!.some((s) => /Bigco/.test(s.name))).toBe(false);
    // In the morning the pick shows as prepared, and a second run has nothing left to do.
    const ready = await loadReady(ctx);
    expect(ready).toMatchObject([{ kitId: juniorKit.id, researched: true }]);
    expect(ready[0]!.pitch).not.toBeNull();
    expect(await runNightShift(ctx, { trigger: "schedule", persist: store, honorPause: true })).toMatchObject({ stopped: "today's picks are already prepared" });
  });

  it("honors the Applications bot's Pause, and runs only in its hours behind the cron token", async () => {
    const { runNightShift, NIGHT_HOURS } = await import("@/lib/agents/nightShift");
    const { store, ctx } = await setup();
    await store.agentState.setPaused("career", true);
    expect(await runNightShift(ctx, { trigger: "schedule", persist: store, honorPause: true })).toEqual({ missing: "skipped", why: "paused in Mission Control" });
    expect(NIGHT_HOURS).toEqual([22, 23]);
    expect(read("lib/agents/cron.ts")).toMatch(/NIGHT_HOURS\.includes\(Number\(ctx\.time\.slice\(0, 2\)\)\)/);
    expect(read("app/api/cron/night/route.ts")).toContain('handleCron(request, "night")');
    // Scheduled in the UTC hours for both sides of daylight saving.
    expect((JSON.parse(read("vercel.json")) as { crons: { path: string }[] }).crons.filter((c) => c.path === "/api/cron/night")).toHaveLength(6);
    expect(read("app/(app)/page.tsx")).toContain("<ReadyCard jobs={ready} />");
  });
});
