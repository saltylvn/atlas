import { describe, expect, it } from "vitest";
import {
  buildDoNext,
  composeAbout,
  composerHref,
  CAREER_RULES,
  contactForCompany,
  followUpDraft,
  prepChecklist,
  roundNumber,
  thankYouDraft,
  totalMinutesOf,
} from "@/lib/domain/career";
import { localDate } from "@/lib/domain/dates";
import { recommendations, weeklyReview, type WeeklyReview } from "@/lib/domain/review";
import { seedState } from "@/lib/data/memory";
import { demoSnapshot } from "./helpers/demoSnapshot";
import type { Contact, TrackedApplication, TrackedInterview, CareerSnapshot, JobPosting, LedgerEntry, Task } from "@/lib/domain/types";

const TZ = "America/Denver";
// 10:00 Denver on Wed Nov 11 2026.
const NOW = new Date("2026-11-11T17:00:00Z");
const TODAY = "2026-11-11";

const app = (a: Partial<TrackedApplication>): TrackedApplication => ({
  applicationId: a.applicationId ?? "JH-" + Math.random().toString(36).slice(2, 7),
  company: "Acme",
  role: "Solutions Engineer",
  stage: "Applied",
  appliedDate: TODAY,
  stageUpdatedAt: `${a.appliedDate ?? TODAY}T12:00:00Z`,
  nextAction: "",
  nextActionDue: "",
  postingUrl: "https://example.com/j",
  ...a,
});

const iv = (i: Partial<TrackedInterview>): TrackedInterview => ({
  interviewId: i.interviewId ?? "IV-" + Math.random().toString(36).slice(2, 7),
  applicationId: "JH-1",
  company: "Acme",
  role: "Solutions Engineer",
  round: "Interview 1",
  start: "2026-11-12T17:00:00Z",
  end: "2026-11-12T18:00:00Z",
  status: "Confirmed",
  meetingLink: "",
  ...i,
});

const snap = (applications: TrackedApplication[], interviews: TrackedInterview[] = []): CareerSnapshot => ({
  generatedAt: NOW.toISOString(),
  applications,
  interviews,
});

const posting = (p: Partial<JobPosting>): JobPosting => ({
  id: p.id ?? "p-" + Math.random().toString(36).slice(2, 7),
  company: "Globex",
  title: "Senior Solutions Engineer",
  location: "Remote",
  url: "https://example.com/p",
  board: "greenhouse",
  updatedAt: "2026-11-10T00:00:00Z",
  score: 95,
  matched: ["Solutions Engineer", "Remote"],
  ...p,
});

const contact = (c: Partial<Contact>): Contact => ({
  id: c.id ?? "c1",
  name: "Sam Recruiter",
  circle: "network",
  email: "sam@example.com",
  phone: null,
  cadenceDays: 0,
  lastContactAt: null,
  birthday: null,
  notes: "",
  createdAt: "2026-01-01T00:00:00Z",
  ...c,
});

const run = (snapshot: CareerSnapshot | null, postings: JobPosting[] = [], contacts: Contact[] = []) =>
  buildDoNext({ snapshot, postings, contacts, now: NOW, today: TODAY, timeZone: TZ, displayName: "Tyler" });

