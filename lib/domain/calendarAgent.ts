// The Calendar Agent (build step 2). Pure: the runner (lib/agents/calendar.ts) fetches
// the calendar and passes everything in, so the scheduled run, Run Now, Today's live
// preview and the tests all use this same code.
//
// Read-only. It reviews every Google Calendar event from today through the end of the
// brief's window, flags conflicts, marks the events that matter (appointments and job
// interviews), and links interviews to your tracked applications. An interview that
// is not on the calendar becomes a "needs approval" item with a prefilled Google
// Calendar link: nothing is added until you save it there yourself.

import { localDate, localTime, shortDate } from "./dates";
import type { StandardReport } from "./chiefOfStaff";
import type { BriefSlot, CalendarEvent, TrackedInterview, CareerSnapshot, LocalDate } from "./types";

export type ImportantKind = "interview" | "appointment";

export interface BriefEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  source: CalendarEvent["source"];
  /** Set when the Calendar Agent marks the event as one to keep top of mind. */
  important?: ImportantKind;
}

export interface ImportantEvent {
  day: LocalDate;
  title: string;
  start: string;
  allDay: boolean;
  kind: ImportantKind;
}

export interface InterviewNote {
  company: string;
  role: string;
  round: string;
  start: string;
  end: string;
  /** The job description link from the application (https only, else empty). */
  link: string;
  meetingLink: string;
  /** True when a Google Calendar event already covers this interview. */
  onCalendar: boolean;
  /** Prefilled Google Calendar link for an interview that is not on the calendar yet. */
  addUrl: string;
  /** Prep notes the Chief of Staff gets from the Career Agent. Empty until it does. */
  prep?: string[];
}

export interface CalendarSection {
  today: BriefEvent[];
  ahead: { day: LocalDate; events: BriefEvent[] }[];
  conflicts: string[];
  /** Added in build step 2; briefs saved before then do not have these. */
  important?: ImportantEvent[];
  interviews?: InterviewNote[];
}

export type CalendarStatus = "ok" | "not_configured" | "error";

/** A tracked interview with its application's job description link. */
export type CalendarInterview = TrackedInterview & { postingUrl: string };

/** What the Chief of Staff passes the Calendar Agent from the career tracker: interviews only. */
export function interviewsFrom(snapshot: CareerSnapshot | null): CalendarInterview[] {
  if (!snapshot) return [];
  const links = new Map(snapshot.applications.map((a) => [a.applicationId, a.postingUrl]));
  return snapshot.interviews.map((i) => ({ ...i, postingUrl: links.get(i.applicationId) ?? "" }));
}

export interface CalendarAgentInput {
  slot: BriefSlot;
  forDate: LocalDate;
  /** Last day of the window (inclusive): tomorrow on Saturday, else the week ahead. */
  aheadUntil: LocalDate;
  timeZone: string;
  /** Events from Google Calendar for the window. */
  events: CalendarEvent[];
  status: CalendarStatus;
  /** The career tracker's interviews, passed in by the Chief of Staff. */
  interviews: CalendarInterview[];
}

export interface CalendarAgentResult {
  status: CalendarStatus;
  /** Null when no calendar is connected. */
  section: CalendarSection | null;
  report: StandardReport;
}

// ---------------------------------------------------------------------------
// Classification

const INTERVIEW = /\b(interview|phone screen|tech(nical)? screen|recruiter (call|chat|screen)|hiring manager)\b/i;
const APPOINTMENT =
  /\b(appt|appointment|doctor|dr\.?(?!\s*pepper)|dentist|dental|orthodontist|clinic|hospital|urgent care|therapy|therapist|chiropractor|optometrist|eye exam|dermatologist|pediatrician|vet|veterinarian|check-?up|physical|lab work|blood work|surgery|haircut|barber|dmv|court date|jury duty|notary)\b/i;

/** Rules-based tagging: no model call, so the Calendar Agent costs nothing to run. */
export function classifyEvent(title: string): ImportantKind | null {
  if (INTERVIEW.test(title)) return "interview";
  if (APPOINTMENT.test(title)) return "appointment";
  return null;
}

// ---------------------------------------------------------------------------
// Conflicts

