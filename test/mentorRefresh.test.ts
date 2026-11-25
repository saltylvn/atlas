import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { eligible, mentorRetryReason, type MentorInput, type MentorInsight, type Observation } from "@/lib/domain/mentor";

const NOW = new Date("2026-11-17T20:00:00Z");
const TODAY = "2026-11-17";

function demo(): { ctx: Context; state: ReturnType<typeof seedState> } {
  const state = seedState(NOW);
  return { state, ctx: { mode: "demo", userId: "demo", store: createMemoryStore(state), settings: state.settings, now: NOW, today: TODAY, time: "13:00" } };
}

const obs = (id: string, metric: string): Observation => ({ id, area: "queue", severity: 60, metric, fact: `${id} is at ${metric}.`, action: "Do the thing." });
const said = (key: string, metric: string, over: Partial<MentorInsight> = {}): MentorInsight => ({
  id: `i-${key}-${metric}`, forDate: TODAY, slot: "midday", key, area: "queue", title: "t", body: "b", action: "a", evidence: [], metric, writer: "rules", status: "new", createdAt: `${TODAY}T15:00:00Z`, ...over,
});
const input = (prior: MentorInsight[]) => ({ today: TODAY, slot: "midday", prior }) as unknown as MentorInput;

describe("The Career Mentor reviewing again with fresh data", () => {
  it("may say again today what moved, never what did not (a morning priority keeps its progress note at midday)", () => {
    const prior = [said("queue:waiting", "3/2"), said("queue:follow-ups", "1")];
    const now = [obs("queue:waiting", "5/2"), obs("queue:follow-ups", "1")];
    // A scheduled review keeps to once a day.
    expect(eligible(input(prior), now).map((o) => o.id)).not.toContain("queue:waiting");
    // A refresh says it again with the new number; the unchanged one stays as it was.
    const ids = eligible(input(prior), now, { refresh: true }).map((o) => o.id);
    expect(ids).toContain("queue:waiting");
    expect(ids).not.toContain("queue:follow-ups");
  });

  it("compares with the latest time it was said, and still honours a dismissal", () => {
    const prior = [said("queue:waiting", "3/2", { createdAt: `${TODAY}T15:00:00Z`, status: "replaced" }), said("queue:waiting", "5/2", { id: "newer", createdAt: `${TODAY}T18:00:00Z` })];
    expect(eligible(input(prior), [obs("queue:waiting", "5/2")], { refresh: true })).toHaveLength(0);
    expect(eligible(input(prior), [obs("queue:waiting", "3/2")], { refresh: true }).map((o) => o.id)).toEqual(["queue:waiting"]);
    expect(eligible(input([said("queue:waiting", "3/2", { status: "dismissed" })]), [obs("queue:waiting", "9/9")], { refresh: true })).toHaveLength(0);
  });

  it("asks the model again about what the rules said, when the model is on", () => {
    const prior = [said("queue:waiting", "3/2", { writer: "rules" }), said("queue:follow-ups", "1", { writer: "model" })];
    const now = [obs("queue:waiting", "3/2"), obs("queue:follow-ups", "1")];
    expect(eligible(input(prior), now, { refresh: true })).toHaveLength(0);
    // The rules' insight may be judged again; the model's own, unchanged, is not.
    expect(eligible(input(prior), now, { refresh: true, rejudge: true }).map((o) => o.id)).toEqual(["queue:waiting"]);
  });

  it("never saves a copy of what is already open (the model off, nothing moved)", async () => {
    const { runMentor } = await import("@/lib/agents/mentor");
    const { ctx, state } = demo();
    const first = await runMentor(ctx, "midday", { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in first) throw new Error(first.why);
    const count = state.mentorInsights!.length;
    const again = await runMentor(ctx, "midday", { trigger: "run-now", honorPause: false, persist: ctx.store, refresh: true });
    if ("missing" in again) throw new Error(again.why);
    for (const i of again.insights) expect(first.insights.some((f) => f.key === i.key && f.metric === i.metric), i.key).toBe(false);
    expect(state.mentorInsights!.filter((i) => i.status === "replaced")).toHaveLength(0);
    expect(state.mentorInsights!.length).toBe(count + again.insights.length);
  });

  it("offers another try when the last review did not finish, or fell back to rules with the model on", () => {
    const run = (task: string, status: string, detail: string) => ({ agent: "mentor", task, status, detail });
    expect(mentorRetryReason([run("Mentor: morning priority", "failed", "timeout")], true)).toBe("The Career Mentor's last review did not finish.");
    expect(mentorRetryReason([run("Mentor: midday check", "succeeded", "2 insights (queue, profile), by rules")], true)).toContain("used its rules");
    // The model off: rules are the plan, not a failure.
    expect(mentorRetryReason([run("Mentor: midday check", "succeeded", "2 insights (queue), by rules")], false)).toBeNull();
    expect(mentorRetryReason([run("Mentor: evening review", "succeeded", "1 insight (queue), by Gemini")], true)).toBeNull();
    expect(mentorRetryReason([run("Mentor: midday check", "succeeded", "nothing new worth raising")], true)).toBeNull();
    // The newest review counts: a refresh that worked clears an earlier failure.
    expect(mentorRetryReason([run("Refresh and review", "succeeded", "Scout, Applications, Analyst, Career Mentor refreshed"), run("Mentor: morning priority", "failed", "x")], true)).toBeNull();
    expect(mentorRetryReason([{ agent: "scout", task: "Scout", status: "failed", detail: "" }], true)).toBeNull();
  });

  it("replaces the older open insight when a refresh says it again (demo, no model)", async () => {
    const { runMentor } = await import("@/lib/agents/mentor");
    const { ctx, state } = demo();
    const first = await runMentor(ctx, "midday", { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in first) throw new Error(first.why);
    expect(first.insights.length).toBeGreaterThan(0);
    // Pretend the first insight was said with older numbers.
    const stale = state.mentorInsights!.find((i) => i.id === first.insights[0]!.id)!;
    stale.metric = "older numbers";
    const again = await runMentor(ctx, "midday", { trigger: "run-now", honorPause: false, persist: ctx.store, refresh: true });
    if ("missing" in again) throw new Error(again.why);
    expect(again.updated).toBe(1);
    const rows = state.mentorInsights!.filter((i) => i.key === stale.key);
    expect(rows.map((r) => r.status).sort()).toEqual(["new", "replaced"]);
    // What did not move is not said again; anything else it says is a subject it has not raised before.
    const before = new Set(first.insights.map((i) => i.key));
    for (const i of again.insights) if (i.key !== stale.key) expect(before.has(i.key), i.key).toBe(false);
    expect(again.insights.map((i) => i.key)).toContain(stale.key);
  });
});

// ---- the whole refresh, with each agent stood in for ----

const calls: string[] = [];
const SCOUT = { report: { headline: "s" }, recorded: 40, added: 12, inWindow: 150 };
vi.mock("@/lib/agents/scout", async (orig) => ({ ...(await orig<object>()), runScout: vi.fn(async () => (calls.push("scout"), SCOUT)) }));
vi.mock("@/lib/agents/analyst", async (orig) => ({ ...(await orig<object>()), runAnalyst: vi.fn(async () => (calls.push("analyst"), { report: { headline: "150 postings, best fit Software Engineer." } })) }));
vi.mock("@/lib/agents/career", async (orig) => ({
  ...(await orig<object>()),
  readNewJobMail: vi.fn(async () => (calls.push("mail"), { items: [], read: 0, rejections: 0, interviews: 0 })),
  trackApplications: vi.fn(async () => (calls.push("track"), { created: 0, updated: 1, jobEmails: 3, roles: 1 })),
}));

describe("Refresh and review", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("brings the data up to date first, then the Career Mentor reviews with it, and says what changed", async () => {
    const { runMentorRefresh } = await import("@/lib/agents/mentorRefresh");
    const { runAnalyst } = await import("@/lib/agents/analyst");
    const mentor = await import("@/lib/agents/mentor");
    const spy = vi.spyOn(mentor, "runMentor").mockImplementation(async () => (calls.push("mentor"), { report: { headline: "m" } as never, insights: [{ key: "a" }, { key: "b" }] as never, updated: 1 }));
    const { ctx } = demo();
    const out = await runMentorRefresh(ctx, ctx.store);
    if ("missing" in out) throw new Error(out.why);
    // The Scout and the email reading first (in either order), then the Analyst, then the Career Mentor.
    expect(calls.slice(-2)).toEqual(["analyst", "mentor"]);
    expect(new Set(calls.slice(0, 3))).toEqual(new Set(["scout", "mail", "track"]));
    expect(vi.mocked(runAnalyst).mock.calls[0]![1]).toMatchObject({ reuseToday: false, trigger: "run-now" });
    expect(spy.mock.calls[0]![2]).toMatchObject({ refresh: true, trigger: "run-now" });
    // Someone is waiting: the page's limit.
    expect(spy.mock.calls[0]![0].deadline).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(out.lines).toEqual([
      "Scout: 12 new postings recorded (150 in the last 30 days).",
      "Applications: 1 moved forward, 1 roles filled in.",
      "Analyst: 150 postings, best fit Software Engineer.",
      "Career Mentor: 1 new insight, 1 updated with the new numbers.",
    ]);
    const run = (await ctx.store.agentRuns.recent(10)).find((r) => r.task === "Refresh and review" && r.status === "succeeded")!;
    expect(run.trace!.map((s) => s.name)).toEqual(["Ask the Scout for fresh postings", "Update applications from new job emails", "Ask the Analyst for a fresh market report", "Ask the Career Mentor to review with the fresh data"]);
    spy.mockRestore();
  });
});
