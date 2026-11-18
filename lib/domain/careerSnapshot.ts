// The career tracker's snapshot, built by the Career Agent from Atlas's own data:
//   applications  the Applications board (lib/domain/applications.ts)
//   interviews    interviews on your Google Calendar, matched to those applications
// Do-next, the Hot List, pipeline counts, interview prep, time-blocking and the weekly
// review all read this one shape. Pure: the loader (lib/career.ts) passes everything in.

import { classifyEvent, httpsOnly } from "./calendarAgent";
import type { Application, CalendarEvent, CareerSnapshot, TrackedApplication, TrackedInterview } from "./types";

const STAGE: Record<Application["status"], string> = {
  saved: "Draft",
  applied: "Applied",
  replied: "Reply",
  interview: "Interview 1",
  offer: "Offer",
  rejected: "Rejected",
};

/** "Next: Prep the demo (by 2026-11-18)" in an application's notes -> its next action. */
export function parseNext(notes: string): { nextAction: string; nextActionDue: string } {
  const m = /next:\s*(.+?)(?:\s*\(by\s*(\d{4}-\d{2}-\d{2})\))?\s*$/im.exec(notes);
  return m ? { nextAction: m[1]!.trim().slice(0, 200), nextActionDue: m[2] ?? "" } : { nextAction: "", nextActionDue: "" };
}

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

/** "Acme - Round 2", "Interview 3 with Acme", "Final round: Acme". */
export function roundOf(title: string): string {
  const n = /\b(?:round|interview)\s*#?\s*(\d)\b/i.exec(title);
  if (n) return `Interview ${n[1]}`;
  if (/\bfinal\b/i.test(title)) return "Final round";
  if (/\b(phone|recruiter|intro)\s*(screen|call|chat)\b/i.test(title)) return "Screen";
  return "Interview";
}

/**
 * Interviews from the calendar: timed events titled as an interview, or naming a
 * company you have an open application with. Each is linked to that application.
 */
export function trackedInterviews(apps: Application[], events: CalendarEvent[]): TrackedInterview[] {
  const open = apps.filter((a) => a.status !== "rejected" && a.status !== "saved");
  return events.flatMap((e) => {
    if (e.allDay) return [];
    const title = norm(e.title);
    const app = open.find((a) => norm(a.company).trim().length >= 3 && title.includes(norm(a.company)));
    if (!app && classifyEvent(e.title) !== "interview") return [];
    if (app && classifyEvent(e.title) !== "interview" && app.status !== "interview" && app.status !== "replied") return [];
    const company = app?.company ?? (e.title.replace(/\b(interview|phone screen|technical screen|with|round \d|final)\b/gi, "").replace(/[:|()–-]+/g, " ").replace(/\s+/g, " ").trim() || e.title);
    return [
      {
        interviewId: `cal:${e.id}`,
        applicationId: app?.id ?? "",
        company: company.slice(0, 120),
        role: app?.role ?? "",
        round: roundOf(e.title),
        start: e.start,
        end: e.end,
        status: "Scheduled",
        meetingLink: httpsOnly(e.location),
      },
    ];
  });
}

export function trackedApplication(a: Application, interviews: TrackedInterview[]): TrackedApplication {
  const next = parseNext(a.notes);
  const rounds = interviews.filter((i) => i.applicationId === a.id && /^Interview \d$/.test(i.round)).map((i) => Number(i.round.slice(-1)));
  const stage = a.status === "interview" && rounds.length ? `Interview ${Math.max(...rounds)}` : STAGE[a.status];
  return {
    applicationId: a.id,
    company: a.company,
    role: a.role,
    stage,
    appliedDate: a.appliedOn ?? "",
    stageUpdatedAt: a.statusAt,
    nextAction: next.nextAction,
    nextActionDue: next.nextActionDue,
    postingUrl: a.url,
  };
}

/** Null when there is nothing to track yet (no applications and no interviews). */
export function careerSnapshot(apps: Application[], events: CalendarEvent[], now: Date): CareerSnapshot | null {
  const interviews = trackedInterviews(apps, events);
  if (apps.length === 0 && interviews.length === 0) return null;
  return { generatedAt: now.toISOString(), applications: apps.map((a) => trackedApplication(a, interviews)), interviews };
}
