import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCareerDeskSearch } from "@/lib/agents/careerDesk";
import { careerAgentWork, findMoreMatches, MORE_TASK, PER_BRIEF, storedMatches, type FeedReader } from "@/lib/agents/career";
import { NO_TRACE } from "@/lib/agents/trace";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { todaysPicks } from "@/lib/domain/applyPlan";
import type { RawJob } from "@/lib/domain/careerAgent";
import { ago } from "@/lib/domain/dates";
import { toDocuments } from "@/lib/domain/knowledge";
import { MORE_COUNT, MORE_JOBS_HREF, MORE_BUTTON, MORE_LOCAL_SEATS, deskMessage, ON_DEMAND_SLOT, REVIEW_DAYS, shownHow, slotFromRow, slotToRow, toReview } from "@/lib/domain/moreMatches";
import { BRIEF_SLOTS, type JobMatch } from "@/lib/domain/types";
import { tierOfStored } from "@/lib/domain/workplace";

// "Find more good fits": a search you start yourself. Same rules as a brief, never a posting
// already shown, and kept apart from the briefs.

const NOW = new Date("2026-11-18T16:00:00Z");
const TODAY = "2026-11-18";
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function demo(): Context {
  const state = seedState(NOW);
  const store = createMemoryStore(state);
  return { mode: "demo", userId: "demo", store, settings: state.settings, now: NOW, today: TODAY, time: "10:00" };
}

const job = (n: number, over: Partial<RawJob> = {}): RawJob => ({ key: `feed:${n}`, source: "Acme careers", title: "Solutions Engineer", company: `Co ${n}`, url: `https://jobs.example/${n}`, location: "Remote (US)", text: "", postedAt: hoursAgo(2), ...over });

/** 20 fresh remote postings and 3 week-old Utah ones: 23 that fit. */
const POOL: RawJob[] = [
  ...Array.from({ length: 20 }, (_, i) => job(i + 1)),
  job(101, { location: "Lehi, UT (Hybrid)", postedAt: hoursAgo(24 * 9) }),
  job(102, { location: "Remote - Salt Lake City, UT", postedAt: hoursAgo(24 * 9) }),
  job(103, { location: "Draper, UT (On-site)", postedAt: hoursAgo(24 * 9) }),
  // Never a match, whoever asks: senior, contract, and too far to drive.
  job(201, { title: "Senior Solutions Engineer" }),
  job(202, { title: "Solutions Engineer (Contract)" }),
  job(203, { location: "Provo, UT (On-site)" }),
];

const feed =
  (jobs: RawJob[], failed: string[] = [], sourceCount = 4): FeedReader =>
  async () => ({ jobs, failed, sourceCount });

const more = async (ctx: Context, read: FeedReader = feed(POOL)) => {
  const out = await findMoreMatches(ctx, { trigger: "owner", persist: ctx.store, read });
  if ("missing" in out) throw new Error(`did not finish: ${out.why}`);
  return out;
};