/** Timed, busy events that overlap. Events marked "Free" in Google Calendar never conflict. */
export function findConflicts(events: CalendarEvent[], timeZone: string): string[] {
  const timed = events.filter((e) => !e.allDay && !e.free && !e.declined).sort((a, b) => a.start.localeCompare(b.start));
  const out: string[] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i]!;
      const b = timed[j]!;
      if (Date.parse(b.start) >= Date.parse(a.end)) break;
      const day = localDate(new Date(a.start), timeZone);
      out.push(`${day}: “${a.title}” (${localTime(new Date(a.start), timeZone)}) overlaps “${b.title}” (${localTime(new Date(b.start), timeZone)})`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Interviews

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const HALF_HOUR = 30 * 60_000;

/** Only https links are ever rendered or passed on. */
export function httpsOnly(url: string): string {
  try {
    return new URL(url).protocol === "https:" ? url : "";
  } catch {
    return "";
  }
}

function span(iv: Pick<TrackedInterview, "start" | "end">): [number, number] {
  const s = Date.parse(iv.start);
  const e = Date.parse(iv.end);
  return [s, Number.isFinite(e) && e > s ? e : s + HALF_HOUR];
}

/** The calendar event that covers a tracked interview: overlapping in time and naming the company, or titled as an interview. */
export function matchInterview(iv: TrackedInterview, events: CalendarEvent[]): CalendarEvent | undefined {
  const [s, e] = span(iv);
  const company = norm(iv.company);
  return events.find((ev) => {
    if (ev.allDay || ev.source !== "calendar") return false;
    const overlaps = Date.parse(ev.start) < e && Date.parse(ev.end) > s;
    if (!overlaps) return false;
    return (company !== "" && ` ${norm(ev.title)} `.includes(` ${company} `)) || classifyEvent(ev.title) === "interview";
  });
}

/** Google Calendar's own "create event" form, prefilled. Saving it there is the approval. */
export function googleCalendarAddUrl(e: { title: string; start: string; end: string; details: string; location: string }): string {
  const stamp = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${stamp(e.start)}/${stamp(e.end)}`, details: e.details, location: e.location });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// The report

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function calendarAgentReport(input: CalendarAgentInput): CalendarAgentResult {
  const { forDate, aheadUntil, timeZone: tz, status } = input;
  const light = input.slot === "saturday";
  const dayOf = (e: Pick<CalendarEvent, "start" | "allDay">) => (e.allDay ? e.start.slice(0, 10) : localDate(new Date(e.start), tz));
  const inWindow = (day: LocalDate) => day >= forDate && day <= aheadUntil;
  const errors = status === "error" ? ["Calendar could not be read. Check the CALENDAR_ICS_URL setting."] : [];

  if (status === "not_configured") {
    return {
      status,
      section: null,
      report: { agent: "calendar", headline: "No calendar connected yet.", details: [], needsApproval: [], errors: [] },
    };
  }

  // Google Calendar events in the window, plus tracked interviews matched against them.
  const events = input.events.filter((e) => e.source === "calendar" && inWindow(dayOf(e)));
  const interviews = input.interviews
    .filter((i) => i.start && Number.isFinite(Date.parse(i.start)) && !/^cancel/i.test(i.status) && inWindow(localDate(new Date(i.start), tz)))
    .sort((a, b) => a.start.localeCompare(b.start));

  const matched = new Map<string, CalendarInterview>();
  const notes: InterviewNote[] = [];
  const extra: (CalendarEvent & { important: ImportantKind })[] = [];
  for (const iv of interviews) {
    const hit = matchInterview(iv, events);
    const [s, e] = span(iv);
    const start = new Date(s).toISOString();
    const end = new Date(e).toISOString();
    const title = `Interview: ${iv.company} (${iv.round})`;
    const link = httpsOnly(iv.postingUrl);
    const meetingLink = httpsOnly(iv.meetingLink);
    if (hit) matched.set(hit.id, iv);
    else extra.push({ id: `iv:${iv.interviewId}`, title, start, end, allDay: false, location: meetingLink, source: "interview", important: "interview" });
    notes.push({
      company: iv.company,
      role: iv.role,
      round: iv.round,
      start,
      end,
      link,
      meetingLink,
      onCalendar: Boolean(hit),
      addUrl: hit ? "" : googleCalendarAddUrl({ title, start, end, details: [iv.role, link].filter(Boolean).join("\n"), location: meetingLink }),
    });
  }

  const all = [
    ...events.map((e) => ({ ...e, important: matched.has(e.id) ? ("interview" as const) : (classifyEvent(e.title) ?? undefined) })),
    ...extra,
  ].sort((a, b) => a.start.localeCompare(b.start));

  const byDay = new Map<LocalDate, BriefEvent[]>();
  for (const e of all) {
    const day = dayOf(e);
    const brief: BriefEvent = { title: e.title, start: e.start, end: e.end, allDay: e.allDay, source: e.source, ...(e.important ? { important: e.important } : {}) };
    byDay.set(day, [...(byDay.get(day) ?? []), brief]);
  }

  const conflicts = findConflicts(all, tz);
  const important: ImportantEvent[] = all.filter((e) => e.important).map((e) => ({ day: dayOf(e), title: e.title, start: e.start, allDay: e.allDay, kind: e.important! }));
  const section: CalendarSection = {
    today: byDay.get(forDate) ?? [],
    ahead: [...byDay.entries()].filter(([d]) => d !== forDate).map(([day, evs]) => ({ day, events: evs })),
    conflicts,
    important,
    interviews: notes,
  };

  const dayLabel = (day: LocalDate) => (day === forDate ? "Today" : shortDate(day));
  const at = (e: { start: string; allDay: boolean }) => (e.allDay ? "all day" : localTime(new Date(e.start), tz));
  const aheadCount = section.ahead.reduce((n, d) => n + d.events.length, 0);
  const parts = [`${plural(section.today.length, "event")} today`, `${aheadCount} ${light ? "tomorrow" : "the rest of the week"}`];
  if (conflicts.length) parts.push(plural(conflicts.length, "conflict"));
  if (notes.length) parts.push(plural(notes.length, "interview"));

  return {
    status,
    section,
    report: {
      agent: "calendar",
      headline: status === "error" && all.length === 0 ? "Calendar could not be read." : `${parts.join(", ")}.`,
      details: [
        ...important.map((e) => `${e.kind === "interview" ? "Interview" : "Appointment"} · ${dayLabel(e.day)} ${at(e)} · ${e.title}`),
        ...conflicts.map((c) => `Conflict: ${c}`),
      ],
      needsApproval: notes.filter((n) => !n.onCalendar).map((n) => `Add to calendar: ${n.company} ${n.round}, ${dayLabel(localDate(new Date(n.start), tz))} ${localTime(new Date(n.start), tz)}`),
      errors,
    },
  };
}
