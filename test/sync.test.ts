import { beforeAll, describe, expect, it } from "vitest";
import { CAREER_SYNC_TASK, runSync } from "@/lib/agents/sync";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { hourLabel, isSyncTime, nextSync, SYNC_HOURS, SYNC_TASK } from "@/lib/domain/briefSchedule";
import { urgentSince } from "@/lib/domain/urgent";
import type { InboxItem } from "@/lib/domain/types";

const MON = "2026-11-16";
const SAT = "2026-11-21";
const SUN = "2026-11-22";

describe("2-hour sync schedule", () => {
  it("runs Monday to Saturday, every two hours from 6 AM to 4 PM", () => {
    expect(SYNC_HOURS).toEqual([6, 8, 10, 12, 14, 16]);
    expect(SYNC_HOURS.map((h) => isSyncTime(MON, `${String(h).padStart(2, "0")}:05`))).toEqual([true, true, true, true, true, true]);
    for (const off of ["05:59", "07:00", "09:30", "17:00", "22:00"]) expect(isSyncTime(MON, off)).toBe(false);
    expect(isSyncTime(SAT, "16:40")).toBe(true);
    expect(isSyncTime(SUN, "10:05")).toBe(false);
  });

  it("knows the next sync, across the evening and Sunday", () => {
    expect(nextSync(MON, "07:10")).toEqual({ day: MON, hour: 8 });
    expect(nextSync(MON, "16:10")).toEqual({ day: "2026-11-17", hour: 6 });
    expect(nextSync(SAT, "18:00")).toEqual({ day: "2026-11-23", hour: 6 });
    expect(nextSync(SUN, "08:00")).toEqual({ day: "2026-11-23", hour: 6 });
    expect([6, 12, 16].map(hourLabel)).toEqual(["6 AM", "12 PM", "4 PM"]);
  });

  it("is called by the scheduler in every candidate UTC hour, Monday to Saturday", async () => {
    const { readFileSync } = await import("node:fs");
    const crons: { path: string; schedule: string }[] = JSON.parse(readFileSync("vercel.json", "utf8")).crons;
    const sync = crons.filter((c) => c.path === "/api/cron/sync").map((c) => c.schedule);
    // 6 AM to 4 PM Mountain is 12:00 to 23:00 UTC across standard and daylight time.
    expect(sync).toEqual(Array.from({ length: 12 }, (_, i) => `5 ${12 + i} * * 1-6`));
  });
});

const mail = (over: Partial<InboxItem>): InboxItem => ({
  id: "i",
  messageId: "m",
  threadId: "t",
  fromName: "Someone",
  fromEmail: "someone@example.com",
  subject: "Hello",
  snippet: "",
  receivedAt: "2026-11-16T15:30:00Z",
  category: "fyi",
  reason: "Addressed to you",
  done: false,
  createdAt: "2026-11-16T15:30:00Z",
  ...over,
});

describe("Urgent between briefs", () => {
  const prefs = { emailStores: [], emailSubscriptions: [], emailUnsubscribed: [] };
  const SINCE = "2026-11-16T15:00:00Z";

  it("pings only for a new interview invite or payment alert", () => {
    const items = [
      // Each invite's text was read and says so: the subject is not what makes it one.
      mail({ id: "1", fromName: "Sam Ortiz", fromEmail: "sam@halcyon.ai", subject: "The AI Engineer role at Halcyon", textVerdict: "interview" }),
      mail({ id: "2", fromName: "Old Co", fromEmail: "hr@old.co", subject: "Your application at Old Co", receivedAt: "2026-11-16T13:00:00Z", textVerdict: "interview" }),
      mail({ id: "3", fromName: "Costco", fromEmail: "deals@costco.com", subject: "Black Friday deals" }),
      mail({ id: "4", fromName: "Done Co", fromEmail: "x@done.co", subject: "Your application at Done Co", done: true, textVerdict: "interview" }),
    ];
    const alerts = [
      { name: "Lakeshore Financial", subject: "Payment failed: action required", receivedAt: "2026-11-16T15:45:00Z" },
      { name: "Chase", subject: "Payment past due", receivedAt: "2026-11-16T10:00:00Z" },
    ];
    const urgent = urgentSince(items, prefs, SINCE, alerts);
    expect(urgent.map((u) => u.title)).toEqual(["Interview invite: Sam Ortiz", "Payment alert: Lakeshore Financial"]);
    expect(urgent[0]).toMatchObject({ kind: "interview", url: "/inbox" });
    expect(urgent[1]).toMatchObject({ kind: "payment", url: "/renewals" });
    expect(urgentSince([mail({ subject: "Newsletter" })], prefs, SINCE, [])).toEqual([]);
  });

  it("a subject alone never pings as an interview: unread, it waits for its text", () => {
    const from = { fromName: "Sam Ortiz", fromEmail: "sam@halcyon.ai" };
    const subject = "Interview availability for the AI Engineer role";
    // Unread: the tracker holds it off the timelines, and the phone does not call it an invite either.
    for (const textVerdict of [undefined, null] as const) expect(urgentSince([mail({ ...from, subject, textVerdict })], prefs, SINCE, []), String(textVerdict)).toEqual([]);
    // Read, and the text says so: it pings (here, because it is on no timeline).
    expect(urgentSince([mail({ ...from, subject, textVerdict: "interview" })], prefs, SINCE, []).map((u) => u.title)).toEqual(["Interview invite: Sam Ortiz"]);
    // Read, and no rule found an invitation in the text: not an interview, so no ping from here.
    expect(urgentSince([mail({ ...from, subject, textVerdict: "none" })], prefs, SINCE, [])).toEqual([]);
    // "Next steps" names no interview, read or not.
    for (const textVerdict of [null, "none"] as const) expect(urgentSince([mail({ ...from, subject: "Next steps for your application", textVerdict })], prefs, SINCE, []), String(textVerdict)).toEqual([]);
  });

  it("clips long text", () => {
    const u = urgentSince([mail({ fromName: "N".repeat(200), subject: `Interview ${"x".repeat(400)}`, textVerdict: "interview" })], prefs, SINCE, []);
    expect(u[0]!.title.length).toBeLessThanOrEqual(80);
    expect(u[0]!.body.length).toBeLessThanOrEqual(160);
  });
});

