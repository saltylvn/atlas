import { describe, expect, it } from "vitest";
import { costUsd, MODELS } from "@/lib/ai/models";
import { composeBrief } from "@/lib/domain/brief";
import { BRIEF_NAME, briefedSlots, currentSlot, nextBrief, scheduledSlot, slotsFor, todaysBriefs } from "@/lib/domain/briefSchedule";
import { calendarAgentReport, type CalendarAgentInput } from "@/lib/domain/calendarAgent";
import { assembleReport, findConflicts, hotList, searchText, type AssembleInput } from "@/lib/domain/chiefOfStaff";
import { emailAgentReport } from "@/lib/domain/emailAgent";
import { financeAgentReport } from "@/lib/domain/financeAgent";
import { newsAgentReport, shownIn, type NewsAgentInput } from "@/lib/domain/newsAgent";
import type { CalendarEvent, InboxItem, CareerSnapshot, NewsItem } from "@/lib/domain/types";

// 2026-11-16 is a Monday.
const MON = "2026-11-16";
const SAT = "2026-11-21";
const SUN = "2026-11-22";
const TZ = "America/Denver";

describe("brief schedule and Weekend Mode", () => {
  it("gives weekdays two briefs, Saturday one light brief, Sunday none", () => {
    expect(slotsFor(MON)).toEqual(["morning", "afternoon"]);
    expect(slotsFor(SAT)).toEqual(["saturday"]);
    expect(slotsFor(SUN)).toEqual([]);
  });
  it("maps scheduler triggers to slots and skips the weekend afternoon and Sunday", () => {
    expect(scheduledSlot(MON, "morning")).toBe("morning");
    expect(scheduledSlot(MON, "afternoon")).toBe("afternoon");
    expect(scheduledSlot(SAT, "morning")).toBe("saturday");
    expect(scheduledSlot(SAT, "afternoon")).toBeNull();
    expect(scheduledSlot(SUN, "morning")).toBeNull();
  });
  it("picks the current slot for Run Now and the next scheduled brief", () => {
    expect(currentSlot(MON, "08:30")).toBe("morning");
    expect(currentSlot(MON, "13:10")).toBe("afternoon");
    expect(currentSlot(SUN, "10:00")).toBe("saturday");
    expect(nextBrief(MON, "08:00")).toEqual({ day: MON, slot: "morning" });
    expect(nextBrief(MON, "10:00")).toEqual({ day: MON, slot: "afternoon" });
    expect(nextBrief("2026-11-20", "15:00")).toEqual({ day: SAT, slot: "saturday" });
    expect(nextBrief(SAT, "10:00")).toEqual({ day: "2026-11-23", slot: "morning" });
  });
});

const now = new Date("2026-11-16T15:00:00Z");
const app = (over: Partial<CareerSnapshot["applications"][number]>) => ({
  applicationId: "A",
  company: "Acme",
  role: "AI Engineer",
  stage: "Applied",
  appliedDate: "2026-11-01",
  stageUpdatedAt: "2026-11-15T12:00:00Z",
  nextAction: "",
  nextActionDue: "",
  postingUrl: "https://example.com/job",
  ...over,
});
const snapshot = (apps: ReturnType<typeof app>[], interviews: CareerSnapshot["interviews"] = []): CareerSnapshot => ({
  generatedAt: now.toISOString(),
  applications: apps,
  interviews,
});

