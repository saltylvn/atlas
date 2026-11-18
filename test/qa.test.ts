import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { runQa } from "@/lib/agents/qa";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { AI_CHECK_TASK } from "@/lib/domain/aiCheck";
import { localDate } from "@/lib/domain/dates";
import { MAP_EDGES, MAP_GROUPS, MAP_NODES, MAP_SIZE } from "@/lib/domain/orchestration";
import { QA_AI_CHECK_TASK, QA_EVAL_TASK, QA_REFUSED_HIGH, QA_REFUSED_MEDIUM, QA_REFUSED_MIN, QA_TASK, qaAlerts, qaReview, type QaFinding, type QaInput, type QaReport, type StoredQaReport } from "@/lib/domain/qa";
import { refusedDetail, TOKEN_REFUSED } from "@/lib/domain/refusedTokens";
import { audit } from "@/lib/audit";
import { EVAL_TASK } from "@/lib/evals";

vi.mock("@/components/client/MissionControls", () => ({ RunNowButton: () => null }));

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const NOW = new Date("2026-11-23T01:00:00Z"); // Sunday 6 PM Mountain

function demo(today = "2026-11-22", now = NOW): Context {
  const state = seedState(now);
  return { mode: "demo", userId: "demo", store: createMemoryStore(state), settings: state.settings, now, today, time: "18:00" };
}

