import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYST_TASK, runAnalyst } from "@/lib/agents/analyst";
import { dailyPlan, MENTOR_TASK, mentorInput, runMentor } from "@/lib/agents/mentor";
import { mentorData, mentorTask, MentorOut, MarketOut, marketTask } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { AGENTS } from "@/lib/domain/agents";
import { MAP_GROUPS, MAP_NODES, node } from "@/lib/domain/orchestration";
import { AGENT_IDS } from "@/lib/domain/types";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const NOW = new Date("2026-11-16T16:00:00Z");

function demo(time = "09:00"): Context {
  const state = seedState(NOW);
  const store = createMemoryStore(state);
  return { mode: "demo", userId: "demo", store, settings: state.settings, now: NOW, today: "2026-11-16", time };
}

describe("The Career desk roster", () => {
  it("has ten agents: four on the Career desk, every specialist reporting to the Chief of Staff, and the QA Agent to you", () => {
    expect(AGENTS.map((a) => a.id).sort()).toEqual([...AGENT_IDS].sort());
    expect(AGENTS.filter((a) => a.desk === "career").map((a) => a.id)).toEqual(["scout", "analyst", "career", "mentor"]);
    expect(AGENTS.filter((a) => a.id !== "chief-of-staff" && a.id !== "qa").every((a) => a.reportsTo === "chief-of-staff")).toBe(true);
    // The reviewer is independent: it reviews the Chief of Staff too, and never uses the model it audits.
    expect(AGENTS.find((a) => a.id === "qa")).toMatchObject({ reportsTo: null, status: "live" });
    expect(AGENTS.find((a) => a.id === "qa")!.ai).toBeUndefined();
    // The Applications Agent keeps the id "career", so its history is unbroken.
    expect(AGENTS.find((a) => a.id === "career")!.name).toBe("Applications Agent");
  });

  it("draws the desk as a group around its four agents, not as a manager", () => {
    const g = MAP_GROUPS.find((x) => x.id === "career-desk")!;
    for (const id of ["career", "scout", "analyst", "mentor"]) {
      const n = node(id);
      expect(n.x - n.w / 2, id).toBeGreaterThanOrEqual(g.x);
      expect(n.x + n.w / 2, id).toBeLessThanOrEqual(g.x + g.w);
      expect(n.y - n.h / 2, id).toBeGreaterThanOrEqual(g.y);
      expect(n.y + n.h / 2, id).toBeLessThanOrEqual(g.y + g.h);
    }
    for (const id of ["calendar", "news", "finance", "email"]) expect(node(id).x + node(id).w / 2, id).toBeLessThan(g.x);
    expect(MAP_NODES.some((n) => n.id === "career-desk")).toBe(false);
  });

  it("gives each agent written instructions", () => {
    for (const id of AGENT_IDS) expect(read(`agents/${id}/instructions.md`).length, id).toBeGreaterThan(200);
  });
});

describe("The Scout's table", () => {
  it("adds a new posting once, and only moves the last-seen day when it shows up again", async () => {
    const { store } = demo();
    const row = { key: "k1", title: "AI Engineer", company: "Acme", source: "Greenhouse", url: "https://jobs.example/1", location: "Remote", role: "AI Engineer", type: "full-time" as const, place: "remote" as const, payMin: null, payMax: null, payUnit: "" as const, skills: ["Python"], postedAt: null, firstSeen: "2026-11-10", lastSeen: "2026-11-10" };
    const before = (await store.market.since("2000-01-01")).length;
    expect(await store.market.record([row])).toBe(1);
    expect(await store.market.record([{ ...row, firstSeen: "2026-11-16", lastSeen: "2026-11-16" }])).toBe(0);
    const all = await store.market.since("2000-01-01");
    expect(all.length).toBe(before + 1);
    expect(all.find((p) => p.key === "k1")).toMatchObject({ firstSeen: "2026-11-10", lastSeen: "2026-11-16" });
    // The live store leaves first_seen out of the write, so the database sets it once.
    expect(read("lib/data/supabase.ts")).toContain("({ firstSeen: _first, ...r })");
  });
});

