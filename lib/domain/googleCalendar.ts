// Google Calendar, read the way Google shows it (24 Nov 2026). The adapter
// (lib/integrations/googleCalendar.ts) fetches your calendar list and each shown calendar's
// events; this file turns Google's JSON into Atlas's CalendarEvent, colors included. Pure.
//
//   EVENT_COLORS   Google's eleven event colors, as its own screen shows them
//   eventColor     an event's color: its own, else its calendar's
//   textOn         white or dark text, whichever reads on that color
//   toEvents       Google's events for one calendar, as CalendarEvents

import { z } from "zod";
import { zonedToUtc } from "./dates";
import type { CalendarEvent } from "./types";

/**
 * Google Calendar's event colors by colorId, as Google's web and phone apps draw them
 * (Lavender, Sage, Grape, Flamingo, Banana, Tangerine, Peacock, Graphite, Blueberry, Basil,
 * Tomato). The Colors API still returns an older, paler palette for these ids, so Atlas uses
 * the ones you see on screen.
 */
export const EVENT_COLORS: Readonly<Record<string, { name: string; hex: string }>> = {
  "1": { name: "Lavender", hex: "#7986cb" },
  "2": { name: "Sage", hex: "#33b679" },
  "3": { name: "Grape", hex: "#8e24aa" },
  "4": { name: "Flamingo", hex: "#e67c73" },
  "5": { name: "Banana", hex: "#f6bf26" },
  "6": { name: "Tangerine", hex: "#f4511e" },
  "7": { name: "Peacock", hex: "#039be5" },
  "8": { name: "Graphite", hex: "#616161" },
  "9": { name: "Blueberry", hex: "#3f51b5" },
  "10": { name: "Basil", hex: "#0b8043" },
  "11": { name: "Tomato", hex: "#d50000" },
};

/**
 * Google Calendar's 24 calendar colors by colorId: the paler hex the API still returns, and the
 * color Google's own screen draws for it today (Cocoa, Flamingo, Tomato ... Amethyst). A calendar
 * whose backgroundColor is the old hex for its colorId is drawn in the new one; a custom color
 * you picked yourself is used as it is.
 */
export const CALENDAR_COLORS: Readonly<Record<string, { name: string; api: string; hex: string }>> = {
  "1": { name: "Cocoa", api: "#ac725e", hex: "#795548" },
  "2": { name: "Flamingo", api: "#d06b64", hex: "#e67c73" },
  "3": { name: "Tomato", api: "#f83a22", hex: "#d50000" },
  "4": { name: "Tangerine", api: "#fa573c", hex: "#f4511e" },
  "5": { name: "Pumpkin", api: "#ff7537", hex: "#ef6c00" },
  "6": { name: "Mango", api: "#ffad46", hex: "#f09300" },
  "7": { name: "Eucalyptus", api: "#42d692", hex: "#009688" },
  "8": { name: "Basil", api: "#16a765", hex: "#0b8043" },
  "9": { name: "Pistachio", api: "#7bd148", hex: "#7cb342" },
  "10": { name: "Avocado", api: "#b3dc6c", hex: "#c0ca33" },
  "11": { name: "Citron", api: "#fbe983", hex: "#e4c441" },
  "12": { name: "Banana", api: "#fad165", hex: "#f6bf26" },
  "13": { name: "Sage", api: "#92e1c0", hex: "#33b679" },
  "14": { name: "Peacock", api: "#9fe1e7", hex: "#039be5" },
  "15": { name: "Cobalt", api: "#9fc6e7", hex: "#4285f4" },
  "16": { name: "Blueberry", api: "#4986e7", hex: "#3f51b5" },
  "17": { name: "Lavender", api: "#9a9cff", hex: "#7986cb" },
  "18": { name: "Wisteria", api: "#b99aff", hex: "#b39ddb" },
  "19": { name: "Graphite", api: "#c2c2c2", hex: "#616161" },
  "20": { name: "Birch", api: "#cabdbf", hex: "#a79b8e" },
  "21": { name: "Radicchio", api: "#cca6ac", hex: "#ad1457" },
  "22": { name: "Cherry blossom", api: "#f691b2", hex: "#d81b60" },
  "23": { name: "Grape", api: "#cd74e6", hex: "#8e24aa" },
  "24": { name: "Amethyst", api: "#a47ae2", hex: "#9e69af" },
};

/** A calendar's color as Google's screen shows it: the new shade of a palette color, or your own custom color. */
export function calendarColor(colorId: string | undefined, backgroundColor: string | undefined): string | null {
  const bg = safeHex(backgroundColor);
  const palette = colorId ? CALENDAR_COLORS[colorId] : undefined;
  if (palette && (!bg || bg === palette.api)) return palette.hex;
  if (bg) {
    // Some calendars report the old hex without a colorId: match it by value.
    const byHex = Object.values(CALENDAR_COLORS).find((c) => c.api === bg);
    return byHex ? byHex.hex : bg;
  }
  return null;
}