describe("The QA Agent's weekly review, end to end (demo)", () => {
  it("reviews the week, saves one report for the day, and logs counts only", async () => {
    // The store stamps log rows with the real clock, so this review is of the real "today".
    const real = new Date();
    const ctx = demo(localDate(real, "America/Denver"), real);
    // Something for it to find: a brief's run that started and never finished.
    await ctx.store.agentRuns.append({ runId: "stuck", agent: "chief-of-staff", task: "Morning Brief", status: "started", trigger: "schedule", detail: "", model: "", inputTokens: 0, outputTokens: 0, costUsd: 0 });
    const res = await runQa({ ...ctx, now: new Date(real.getTime() + 10 * 60_000) }, { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in res) throw new Error(res.why);
    expect(res.stored.forDate).toBe(ctx.today);
    expect(res.stored.report.checks.length).toBeGreaterThanOrEqual(10);
    expect(res.stored.report.findings.map((f) => f.key)).toContain("runs:chief-of-staff");
    expect(res.report.headline).toBe(res.stored.report.headline);

    const run = (await ctx.store.agentRuns.recent(10)).find((r) => r.task === QA_TASK && r.status === "succeeded")!;
    expect(run.agent).toBe("qa");
    expect(run.model).toBe("");
    expect(run.detail).toMatch(/^\d+ findings \(\d+ high, \d+ medium, \d+ low\), \d+ checks$/);
    expect(run.trace!.map((s) => s.name)).toEqual(["Gather a week of runs, briefs, eval scores, connections and queues", "Review by rules, and compare with last week", "Save the review"]);
    // The log holds counts; the findings stay in their own table.
    for (const f of res.stored.report.findings) expect(JSON.stringify(run)).not.toContain(f.title);

    // A second run the same day replaces the report; it does not stack.
    await runQa(ctx, { trigger: "run-now", honorPause: false, persist: ctx.store });
    expect(await ctx.store.qa.recent(5)).toHaveLength(1);
  });

  it("compares with the review from an earlier day, not with itself", async () => {
    const ctx = demo();
    const last: QaReport = { from: "2026-11-09", to: "2026-11-15", headline: "h", checks: [], resolved: [], stats: { runs: 0, failed: 0, stalled: 0, aiAnswered: 0, aiFellBack: 0, briefsSaved: 0, briefsExpected: 0 }, findings: [{ key: "conn:error:gmail_imap", area: "data", severity: "high", title: "The Gmail connection has an error", evidence: [], fix: "f", weeks: 1 }] };
    await ctx.store.qa.save({ forDate: "2026-11-15", report: last });
    const res = await runQa(ctx, { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in res) throw new Error(res.why);
    expect(res.stored.report.resolved).toEqual(["The Gmail connection has an error"]);
    const again = await runQa(ctx, { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in again) throw new Error(again.why);
    expect(again.stored.report.resolved).toEqual(["The Gmail connection has an error"]);
  });

  it("counts the week's refused tokens from the audit trail and raises them with the count", async () => {
    const real = new Date();
    const ctx = demo(localDate(real, "America/Denver"), real);
    // Three records, as the recorder writes them, among other audit rows that are not counted.
    await audit(ctx.store, { actor: "system", action: TOKEN_REFUSED, target: "/api/cron/sync", detail: refusedDetail("/api/cron/sync", { missing: 4, wrong: 20 }), outcome: "denied" });
    await audit(ctx.store, { actor: "system", action: TOKEN_REFUSED, target: "/api/capture", detail: refusedDetail("/api/capture", { missing: 0, wrong: 3 }), outcome: "denied" });
    await audit(ctx.store, { actor: "system", action: TOKEN_REFUSED, target: "/api/keepalive", detail: refusedDetail("/api/keepalive", { missing: 1, wrong: 0 }), outcome: "denied" });
    await audit(ctx.store, { actor: "owner", action: "message.handoff", target: "c1", detail: "blocked by kill switch", outcome: "denied" });
    const res = await runQa({ ...ctx, now: new Date(real.getTime() + 60_000) }, { trigger: "run-now", honorPause: false, persist: ctx.store });
    if ("missing" in res) throw new Error(res.why);

    const f = res.stored.report.findings.find((x) => x.key === "security:refused-tokens")!;
    expect(f).toMatchObject({ area: "security", severity: "medium", weeks: 1, title: "At least 28 requests to the machine endpoints were refused: no token, or a wrong one" });
    expect(f.evidence[0]).toBe("3 records in the audit trail: 5 with no token, 23 with a wrong token");
    expect(f.evidence[1]).toBe("/api/cron/sync: 24 · /api/capture: 3 · /api/keepalive: 1");
    expect(f.evidence[2]).toMatch(/^First \w{3} \d\d:\d\d, last \w{3} \d\d:\d\d$/);
    expect(res.stored.report.checks.find((c) => c.name === "No run of refused tokens at the machine endpoints")).toMatchObject({ area: "security", ok: false, note: "28 requests refused in 3 records" });

    // The run's own log rows hold counts only.
    const run = (await ctx.store.agentRuns.recent(10)).find((r) => r.task === QA_TASK && r.status === "succeeded")!;
    expect(run.trace![0]!.note).toContain("refused tokens 3 records");
    expect(JSON.stringify(run)).not.toContain("/api/cron/sync");
  });

  it("raises refused tokens from 5 in a week, medium from 25 and high from 250, and says so when under", () => {
    const now = new Date("2026-11-23T01:00:00Z");
    const week = (refused: QaInput["refused"]): QaInput => ({ today: "2026-11-22", now, timeZone: "America/Denver", runs: [], briefs: [], connections: [], applications: [], approvals: [], insights: [], paused: [], aiCalls: [], aiDailyLimit: 60, aiOn: false, models: null, refused, previous: null });
    const one = (n: number) => [{ at: "2026-11-18T10:12:00Z", target: "/api/cron/sync", detail: refusedDetail("/api/cron/sync", { missing: n, wrong: 0 }) }];
    const raised = (n: number) => qaReview(week(one(n))).findings.find((f) => f.key === "security:refused-tokens")?.severity ?? "none";
    expect([QA_REFUSED_MIN, QA_REFUSED_MEDIUM, QA_REFUSED_HIGH]).toEqual([5, 25, 250]);
    expect([4, 5, 24, 25, 249, 250, 100_000].map(raised)).toEqual(["none", "low", "low", "medium", "medium", "high", "high"]);

    const check = (refused: QaInput["refused"]) => qaReview(week(refused)).checks.find((c) => c.name === "No run of refused tokens at the machine endpoints")!;
    expect(check(one(4))).toMatchObject({ ok: true, note: "4 requests refused in 1 record, under the 5 that raise a finding" });
    expect(check([])).toMatchObject({ ok: true, note: "No token was refused this week" });
    expect(check(null)).toMatchObject({ ok: true, note: "The audit trail was not read this week" });
    expect(check(undefined)).toMatchObject({ ok: true, note: "The audit trail was not read this week" });
    // A high one reaches Today like any other high finding, and leads the ones of its severity.
    expect(qaAlerts(qaReview(week(one(250))), "2026-11-23").map((f) => f.key)[0]).toBe("security:refused-tokens");
    expect(qaAlerts(qaReview(week(one(249))), "2026-11-23").map((f) => f.key)).not.toContain("security:refused-tokens");
  });

  it("skips a scheduled review when paused, and still runs when you ask", async () => {
    const ctx = demo();
    await ctx.store.agentState.setPaused("qa", true);
    expect(await runQa(ctx, { trigger: "schedule", honorPause: true, persist: ctx.store })).toEqual({ missing: "skipped", why: "paused in Mission Control" });
    expect("missing" in (await runQa(ctx, { trigger: "run-now", honorPause: false, persist: ctx.store }))).toBe(false);
  });
});

describe("The QA Agent's place in Atlas", () => {
  it("names the tasks it reads the way their owners write them", () => {
    expect(QA_EVAL_TASK).toBe(EVAL_TASK);
    expect(QA_AI_CHECK_TASK).toBe(AI_CHECK_TASK);
  });

  it("never calls the AI model or anything outside Atlas", () => {
    for (const f of ["lib/domain/qa.ts", "lib/domain/refusedTokens.ts", "lib/agents/qa.ts"]) {
      const src = read(f);
      expect(src, f).not.toMatch(/structured|takeAiCall|safeFetch|fetch\(/);
    }
    // It reads what the model is called (to say which one answered), nothing more.
    expect(read("lib/agents/qa.ts")).toMatch(/geminiModel\("writer"\)/);
  });

  it("runs once a week, Sunday evening Mountain time, behind the cron's bearer check", () => {
    const crons = (JSON.parse(read("vercel.json")).crons as { path: string; schedule: string }[]).filter((c) => c.path === "/api/cron/qa");
    expect(crons.map((c) => c.schedule)).toEqual(["0 1 * * 1"]);
    expect(read("app/api/cron/qa/route.ts")).toContain('handleCron(request, "qa")');
    expect(read("lib/agents/cron.ts")).toMatch(/if \(wanted === "qa"\)[\s\S]*runQa\(ctx, \{ trigger: "schedule", honorPause: true, persist: store \}\)/);
  });

  it("has its own table that only the server writes, and the roster allows it everywhere", () => {
    const sql = read("supabase/migrations/20261117232050_qa_agent.sql");
    for (const t of ["agent_runs", "agent_state", "time_ledger"]) expect(sql).toMatch(new RegExp(`alter table public\\.${t} add constraint ${t}_agent_check[\\s\\S]*?'qa'\\)\\)`));
    expect(sql).toContain("alter table public.qa_reports enable row level security");
    expect(sql).toContain("revoke all on public.qa_reports from authenticated, anon;");
    expect(sql).toContain("grant select on public.qa_reports to authenticated;");
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*qa_reports/);
    // Retention keeps every earlier rule and adds a year of reviews.
    for (const t of ["audit_events", "inbox_items", "agent_runs", "job_matches", "ai_usage", "market_postings", "market_reports", "mentor_insights", "role_proposals", "qa_reports"]) expect(sql, t).toContain(`delete from public.${t}`);
  });

  it("sits on the Live Map in its own band, with no lines", () => {
    const qa = MAP_NODES.find((n) => n.id === "qa")!;
    const band = MAP_GROUPS.find((g) => g.id === "quality")!;
    expect(qa.agent).toBe("qa");
    expect(qa.x - qa.w / 2).toBeGreaterThanOrEqual(band.x);
    expect(qa.y - qa.h / 2).toBeGreaterThanOrEqual(band.y);
    expect(qa.y + qa.h / 2).toBeLessThanOrEqual(band.y + band.h);
    expect(band.y + band.h).toBeLessThanOrEqual(MAP_SIZE.h);
    expect(MAP_EDGES.filter((e) => e.from === "qa" || e.to === "qa")).toEqual([]);
  });
});

describe("Showing the review", () => {
  const finding = (over: Partial<QaFinding>): QaFinding => ({ key: "briefs:missing", area: "briefs", severity: "high", title: "1 brief was not saved", evidence: ["Tue · Morning Brief"], fix: "Check that run's trace.", weeks: 2, ...over });
  const stored = (findings: QaFinding[], resolved: string[] = []): StoredQaReport => ({
    id: "q1",
    forDate: "2026-11-22",
    createdAt: "2026-11-23T01:00:10Z",
    report: { from: "2026-11-16", to: "2026-11-22", headline: findings.length ? "1 finding: 1 high. 12 of 13 checks passed." : "All 13 checks passed.", findings, resolved, checks: [{ area: "briefs", name: "Every brief was saved, on time", ok: findings.length === 0, note: "10 of 11 saved" }], stats: { runs: 120, failed: 0, stalled: 1, aiAnswered: 9, aiFellBack: 1, briefsSaved: 10, briefsExpected: 11 } },
  });

  it("lists findings with severity, how long open, the fix and the evidence; then what was fixed and every check", async () => {
    const { QaCard } = await import("@/components/QaCard");
    const html = renderToStaticMarkup(createElement(QaCard, { latest: stored([finding({})], ["The Gmail connection has an error"]), now: NOW }));
    for (const text of ["1 finding: 1 high", "High", "Open for 2 reviews", "1 brief was not saved", "Suggested fix:", "Tue · Morning Brief", "Fixed since the last review (1)", "The Gmail connection has an error", "Every check it ran (0 of 1 passed)", "10 of 11 briefs saved"]) expect(html, text).toContain(text);
    const clean = renderToStaticMarkup(createElement(QaCard, { latest: stored([]), now: NOW }));
    expect(clean).toContain("All 13 checks passed.");
    expect(renderToStaticMarkup(createElement(QaCard, { latest: null, now: NOW }))).toContain("No review yet");
  });

  it("shows a refused-token finding under Security, with its count and where it came from", async () => {
    const { QaCard } = await import("@/components/QaCard");
    const f = finding({ key: "security:refused-tokens", area: "security", severity: "medium", weeks: 1, title: "At least 28 requests to the machine endpoints were refused: no token, or a wrong one", evidence: ["3 records in the audit trail: 5 with no token, 23 with a wrong token", "/api/cron/sync: 24 · /api/capture: 3 · /api/keepalive: 1"], fix: "Add the Vercel Firewall rate-limit rule for /api/*." });
    const html = renderToStaticMarkup(createElement(QaCard, { latest: stored([f]), now: NOW }));
    for (const text of ["Medium", "Security", "New this week", "At least 28 requests to the machine endpoints were refused", "Suggested fix:", "/api/cron/sync: 24 · /api/capture: 3 · /api/keepalive: 1", "tokens refused at the machine endpoints"]) expect(html, text).toContain(text);
  });

  it("Today points at the review only for something serious, and only while it is fresh", () => {
    const report = stored([finding({}), finding({ key: "data:roles", severity: "low" })]).report;
    expect(qaAlerts(report, "2026-11-23").map((f) => f.key)).toEqual(["briefs:missing"]);
    expect(qaAlerts(report, "2026-11-24")).toHaveLength(1);
    expect(qaAlerts(report, "2026-11-25")).toEqual([]);
    expect(qaAlerts(stored([finding({ severity: "medium" })]).report, "2026-11-23")).toEqual([]);
    expect(qaAlerts(null, "2026-11-23")).toEqual([]);
  });
});
