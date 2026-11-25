// The People tab: your closest people in six categories, four places each, and the three ways
// to reach them (text, schedule a text, invite to an event). Pure: no I/O.
//
// Atlas drafts and reminds; you send. A text opens in Messages with the draft filled in; a
// scheduled text is a reminder (a phone notification from Atlas, and an event in your own
// calendar at the exact time); an invite opens Google Calendar with the person as a guest, and
// you press Save so it comes from you.

import { addDays, daysBetween } from "./dates";
import { PEOPLE_CATEGORIES, type Circle, type Contact, type LocalDate, type PeopleCategory } from "./types";

/** The most places any category has. */
export const SLOTS = 4;

export const CATEGORY: Record<PeopleCategory, { label: string; one: string; cadenceDays: number; circle: Circle; color: string; slots: number }> = {
  spouse: { label: "Spouse", one: "spouse", cadenceDays: 1, circle: "family", color: "var(--c-brown)", slots: 1 },
  family: { label: "Family", one: "family member", cadenceDays: 7, circle: "family", color: "var(--c-brown)", slots: SLOTS },
  friends: { label: "Friends", one: "friend", cadenceDays: 14, circle: "friends", color: "var(--c-green)", slots: SLOTS },
  colleagues: { label: "Work Colleagues", one: "colleague", cadenceDays: 30, circle: "team", color: "var(--c-blue)", slots: SLOTS },
  mentors: { label: "Mentors", one: "mentor", cadenceDays: 30, circle: "network", color: "var(--c-indigo)", slots: SLOTS },
  church: { label: "Church", one: "church friend", cadenceDays: 14, circle: "friends", color: "var(--c-slate)", slots: SLOTS },
};

export type Board = Record<PeopleCategory, (Contact | null)[]>;

/** True when a category has that place: Spouse has one, the others four. */
export const hasPlace = (category: PeopleCategory, slot: number): boolean => Number.isInteger(slot) && slot >= 1 && slot <= CATEGORY[category].slots;

/** Each category's places, in order: the person in each, or null. */
export function board(contacts: readonly Contact[]): Board {
  const out = Object.fromEntries(PEOPLE_CATEGORIES.map((c) => [c, Array<Contact | null>(CATEGORY[c].slots).fill(null)])) as Board;
  for (const c of contacts) {
    if (!c.category || !c.slot || !hasPlace(c.category, c.slot)) continue;
    if (!out[c.category][c.slot - 1]) out[c.category][c.slot - 1] = c;
  }
  return out;
}

/** The first empty place in a category, or null when all are taken. */
export function freeSlot(b: Board, category: PeopleCategory): number | null {
  const at = b[category].findIndex((c) => !c);
  return at < 0 ? null : at + 1;
}

/** Days since you were last in touch, or null when never. */
export const daysSince = (c: Pick<Contact, "lastContactAt">, today: LocalDate): number | null => (c.lastContactAt ? daysBetween(c.lastContactAt.slice(0, 10), today) : null);

/** True when someone placed has gone longer than their cadence (their own, else their category's). */
export function overdue(c: Pick<Contact, "lastContactAt" | "cadenceDays" | "category" | "createdAt">, today: LocalDate): boolean {
  const cadence = c.cadenceDays || (c.category ? CATEGORY[c.category].cadenceDays : 0);
  if (!cadence) return false;
  const since = c.lastContactAt ? c.lastContactAt.slice(0, 10) : c.createdAt.slice(0, 10);
  return daysBetween(since, today) > cadence;
}

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** People whose name matches what you type, best first: first-name starts, then any word, then anywhere. At most `limit`. */
export function searchPeople<T extends Pick<Contact, "id" | "name">>(contacts: readonly T[], query: string, limit = 8): T[] {
  const q = words(query);
  if (!q) return [];
  const rank = (c: T) => {
    const n = words(c.name);
    if (n.startsWith(q)) return 0;
    if (n.split(" ").some((w) => w.startsWith(q))) return 1;
    return n.includes(q) ? 2 : 3;
  };
  return contacts.filter((c) => rank(c) < 3).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// From your phone (an iPhone Shortcut posts the contact you pick)

/** A phone number as a form may take it: digits, spaces, + ( ) -, 7 to 20 long. Anything else is dropped. */
export function cleanPhone(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/[^\d+() -]/g, "").replace(/\s+/g, " ").trim();
  return /^\+?[0-9 ()-]{7,20}$/.test(s) ? s : null;
}

export function cleanEmail(raw: unknown): string | null {
  const s = String(raw ?? "").trim().toLowerCase();
  return s.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? s : null;
}

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);