describe("Hot List", () => {
  it("puts offers, then interviews, then replies on top, and ignores stale or plain applications", () => {
    const list = hotList(
      snapshot([
        app({ applicationId: "1", company: "ReplyCo", stage: "Reply" }),
        app({ applicationId: "2", company: "OfferCo", stage: "Offer" }),
        app({ applicationId: "3", company: "Applied Inc", stage: "Applied" }),
        app({ applicationId: "4", company: "Old Reply", stage: "Reply", stageUpdatedAt: "2026-10-01T00:00:00Z" }),
        app({ applicationId: "5", company: "InterviewCo", stage: "Interview 2" }),
      ]),
      now,
      TZ,
    );
    expect(list.map((h) => [h.kind, h.company])).toEqual([
      ["offer", "OfferCo"],
      ["interview", "InterviewCo"],
      ["reply", "ReplyCo"],
    ]);
  });
  it("keeps an older interview on the list while one is still upcoming", () => {
    const list = hotList(
      snapshot([app({ applicationId: "9", company: "Later", stage: "Interview 1", stageUpdatedAt: "2026-10-01T00:00:00Z" })], [
        { interviewId: "I", applicationId: "9", company: "Later", role: "AI Engineer", round: "Interview 1", start: "2026-11-18T17:00:00Z", end: "2026-11-18T18:00:00Z", status: "Confirmed", meetingLink: "" },
      ]),
      now,
      TZ,
    );
    expect(list[0]).toMatchObject({ kind: "interview", company: "Later" });
    expect(list[0]!.detail).toContain("Interview 1");
  });
});

const ev = (title: string, start: string, end: string, allDay = false): CalendarEvent => ({ id: title, title, start, end, allDay, location: "", source: "calendar" });
// One-word-per-story titles, so no two test stories look like the same story.
const story = (topic: NewsItem["topic"], source: string, n: number): NewsItem => ({ id: `${topic}${source}${n}`, topic, title: `Headline ${topic}${source}x${n}`, url: `https://x.test/${topic}/${source}/${n}`, source, publishedAt: null });

describe("calendar conflicts", () => {
  it("flags overlapping timed events only", () => {
    const c = findConflicts([ev("Standup", "2026-11-16T16:00:00Z", "2026-11-16T16:30:00Z"), ev("Dentist", "2026-11-16T16:15:00Z", "2026-11-16T17:00:00Z"), ev("Lunch", "2026-11-16T18:00:00Z", "2026-11-16T19:00:00Z"), ev("Holiday", "2026-11-16", "2026-11-17", true)], TZ);
    expect(c).toHaveLength(1);
    expect(c[0]).toContain("Standup");
    expect(c[0]).toContain("Dentist");
  });
});

function cal(over: Partial<CalendarAgentInput> = {}) {
  return calendarAgentReport({
    slot: "morning",
    forDate: MON,
    aheadUntil: "2026-11-22",
    timeZone: TZ,
    events: [ev("Standup", "2026-11-16T16:00:00Z", "2026-11-16T16:30:00Z"), ev("Gym", "2026-11-18T01:00:00Z", "2026-11-18T02:00:00Z")],
    status: "ok",
    interviews: [],
    ...over,
  });
}

const allNews = (["ai", "tech", "politics", "world"] as const).flatMap((t) => [1, 2, 3, 4].map((n) => story(t, `S${n}`, n)));
function nws(over: Partial<NewsAgentInput> = {}) {
  return newsAgentReport({ slot: "morning", now, items: allNews, failedFeeds: [], feedCount: 17, lean: {}, shown: { urls: new Set(), titles: [] }, ...over });
}

const mail = (n: number, category: InboxItem["category"]): InboxItem => ({
  id: `m${n}`, messageId: `m${n}`, threadId: `t${n}`, fromName: `Sender ${n}`, fromEmail: `s${n}@example.com`, subject: `Hello ${n}`, snippet: "",
  receivedAt: "2026-11-16T12:00:00Z", category, reason: category === "noise" ? "Mailing list or automated" : "Addressed to you", done: false, createdAt: "2026-11-16T12:00:00Z",
});
const inboxItems = [mail(1, "reply"), mail(2, "reply"), mail(3, "fyi"), ...[4, 5, 6, 7, 8].map((n) => mail(n, "noise"))];
const eml = () => emailAgentReport({ slot: "morning", items: inboxItems, prefs: { stores: [], subscriptions: [], unsubscribed: [] }, sync: "ok" });

function input(over: Partial<AssembleInput> = {}): AssembleInput {
  const brief = composeBrief({ today: MON, tasks: [], events: [], peopleDue: [], pipeline: null, news: [], weather: null, dailyCapacityMin: 360, timeZone: TZ });
  return {
    slot: "morning",
    forDate: MON,
    now,
    timeZone: TZ,
    brief,
    calendar: cal(),
    email: eml(),
    news: nws(),
    bills: [],
    pipeline: null,
    snapshot: snapshot([app({ company: "OfferCo", stage: "Offer" })]),
    ...over,
  };
}