describe("career do-next", () => {
  it("is empty with no snapshot and no postings", () => {
    expect(run(null)).toEqual([]);
  });

  it("follows up after 7 quiet days, not before", () => {
    const items = run(snap([app({ applicationId: "A", appliedDate: "2026-11-04" }), app({ applicationId: "B", appliedDate: "2026-11-05" })]));
    expect(items.map((i) => i.id)).toEqual(["follow-up:A"]);
    expect(items[0]!.why).toContain("7 days");
    expect(items[0]!.minutes).toBe(10);
    expect(items[0]!.draft!.body).toContain("Acme");
    expect(items[0]!.draft!.body).toContain("Tyler");
  });

  it("closes out applications quiet for 30+ days instead of following up", () => {
    const items = run(snap([app({ applicationId: "A", appliedDate: "2026-10-01" })]));
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe("close-out");
    expect(items[0]!.minutes).toBe(5);
  });

  it("ignores closed stages", () => {
    const items = run(snap([app({ stage: "Rejected", appliedDate: "2026-10-01" }), app({ stage: "Withdrawn", appliedDate: "2026-10-20" })]));
    expect(items).toEqual([]);
  });

  it("asks for a thank-you within 24h of an interview ending", () => {
    const ended = iv({ interviewId: "I1", applicationId: "A", start: "2026-11-11T14:00:00Z", end: "2026-11-11T15:00:00Z" });
    const items = run(snap([app({ applicationId: "A", stage: "Interview 1" })], [ended]));
    expect(items[0]!.kind).toBe("thank-you");
    expect(items[0]!.why).toContain("2h ago");
    expect(items[0]!.draft!.subject).toContain("Interview 1");
  });

  it("skips thank-you after 24h and for cancelled interviews", () => {
    const old = iv({ start: "2026-11-09T14:00:00Z", end: "2026-11-09T15:00:00Z" });
    const cancelled = iv({ start: "2026-11-11T14:00:00Z", end: "2026-11-11T15:00:00Z", status: "Cancelled" });
    expect(run(snap([app({ applicationId: "JH-1", stage: "Interview 1" })], [old, cancelled]))).toEqual([]);
  });

  it("preps for interviews within 3 days, with a longer checklist for later rounds", () => {
    const soon = iv({ interviewId: "S", applicationId: "A", round: "Interview 3", start: "2026-11-13T17:00:00Z", end: "2026-11-13T18:00:00Z", meetingLink: "https://x" });
    const far = iv({ interviewId: "F", applicationId: "B", start: "2026-11-20T17:00:00Z", end: "2026-11-20T18:00:00Z" });
    const items = run(snap([app({ applicationId: "A", stage: "Interview 3" }), app({ applicationId: "B", stage: "Interview 1" })], [soon, far]));
    expect(items.map((i) => i.id)).toEqual(["prep:S"]);
    expect(items[0]!.why).toContain("in 2 days");
    expect(items[0]!.minutes).toBe(45 + 15 * 2);
    expect(items[0]!.checklist!.some((c) => /compensation/i.test(c))).toBe(true);
    expect(items[0]!.url).toBe("https://x");
  });

  it("uses the owner's timezone for 'tomorrow'", () => {
    // 04:00 UTC Nov 12 is 21:00 Nov 11 in Denver: that is today, not tomorrow.
    const tonight = iv({ interviewId: "T", start: "2026-11-12T04:00:00Z", end: "2026-11-12T05:00:00Z" });
    const items = run(snap([app({ applicationId: "JH-1", stage: "Interview 1" })], [tonight]));
    expect(items[0]!.why).toContain("today");
  });

  it("surfaces job-hunt next actions that are due, but not twice with prep", () => {
    const a = app({ applicationId: "A", stage: "Reply", nextAction: "Send availability", nextActionDue: "2026-11-09" });
    const b = app({ applicationId: "B", stage: "Interview 2", nextAction: "Prep demo", nextActionDue: "2026-11-11" });
    const items = run(snap([a, b], [iv({ interviewId: "X", applicationId: "B", round: "Interview 2" })]));
    expect(items.map((i) => i.id).sort()).toEqual(["due:A", "prep:X"]);
    expect(items.find((i) => i.id === "due:A")!.why).toContain("2 days ago");
  });

  it("suggests the best new postings, skipping ones already tracked and low scores", () => {
    const tracked = app({ company: "Globex", role: "Senior Solutions Engineer", appliedDate: "2026-11-10" });
    const ps = [
      posting({ id: "dup" }),
      posting({ id: "low", company: "Initech", score: 70 }),
      posting({ id: "a", company: "Initech", title: "Solutions Architect", score: 100 }),
      posting({ id: "b", company: "Umbrella", title: "Sales Engineer", score: 90 }),
      posting({ id: "c", company: "Hooli", title: "AI Engineer", score: 88 }),
      posting({ id: "d", company: "Pied Piper", title: "Customer Engineer", score: 86 }),
    ];
    const items = run(snap([tracked]), ps);
    expect(items.map((i) => i.id)).toEqual(["apply:a", "apply:b", "apply:c"]);
    expect(items).toHaveLength(CAREER_RULES.maxApply);
  });

  it("caps apply items per company", () => {
    const ps = [posting({ id: "1", title: "A", score: 99 }), posting({ id: "2", title: "B", score: 98 }), posting({ id: "3", company: "Initech", title: "C", score: 90 })];
    expect(run(null, ps).map((i) => i.id)).toEqual(["apply:1", "apply:3"]);
  });

  it("orders by urgency: thank-you, prep, due, follow-up, apply, close-out", () => {
    const items = run(
      snap(
        [
          app({ applicationId: "T", stage: "Interview 1" }),
          app({ applicationId: "P", stage: "Interview 1" }),
          app({ applicationId: "D", stage: "Reply", nextAction: "Reply", nextActionDue: TODAY }),
          app({ applicationId: "F", appliedDate: "2026-11-01" }),
          app({ applicationId: "C", appliedDate: "2026-09-01" }),
        ],
        [
          iv({ interviewId: "t", applicationId: "T", start: "2026-11-11T15:00:00Z", end: "2026-11-11T16:00:00Z" }),
          iv({ interviewId: "p", applicationId: "P" }),
        ],
      ),
      [posting({ id: "x" })],
    );
    expect(items.map((i) => i.kind)).toEqual(["thank-you", "prep", "due", "follow-up", "apply", "close-out"]);
    expect(totalMinutesOf(items)).toBe(items.reduce((n, i) => n + i.minutes, 0));
  });

  it("links follow-ups to a People contact that mentions the company", () => {
    const people = [contact({ id: "other", notes: "Acme Corp alum? no" , name: "Zed" }), contact({ id: "rec", notes: "Recruiter at Bluebird Health" })];
    const items = run(snap([app({ company: "Bluebird Health", appliedDate: "2026-11-01" })]), [], people);
    expect(items[0]!.contactId).toBe("rec");
    const href = composerHref(items[0]!)!;
    expect(href.startsWith("/people?to=rec&via=email&about=")).toBe(true);
    expect(href.endsWith("#compose")).toBe(true);
    expect(new URLSearchParams(href.split("?")[1]!.split("#")[0]).get("about")).toBe("Follow up on my application at Bluebird Health");
    expect(composerHref({ ...items[0]!, contactId: undefined })).toBeNull();
    expect(composeAbout({ kind: "thank-you", company: "Acme", title: "x" })).toBe("Thank you for the interview at Acme");
    expect(contactForCompany("Nobody", people)).toBeUndefined();
    expect(contactForCompany("", people)).toBeUndefined();
  });

  it("works on the demo seed", () => {
    const s = seedState(NOW);
    const items = run(demoSnapshot(NOW), [], s.contacts);
    expect(items.some((i) => i.kind === "prep" && i.company === "Northwind Labs")).toBe(true);
    expect(items.some((i) => i.kind === "due" && i.company === "Halcyon AI")).toBe(true);
  });
});

