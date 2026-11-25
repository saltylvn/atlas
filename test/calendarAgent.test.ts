import { describe, expect, it } from "vitest";
import {
  calendarAgentReport,
  classifyEvent,
  findConflicts,
  httpsOnly,
  interviewsFrom,
  type CalendarAgentInput,
  type CalendarInterview,
} from "@/lib/domain/calendarAgent";
import type { CalendarEvent, CareerSnapshot } from "@/lib/domain/types";
import { eventsBetween } from "@/lib/integrations/ical";

// 2026-11-16 is a Monday. Denver is UTC-7 in November, so 16:00Z is 9:00 AM.
const MON = "2026-11-16";
const TZ = "America/Denver";

const ev = (title: string, start: string, end: string, over: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: title, title, start, end, allDay: false, location: "", source: "calendar", ...over });
const iv = (over: Partial<CalendarInterview> = {}): CalendarInterview => ({
  interviewId: "I1",
  applicationId: "A1",
  company: "Acme",
  role: "AI Engineer",
  round: "Interview 2",
  start: "2026-11-18T17:00:00Z",
  end: "2026-11-18T18:00:00Z",
  status: "Confirmed",
  meetingLink: "https://meet.test/acme",
  postingUrl: "https://jobs.test/acme",
  ...over,
});
const run = (over: Partial<CalendarAgentInput> = {}) =>
  calendarAgentReport({ slot: "morning", forDate: MON, aheadUntil: "2026-11-22", timeZone: TZ, events: [], status: "ok", interviews: [], ...over });

describe("Calendar bot: what to keep top of mind", () => {
  it("tags appointments and interviews by title, and leaves ordinary meetings alone", () => {
    expect(classifyEvent("Dentist cleaning")).toBe("appointment");
    expect(classifyEvent("Dr. Patel follow-up")).toBe("appointment");
    expect(classifyEvent("Annual check-up")).toBe("appointment");
    expect(classifyEvent("Phone screen with Acme")).toBe("interview");
    expect(classifyEvent("Interview: Northwind (Round 1)")).toBe("interview");
    expect(classifyEvent("Team standup")).toBeNull();
    expect(classifyEvent("Onsite workshop: Northwind")).toBeNull();
    expect(classifyEvent("Drive kids to practice")).toBeNull();
  });

  it("lists important events across the week with day and time", () => {
    const r = run({ events: [ev("Dentist", "2026-11-19T22:00:00Z", "2026-11-19T23:00:00Z"), ev("Standup", "2026-11-16T16:00:00Z", "2026-11-16T16:15:00Z")] });
    expect(r.section?.important).toEqual([{ day: "2026-11-19", title: "Dentist", start: "2026-11-19T22:00:00Z", allDay: false, kind: "appointment" }]);
    expect(r.report.details).toEqual(["Appointment · Thu, Nov 19 15:00 · Dentist"]);
    expect(r.section?.ahead.find((d) => d.day === "2026-11-19")?.events[0]?.important).toBe("appointment");
  });
});

