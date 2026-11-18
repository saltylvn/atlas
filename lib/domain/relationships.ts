// Keep-in-touch logic: who you meant to reach out to, and whose birthday is coming.

import { addDays, daysBetween } from "./dates";
import type { Contact, LocalDate } from "./types";

export interface ContactDue {
  contact: Contact;
  reason: "birthday" | "cadence" | "never";
  /** Birthday: days until it (0 = today). Cadence: days overdue. */
  days: number;
}

const BIRTHDAY_WINDOW = 7;

/** Days from `today` until the next occurrence of an "MM-DD" birthday (0-365). */
export function daysUntilBirthday(today: LocalDate, mmdd: string): number {
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    // Feb 29 birthdays are celebrated on Feb 28 in non-leap years.
    let candidate = `${y}-${mmdd}`;
    if (mmdd === "02-29" && !isLeap(y)) candidate = `${y}-02-28`;
    const diff = daysBetween(today, candidate);
    if (diff >= 0) return diff;
  }
  return 365;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function contactsDue(contacts: Contact[], today: LocalDate): ContactDue[] {
  const due: ContactDue[] = [];
  for (const contact of contacts) {
    if (contact.birthday) {
      const days = daysUntilBirthday(today, contact.birthday);
      if (days <= BIRTHDAY_WINDOW) {
        due.push({ contact, reason: "birthday", days });
        continue;
      }
    }
    if (contact.cadenceDays > 0) {
      if (!contact.lastContactAt) {
        due.push({ contact, reason: "never", days: 0 });
        continue;
      }
      const last = contact.lastContactAt.slice(0, 10);
      const overdue = daysBetween(addDays(last, contact.cadenceDays), today);
      if (overdue >= 0) due.push({ contact, reason: "cadence", days: overdue });
    }
  }
  const rank = { birthday: 0, cadence: 1, never: 2 } as const;
  return due.sort(
    (a, b) =>
      rank[a.reason] - rank[b.reason] ||
      (a.reason === "birthday" ? a.days - b.days : b.days - a.days) ||
      a.contact.name.localeCompare(b.contact.name),
  );
}

export function dueLabel(item: ContactDue): string {
  switch (item.reason) {
    case "birthday":
      return item.days === 0 ? "Birthday today" : `Birthday in ${item.days}d`;
    case "never":
      return "Not contacted yet";
    case "cadence":
      return item.days === 0 ? "Due today" : `${item.days}d overdue`;
  }
}
