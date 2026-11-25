// What is worth a phone ping between briefs. Pure: the 2-hour sync passes the inbox in.
//
// Only two things qualify, and only when they are new since the last sync:
//   a payment alert (failed, declined or past due), and an interview invite the tracker
//   could not put on an application's timeline (it cannot tell which application, or
//   which company).
// An email is an invite only when its text says so. One whose subject says "interview" while
// its text is unread is not pinged: the tracker holds it off the timelines until it is read
// (`kindToPlace`), and "Interview invite" on your phone from a subject alone would be the
// same mistake by another door. Once read, it pings from the outbox or from here.
// An invite that is on a timeline is the Heard back outbox's to send
// (lib/domain/heardBack.ts), so it is left out here and never pinged twice. Everything
// else waits for the next brief. An interview ping carries the sender and the kind of
// thing, never the email's subject or text; a payment alert carries its clipped subject.

import { textRead } from "./applications";
import { prefsFrom, tagInbox } from "./emailAgent";
import type { FinanceBill } from "./financeAgent";
import type { InboxItem, Settings } from "./types";

export interface Urgent {
  kind: "interview" | "payment";
  title: string;
  body: string;
  /** Where the ping opens in Atlas. */
  url: string;
  receivedAt: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Urgent items that arrived after `since`, interviews first, newest first within each kind.
 * `onTimeline` holds the source of every timeline event ("email:<message id>"): an invite
 * found there is already in the Heard back outbox.
 */
export function urgentSince(
  items: InboxItem[],
  settings: Pick<Settings, "emailStores" | "emailSubscriptions" | "emailUnsubscribed">,
  since: string,
  alerts: Pick<FinanceBill, "name" | "subject" | "receivedAt">[],
  onTimeline: ReadonlySet<string> = new Set(),
): Urgent[] {
  const interviews: Urgent[] = tagInbox(items, prefsFrom(settings))
    .filter((i) => !i.done && i.jobKind === "interview" && textRead(i) && i.receivedAt > since && !onTimeline.has(`email:${i.messageId}`))
    .map((i) => ({ kind: "interview", title: clip(`Interview invite: ${i.fromName}`, 80), body: "Atlas could not tell which application it is about. Open your inbox to see it.", url: "/inbox", receivedAt: i.receivedAt }));
  const payments: Urgent[] = alerts
    .filter((a) => a.receivedAt > since)
    .map((a) => ({ kind: "payment", title: clip(`Payment alert: ${a.name}`, 80), body: clip(a.subject || "Open Renewals to see it.", 160), url: "/renewals", receivedAt: a.receivedAt }));
  const newest = (a: Urgent, b: Urgent) => b.receivedAt.localeCompare(a.receivedAt);
  return [...interviews.sort(newest), ...payments.sort(newest)];
}