const HEX = /^#[0-9a-f]{6}$/i;

/** A color from Google, only if it is a plain six-digit hex: it goes into a style, so nothing else may. */
export function safeHex(v: unknown): string | null {
  return typeof v === "string" && HEX.test(v) ? v.toLowerCase() : null;
}

/** An event's own color when it has one, else its calendar's. */
export function eventColor(colorId: string | undefined, calendarHex: string | null): string | null {
  return (colorId && EVENT_COLORS[colorId]?.hex) || calendarHex;
}

/** White text or dark text, whichever has more contrast on `hex` (WCAG relative luminance). */
export function textOn(hex: string): "#ffffff" | "#1f1f1f" {
  const c = safeHex(hex);
  if (!c) return "#1f1f1f";
  const lin = (i: number) => {
    const v = parseInt(c.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  // Contrast with white is 1.05 / (l + 0.05); with #1f1f1f (luminance ~0.0137) it is (l + 0.05) / 0.0637.
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0637 ? "#ffffff" : "#1f1f1f";
}

// ---------------------------------------------------------------------------
// Google's JSON, validated (it is external input)

export const GCalCalendar = z.object({
  id: z.string().min(1).max(300),
  summary: z.string().max(300).optional(),
  backgroundColor: z.string().optional(),
  colorId: z.string().max(4).optional(),
  /** Shown in Google Calendar's list (the box is ticked). */
  selected: z.boolean().optional(),
  hidden: z.boolean().optional(),
  primary: z.boolean().optional(),
  accessRole: z.string().optional(),
});
export type GCalCalendar = z.infer<typeof GCalCalendar>;

const When = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dateTime: z.string().optional() });

export const GCalEvent = z.object({
  id: z.string().min(1).max(1100),
  status: z.string().optional(),
  summary: z.string().max(2000).optional(),
  location: z.string().max(2000).optional(),
  colorId: z.string().max(4).optional(),
  transparency: z.string().optional(),
  eventType: z.string().optional(),
  start: When.optional(),
  end: When.optional(),
  attendees: z.array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() })).max(500).optional(),
});
export type GCalEvent = z.infer<typeof GCalEvent>;

/** The calendars Google shows you, primary first: ticked, not hidden. At most `max`. */
export function shownCalendars(list: readonly GCalCalendar[], max = 12): GCalCalendar[] {
  return list
    .filter((c) => c.selected !== false && c.hidden !== true)
    .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)))
    .slice(0, max);
}

/** Kinds Google draws outside the grid or not at all in the day view: the working-location chip and birthday-like extras stay out. */
const SKIP_TYPES = new Set(["workingLocation"]);

/**
 * One calendar's events as CalendarEvents, with the color Google shows. Cancelled events and
 * working-location chips are left out; an event you declined is kept and marked (Google shows
 * it struck through). Anything that does not parse is skipped, never guessed.
 */
export function toEvents(raw: readonly unknown[], calendar: Pick<GCalCalendar, "id" | "backgroundColor" | "colorId">, timeZone: string): CalendarEvent[] {
  const calHex = calendarColor(calendar.colorId, calendar.backgroundColor);
  const out: CalendarEvent[] = [];
  for (const r of raw) {
    const p = GCalEvent.safeParse(r);
    if (!p.success) continue;
    const e = p.data;
    if (e.status === "cancelled" || SKIP_TYPES.has(e.eventType ?? "")) continue;
    const allDay = Boolean(e.start?.date);
    let start: string;
    let end: string;
    if (allDay) {
      if (!e.start?.date) continue;
      start = zonedToUtc(e.start.date, "00:00", timeZone).toISOString();
      end = zonedToUtc(e.end?.date ?? e.start.date, "00:00", timeZone).toISOString();
    } else {
      const s = Date.parse(e.start?.dateTime ?? "");
      const en = Date.parse(e.end?.dateTime ?? "");
      if (Number.isNaN(s) || Number.isNaN(en) || en < s) continue;
      start = new Date(s).toISOString();
      end = new Date(en).toISOString();
    }
    const color = eventColor(e.colorId, calHex);
    const declined = e.attendees?.some((a) => a.self && a.responseStatus === "declined") ?? false;
    out.push({
      id: `g:${calendar.id.slice(0, 60)}:${e.id.slice(0, 120)}`,
      title: (e.summary ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || "(No title)",
      start,
      end,
      allDay,
      location: (e.location ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      source: "calendar",
      ...(e.transparency === "transparent" ? { free: true } : {}),
      ...(color ? { color } : {}),
      ...(declined ? { declined: true } : {}),
    });
  }
  return out;
}

/** The same event on two calendars (an invite you were sent on a shared calendar too) shows once, the first calendar's copy. */
export function dedupe(events: readonly CalendarEvent[]): CalendarEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => {
    const k = `${e.title.toLowerCase()}|${e.start}|${e.end}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