describe("Find more good fits", () => {
  it("finds five that fit and were never shown, by the brief's own rules, with a seat kept for Utah", async () => {
    const ctx = demo();
    const out = await more(ctx);
    expect(MORE_COUNT).toBe(5);
    expect(out.found).toHaveLength(5);
    expect(out.unseen).toBe(23);
    expect(out.allFailed).toBe(false);
    // The three Utah postings are a week old and would lose to fresh remote ones on score alone.
    expect(MORE_LOCAL_SEATS).toBe(1);
    expect(out.found.filter((m) => tierOfStored(m.location) !== "remote").map((m) => m.location)).toEqual(["Remote · Salt Lake City, UT"]);
    // Senior, contract and too-far postings are left out here exactly as in a brief.
    for (const key of ["feed:201", "feed:202", "feed:203"]) expect(out.found.some((m) => m.key === key), key).toBe(false);
    // Best first, and stored for review under their own slot.
    expect(out.found.map((m) => m.score)).toEqual([...out.found.map((m) => m.score)].sort((a, b) => b - a));
    for (const m of out.found) expect(m).toMatchObject({ shownOn: TODAY, shownSlot: ON_DEMAND_SLOT, status: "new", rating: 0 });
    expect(await ctx.store.jobMatches.since(TODAY)).toHaveLength(5);
  });

  it("gives the next five each time, never a repeat, and says so when nothing is left", async () => {
    const ctx = demo();
    const rounds = [];
    for (let i = 0; i < 6; i++) rounds.push(await more(ctx));
    expect(rounds.map((r) => r.found.length)).toEqual([5, 5, 5, 5, 3, 0]);
    expect(rounds.map((r) => r.unseen)).toEqual([23, 18, 13, 8, 3, 0]);
    expect(new Set(rounds.flatMap((r) => r.found.map((m) => m.key))).size).toBe(23);
    expect(deskMessage({ scout: 0, analyst: "kept", found: 0, allFailed: false }).text).toContain("Applications found no new good fits: every posting that fits has been shown.");
  });

  it("logs each search as a run of the Applications bot, with a trace, at no cost", async () => {
    const ctx = demo();
    await more(ctx);
    const runs = (await ctx.store.agentRuns.recent(10)).filter((r) => r.task === MORE_TASK);
    expect(runs.map((r) => r.status).sort()).toEqual(["started", "succeeded"]);
    const done = runs.find((r) => r.status === "succeeded")!;
    expect(done).toMatchObject({ agent: "career", trigger: "owner", costUsd: 0, model: "", detail: "5 more found for review (23 fit and had not been shown)" });
    expect(done.trace!.map((s) => s.name)).toEqual(["Load your watchlist, thumbs and matches already shown", "Read the job feeds", "Filter by role, level, full-time, place and pay, then rank and pick", "Store them for your review"]);
    // The trace says what was left out and why five were picked, in counts.
    expect(done.trace![2]!.note).toBe("23 of 26 fit your 5 roles (3 in Utah: remote, hybrid or an office inside the commute); 1 above your level (senior, or more than 3 years asked) and 1 contract or part-time posting left out; 23 never shown; picked 5 of the 5 asked for");
    expect(done.trace![3]!.note).toBe("5 stored under their own slot; no brief will show them again");
  });

  it("keeps what it finds apart from the briefs: no brief counts them, shows them or repeats them", async () => {
    const ctx = demo();
    const found = (await more(ctx)).found;
    // The brief for this slot has not run: its preview is still empty, and it still has all its room.
    expect((await storedMatches(ctx, "morning")).section.fullTime).toEqual([]);
    const brief = await careerAgentWork(ctx, "morning", ctx.store, NO_TRACE, feed(POOL));
    // One list of ten, from every source alike.
    expect(PER_BRIEF).toBe(10);
    expect(brief.section.fullTime).toHaveLength(10);
    const foundKeys = new Set(found.map((m) => m.key));
    const briefKeys = (await ctx.store.jobMatches.since(TODAY)).filter((m) => m.shownSlot === "morning").map((m) => m.key);
    expect(briefKeys).toHaveLength(10);
    expect(briefKeys.some((k) => foundKeys.has(k))).toBe(false);
    // And the other way round: after a brief has taken its ten, a search still finds five.
    const other = demo();
    await careerAgentWork(other, "morning", other.store, NO_TRACE, feed(POOL));
    const after = await more(other);
    expect(after.found).toHaveLength(5);
    expect((await storedMatches(other, "morning")).section.fullTime).toHaveLength(10);
  });

  it("reports a search that could read no feed, and one that broke", async () => {
    const ctx = demo();
    const out = await more(ctx, feed([], ["Remote OK", "We Work Remotely", "Jobicy", "HN Who's Hiring"], 4));
    expect(out).toMatchObject({ found: [], allFailed: true });
    expect(deskMessage({ scout: null, analyst: "failed", found: 0, allFailed: true })).toEqual({ ok: false, text: "No job feed could be read just now. Try again in a few minutes." });
    // One feed down is not a failure: the rest are searched, and the run says which failed.
    const partial = await more(ctx, feed(POOL, ["Jobicy"], 4));
    expect(partial.found).toHaveLength(5);
    expect(partial.failedSources).toEqual(["Jobicy"]);
    const broke = await findMoreMatches(ctx, {
      trigger: "owner",
      persist: ctx.store,
      read: async () => {
        throw new Error("boom");
      },
    });
    expect(broke).toEqual({ missing: "failed", why: "boom" });
    const runs = (await ctx.store.agentRuns.recent(20)).filter((r) => r.task === MORE_TASK && r.status !== "started");
    expect(runs.map((r) => r.status).sort()).toEqual(["failed", "failed", "succeeded"]);
    expect(runs.find((r) => r.status === "succeeded")!.detail).toBe("5 more found for review (23 fit and had not been shown) · 1 job source failed: Jobicy");
  });

  it("says what each Career desk agent did, in the order they ran", () => {
    expect(deskMessage({ scout: 12, analyst: "updated", found: 5, allFailed: false })).toEqual({ ok: true, text: "Scout recorded 12 new postings. Analyst updated the market report. Applications added 5 new good fits, below." });
    expect(deskMessage({ scout: 1, analyst: "kept", found: 1, allFailed: false }).text).toBe("Scout recorded 1 new posting. Analyst's report from today still stands. Applications added 1 new good fit, below.");
    // An agent that could not run is named, and the search still reports what it found.
    expect(deskMessage({ scout: null, analyst: "failed", found: 3, allFailed: false }).text).toBe("Scout could not run. Analyst could not update the report. Applications added 3 new good fits, below.");
    expect(MORE_JOBS_HREF).toBe("/career#more-jobs");
  });

  it("shows how old a posting is, as the briefs do", () => {
    const at = NOW.toISOString();
    expect(ago(hoursAgo(3), at)).toBe("3h ago");
    expect(ago(hoursAgo(23), at)).toBe("23h ago");
    expect(ago(hoursAgo(50), at)).toBe("2d ago");
    // A posting dated a little ahead of the clock is new, not negative.
    expect(ago(hoursAgo(-2), at)).toBe("0h ago");
  });
});