describe("2-hour sync run", () => {
  beforeAll(() => {
    // No network in tests: the News Agent reads no feeds.
    process.env.ATLAS_OFFLINE = "1";
  });

  it("has every agent report, logs one traced run, and writes no brief or job matches", async () => {
    const NOW = new Date("2026-11-16T15:05:00Z"); // Monday 8:05 AM in Denver
    const state = { ...seedState(NOW), agentRuns: [] };
    const store = createMemoryStore(state);
    const ctx = { mode: "demo", userId: "demo", store, settings: state.settings, now: NOW, today: MON, time: "08:05" } as Context;
    const briefsBefore = (await store.briefs.search({ limit: 50 })).length;
    const matchesBefore = (await store.jobMatches.since("2000-01-01")).length;

    const outcome = await runSync(ctx, "run-now", null);
    expect(outcome.status).toBe("succeeded");

    const runs = await store.agentRuns.recent(50);
    const sync = runs.find((r) => r.task === SYNC_TASK && r.status === "succeeded")!;
    expect(sync.agent).toBe("chief-of-staff");
    expect(sync.costUsd).toBe(0);
    const steps = sync.trace!.map((s) => s.name);
    // Notion and the inbox come first; the rest report in parallel, then the urgent check.
    expect(steps.slice(0, 2)).toEqual(["Sync resumes from Notion", "Ask the Email bot"]);
    expect(new Set(steps.slice(2, 7))).toEqual(new Set(["Ask the Calendar bot", "Ask the News bot", "Ask the Applications bot to log applications and queue follow-ups", "Ask the Finance bot", "Ask the Scout"]));
    expect(steps[7]).toBe("Check for anything urgent");
    // Each specialist logged its own run too.
    expect(new Set(runs.filter((r) => r.status !== "started").map((r) => r.agent))).toEqual(new Set(["chief-of-staff", "email", "calendar", "news", "finance", "career", "scout"]));
    // The Analyst and the Career Mentor run with the briefs, never in a sync.
    expect(runs.some((r) => r.agent === "analyst" || r.agent === "mentor")).toBe(false);
    // The Applications Agent's part is its own traced run, so the live map can show it working.
    const career = runs.find((r) => r.agent === "career" && r.status === "succeeded" && r.task === CAREER_SYNC_TASK)!;
    expect(career.task).toBe(CAREER_SYNC_TASK);
    expect(career.trace!.map((s) => s.name)).toEqual(["Read the text of new job emails (read-only, rules only)", "Track applications from job emails", "Tell your phone who wrote back", "Look up missing roles in the application emails (read-only, rules only)", "Queue follow-ups for quiet applications", "Queue jobs you gave a thumbs-up that are in no queue", "Find approved jobs whose posting has not been read", "Find jobs in the Apply Queue with no research yet", "Prepare for a new interview"]);
    // With no Firecrawl key nothing is read, and the step says so instead of failing the sync.
    expect(career.trace!.at(-2)!.note).toMatch(/none waiting|Firecrawl is not set up yet/);
    // A new interview gets its prep (Interview Prep agent, Step 4), one a run.
    expect(career.trace!.at(-1)!.note).toMatch(/^prepared |no new interviews/);
    expect(runs.some((r) => r.agent === "career" && r.status === "started" && r.runId === career.runId)).toBe(true);
    // It refreshes data only.
    expect((await store.briefs.search({ limit: 50 })).length).toBe(briefsBefore);
    expect((await store.jobMatches.since("2000-01-01")).length).toBe(matchesBefore);
  });
});
