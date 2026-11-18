// The Finance Agent (build step 6). Pure: the runner (lib/agents/finance.ts) passes in the
// inbox the Email Agent already synced, your Renewals list and your Settings lists, so the
// scheduled run, Run Now, the Renewals page and the tests all use this same code.
//
// Email only, rules only. It never connects to a bank, never logs in anywhere and never
// moves money. From the sender and subject (and Gmail's snippet when there is one) of
// emails the Email Agent tagged finance, subscription or store, it finds:
//   alerts   a failed or past-due payment, a late fee, a declined card
//   bills    a bill or statement that is ready, an amount due, an autopay coming up,
//            a subscription renewing, and payments that went through
//   deals    sales and coupons from the stores you keep (holiday sales flagged)
// Bills from a sender that is not on your Renewals list come with a one-click
// "Track in Renewals"; nothing is added without that click.

import type { StandardReport } from "./chiefOfStaff";
import { addDays, daysBetween } from "./dates";
import { matchPhrases, senderKey, senderMatches, tagInbox, type EmailPrefs, type TaggedItem } from "./emailAgent";
import { renewalView, renewalWhen, type RenewalRow } from "./renewals";
import type { InboxItem, LocalDate, Renewal, RenewalKind } from "./types";

export type BillStatus = "alert" | "due" | "autopay" | "renewal" | "statement" | "paid";

export interface FinanceBill {
  /** The subscription as you wrote it in Settings, or the sender's name. */
  name: string;
  /** Sender domain, e.g. "harborview.com". */
  key: string;
  status: BillStatus;
  /** Dollars, from the latest email that names an amount. */
  amount: number | null;
  /** Due, renewal or autopay date, from the latest email that names one. */
  dueOn: LocalDate | null;
  subject: string;
  receivedAt: string;
  /** True when one of your subscriptions (Settings) sent it. */
  subscription: boolean;
  /** The Renewals entry this sender matches, or null when it is not tracked yet. */
  trackedId: string | null;
}

export interface FinanceDeal {
  store: string;
  subject: string;
  receivedAt: string;
  /** Largest "% off" in the subject, when there is one. */
  percentOff: number | null;
  /** Black Friday, Cyber Monday, Prime Day and other holiday sales. */
  holiday: boolean;
  /** 30% off or more, or a holiday sale. */
  major: boolean;
}

/** A Renewals entry Atlas suggests from your email, ready for the Track button. */
export interface TrackSuggestion {
  title: string;
  kind: RenewalKind;
  dueOn: LocalDate | null;
  cadence: "monthly" | "yearly";
}

export interface FinanceSection {
  alerts: FinanceBill[];
  bills: FinanceBill[];
  /** Bills from senders not on your Renewals list. */
  untracked: number;
  deals: FinanceDeal[];
  /** Renewals inside their warning window, overdue first. */
  dueSoon: { title: string; kind: RenewalKind; when: string }[];
}

// ---------------------------------------------------------------------------
// Reading a subject

const ALERT =
  /\b(past[- ]due|overdue|payment (failed|declined|unsuccessful|was not processed|could not be processed|returned)|(failed|declined|missed|returned|late) payment|card (was )?declined|late fee|insufficient funds|overdraft|action required: payment|payment problem|unable to process (your )?payment|update (your )?payment (method|info))\b/i;
const PAID =
  /\b(payment (received|posted|confirmation|confirmed|successful|processed|complete)|thanks? (you )?for (your|the) payment|we('ve| have)? received your payment|you('ve| have)? paid|payment of \$[\d,.]+ (was )?(received|posted)|receipt for your payment)\b/i;
const AUTOPAY = /\b(auto[- ]?pay|automatic payment|scheduled payment|recurring payment)\b/i;
const RENEWAL = /\b(renew(s|al|ing|ed)?|auto[- ]renew|membership (fee|dues)|price (change|increase)|subscription (fee|charge)|trial (ends|ending))\b/i;
const STATEMENT =
  /\b(e-?statement|statement (is )?(ready|available|now available)|your (\w+ )?statement|new statement|(e-?)?bill (is )?(ready|available)|new bill|your bill|invoice)\b/i;