describe("The review list", () => {
  let n = 0;
  const match = (over: Partial<JobMatch>): JobMatch => ({ id: `m${++n}`, key: `k${n}`, title: "Solutions Engineer", company: `Co ${n}`, url: "https://jobs.example/m", source: "Acme careers", location: "Remote · U.S.", role: "Solutions Engineer", payText: "salary not listed", postedAt: null, score: 50, shownOn: TODAY, shownSlot: ON_DEMAND_SLOT, rating: 0, status: "new", createdAt: "", ...over });

  it("lists what was found and still waits on you, Utah first, best first within a group", () => {
    const rows = [
      match({ company: "Remote low", score: 40 }),
      match({ company: "Office", location: "On-site · Draper, UT · ~20 min", score: 90 }),
      match({ company: "Remote high", score: 80 }),
      match({ company: "Utah hybrid", location: "Hybrid · Lehi, UT · ~25 min", score: 30 }),
      // Not in the list: a brief's own match, one you rated either way, one already queued, and one too old.
      match({ company: "From a brief", shownSlot: "morning" }),
      match({ company: "Liked", rating: 1, status: "pursuing" }),
      match({ company: "Passed", rating: -1, status: "dismissed" }),
      match({ company: "Old", shownOn: "2026-11-14" }),
    ];
    expect(toReview(rows, TODAY).map((m) => m.company)).toEqual(["Utah hybrid", "Remote high", "Remote low", "Office"]);
    // "Apply today" is drawn from the briefs, so a found match is never listed in both places:
    // all ten of a search are in this list, as the button says.
    const picked = todaysPicks(rows, [], TODAY, 3).picks.map((m) => m.company);
    expect(picked).toEqual(["From a brief"]);
    expect(toReview(rows, TODAY).some((m) => picked.includes(m.company))).toBe(false);
    // It waits three days, then leaves the list.
    expect(REVIEW_DAYS).toBe(3);
    expect(toReview(rows, "2026-11-21").map((m) => m.company)).toHaveLength(4);
    expect(toReview(rows, "2026-11-22")).toEqual([]);
  });
});

describe("How a found match is stored", () => {
  it("uses a slot value the database already allows, and reads it back", () => {
    const stored = slotToRow(ON_DEMAND_SLOT);
    // No migration: the value must be one the shown_slot check constraint accepts.
    expect(BRIEF_SLOTS as readonly string[]).toContain(stored);
    expect(readFileSync(join(__dirname, "..", "supabase/migrations/20261113173446_career.sql"), "utf8")).toContain("shown_slot in ('morning', 'afternoon', 'saturday')");
    expect(stored).toBe("saturday");
    expect(slotFromRow(stored)).toBe(ON_DEMAND_SLOT);
    // The slots a brief writes for a match pass through unchanged, both ways.
    for (const slot of ["morning", "afternoon"]) {
      expect(slotToRow(slot)).toBe(slot);
      expect(slotFromRow(slot)).toBe(slot);
    }
    // The database adapter is the only place that maps it.
    const adapter = readFileSync(join(__dirname, "..", "lib/data/supabase.ts"), "utf8");
    expect(adapter).toContain("shownSlot: slotToRow(r.shownSlot)");
    expect(adapter).toContain("shownSlot: slotFromRow(m.shownSlot)");
  });

  it("is described to Ask Atlas as found when you asked, not as part of a brief", () => {
    expect(shownHow("morning")).toBe("in the morning brief");
    expect(shownHow(ON_DEMAND_SLOT)).toBe("when you asked for more");
    const found: JobMatch = { id: "m1", key: "feed:1", title: "Solutions Engineer", company: "Acme", url: "https://jobs.example/1", source: "Acme careers", location: "Remote · U.S.", role: "Solutions Engineer", payText: "$95k–$110k", postedAt: null, score: 60, shownOn: TODAY, shownSlot: ON_DEMAND_SLOT, rating: 0, status: "new", createdAt: NOW.toISOString() };
    const docs = toDocuments({ jobMatches: [found, { ...found, id: "m2", key: "feed:2", company: "Birch", shownSlot: "morning" }] }, "America/Denver");
    expect(docs.find((d) => d.title === "Job match: Solutions Engineer at Acme")?.text).toContain("Shown 2026-11-18 when you asked for more.");
    expect(docs.find((d) => d.title === "Job match: Solutions Engineer at Birch")?.text).toContain("Shown 2026-11-18 in the morning brief.");
  });
});