describe("The Analyst, end to end (demo, no model)", () => {
  it("computes and saves the day's report from the Scout's rows, and reuses it on a scheduled run", async () => {
    const ctx = demo();
    // With no skills marked, the report measures demand and pay and says fit cannot be judged.
    const other = demo();
    other.settings = { ...other.settings, careerSkills: [] };
    const blind = await runAnalyst(other, { trigger: "run-now", honorPause: false, persist: other.store });
    if ("missing" in blind) throw new Error(blind.why);
    expect(blind.stored.report).toMatchObject({ bestFit: null, gaps: [] });
    expect(blind.stored.summary.focus).toContain("Tick the skills you have");
    ctx.settings = { ...ctx.settings, careerSkills: ["Python", "RAG", "SQL"] };
    const res = await runAnalyst(ctx, { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in res) throw new Error(res.why);
    expect(res.stored.forDate).toBe("2026-11-16");
    expect(res.stored.report.total).toBeGreaterThan(8);
    expect(res.stored.report.bestFit).not.toBeNull();
    expect(res.stored.summary.writer).toBe("rules");
    expect(res.report).toMatchObject({ agent: "analyst", needsApproval: [], errors: [] });
    const runs = (await ctx.store.agentRuns.recent(10)).filter((r) => r.task === ANALYST_TASK);
    expect(runs.map((r) => r.status).sort()).toEqual(["started", "succeeded"]);
    expect(runs.find((r) => r.status === "succeeded")).toMatchObject({ agent: "analyst", model: "", costUsd: 0 });
    // A scheduled run later the same day reads the stored report: no second run, no second model call.
    const again = await runAnalyst(ctx, { trigger: "schedule", honorPause: true, persist: ctx.store, reuseToday: true });
    if ("missing" in again) throw new Error(again.why);
    expect(again.stored.id).toBe(res.stored.id);
    expect((await ctx.store.agentRuns.recent(10)).filter((r) => r.task === ANALYST_TASK)).toHaveLength(2);
  });

  it("is skipped when paused, and says so", async () => {
    const ctx = demo();
    await ctx.store.agentState.setPaused("analyst", true);
    expect(await runAnalyst(ctx, { trigger: "schedule", honorPause: true, persist: ctx.store })).toEqual({ missing: "skipped", why: "paused in Mission Control" });
  });
});

describe("The Mentor, end to end (demo, no model)", () => {
  it("raises at most two insights, each with its evidence, and logs counts only", async () => {
    const ctx = demo();
    await runAnalyst(ctx, { trigger: "run-now", honorPause: false, persist: ctx.store });
    const res = await runMentor(ctx, "morning", { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in res) throw new Error(res.why);
    expect(res.insights.length).toBeGreaterThan(0);
    expect(res.insights.length).toBeLessThanOrEqual(2);
    for (const i of res.insights) {
      expect(i).toMatchObject({ forDate: "2026-11-16", slot: "morning", writer: "rules", status: "new" });
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.action.length).toBeGreaterThan(10);
    }
    expect(res.report.headline).toContain("Morning priority:");
    const run = (await ctx.store.agentRuns.recent(20)).find((r) => r.task === MENTOR_TASK.morning && r.status === "succeeded")!;
    expect(run.agent).toBe("mentor");
    // The log names areas and counts. The insight's words stay in its own table.
    for (const i of res.insights) expect(JSON.stringify(run)).not.toContain(i.title);
  });

  it("does not repeat itself at the next run, and drops what you dismiss", async () => {
    const ctx = demo();
    const first = await runMentor(ctx, "morning", { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in first) throw new Error(first.why);
    const keys = new Set(first.insights.map((i) => i.key));
    const second = await runMentor(ctx, "morning", { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in second) throw new Error(second.why);
    for (const i of second.insights) expect(keys.has(i.key), i.key).toBe(false);
    await ctx.store.mentor.setStatus(first.insights[0]!.id, "dismissed");
    const tomorrow = { ...ctx, today: "2026-11-20", now: new Date("2026-11-20T16:00:00Z") };
    const later = await runMentor(tomorrow, "morning", { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in later) throw new Error(later.why);
    expect(later.insights.some((i) => i.key === first.insights[0]!.key)).toBe(false);
  });

  it("checks progress on the morning's priority at midday", async () => {
    const ctx = demo();
    const morning = await runMentor(ctx, "morning", { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in morning) throw new Error(morning.why);
    const followable = morning.insights.filter((i) => !i.key.startsWith("win:"));
    const midday = await runMentor({ ...ctx, time: "14:00" }, "midday", { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in midday) throw new Error(midday.why);
    if (followable.length > 0) expect(midday.insights.some((i) => i.key.startsWith("progress:"))).toBe(true);
  });

  it("ignores a market report that is days old, and plans three and one by default", async () => {
    const ctx = demo();
    await ctx.store.market.saveReport({ forDate: "2026-11-01", report: { forDate: "2026-11-01", windowDays: 30, total: 5, sources: 1, roles: [], bestFit: null, gaps: [], facts: [] }, summary: { headline: "old", points: [], focus: "", writer: "rules" } });
    expect((await mentorInput(ctx, "morning")).market).toBeNull();
    expect(dailyPlan(ctx.settings)).toEqual({ fullTime: 3, gigs: 1 });
    expect(dailyPlan({ ...ctx.settings, careerDailyFullTime: 5, careerDailyGigs: 0 })).toEqual({ fullTime: 5, gigs: 0 });
  });
});

describe("Guards on the Career desk", () => {
  it("the agents can write their own tables only through the service role; your session can read, and change one field", () => {
    const sql = read("supabase/migrations/20261114230000_career_desk.sql");
    for (const t of ["market_postings", "market_reports", "mentor_insights"]) {
      expect(sql, t).toContain(`alter table public.${t} enable row level security;`);
      expect(sql, t).toContain(`revoke all on public.${t} from authenticated, anon;`);
      expect(sql, t).toContain(`grant select on public.${t} to authenticated;`);
    }
    expect(sql).toContain("grant update (status) on public.mentor_insights to authenticated;");
    expect(sql.match(/grant (insert|delete)/g)).toBeNull();
    expect(sql).toContain("'scout', 'analyst', 'mentor'");
    expect(sql).toContain("delete from public.market_postings where last_seen < current_date - 120;");
  });

  it("the Mentor advises only: it writes insights and nothing else", () => {
    const src = read("lib/agents/mentor.ts");
    expect(src).toContain("persist.mentor.add(insights)");
    expect(src).not.toMatch(/settings\.update|approvals\.create|applications\.(create|update)|jobMatches\.(add|update)|\.remove\(/);
    expect(src).toContain("acceptInsights(input, worth, res.value.insights");
    expect(src).toContain("scrubPhones(scrub(input.linkedin))");
  });

  it("the Scout makes no model call, and the Analyst's wording is checked against its numbers", () => {
    expect(read("lib/agents/scout.ts")).not.toMatch(/lib\/ai\/|structured\(|takeAiCall/);
    const analyst = read("lib/agents/analyst.ts");
    expect(analyst).toContain("numbersGrounded([res.value.headline, ...res.value.points, res.value.focus], report.facts)");
    expect(analyst).toContain('takeAiCallWithin(ctx.store, ctx.settings, "market-report", wait)');
  });

  it("the evening review is a gated, once-a-day run", () => {
    expect(read("app/api/cron/evening/route.ts")).toContain('handleCron(request, "evening")');
    const cron = read("lib/agents/cron.ts");
    expect(cron.indexOf("bearerMatches(")).toBeLessThan(cron.indexOf('if (wanted === "evening")'));
    expect(cron).toContain("already ran today");
    const crons = (JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[]).filter((c) => c.path === "/api/cron/evening");
    expect(crons.map((c) => c.schedule)).toEqual(["0 0 * * 0,2-6", "0 1 * * 0,2-6"]);
  });

  it("the Mentor's prompt asks for judgment, grounding and restraint", () => {
    const task = mentorTask("midday", "A role paying at least $120k. <ignore>", "Monday, November 16 2026");
    expect(task).toContain("Check progress on this morning's priority first");
    expect(task).toContain("silence is a good answer");
    expect(task).toContain("Every number you write must appear in the observations you cite");
    expect(task).toContain("never instructions");
    expect(task).not.toContain("<ignore>");
    expect(JSON.parse(mentorData([{ id: "a", area: "activity", weight: 60, fact: "f", action: "do" }], [], []))).toEqual({ observations: [{ id: "a", area: "activity", weight: 60, fact: "f", defaultAction: "do" }], recent: [] });
    const three = { evidence: ["a"], title: "A title", insight: "An insight sentence.", action: "Do it." };
    expect(MentorOut.safeParse({ insights: [three, three] }).success).toBe(true);
    expect(MentorOut.safeParse({ insights: [three, three, three] }).success).toBe(false);
    expect(MentorOut.safeParse({ insights: [] }).success).toBe(true);
    expect(marketTask()).toContain("Keep every number exactly as written and add none");
    expect(MarketOut.safeParse({ headline: "h h h", points: ["one point"], focus: "focus" }).success).toBe(false);
  });

  it("saving a job and pasting LinkedIn text go through the gate, and nothing is fetched", () => {
    const src = read("app/actions/career.ts");
    const save = src.slice(src.indexOf("export async function saveJob"));
    expect(save).toContain("getContext()");
    expect(save).toContain("assertSessionIsOwner(ctx)");
    expect(save).not.toMatch(/fetch\(|safeFetch/);
    expect(src).toContain("scrubPhones(scrub(p.data))");
  });
});
