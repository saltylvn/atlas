import { addDays, weekdayIndex, zonedToUtc } from "@/lib/domain/dates";
import type { CalendarEvent, LocalDate } from "@/lib/domain/types";

// A deliberately small iCalendar reader: enough for a personal "secret iCal address"
// feed. Handles UTC, TZID and all-day DTSTART values, plus DAILY/WEEKLY RRULEs with
// INTERVAL, BYDAY, COUNT, UNTIL and EXDATE, and single-instance edits (RECURRENCE-ID):
// a moved or cancelled instance replaces that occurrence of its series. UNTIL is compared
// as an instant, so a series Google ends with "this and following events" stops before
// the edited occurrence. Anything fancier is skipped, not guessed.

interface Prop {
  value: string;
  params: Record<string, string>;
}

function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
}

function parseLine(line: string): [string, Prop] | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const [name = "", ...paramParts] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const [k, v] = p.split("=");
    if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, "");
  }
  return [name.toUpperCase(), { value: line.slice(colon + 1), params }];
}

const unescape = (s: string) => s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

interface When {
  instant: Date;
  allDay: boolean;
  day: LocalDate;
}

function parseWhen(p: Prop, defaultTz: string): When | null {
  const v = p.value.trim();
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(v);
  if (!m) return null;
  const day = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return { instant: zonedToUtc(day, "00:00", defaultTz), allDay: true, day };
  const hhmm = `${m[4]}:${m[5]}`;
  if (m[7] === "Z") return { instant: new Date(`${day}T${hhmm}:${m[6]}Z`), allDay: false, day };
  return { instant: zonedToUtc(day, hhmm, p.params.TZID ?? defaultTz), allDay: false, day };
}

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

type Props = Map<string, Prop[]>;

/** Events overlapping [from, to] (inclusive local dates). */
export function eventsBetween(ics: string, from: LocalDate, to: LocalDate, timeZone: string): CalendarEvent[] {
  const vevents: Props[] = [];
  let cur: Props | null = null;

  for (const line of unfold(ics)) {
    if (line === "BEGIN:VEVENT") {
      cur = new Map();
      continue;
    }
    if (line === "END:VEVENT" && cur) {
      vevents.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    const [name, prop] = parsed;
    cur.set(name, [...(cur.get(name) ?? []), prop]);
  }

  // Single-instance edits: each names the series (UID) and the occurrence it replaces.
  const replaced = new Map<string, Set<string>>();
  for (const v of vevents) {
    const rid = v.get("RECURRENCE-ID")?.[0];
    if (!rid) continue;
    const when = parseWhen(rid, timeZone);
    if (!when) continue;
    const uid = v.get("UID")?.[0]?.value ?? "";
    replaced.set(uid, (replaced.get(uid) ?? new Set()).add(occurrenceKey(when)));
  }

  const out = vevents.flatMap((v) => expand(v, from, to, timeZone, replaced.get(v.get("UID")?.[0]?.value ?? "") ?? NONE));
  // The same event twice (two calendars, or an edited series that overlaps its old copy)
  // shows once.
  const seen = new Set<string>();
  return out
    .filter((e) => {
      const k = `${e.title.toLowerCase()}|${e.start}|${e.end}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, 200);
}

const NONE: ReadonlySet<string> = new Set();

/** Identifies one occurrence: the instant for timed events, the day for all-day ones. */
const occurrenceKey = (w: { allDay: boolean; day: LocalDate; instant: Date }) => (w.allDay ? `d:${w.day}` : `t:${w.instant.getTime()}`);

function expand(props: Props, from: LocalDate, to: LocalDate, tz: string, replaced: ReadonlySet<string>): CalendarEvent[] {
  const first = (k: string) => props.get(k)?.[0];
  if ((first("STATUS")?.value ?? "").toUpperCase() === "CANCELLED") return [];
  // A RECURRENCE-ID instance is a one-off at its own DTSTART; its series skips the
  // occurrence it replaced (below), so a moved instance is never shown twice.
  const start = first("DTSTART") && parseWhen(first("DTSTART")!, tz);
  if (!start) return [];
  const end = (first("DTEND") && parseWhen(first("DTEND")!, tz)) || null;
  const durationMs = end ? end.instant.getTime() - start.instant.getTime() : start.allDay ? 86_400_000 : 3_600_000;
  const title = unescape(first("SUMMARY")?.value ?? "Busy").slice(0, 160);
  const location = unescape(first("LOCATION")?.value ?? "").slice(0, 160);
  const uid = first("UID")?.value ?? title;
  const free = (first("TRANSP")?.value ?? "").trim().toUpperCase() === "TRANSPARENT";
  const exdates = new Set(
    (props.get("EXDATE") ?? []).flatMap((p) => p.value.split(",").map((v) => parseWhen({ value: v, params: p.params }, tz)?.day ?? "")),
  );

  const make = (day: LocalDate): CalendarEvent => {
    const shift = start.allDay ? zonedToUtc(day, "00:00", tz) : zonedToUtc(day, hhmmOf(start, tz), tz);
    return {
      id: `${uid}:${day}`,
      title,
      start: shift.toISOString(),
      end: new Date(shift.getTime() + durationMs).toISOString(),
      allDay: start.allDay,
      location,
      source: "calendar",
      ...(free ? { free: true } : {}),
    };
  };

  const rrule = props.has("RECURRENCE-ID") ? undefined : first("RRULE")?.value;
  if (!rrule) {
    const endDay = end ? (end.allDay ? addDays(end.day, -1) : end.day) : start.day;
    return start.day <= to && endDay >= from ? [{ ...make(start.day), start: start.instant.toISOString(), end: new Date(start.instant.getTime() + durationMs).toISOString() }] : [];
  }

  const rule = Object.fromEntries(rrule.split(";").map((kv) => kv.split("=") as [string, string]));
  const freq = rule.FREQ;
  if (freq !== "DAILY" && freq !== "WEEKLY") return [];
  const interval = Math.max(1, Number(rule.INTERVAL ?? 1));
  const count = rule.COUNT ? Number(rule.COUNT) : Infinity;
  // UNTIL is inclusive. A date-time UNTIL (usually UTC) is compared as an instant: Google
  // ends a series edited with "this and following" one second before the edited occurrence,
  // which can fall on the same local day.
  const untilWhen = rule.UNTIL ? parseWhen({ value: rule.UNTIL, params: {} }, tz) : null;
  const byday = rule.BYDAY ? rule.BYDAY.split(",").map((d) => BYDAY.indexOf(d.slice(-2))) : [weekdayIndex(start.day)];

  const results: CalendarEvent[] = [];
  let produced = 0;
  for (let day = start.day, guard = 0; guard < 3660 && day <= to; day = addDays(day, 1), guard++) {
    if (untilWhen && day > untilWhen.day && untilWhen.allDay) break;
    const daysSince = Math.round((Date.parse(day) - Date.parse(start.day)) / 86_400_000);
    const matches =
      freq === "DAILY"
        ? daysSince % interval === 0
        : byday.includes(weekdayIndex(day)) && Math.floor((daysSince + weekdayIndex(start.day)) / 7) % interval === 0;
    if (!matches) continue;
    const occ = make(day);
    if (untilWhen && !untilWhen.allDay && Date.parse(occ.start) > untilWhen.instant.getTime()) break;
    produced++;
    if (produced > count) break;
    const key = occurrenceKey({ allDay: start.allDay, day, instant: new Date(occ.start) });
    if (day >= from && !exdates.has(day) && !replaced.has(key)) results.push(occ);
  }
  return results;
}

function hhmmOf(w: When, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(w.instant);
}