describe("Find more good fits: the Career desk at work", () => {
  const ranScout = (added: number) => (async () => ({ report: { agent: "scout", headline: "", details: [], needsApproval: [], errors: [] }, recorded: added, added, inWindow: added })) as never;
  const failed = (async () => ({ missing: "failed", why: "boom" })) as never;

  it("runs the Scout, then the Analyst, then the Applications bot, and adds five", async () => {
    const ctx = demo();
    const order: string[] = [];
    const scout = (async () => (order.push("scout"), { report: {}, recorded: 12, added: 12, inWindow: 40 })) as never;
    const analyst = (async (_c: Context, o: { reuseToday?: boolean }) => (order.push(`analyst${o.reuseToday ? ":reuse" : ""}`), { report: {}, stored: {} })) as never;
    const out = await runCareerDeskSearch(ctx, { persist: ctx.store, read: async (...a) => (order.push("applications"), feed(POOL)(...a)), scout, analyst });
    expect(order).toEqual(["scout", "analyst", "applications"]);
    expect(out.said).toEqual({ scout: 12, analyst: "updated", found: 5, allFailed: false });
    expect("missing" in out.more ? [] : out.more.found).toHaveLength(5);
  });

  it("keeps today's report when the Scout recorded nothing new, so no model is asked again", async () => {
    const ctx = demo();
    await ctx.store.market.saveReport({ forDate: TODAY, report: { total: 0, facts: [] } as never, summary: { headline: "h", points: [], focus: "f", writer: "rules" } as never });
    let reused: boolean | undefined;
    const analyst = (async (_c: Context, o: { reuseToday?: boolean }) => ((reused = o.reuseToday), { report: {}, stored: {} })) as never;
    const out = await runCareerDeskSearch(ctx, { persist: ctx.store, read: feed(POOL), scout: ranScout(0), analyst });
    expect(reused).toBe(true);
    expect(out.said.analyst).toBe("kept");
    // New postings recorded: the report is computed again.
    const again = await runCareerDeskSearch(ctx, { persist: ctx.store, read: feed(POOL), scout: ranScout(3), analyst });
    expect(reused).toBe(false);
    expect(again.said).toMatchObject({ scout: 3, analyst: "updated", found: 5 });
  });

  it("still adds good fits when the Scout or the Analyst cannot run", async () => {
    const ctx = demo();
    const out = await runCareerDeskSearch(ctx, { persist: ctx.store, read: feed(POOL), scout: failed, analyst: failed });
    expect(out.said).toEqual({ scout: null, analyst: "failed", found: 5, allFailed: false });
  });
});

describe("One search button since 23 Nov 2026", () => {
  const board = (n: number) => job(300 + n, { company: `Board Co ${n}`, url: `https://job-boards.greenhouse.io/board${n}/jobs/${9000 + n}` });
  const MIXED = [...POOL, ...Array.from({ length: 7 }, (_, i) => board(i + 1))];

  it("brings the best five of every kind of job, from boards and job sites alike", async () => {
    const ctx = demo();
    const out = await findMoreMatches(ctx, { trigger: "owner", persist: ctx.store, read: feed(MIXED) });
    if ("missing" in out) throw new Error(out.why);
    expect(out.found).toHaveLength(5);
    expect(out.unseen).toBe(30);
  });

  it("has one button, and says what it found", () => {
    expect(MORE_BUTTON).toBe("Find more jobs to apply for");
    expect(deskMessage({ scout: 4, analyst: "updated", found: 1, allFailed: false }).text).toBe("Scout recorded 4 new postings. Analyst updated the market report. Applications added 1 new good fit, below.");
  });

  it("the Career desk reports what each agent did", async () => {
    const ctx = demo();
    const ok = (async () => ({ report: {}, recorded: 0, added: 2, inWindow: 0 })) as never;
    const out = await runCareerDeskSearch(ctx, { persist: ctx.store, read: feed(MIXED), scout: ok, analyst: (async () => ({ report: {}, stored: {} })) as never });
    expect(out.said).toEqual({ scout: 2, analyst: "updated", found: 5, allFailed: false });
  });
});
