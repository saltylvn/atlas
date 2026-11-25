import { describe, expect, it } from "vitest";
import { freeSlots } from "@/lib/domain/schedule";
import { CALENDAR_COLORS, calendarColor, dedupe, EVENT_COLORS, eventColor, safeHex, shownCalendars, textOn, toEvents } from "@/lib/domain/googleCalendar";

const TZ = "America/Denver";
const cal = { id: "me@example.com", backgroundColor: "#039BE5" };

describe("colors", () => {
  it("uses the event's own color, else its calendar's", () => {
    expect(eventColor("11", "#039be5")).toBe(EVENT_COLORS["11"]!.hex);
    expect(eventColor(undefined, "#039be5")).toBe("#039be5");
    expect(eventColor("99", "#039be5")).toBe("#039be5");
    expect(eventColor(undefined, null)).toBeNull();
  });
  it("keeps only plain six-digit hex colors, since they go into a style", () => {
    expect(safeHex("#039BE5")).toBe("#039be5");
    for (const bad of ["red", "#fff", "#039be5; background:url(x)", "url(#a)", 12, null]) expect(safeHex(bad)).toBeNull();
  });
  it("picks the text color that reads on each event color", () => {
    expect(textOn("#d50000")).toBe("#ffffff"); // Tomato
    expect(textOn("#3f51b5")).toBe("#ffffff"); // Blueberry
    expect(textOn("#f6bf26")).toBe("#1f1f1f"); // Banana
    expect(textOn("not a color")).toBe("#1f1f1f");
  });
  it("has Google's eleven event colors", () => {
    expect(Object.keys(EVENT_COLORS)).toHaveLength(11);
    expect(Object.values(EVENT_COLORS).every((c) => safeHex(c.hex))).toBe(true);
  });
});

describe("toEvents", () => {
  it("turns a timed event into a CalendarEvent with its calendar's color", () => {
    const [e] = toEvents([{ id: "a1", summary: "  Standup  ", location: "Zoom", start: { dateTime: "2026-11-24T09:00:00-07:00" }, end: { dateTime: "2026-11-24T09:15:00-07:00" } }], cal, TZ);
    expect(e).toMatchObject({ title: "Standup", location: "Zoom", allDay: false, start: "2026-11-24T16:00:00.000Z", end: "2026-11-24T16:15:00.000Z", color: "#039be5", source: "calendar" });
    expect(e!.id.startsWith("g:")).toBe(true);
  });
  it("takes an event's own color over its calendar's", () => {
    const [e] = toEvents([{ id: "a2", summary: "Interview", colorId: "6", start: { dateTime: "2026-11-24T16:00:00Z" }, end: { dateTime: "2026-11-24T17:00:00Z" } }], cal, TZ);
    expect(e!.color).toBe(EVENT_COLORS["6"]!.hex);
  });
  it("reads all-day events at local midnight, with an end that is not included", () => {
    const [e] = toEvents([{ id: "a3", summary: "Holiday", start: { date: "2026-11-26" }, end: { date: "2026-11-27" } }], cal, TZ);
    expect(e).toMatchObject({ allDay: true, start: "2026-11-26T07:00:00.000Z", end: "2026-11-27T07:00:00.000Z" });
  });
  it("leaves out cancelled events, working-location chips and anything malformed", () => {
    const out = toEvents(
      [
        { id: "c", status: "cancelled", start: { dateTime: "2026-11-24T16:00:00Z" }, end: { dateTime: "2026-11-24T17:00:00Z" } },
        { id: "w", eventType: "workingLocation", start: { date: "2026-11-24" }, end: { date: "2026-11-25" } },
        { id: "x", start: { dateTime: "nope" }, end: { dateTime: "2026-11-24T17:00:00Z" } },
        { id: "y", start: { dateTime: "2026-11-24T17:00:00Z" }, end: { dateTime: "2026-11-24T16:00:00Z" } },
        { summary: "no id" },
        "not an object",
      ],
      cal,
      TZ,
    );
    expect(out).toEqual([]);
  });
  it("marks free time and events you declined, and names untitled ones", () => {
    const out = toEvents(
      [
        { id: "f", transparency: "transparent", start: { dateTime: "2026-11-24T16:00:00Z" }, end: { dateTime: "2026-11-24T17:00:00Z" } },
        { id: "d", summary: "Party", attendees: [{ self: true, responseStatus: "declined" }], start: { dateTime: "2026-11-24T18:00:00Z" }, end: { dateTime: "2026-11-24T19:00:00Z" } },
      ],
      cal,
      TZ,
    );
    expect(out.map((e) => [e.title, e.free ?? false, e.declined ?? false])).toEqual([
      ["(No title)", true, false],
      ["Party", false, true],
    ]);
  });
  it("never lets a bad calendar color through", () => {
    const [e] = toEvents([{ id: "z", start: { dateTime: "2026-11-24T16:00:00Z" }, end: { dateTime: "2026-11-24T17:00:00Z" } }], { id: "x", backgroundColor: "red;}" }, TZ);
    expect(e!.color).toBeUndefined();
  });
});