describe("career helpers", () => {
  it("parses round numbers", () => {
    expect(roundNumber("Interview 3")).toBe(3);
    expect(roundNumber("Final")).toBe(1);
    expect(roundNumber("Round 0")).toBe(1);
  });
  it("builds checklists and drafts", () => {
    expect(prepChecklist({ company: "A", role: "R", round: "Interview 1", meetingLink: "" }).at(-1)).toMatch(/Confirm/);
    expect(prepChecklist({ company: "A", role: "R", round: "Interview 2", meetingLink: "x" }).some((c) => /demo/.test(c))).toBe(true);
    expect(followUpDraft({ company: "A", role: "R", appliedDate: "2026-11-01T00:00:00Z" }, "T").body).toContain("2026-11-01");
    expect(thankYouDraft({ company: "A", role: "R", round: "Interview 1" }, "T").body).toContain("A");
  });
});

// ---- weekly review ----

const toLocal = (iso: string) => localDate(new Date(iso), TZ);
const task = (t: Partial<Task>): Task => ({
  id: t.id ?? Math.random().toString(36).slice(2),
  title: "t",
  notes: "",
  status: "todo",
  priority: "medium",
  area: "work",
  day: null,
  startTime: null,
  estimateMin: 30,
  energy: "shallow",
  recurrence: "none",
  createdAt: "2026-11-01T00:00:00Z",
  completedAt: null,
  ...t,
});
const led = (at: string, minutesSaved: number): LedgerEntry => ({ id: at, at, agent: "chief-of-staff", activity: "x", minutesSaved });

