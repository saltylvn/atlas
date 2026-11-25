import { classifyEvent, findConflicts } from "@/lib/domain/calendarAgent";
import { eventsBetween } from "@/lib/integrations/ical";
import type { EvalCase, EvalSuite } from "../types";

const TZ = "America/Denver";

/** [event title, expected: interview, appointment or routine] */
const TITLES: [string, string][] = [
  ["Interview with Acme", "interview"],
  ["Phone screen - Northwind", "interview"],
  ["Recruiter call: Ramp", "interview"],
  ["Hiring manager chat (Halcyon)", "interview"],
  ["Technical screen", "interview"],
  ["Dentist appointment", "appointment"],
  ["Dr. Lee check-up", "appointment"],
  ["Haircut", "appointment"],
  ["Vet - Milo", "appointment"],
  ["DMV", "appointment"],
  ["Physical therapy", "appointment"],
  ["Eye exam", "appointment"],
  ["Standup", "routine"],
  ["Work", "routine"],
  ["Lunch", "routine"],
  ["6am Club", "routine"],
  ["10X My Career", "routine"],
  ["Go for a Walk", "routine"],
  ["Vetting vendors for the kitchen", "routine"],
  ["Pick up Dr Pepper for the party", "routine"],
];

const vevent = (uid: string, summary: string, start: string, end: string, extra: string[] = []) => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  `SUMMARY:${summary}`,
  `DTSTART;TZID=${TZ}:${start}`,
  `DTEND;TZID=${TZ}:${end}`,
  ...extra,
  "END:VEVENT",
];
const ics = (...events: string[][]) => ["BEGIN:VCALENDAR", ...events.flat(), "END:VCALENDAR"].join("\r\n");

/** [what the calendar holds, the calendar, first day, last day, expected number of conflicts] */
const CALENDARS: [string, string, string, string, number][] = [
  ["Two meetings that overlap", ics(vevent("a", "Standup", "20261116T090000", "20261116T100000"), vevent("b", "Dentist", "20261116T093000", "20261116T103000")), "2026-11-16", "2026-11-16", 1],
  ["Back-to-back meetings", ics(vevent("a", "Standup", "20261116T090000", "20261116T093000"), vevent("b", "Planning", "20261116T093000", "20261116T103000")), "2026-11-16", "2026-11-16", 0],
  ["A meeting during a block marked Free", ics(vevent("a", "Focus time", "20261116T090000", "20261116T120000", ["TRANSP:TRANSPARENT"]), vevent("b", "Planning", "20261116T100000", "20261116T110000")), "2026-11-16", "2026-11-16", 0],
  [
    "An all-day event and a meeting",
    ics(["BEGIN:VEVENT", "UID:a", "SUMMARY:Mom's birthday", "DTSTART;VALUE=DATE:20261116", "DTEND;VALUE=DATE:20261117", "END:VEVENT"], vevent("b", "Planning", "20261116T100000", "20261116T110000")),
    "2026-11-16",
    "2026-11-16",
    0,
  ],
  ["A cancelled meeting over another", ics(vevent("a", "Old sync", "20261116T100000", "20261116T110000", ["STATUS:CANCELLED"]), vevent("b", "Planning", "20261116T100000", "20261116T110000")), "2026-11-16", "2026-11-16", 0],
  ["Three meetings that all overlap", ics(vevent("a", "A", "20261116T090000", "20261116T110000"), vevent("b", "B", "20261116T093000", "20261116T110000"), vevent("c", "C", "20261116T100000", "20261116T110000")), "2026-11-16", "2026-11-16", 3],
  ["A daily block and a one-off inside it", ics(vevent("a", "Deep work", "20261102T090000", "20261102T110000", ["RRULE:FREQ=DAILY"]), vevent("b", "Dentist", "20261117T100000", "20261117T103000")), "2026-11-16", "2026-11-18", 1],
  [
    "A daily series ended with 'this and following events'",
    ics(vevent("work", "Work", "20261102T093000", "20261102T163000", ["RRULE:FREQ=DAILY;UNTIL=20261113T162959Z"]), vevent("start", "Start Work", "20261113T093000", "20261113T094500"), vevent("lunch", "Lunch", "20261113T120000", "20261113T123000")),
    "2026-11-13",
    "2026-11-13",
    0,
  ],
  [
    "A weekly series moved 30 minutes with 'this and following events'",
    ics(vevent("old", "10X My Career", "20261104T080000", "20261104T090000", ["RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261118T145959Z"]), vevent("new", "10X My Career", "20261118T083000", "20261118T093000", ["RRULE:FREQ=WEEKLY;BYDAY=WE"])),
    "2026-11-16",
    "2026-11-22",
    0,
  ],
  [
    "One day of a daily meeting moved to a free hour",
    ics(vevent("s", "Standup", "20261116T090000", "20261116T091500", ["RRULE:FREQ=DAILY"]), ["BEGIN:VEVENT", "UID:s", `RECURRENCE-ID;TZID=${TZ}:20261117T090000`, "SUMMARY:Standup", `DTSTART;TZID=${TZ}:20261117T110000`, `DTEND;TZID=${TZ}:20261117T111500`, "END:VEVENT"], vevent("d", "Dentist", "20261117T090000", "20261117T100000")),
    "2026-11-17",
    "2026-11-17",
    0,
  ],
  ["The same event on two calendars", ics(vevent("a", "6am Club", "20261114T060000", "20261114T070000"), vevent("b", "6am Club", "20261114T060000", "20261114T070000")), "2026-11-14", "2026-11-14", 0],
  ["A weekday series with one day deleted", ics(vevent("s", "Standup", "20261116T090000", "20261116T093000", ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", `EXDATE;TZID=${TZ}:20261117T090000`]), vevent("d", "Dentist", "20261117T090000", "20261117T100000")), "2026-11-17", "2026-11-17", 0],
];

const cases: EvalCase[] = [
  ...TITLES.map(([title, expected]): EvalCase => ({
    name: `Kind · ${title}`,
    expected,
    actual: () => classifyEvent(title) ?? "routine",
  })),
  ...CALENDARS.map(([name, feed, from, to, expected]): EvalCase => ({
    name: `Conflicts · ${name}`,
    expected: `${expected} conflict${expected === 1 ? "" : "s"}`,
    actual: () => {
      const n = findConflicts(eventsBetween(feed, from, to, TZ), TZ).length;
      return `${n} conflict${n === 1 ? "" : "s"}`;
    },
  })),
];

export const calendarSuite: EvalSuite = {
  agent: "calendar",
  title: "Reading the calendar",
  what: "Tells interviews and appointments from routine events, and finds real conflicts without inventing them from edited or repeating events.",
  threshold: 0.95,
  cases,
};