describe("calendars", () => {
  it("shows the calendars Google shows, primary first", () => {
    const list = [
      { id: "b", selected: true },
      { id: "hidden", selected: true, hidden: true },
      { id: "unticked", selected: false },
      { id: "me", primary: true, selected: true },
    ];
    expect(shownCalendars(list).map((c) => c.id)).toEqual(["me", "b"]);
  });
  it("shows an event on two calendars once", () => {
    const e = { id: "1", title: "Sync", start: "2026-11-24T16:00:00.000Z", end: "2026-11-24T17:00:00.000Z", allDay: false, location: "", source: "calendar" as const };
    expect(dedupe([e, { ...e, id: "2", title: "sync" }])).toHaveLength(1);
  });
});

describe("declined events", () => {
  it("are never busy time", () => {
    const work = { start: 9 * 60, end: 12 * 60, minSlotMin: 15, bufferMin: 0 };
    const meeting = { id: "m", title: "Sync", start: "2026-11-24T16:00:00.000Z", end: "2026-11-24T18:00:00.000Z", allDay: false, location: "", source: "calendar" as const };
    const busy = freeSlots({ day: "2026-11-24", timeZone: TZ, events: [meeting], work, nowMin: null });
    const declined = freeSlots({ day: "2026-11-24", timeZone: TZ, events: [{ ...meeting, declined: true }], work, nowMin: null });
    expect(busy).toEqual([{ start: 11 * 60, end: 12 * 60 }]);
    expect(declined).toEqual([{ start: 9 * 60, end: 12 * 60 }]);
  });
});

describe("calendar colors as Google's screen shows them", () => {
  it("draws a palette color in its current shade, not the paler one the API returns", () => {
    expect(calendarColor("14", "#9fe1e7")).toBe("#039be5"); // Peacock
    expect(calendarColor("8", "#16A765")).toBe("#0b8043"); // Basil
    expect(calendarColor("14", undefined)).toBe("#039be5");
  });
  it("matches the old hex even without a colorId", () => {
    expect(calendarColor(undefined, "#cd74e6")).toBe("#8e24aa"); // Grape
  });
  it("keeps a custom color you picked, and drops anything that is not plain hex", () => {
    expect(calendarColor("14", "#123456")).toBe("#123456");
    expect(calendarColor(undefined, "#123456")).toBe("#123456");
    expect(calendarColor(undefined, "blue")).toBeNull();
    expect(calendarColor("99", undefined)).toBeNull();
  });
  it("has Google's 24 calendar colors, all plain hex", () => {
    expect(Object.keys(CALENDAR_COLORS)).toHaveLength(24);
    expect(Object.values(CALENDAR_COLORS).every((c) => safeHex(c.api) && safeHex(c.hex))).toBe(true);
  });
  it("uses the calendar's screen color for its events", () => {
    const [e] = toEvents([{ id: "p", start: { dateTime: "2026-11-24T16:00:00Z" }, end: { dateTime: "2026-11-24T17:00:00Z" } }], { id: "c", colorId: "14", backgroundColor: "#9fe1e7" }, TZ);
    expect(e!.color).toBe("#039be5");
  });
});