describe("weekly review", () => {
  const base = { today: TODAY, toLocal, ledger: [] as LedgerEntry[], tasks: [] as Task[], contacts: [] as Contact[], snapshot: null };

  it("computes a 7-day time-saved trend in local days", () => {
    const r = weeklyReview({
      ...base,
      ledger: [
        led("2026-11-11T16:00:00Z", 20),
        led("2026-11-05T18:00:00Z", 10), // first day of window
        led("2026-11-05T03:00:00Z", 15), // still Nov 4 in Denver: previous window
        led("2026-10-29T18:00:00Z", 30), // previous window
        led("2026-10-20T18:00:00Z", 99), // ignored
      ],
    });
    expect(r.timeSaved.current).toBe(30);
    expect(r.timeSaved.previous).toBe(45);
    expect(r.timeSaved.delta).toBe(-15);
    expect(r.timeSaved.daily).toHaveLength(7);
    expect(r.timeSaved.daily[0]).toEqual({ day: "2026-11-05", minutes: 10 });
    expect(r.timeSaved.daily[6]).toEqual({ day: TODAY, minutes: 20 });
  });

  it("counts planned vs completed, overdue debt and keep-in-touch debt", () => {
    const r = weeklyReview({
      ...base,
      tasks: [
        task({ day: "2026-11-10", status: "done", estimateMin: 60 }),
        task({ day: "2026-11-11", estimateMin: 30 }), // today, still open: not counted yet
        task({ day: "2026-11-11", estimateMin: 15, status: "done" }),
        task({ day: "2026-11-09", title: "Old", estimateMin: 20 }),
        task({ day: "2026-11-01", title: "Older", estimateMin: 10 }),
        task({ day: null }),
        task({ day: "2026-11-20" }),
      ],
      contacts: [
        contact({ id: "a", name: "Ann", cadenceDays: 7, lastContactAt: "2026-11-01T00:00:00Z" }),
        contact({ id: "b", name: "Bo", cadenceDays: 30, lastContactAt: "2026-11-01T00:00:00Z" }),
        contact({ id: "c", name: "Cy", birthday: "11-12" }),
      ],
    });
    expect(r.tasks).toEqual({ planned: 3, completed: 2, rate: 67, plannedMin: 95, completedMin: 75 });
    expect(r.overdue.count).toBe(2);
    expect(r.overdue.minutes).toBe(30);
    expect(r.overdue.oldestDays).toBe(10);
    expect(r.overdue.titles[0]).toBe("Older");
    expect(r.keepInTouch).toEqual({ due: 1, overdueDays: 3, names: ["Ann"] });
    expect(r.pipeline).toBeNull();
  });

  it("measures pipeline velocity", () => {
    const r = weeklyReview({
      ...base,
      snapshot: snap([
        app({ appliedDate: "2026-11-10" }),
        app({ appliedDate: "2026-11-01" }),
        app({ appliedDate: "2026-11-02", stage: "Interview 1", stageUpdatedAt: "2026-11-09T17:00:00Z" }),
        app({ appliedDate: "2026-10-01", stage: "Rejected", stageUpdatedAt: "2026-10-20T17:00:00Z" }),
        app({ appliedDate: "", stage: "Draft" }),
      ]),
    });
    expect(r.pipeline).toEqual({
      appliedThisWeek: 1,
      appliedLastWeek: 2,
      movedThisWeek: 1,
      active: 3,
      responseRate: 50,
      awaitingReply: 2,
      avgDaysWaiting: 6,
    });
  });
});

describe("recommendations", () => {
  const empty: WeeklyReview = {
    weekOf: "2026-11-09",
    timeSaved: { current: 100, previous: 50, delta: 50, daily: [] },
    tasks: { planned: 0, completed: 0, rate: 0, plannedMin: 0, completedMin: 0 },
    overdue: { count: 0, minutes: 0, oldestDays: 0, titles: [] },
    keepInTouch: { due: 0, overdueDays: 0, names: [] },
    pipeline: null,
  };

  it("always returns exactly three, falling back to habits", () => {
    const recs = recommendations(empty);
    expect(recs).toHaveLength(3);
    expect(recs.map((r) => r.id)).toEqual(["weekly-reset", "batch-messages", "deep-block"]);
  });

  it("prioritizes big overdue debt and over-planning", () => {
    const recs = recommendations({
      ...empty,
      overdue: { count: 6, minutes: 180, oldestDays: 9, titles: ["a", "b", "c"] },
      tasks: { planned: 10, completed: 3, rate: 30, plannedMin: 600, completedMin: 200 },
      keepInTouch: { due: 1, overdueDays: 2, names: ["Ann"] },
    });
    expect(recs.map((r) => r.id)).toEqual(["overdue", "overplanned", "keep-in-touch"]);
    expect(recs[1]!.detail).toContain("45 min of tasks per weekday");
  });

  it("drives the job hunt when applications lag", () => {
    const recs = recommendations({
      ...empty,
      pipeline: { appliedThisWeek: 1, appliedLastWeek: 3, movedThisWeek: 0, active: 6, responseRate: 10, awaitingReply: 4, avgDaysWaiting: 12 },
    });
    expect(recs.map((r) => r.id)).toEqual(["apply-cadence", "follow-ups", "response-rate"]);
    expect(recs.find((r) => r.id === "apply-cadence")!.title).toContain("4 more roles");
  });

  it("flags a drop in time saved and small overdue lists", () => {
    const recs = recommendations({
      ...empty,
      timeSaved: { current: 20, previous: 80, delta: -60, daily: [] },
      overdue: { count: 1, minutes: 10, oldestDays: 1, titles: ["x"] },
    });
    expect(recs.map((r) => r.id)).toEqual(["time-saved-drop", "overdue-small", "weekly-reset"]);
    expect(recs[1]!.title).toBe("Reschedule 1 overdue task");
  });

  it("works on the demo seed end to end", () => {
    const s = seedState(NOW);
    const r = weeklyReview({ today: TODAY, toLocal, ledger: s.ledger, tasks: s.tasks, contacts: s.contacts, snapshot: demoSnapshot(NOW) });
    expect(r.pipeline).not.toBeNull();
    expect(recommendations(r)).toHaveLength(3);
  });
});