/** The contact already in Atlas that a phone contact is: same phone (last ten digits), else same email, else same name. */
export function sameContact<T extends Pick<Contact, "name" | "phone" | "email">>(contacts: readonly T[], incoming: { name: string; phone: string | null; email: string | null }): T | null {
  const d = digits(incoming.phone);
  return (
    (d.length >= 7 ? contacts.find((c) => digits(c.phone) === d) : undefined) ??
    (incoming.email ? contacts.find((c) => (c.email ?? "").toLowerCase() === incoming.email) : undefined) ??
    contacts.find((c) => words(c.name) === words(incoming.name)) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Scheduling and invites, in your own calendar

const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-11-21" and "18:30" as Google Calendar's local time, "20261121T183000". */
const calTime = (day: LocalDate, hhmm: string) => `${day.replace(/-/g, "")}T${hhmm.replace(":", "")}00`;

function addMinutes(day: LocalDate, hhmm: string, minutes: number): { day: LocalDate; time: string } {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  const days = Math.floor(total / 1440);
  const rest = ((total % 1440) + 1440) % 1440;
  return { day: addDays(day, days), time: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}` };
}

export interface CalendarEvent {
  title: string;
  day: LocalDate;
  /** "HH:MM", your local time. */
  time: string;
  minutes: number;
  place?: string;
  details?: string;
  /** Guests' emails. */
  guests?: string[];
  /** Your time zone, e.g. "America/Denver". */
  timezone: string;
}

/**
 * A Google Calendar "new event" link with everything filled in. Opening it shows the event in
 * your own calendar; nothing is created or sent until you press Save there.
 */
export function calendarLink(e: CalendarEvent): string {
  const end = addMinutes(e.day, e.time, Math.max(5, Math.min(e.minutes, 24 * 60)));
  const p = new URLSearchParams({ action: "TEMPLATE", text: e.title.slice(0, 200), dates: `${calTime(e.day, e.time)}/${calTime(end.day, end.time)}`, ctz: e.timezone });
  if (e.place) p.set("location", e.place.slice(0, 300));
  if (e.details) p.set("details", e.details.slice(0, 1500));
  const guests = (e.guests ?? []).map(cleanEmail).filter(Boolean);
  if (guests.length) p.set("add", guests.join(","));
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

/** The reminder for a scheduled text, as an event in your calendar at the exact time. */
export function textReminderLink(name: string, body: string, when: { day: LocalDate; time: string }, timezone: string, atlasUrl: string): string {
  return calendarLink({ title: `Text ${name}`, day: when.day, time: when.time, minutes: 10, timezone, details: `Your draft:\n${body}\n\nOpen it in Atlas to send: ${atlasUrl}` });
}

/** Scheduled texts whose time has come and whose reminder has not gone out. */
export function remindersDue<T extends { remindAt?: string | null; remindedAt?: string | null; status: string }>(messages: readonly T[], now: Date): T[] {
  return messages.filter((m) => m.status === "draft" && m.remindAt && !m.remindedAt && Date.parse(m.remindAt) <= now.getTime());
}

// ---------------------------------------------------------------------------
// Importing your whole contact list (the "Import contacts to Atlas" Shortcut)

/** The most contacts one import takes. */
export const PHONEBOOK_MAX = 2000;

export interface PhonebookEntry {
  name: string;
  phone: string | null;
  email: string | null;
}

export type NewContact = Omit<Contact, "id" | "createdAt">;

export interface ImportPlan {
  create: NewContact[];
  /** People already in Atlas who gain a phone or email they lacked. */
  update: { id: string; patch: Partial<Pick<Contact, "phone" | "email">> }[];
  /** Already in Atlas with nothing new, repeated in the list, or without a usable name. */
  skipped: number;
}

/**
 * What an import changes. Someone already in Atlas (same phone, email or name) only gains a
 * phone or email they lacked: their name, place and notes are never touched. Everyone else is
 * added unplaced, marked as from the phonebook, with no cadence, so nothing nags about them.
 * The same person twice in the list counts once. Idempotent: importing again adds nobody.
 */
export function planImport(existing: readonly Contact[], incoming: readonly PhonebookEntry[]): ImportPlan {
  const plan: ImportPlan = { create: [], update: [], skipped: 0 };
  const seen: PhonebookEntry[] = [];
  const updated = new Map<string, ImportPlan["update"][number]>();
  for (const raw of incoming.slice(0, PHONEBOOK_MAX)) {
    const name = raw.name.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!/[\p{L}\p{N}]/u.test(name)) {
      plan.skipped++;
      continue;
    }
    const entry = { name, phone: cleanPhone(raw.phone), email: cleanEmail(raw.email) };
    if (sameContact(seen, entry)) {
      plan.skipped++;
      continue;
    }
    seen.push(entry);
    const known = sameContact(existing, entry);
    if (known) {
      const patch = { ...(entry.phone && !known.phone ? { phone: entry.phone } : {}), ...(entry.email && !known.email ? { email: entry.email } : {}) };
      if (Object.keys(patch).length && !updated.has(known.id)) updated.set(known.id, { id: known.id, patch });
      else plan.skipped++;
      continue;
    }
    plan.create.push({ name, circle: "network", email: entry.email, phone: entry.phone, cadenceDays: 0, lastContactAt: null, birthday: null, notes: "", category: null, slot: null, phonebook: true });
  }
  plan.update = [...updated.values()];
  return plan;
}

/** Shown in your lists and reminders: everyone except phonebook imports you have not placed. */
export const inYourLists = (c: Pick<Contact, "phonebook" | "category">): boolean => !c.phonebook || Boolean(c.category);