describe("Today's briefs", () => {
  it("lists the day's briefs newest first: the 2:00 PM brief above the morning one", () => {
    const morning = { slot: "morning" as const, id: "m" };
    const afternoon = { slot: "afternoon" as const, id: "a" };
    expect(todaysBriefs([morning]).map((b) => b.id)).toEqual(["m"]);
    expect(todaysBriefs([morning, afternoon]).map((b) => b.id)).toEqual(["a", "m"]);
    expect(todaysBriefs([afternoon, morning]).map((b) => b.id)).toEqual(["a", "m"]);
    expect(todaysBriefs([{ slot: "saturday" as const, id: "s" }]).map((b) => b.id)).toEqual(["s"]);
    expect(todaysBriefs([])).toEqual([]);
    expect(BRIEF_NAME).toMatchObject({ morning: "Morning Brief", afternoon: "Afternoon Brief" });
  });

  it("tracks each brief's Briefed on its own, for today only", () => {
    const at = "2026-11-16T16:30:00Z"; // Monday 9:30 AM in Denver
    const entry = (activity: string, when = at, agent = "chief-of-staff" as const) => ({ agent, activity, at: when });
    expect(briefedSlots([], MON, TZ)).toEqual([]);
    expect(briefedSlots([entry("Morning brief")], MON, TZ)).toEqual(["morning"]);
    expect(briefedSlots([entry("Morning brief"), entry("Afternoon brief", "2026-11-16T21:10:00Z")], MON, TZ)).toEqual(["morning", "afternoon"]);
    // Yesterday's confirmation and other agents' entries do not count.
    expect(briefedSlots([entry("Morning brief", "2026-11-15T16:30:00Z")], MON, TZ)).toEqual([]);
    expect(briefedSlots([{ agent: "news" as const, activity: "Morning brief", at }], MON, TZ)).toEqual([]);
  });
});

