// What is worth a phone ping between briefs. Pure: the 2-hour sync passes the inbox in.
//
// Only two things qualify, and only when they are new since the last sync:
//   an interview invite, and a payment alert (failed, declined or past due).
// Everything else waits for the next brief. A ping carries the sender and the kind of
// thing, never an email's text beyond its subject, which is clipped.

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

/** Urgent items that arrived after `since`, interviews first, newest first within each kind. */
export function urgentSince(items: InboxItem[], settings: Pick<Settings, "emailStores" | "emailSubscriptions" | "emailUnsubscribed">, since: string, alerts: Pick<FinanceBill, "name" | "subject" | "receivedAt">[]): Urgent[] {
  const interviews: Urgent[] = tagInbox(items, prefsFrom(settings))
    .filter((i) => !i.done && i.jobKind === "interview" && i.receivedAt > since)
    .map((i) => ({ kind: "interview", title: clip(`Interview invite: ${i.fromName}`, 80), body: clip(i.subject || "Open your inbox to reply.", 160), url: "/inbox", receivedAt: i.receivedAt }));
  const payments: Urgent[] = alerts
    .filter((a) => a.receivedAt > since)
    .map((a) => ({ kind: "payment", title: clip(`Payment alert: ${a.name}`, 80), body: clip(a.subject || "Open Renewals to see it.", 160), url: "/renewals", receivedAt: a.receivedAt }));
  const newest = (a: Urgent, b: Urgent) => b.receivedAt.localeCompare(a.receivedAt);
  return [...interviews.sort(newest), ...payments.sort(newest)];
}