describe("Calendar bot: interviews", () => {
  it("matches a job-hunt interview to its calendar event: no duplicate, no false conflict, nothing to approve", () => {
    const r = run({ events: [ev("Acme - round 2 with Dana", "2026-11-18T17:00:00Z", "2026-11-18T18:00:00Z")], interviews: [iv()] });
    const wed = r.section?.ahead.find((d) => d.day === "2026-11-18")?.events ?? [];
    expect(wed).toHaveLength(1);
    expect(wed[0]).toMatchObject({ title: "Acme - round 2 with Dana", important: "interview" });
    expect(r.section?.conflicts).toEqual([]);
    expect(r.section?.interviews?.[0]).toMatchObject({ company: "Acme", role: "AI Engineer", onCalendar: true, addUrl: "", link: "https://jobs.test/acme" });
    expect(r.report.needsApproval).toEqual([]);
  });

  it("asks for approval to add an interview that is not on the calendar, with a prefilled Google Calendar link", () => {
    const r = run({ interviews: [iv()] });
    const note = r.section?.interviews?.[0];
    expect(note?.onCalendar).toBe(false);
    const url = new URL(note!.addUrl);
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20261118T170000Z/20261118T180000Z");
    expect(url.searchParams.get("text")).toBe("Interview: Acme (Interview 2)");
    expect(r.report.needsApproval).toEqual(["Add to calendar: Acme Interview 2, Wed, Nov 18 10:00"]);
    // It still shows in the week ahead so it is never missed.
    expect(r.section?.ahead[0]?.events[0]).toMatchObject({ source: "interview", important: "interview" });
    expect(r.report.headline).toContain("1 interview");
  });

  it("flags a real clash between an interview and another event", () => {
    const r = run({ events: [ev("Dentist", "2026-11-18T17:30:00Z", "2026-11-18T18:30:00Z")], interviews: [iv()] });
    expect(r.section?.conflicts).toHaveLength(1);
    expect(r.section?.conflicts[0]).toContain("Dentist");
  });

  it("skips cancelled interviews, ones outside the window, and non-https links", () => {
    const r = run({
      interviews: [
        iv({ interviewId: "C", status: "Cancelled" }),
        iv({ interviewId: "L", start: "2026-12-01T17:00:00Z", end: "2026-12-01T18:00:00Z" }),
        iv({ interviewId: "K", company: "Bolt", postingUrl: "javascript:alert(1)", meetingLink: "http://plain.test" }),
      ],
    });
    expect(r.section?.interviews?.map((i) => i.company)).toEqual(["Bolt"]);
    expect(r.section?.interviews?.[0]).toMatchObject({ link: "", meetingLink: "" });
  });

  it("attaches each interview's job description link from job-hunt", () => {
    const snap = {
      applications: [{ applicationId: "A1", postingUrl: "https://jobs.test/acme" }],
      interviews: [iv({ postingUrl: undefined as unknown as string })],
    } as unknown as CareerSnapshot;
    expect(interviewsFrom(snap)[0]?.postingUrl).toBe("https://jobs.test/acme");
    expect(interviewsFrom(null)).toEqual([]);
  });
});

describe("Calendar bot: conflicts, window and failures", () => {
  it("never counts events marked Free as conflicts", () => {
    const busy = ev("Standup", "2026-11-16T16:00:00Z", "2026-11-16T16:30:00Z");
    expect(findConflicts([busy, ev("Focus time", "2026-11-16T16:00:00Z", "2026-11-16T18:00:00Z", { free: true })], TZ)).toEqual([]);
    expect(findConflicts([busy, ev("Call", "2026-11-16T16:15:00Z", "2026-11-16T16:45:00Z")], TZ)).toHaveLength(1);
  });

  it("covers only today and tomorrow on Saturday", () => {
    const r = run({
      slot: "saturday",
      forDate: "2026-11-21",
      aheadUntil: "2026-11-22",
      events: [ev("Hike", "2026-11-21T16:00:00Z", "2026-11-21T19:00:00Z"), ev("Brunch", "2026-11-22T17:00:00Z", "2026-11-22T18:00:00Z"), ev("Standup", "2026-11-23T16:00:00Z", "2026-11-23T16:15:00Z")],
    });
    expect(r.section?.today.map((e) => e.title)).toEqual(["Hike"]);
    expect(r.section?.ahead.map((d) => d.day)).toEqual(["2026-11-22"]);
    expect(r.report.headline).toBe("1 event today, 1 tomorrow.");
  });

  it("reports a calendar it cannot read as an error, and an unconnected one as no section", () => {
    const bad = run({ status: "error" });
    expect(bad.report.headline).toBe("Calendar could not be read.");
    expect(bad.report.errors[0]).toContain("CALENDAR_ICS_URL");
    expect(run({ status: "not_configured" }).section).toBeNull();
  });

  it("only passes https links on", () => {
    expect(httpsOnly("https://ok.test/x")).toBe("https://ok.test/x");
    expect(httpsOnly("http://ok.test/x")).toBe("");
    expect(httpsOnly("javascript:alert(1)")).toBe("");
    expect(httpsOnly("not a url")).toBe("");
  });

  it("reads Google's Free marker from the iCal feed", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:a",
      "DTSTART:20261116T160000Z",
      "DTEND:20261116T170000Z",
      "SUMMARY:Focus time",
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:b",
      "DTSTART:20261116T163000Z",
      "DTEND:20261116T170000Z",
      "SUMMARY:Call",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const events = eventsBetween(ics, MON, MON, TZ);
    expect(events.find((e) => e.title === "Focus time")?.free).toBe(true);
    expect(events.find((e) => e.title === "Call")?.free).toBeUndefined();
    expect(findConflicts(events, TZ)).toEqual([]);
  });
});