describe("Chief of Staff report", () => {
  it("leads with the Hot List and carries 9 stories, today and the week ahead", () => {
    const r = assembleReport(input());
    expect(r.headline).toMatch(/^Offer from OfferCo/);
    expect(r.news).toHaveLength(9);
    expect(r.calendar?.today.map((e) => e.title)).toEqual(["Standup"]);
    expect(r.calendar?.ahead.map((d) => d.day)).toEqual(["2026-11-17"]);
    expect(r.email?.needsReply).toBe(2);
    expect(r.reports.map((x) => x.agent)).toEqual(expect.arrayContaining(["career", "calendar", "email", "news"]));
  });
  it("shows only new stories in the 2:00 PM brief", () => {
    const morning = assembleReport(input());
    const afternoon = assembleReport(input({ slot: "afternoon", news: nws({ slot: "afternoon", shown: shownIn([morning]) }) }));
    const seen = new Set(morning.news.map((n) => n.url));
    expect(afternoon.news.length).toBeGreaterThan(0);
    expect(afternoon.news.every((n) => !seen.has(n.url))).toBe(true);
  });
  it("keeps Saturday light: Hot List, calendar and 3 stories, no email or jobs", () => {
    const r = assembleReport(input({ slot: "saturday", forDate: SAT, calendar: cal({ slot: "saturday", forDate: SAT, aheadUntil: SUN }), news: nws({ slot: "saturday" }) }));
    expect(r.news).toHaveLength(3);
    expect(r.email).toBeNull();
    expect(r.jobs).toBeNull();
    expect(r.hotList).toHaveLength(1);
  });
  it("reports failures in the brief instead of dropping them", () => {
    const r = assembleReport(input({ news: nws({ failedFeeds: ["Reuters (politics)"] }), calendar: cal({ status: "error", events: [] }) }));
    expect(r.errors.join(" ")).toContain("Reuters");
    expect(r.errors.join(" ")).toContain("Calendar could not be read");
  });
  it("says so in the brief when a specialist is paused or fails", () => {
    const noMail = assembleReport(input({ email: { missing: "failed", why: "timeout" } }));
    expect(noMail.email).toBeNull();
    expect(noMail.errors).toContain("Email Agent failed: timeout");
    const quiet = assembleReport(input({ news: { missing: "skipped", why: "paused in Mission Control" } }));
    expect(quiet.news).toEqual([]);
    expect(quiet.errors.join(" ")).toContain("News Agent skipped (paused in Mission Control)");
    const paused = assembleReport(input({ calendar: { missing: "skipped", why: "paused in Mission Control" } }));
    expect(paused.calendar).toBeNull();
    expect(paused.errors.join(" ")).toContain("Calendar Agent skipped (paused in Mission Control)");
    const failed = assembleReport(input({ calendar: { missing: "failed", why: "timeout" } }));
    expect(failed.reports.find((x) => x.agent === "calendar")?.errors).toEqual(["Calendar Agent failed: timeout"]);
  });
  it("carries the Finance Agent's section on weekdays and says so when it fails", () => {
    const fin = financeAgentReport({
      today: MON,
      items: [{ ...mail(9, "fyi"), fromName: "Chase", fromEmail: "alerts@chase.com", subject: "Payment past due" }],
      prefs: { stores: [], subscriptions: [], unsubscribed: [] },
      renewals: [],
      inboxReady: true,
    });
    const r = assembleReport(input({ finance: fin }));
    expect(r.finance?.alerts.map((b) => b.name)).toEqual(["Chase"]);
    expect(r.reports.find((x) => x.agent === "finance")?.needsApproval).toEqual(["Track Chase in Renewals"]);
    expect(searchText(r)).toContain("Payment past due");
    const failed = assembleReport(input({ finance: { missing: "failed", why: "timeout" } }));
    expect(failed.finance).toBeNull();
    expect(failed.errors).toContain("Finance Agent failed: timeout");
    const sat = assembleReport(input({ slot: "saturday", forDate: SAT, calendar: cal({ slot: "saturday", forDate: SAT, aheadUntil: SUN }), news: nws({ slot: "saturday" }), finance: fin }));
    expect(sat.finance).toBeNull();
  });
  it("routes each interview to the Career Agent for prep notes", () => {
    const r = assembleReport(
      input({
        calendar: cal({
          interviews: [{ interviewId: "I1", applicationId: "A", company: "Acme", role: "AI Engineer", round: "Interview 2", start: "2026-11-18T17:00:00Z", end: "2026-11-18T18:00:00Z", status: "Confirmed", meetingLink: "https://meet.test/x", postingUrl: "https://example.com/job" }],
        }),
      }),
    );
    const iv = r.calendar?.interviews?.[0];
    expect(iv?.prep?.length).toBeGreaterThan(3);
    expect(iv?.prep?.join(" ")).toContain("AI Engineer");
    expect(r.reports.find((x) => x.agent === "calendar")?.needsApproval).toHaveLength(1);
    expect(searchText(r)).toContain("Acme");
  });
  it("makes the brief searchable by its content", () => {
    expect(searchText(assembleReport(input()))).toContain("OfferCo");
  });
});

describe("model tiers and cost", () => {
  it("uses Haiku for fast work and Opus for writing", () => {
    expect(MODELS).toEqual({ fast: "claude-haiku-5-5", writer: "claude-opus-5-5" });
  });
  it("prices tokens per million, including cache writes and reads", () => {
    expect(costUsd("claude-opus-5-5", { input: 1_000_000, output: 0 })).toBe(4);
    expect(costUsd("claude-haiku-5-5", { input: 2000, output: 1000 })).toBeCloseTo(0.0007, 6);
    expect(costUsd("claude-opus-5-5", { input: 0, output: 0, cacheWrite: 1_000_000, cacheRead: 1_000_000 })).toBe(5.2);
    expect(costUsd("unknown-model", { input: 1_000_000, output: 1_000_000 })).toBe(0);
  });
});