const DUE =
  /\b(payment (is )?due|due (soon|today|tomorrow|on|by|date|in)|bill (is )?due|amount due|minimum (payment )?due|upcoming payment|payment reminder|reminder:? (your )?payment|is due)\b/i;

const STATUS_ORDER: BillStatus[] = ["alert", "paid", "autopay", "renewal", "due", "statement"];

/** What one finance email is about, or null when it is not a bill (a newsletter, a policy update). */
export function billStatus(text: string): BillStatus | null {
  if (ALERT.test(text)) return "alert";
  if (PAID.test(text)) return "paid";
  if (AUTOPAY.test(text)) return "autopay";
  if (RENEWAL.test(text) && !/\b(terms|privacy)\b/i.test(text)) return "renewal";
  if (DUE.test(text)) return "due";
  if (STATEMENT.test(text)) return "statement";
  return null;
}

/** The first dollar amount: "$1,234.56" -> 1234.56. Ignores "$0" and amounts over $1M. */
export function parseAmount(text: string): number | null {
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?\b/g)) {
    const n = Number(`${m[1]!.replace(/,/g, "")}${m[2] ?? ""}`);
    if (n > 0 && n < 1_000_000) return n;
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const LEAD = String.raw`\b(?:due|by|before|renew(?:s|al)?(?: date)?|ends?|expires?|charged|billed|scheduled|withdrawn|draft(?:ed)?|process(?:ed)?|will (?:be )?(?:charged|processed|drafted|withdrawn))(?:\s+(?:on|by|for|date:?))?\s+(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?`;
const NAMED_DATE = new RegExp(`${LEAD}(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i");
const NUMERIC_DATE = new RegExp(`${LEAD}(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b`, "i");
const RELATIVE_DATE = /\b(?:due|ends?|ending|renews?|renewing|expires?|expiring|charged) (today|tomorrow|in (\d{1,2}) days?)\b/i;

const pad = (n: number) => String(n).padStart(2, "0");

function realDate(y: number, m: number, d: number): LocalDate | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/**
 * The due, renewal or autopay date an email names: "due Nov 20", "renews on December 1,
 * 2026", "scheduled for 11/28", "due tomorrow". A date without a year is the next one
 * on or after the day the email arrived (give or take a month for late notices).
 */
export function parseDueDate(text: string, received: LocalDate): LocalDate | null {
  const rel = RELATIVE_DATE.exec(text);
  if (rel) return addDays(received, rel[1]!.toLowerCase() === "today" ? 0 : rel[1]!.toLowerCase() === "tomorrow" ? 1 : Number(rel[2]));
  const named = NAMED_DATE.exec(text);
  const numeric = named ? null : NUMERIC_DATE.exec(text);
  const hit = named
    ? {
        m: MONTHS.indexOf(named[1]!.slice(0, 3).toLowerCase()) + 1,
        d: Number(named[2]),
        y: named[3],
      }
    : numeric
      ? { m: Number(numeric[1]), d: Number(numeric[2]), y: numeric[3] }
      : null;
  if (!hit) return null;
  const year = Number(received.slice(0, 4));
  if (hit.y) return realDate(hit.y.length === 2 ? 2000 + Number(hit.y) : Number(hit.y), hit.m, hit.d);
  const thisYear = realDate(year, hit.m, hit.d);
  if (!thisYear) return null;
  return daysBetween(thisYear, received) > 31 ? realDate(year + 1, hit.m, hit.d) : thisYear;
}

// ---------------------------------------------------------------------------
// Deals

const DEAL =
  /(\d{1,2}\s?% off|\bup to \d{1,2}\s?%|\bsale\b|\bdeals?\b|\bcoupons?\b|promo code|\bsave (up to )?\$?\d|\bclearance\b|doorbusters?|\bsavings\b|\bbogo\b|buy one,? get|\bfree gift\b|\boffer ends\b)/i;
const NOT_A_DEAL = /\b((your|my) order|order (confirmation|update|status|number|#)|shipped|shipping (update|confirmation)|delivered|delivery|receipt|refund|return|password|sign[- ]in|verify|your account|security|invoice)\b/i;
const HOLIDAY = /\b(black friday|cyber (monday|week)|prime (big deal )?days?|holiday (sale|deals?|savings)|doorbusters?|early access|12 days of|boxing day|after[- ]christmas)\b/i;

/** A sale or coupon from a store, or null for an order update or a plain newsletter. */
export function dealFrom(subject: string): Pick<FinanceDeal, "percentOff" | "holiday" | "major"> | null {
  if (!DEAL.test(subject) || NOT_A_DEAL.test(subject)) return null;
  const pcts = [...subject.matchAll(/(\d{1,2})\s?%/g)].map((m) => Number(m[1])).filter((n) => n > 0 && n < 100);
  const percentOff = pcts.length ? Math.max(...pcts) : null;
  const holiday = HOLIDAY.test(subject);
  return { percentOff, holiday, major: holiday || (percentOff ?? 0) >= 30 };
}

// ---------------------------------------------------------------------------
// The report

const day = (iso: string): LocalDate => iso.slice(0, 10);
const text = (i: InboxItem) => `${i.subject} ${i.snippet ?? ""}`;
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The Renewals entry that a sender's bills belong to, if you track it. */
function trackedFor(renewals: Renewal[], mails: TaggedItem[], name: string, subscription: string | null): string | null {
  const phrases = subscription ? matchPhrases(subscription) : matchPhrases(name);
  const hit = renewals.find((r) => {
    const title = ` ${norm(r.title)} `;
    return mails.some((m) => senderMatches(r.title, m)) || phrases.some((p) => title.includes(` ${p} `));
  });
  return hit?.id ?? null;
}

/** Most common display name for a sender. */
function senderName(mails: TaggedItem[]): string {
  const names = new Map<string, number>();
  for (const m of mails) if (m.fromName.trim()) names.set(m.fromName.trim(), (names.get(m.fromName.trim()) ?? 0) + 1);
  return [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? senderKey(mails[0]!.fromEmail);
}

/** Bills, one per sender (or tracked subscription), from its latest bill email. */
export function findBills(tagged: TaggedItem[], renewals: Renewal[]): FinanceBill[] {
  const groups = new Map<string, TaggedItem[]>();
  for (const m of tagged) {
    if (m.tag !== "finance" && m.tag !== "subscription") continue;
    if (!billStatus(text(m))) continue;
    const key = m.tag === "subscription" && m.matched ? `sub:${m.matched}` : senderKey(m.fromEmail);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const bills: FinanceBill[] = [];
  for (const [key, mails] of groups) {
    const sorted = [...mails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    const latest = sorted[0]!;
    const subscription = latest.tag === "subscription" ? latest.matched : null;
    const name = subscription ?? senderName(mails);
    const amount = sorted.map((m) => parseAmount(text(m))).find((n) => n !== null) ?? null;
    const dueOn = sorted.map((m) => parseDueDate(text(m), day(m.receivedAt))).find((d) => d !== null) ?? null;
    bills.push({
      name,
      key: key.startsWith("sub:") ? senderKey(latest.fromEmail) : key,
      status: billStatus(text(latest))!,
      amount,
      dueOn,
      subject: latest.subject,
      receivedAt: latest.receivedAt,
      subscription: Boolean(subscription),
      trackedId: trackedFor(renewals, mails, name, subscription),
    });
  }
  return bills.sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || b.receivedAt.localeCompare(a.receivedAt),
  );
}

/** Deals from the stores you keep: the best one per store, holiday and big sales first. */
export function findDeals(tagged: TaggedItem[], max = 6): FinanceDeal[] {
  const best = new Map<string, FinanceDeal>();
  const score = (d: FinanceDeal) => (d.holiday ? 1000 : 0) + (d.percentOff ?? 0);
  for (const m of tagged) {
    if (m.tag !== "store" || !m.matched) continue;
    const deal = dealFrom(m.subject);
    if (!deal) continue;
    const d: FinanceDeal = {
      store: m.matched,
      subject: m.subject,
      receivedAt: m.receivedAt,
      ...deal,
    };
    const prev = best.get(m.matched);
    if (!prev || score(d) > score(prev) || (score(d) === score(prev) && d.receivedAt > prev.receivedAt)) best.set(m.matched, d);
  }
  return [...best.values()].sort((a, b) => Number(b.major) - Number(a.major) || score(b) - score(a) || b.receivedAt.localeCompare(a.receivedAt)).slice(0, max);
}

/** What the Track button fills in for an untracked bill. */
export function trackSuggestion(b: FinanceBill): TrackSuggestion {
  const yearly = /\b(annual|yearly|year|registration|policy|premium)\b/i.test(b.subject);
  return {
    title: b.name.slice(0, 120),
    kind: b.subscription || b.status === "renewal" ? "renewal" : "bill",
    dueOn: b.dueOn,
    cadence: yearly ? "yearly" : "monthly",
  };
}

export interface FinanceAgentInput {
  today: LocalDate;
  items: InboxItem[];
  prefs: EmailPrefs;
  renewals: Renewal[];
  /** False when the inbox could not be read (Gmail not connected): only Renewals report. */
  inboxReady: boolean;
}

export interface FinanceAgentResult {
  section: FinanceSection;
  bills: FinanceBill[];
  deals: FinanceDeal[];
  dueRows: RenewalRow[];
  report: StandardReport;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const STATUS_LABEL: Record<BillStatus, string> = {
  alert: "Payment alert",
  due: "Due",
  autopay: "Autopay",
  renewal: "Renews",
  statement: "Statement ready",
  paid: "Paid",
};

/** One line for a bill: "Harborview: Due $142.18 on 2026-11-20". */
export function billLine(b: FinanceBill): string {
  const bits = [STATUS_LABEL[b.status], b.amount !== null ? money(b.amount) : "", b.dueOn ? `on ${b.dueOn}` : ""].filter(Boolean).join(" ");
  return `${b.name}: ${bits}`;
}

export function financeAgentReport(input: FinanceAgentInput): FinanceAgentResult {
  const { today } = input;
  // Only mail from the last 45 days counts; an old statement is not news.
  const recent = input.items.filter((i) => daysBetween(day(i.receivedAt), today) <= 45);
  const tagged = input.inboxReady ? tagInbox(recent, input.prefs) : [];
  const bills = findBills(tagged, input.renewals);
  const deals = findDeals(tagged);
  const dueRows = renewalView(input.renewals, today).attention;

  const alerts = bills.filter((b) => b.status === "alert");
  const open = bills.filter((b) => b.status !== "alert" && b.status !== "paid");
  const untracked = bills.filter((b) => !b.trackedId && b.status !== "paid");
  const dueSoon = dueRows.map((r) => ({
    title: r.renewal.title,
    kind: r.renewal.kind,
    when: renewalWhen(r.daysUntil).toLowerCase(),
  }));

  const parts: string[] = [];
  if (alerts.length) parts.push(plural(alerts.length, "payment alert"));
  if (dueSoon.length) parts.push(`${plural(dueSoon.length, "bill or renewal", "bills or renewals")} due soon`);
  if (open.length) parts.push(`${plural(open.length, "bill")} in your email`);
  if (deals.length) parts.push(`${plural(deals.length, "deal")} at stores you keep`);
  const headline = parts.length ? `${parts.join(", ")}.` : "No bills due, no payment alerts, no deals today.";

  return {
    bills,
    deals,
    dueRows,
    section: {
      alerts,
      bills: open,
      untracked: untracked.length,
      deals,
      dueSoon,
    },
    report: {
      agent: "finance",
      headline: headline.charAt(0).toUpperCase() + headline.slice(1),
      details: [
        ...alerts.map((b) => `${billLine(b)}: ${b.subject}`),
        ...dueSoon.map((d) => `${d.title} ${d.when}`),
        ...open.slice(0, 8).map(billLine),
        ...deals.map((d) => `${d.store}${d.major ? " (big sale)" : ""}: ${d.subject}`),
      ],
      needsApproval: untracked.map((b) => `Track ${b.name} in Renewals`),
      errors: input.inboxReady ? [] : ["The inbox has not been read yet, so only your Renewals list is checked. Connect Gmail in Connectors."],
    },
  };
}
