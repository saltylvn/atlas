// The Email Agent (build step 4). Pure: the runner (lib/agents/email.ts) syncs Gmail and
// passes the stored inbox in, so the scheduled run, Run Now, Today's live preview and
// the tests all use this same code.
//
// On top of the reply / FYI / noise triage, every email gets at most one tag:
//   job           confirmations, replies, rejections, interview invites, assessments,
//                 requests for times or for something, offers, recruiters
//                 (handed to the Career Agent; an interview invite needs a reply)
//   subscription  one of the subscriptions you track, with its latest update
//   finance       bills, banks, credit cards: shown as a count
//   store         a store you shop at (kept, so the Finance Agent can flag deals)
// Tags are computed when read, from sender and subject only, so changing your lists in
// Settings re-tags the whole inbox at once. Rules only: an email's text can never talk
// its way into a different pile.

import type { StandardReport } from "./chiefOfStaff";
import { summarizeInbox, type InboxSummary } from "./inbox";
import type { BriefSlot, InboxItem, Settings } from "./types";

export type EmailTag = "job" | "subscription" | "finance" | "store";
export type JobKind = "interview" | "reply" | "rejection" | "confirmation" | "recruiter" | "assessment" | "scheduling" | "offer" | "info_request";

export interface EmailPrefs {
  /** Stores and senders you keep (never proposed for unsubscribing). */
  stores: string[];
  /** Subscriptions you track, e.g. "Apex Fitness" or "Disney/Hulu". */
  subscriptions: string[];
  /** Sender domains you already unsubscribed from (never proposed again). */
  unsubscribed: string[];
}

export function prefsFrom(s: Pick<Settings, "emailStores" | "emailSubscriptions" | "emailUnsubscribed">): EmailPrefs {
  return { stores: s.emailStores ?? [], subscriptions: s.emailSubscriptions ?? [], unsubscribed: s.emailUnsubscribed ?? [] };
}

export interface TaggedItem extends InboxItem {
  tag: EmailTag | null;
  jobKind: JobKind | null;
  /** The store or subscription it matched, as you wrote it in Settings. */
  matched: string | null;
}

// ---------------------------------------------------------------------------
// Senders and names

const TWO_PART_TLD = /\.(co|com|org|net|gov|ac)\.[a-z]{2}$/;

/** The sender's organization domain: "email.costco.com" -> "costco.com". */
export function senderKey(email: string): string {
  const domain = (email.split("@")[1] ?? "").toLowerCase().replace(/[^a-z0-9.-]/g, "");
  const parts = domain.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  return parts.slice(TWO_PART_TLD.test(domain) ? -3 : -2).join(".");
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const GENERIC = new Set(["subscription", "subscriptions", "payment", "payments", "loan", "bill", "account", "membership", "inc", "llc", "the"]);

/**
 * What to look for in a sender for one of your entries. "Disney/Hulu" gives two
 * alternatives; "(Car Payment)" notes are ignored; generic words like "payment" or
 * "subscription" are dropped, so "North Star loan payment" looks for "north star".
 */
export function matchPhrases(entry: string): string[] {
  return entry
    .replace(/\([^)]*\)/g, " ")
    .split("/")
    .map((alt) => norm(alt).split(" ").filter((w) => w && !GENERIC.has(w)).join(" "))
    .filter((p) => p.length >= 3);
}

/**
 * The phrase and its shorter leading parts that are still distinctive: "harborview
 * insurance" also tries "harborview"; "shiny bubble car wash" also tries "shiny bubble"
 * (but not "shiny": a single word must be at least 6 letters).
 */
function candidates(phrase: string): string[] {
  const words = phrase.split(" ");
  const out = [phrase];
  for (let n = words.length - 1; n >= 1; n--) {
    const head = words.slice(0, n).join(" ");
    if (head.replace(/ /g, "").length >= 6) out.push(head);
  }
  return out;
}

/** True when the sender's name or domain carries the entry ("north star" matches northstarfinancial.com). */
export function senderMatches(entry: string, item: Pick<InboxItem, "fromName" | "fromEmail">): boolean {
  const name = ` ${norm(item.fromName)} `;
  const domain = norm(senderKey(item.fromEmail)).replace(/ /g, "");
  return matchPhrases(entry)
    .flatMap(candidates)
    .some((p) => name.includes(` ${p} `) || (p.replace(/ /g, "").length >= 4 && domain.includes(p.replace(/ /g, ""))));
}

// ---------------------------------------------------------------------------
// Job emails

const ATS = /(^|\.)(greenhouse\.io|greenhouse-mail\.io|lever\.co|ashbyhq\.com|myworkday\.com|myworkdayjobs\.com|workday\.com|icims\.com|smartrecruiters\.com|jobvite\.com|bamboohr\.com|workablemail\.com|workable\.com|recruitee\.com|teamtailor\.com|breezy\.hr|rippling\.com|dover\.com|gem\.com)$/;
const JOB_ALERT = /\b(job alert|jobs? for you|new jobs?|recommended jobs?|jobs you may|is hiring)\b/i;
const INTERVIEW = /\b(interview|phone screen|technical screen|schedule (a |your )?(call|time|chat|conversation)|your availability)\b/i;
// "Next steps" names no interview: confirmations, assessments and rejections say it too. It is
// a reply, so the email is still job mail and its text is read, and the text decides the rest.
const NEXT_STEPS = /\bnext steps\b/i;
const REJECTION = /\b(unfortunately|not (to )?mov(e|ing) forward|other candidates|regret|no longer (being )?consider|position (has been )?filled|decided to (pursue|move))\b/i;
const CONFIRMATION = /\b(thanks? (you )?for (applying|your application|your interest)|application (received|submitted|confirmation)|we('ve| have)? (received|got) your( [\w&'’ -]{1,60})? application|we got it|your application (to|for|has been)|demographic survey|self[- ]identification|eeo survey)\b/i;
const STATUS = /\b(update on your application|application (status|update))\b/i;
const RECRUITER = /\b(opportunity|opportunities|role|position|opening|recruit(er|ing)|hiring|your background|your profile)\b/i;

/**
 * What kind of job email this is, from its sender and subject. Once the Applications Agent
 * has read its text, what the rules found there wins ("Update on your application" is often
 * a rejection): a rejection, an interview invite, an assessment, a request for times, an
 * offer, a request for something. It only reads job mail and emails from companies you
 * applied to, so a verdict also makes a company's vaguely titled email job mail.
 *
 * A subject alone makes an interview invite only while the text is unread (`textVerdict`
 * unset): then the subject is all there is. Once the text was read and no rule found an
 * invitation in it ("none"), a subject that says "interview" is a reply: it is still on the
 * timeline and still pings as "They replied", and the stage moves no further than In review.
 * A wrong "interview" is worse than a late one (docs/design-pipeline.md, section 1).
 *
 * The unread kind is a label for Inbox and the brief, beside the subject it came from. It
 * moves nothing: the tracker places no email until its text is read (`kindToPlace`,
 * lib/domain/applications.ts), and the urgent ping waits for the text too.
 */
export function jobKind(item: Pick<InboxItem, "fromEmail" | "subject" | "category" | "textVerdict"> & { reason?: string }): JobKind | null {
  if (item.textVerdict && item.textVerdict !== "none") return item.textVerdict;
  const kind = kindFromHeaders(item);
  if (item.textVerdict === "none" && kind === "interview") return "reply";
  return kind;
}

function kindFromHeaders(item: Pick<InboxItem, "fromEmail" | "subject" | "category"> & { reason?: string }): JobKind | null {
  const subject = item.subject;
  // Newsletters and promotions are never job mail; a "no-reply" notification can be.
  const bulk = item.category === "noise" && /^(Mailing list|Gmail )/.test(item.reason ?? "Mailing list");
  if (JOB_ALERT.test(subject)) return null;
  const ats = ATS.test((item.fromEmail.split("@")[1] ?? "").toLowerCase());
  if (INTERVIEW.test(subject) && (ats || !bulk)) return "interview";
  if (REJECTION.test(subject)) return ats || /application|candida/i.test(subject) ? "rejection" : null;
  if (CONFIRMATION.test(subject)) return "confirmation";
  if (STATUS.test(subject)) return "reply";
  if (NEXT_STEPS.test(subject) && (ats || !bulk)) return "reply";
  // A reply thread about a role, from a person or a hiring system: never a mailing list
  // (a GitHub pull request titled "...resume link per role" is not job mail).
  if ((ats || !bulk) && /^re:/i.test(subject) && /\b(application|role|position|interview|offer)\b/i.test(subject)) return "reply";
  // Anything else from a hiring system (surveys, account notices) shows you applied; it is
  // not a reply from the company.
  if (ats) return "confirmation";
  // A person (not a mailing list) writing about a role.
  if (!bulk && item.category !== "noise" && RECRUITER.test(subject)) return "recruiter";
  return null;
}

// ---------------------------------------------------------------------------
// Finance

const FINANCE_DOMAIN =
  /^(chase|bankofamerica|bofa|wellsfargo|capitalone|americanexpress|aexp|discover|citi|citibank|usbank|ally|schwab|fidelity|vanguard|paypal|venmo|sofi|synchrony|syf|navyfederal|mountainamerica|macu|americafirst|zionsbank|goldmansachs|marcus|apple|irs|intuit|turbotax|experian|equifax|transunion|creditkarma|northstarfinancial|northstar|lakeshorefinancial|harborview|geico|statefarm|allstate)\.[a-z.]+$/;
const FINANCE_SUBJECT = /\b(statement|bill(ing)?|payment|autopay|auto-pay|invoice|balance|due date|past due|credit card|deposit|withdrawal|transaction|account alert|overdraft|transfer|tax(es)?|premium|policy|loan)\b/i;
const BILLING = /\b(membership|prime|subscription|renew(al|s|ed)?|billing|payment|charge|plan|receipt|invoice|statement|due|policy|premium)\b/i;

/** One tag per email: job, then a tracked subscription, then finance, then a kept store. */
export function tagEmail(item: InboxItem, prefs: EmailPrefs): Pick<TaggedItem, "tag" | "jobKind" | "matched"> {
  const kind = jobKind(item);
  if (kind) return { tag: "job", jobKind: kind, matched: null };

  const store = prefs.stores.find((s) => senderMatches(s, item)) ?? null;
  const sub = prefs.subscriptions.find((s) => senderMatches(s, item)) ?? null;
  // A sender that is both a store and a subscription (Amazon) counts as the subscription
  // only for billing emails, so its deals stay with the store.
  if (sub && (!store || BILLING.test(item.subject))) return { tag: "subscription", jobKind: null, matched: sub };

  const finance = FINANCE_DOMAIN.test(senderKey(item.fromEmail)) || (item.category !== "noise" && FINANCE_SUBJECT.test(item.subject));
  if (finance && !store) return { tag: "finance", jobKind: null, matched: null };
  if (store) return { tag: "store", jobKind: null, matched: store };
  return { tag: null, jobKind: null, matched: null };
}

/** Tags every email. An interview invite always lands in "needs a reply": one the text says, or one only the subject names while the text is unread. */
export function tagInbox(items: InboxItem[], prefs: EmailPrefs): TaggedItem[] {
  return items.map((i) => {
    const t = tagEmail(i, prefs);
    const promote = t.jobKind === "interview" && i.category !== "reply";
    return { ...i, ...t, ...(promote ? { category: "reply" as const, reason: "Interview invite" } : {}) };
  });
}

// ---------------------------------------------------------------------------
// Declutter

export interface DeclutterProposal {
  /** Sender domain, e.g. "brand.com". */
  key: string;
  name: string;
  count: number;
  latestSubject: string;
  latestAt: string;
}

const PROMO = /^(Mailing list or automated|Gmail promotions|Gmail social|Gmail forums)$/;

/**
 * Promotional senders worth unsubscribing from: mailing lists and promotions that are
 * not a store you keep, a subscription you track, a finance or job sender, and not
 * one you already unsubscribed from. Most emails first.
 */
export function declutter(items: TaggedItem[], prefs: EmailPrefs, max = 12): DeclutterProposal[] {
  const groups = new Map<string, TaggedItem[]>();
  for (const i of items) {
    const key = senderKey(i.fromEmail);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const out: DeclutterProposal[] = [];
  for (const [key, mails] of groups) {
    if (prefs.unsubscribed.includes(key)) continue;
    if (mails.some((m) => m.tag !== null)) continue;
    if (!mails.every((m) => m.category === "noise" && PROMO.test(m.reason))) continue;
    const latest = [...mails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]!;
    const names = new Map<string, number>();
    for (const m of mails) names.set(m.fromName, (names.get(m.fromName) ?? 0) + 1);
    const name = [...names.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    out.push({ key, name, count: mails.length, latestSubject: latest.subject, latestAt: latest.receivedAt });
  }
  return out.sort((a, b) => b.count - a.count || b.latestAt.localeCompare(a.latestAt)).slice(0, max);
}

// ---------------------------------------------------------------------------
// The report

export interface JobEmail {
  kind: JobKind;
  fromName: string;
  subject: string;
  receivedAt: string;
  /** The sentence in the email's text that decided its kind. */
  quote?: string;
}

export interface SubscriptionUpdate {
  name: string;
  subject: string;
  receivedAt: string;
}

export interface EmailSection {
  needsReply: number;
  fyi: number;
  noise: number;
  waiting: { fromName: string; subject: string }[];
  /** Added in build step 4; briefs saved before then do not have these. */
  finance?: number;
  jobs?: JobEmail[];
  subscriptions?: SubscriptionUpdate[];
  declutter?: number;
}

export type SyncState = "ok" | "not_connected" | "error" | "not_run";

export interface EmailAgentInput {
  slot: BriefSlot;
  items: InboxItem[];
  prefs: EmailPrefs;
  sync: SyncState;
  syncMessage?: string;
}

export interface EmailAgentResult {
  sync: SyncState;
  summary: InboxSummary;
  section: EmailSection;
  declutter: DeclutterProposal[];
  report: StandardReport;
}

const JOB_LABEL: Record<JobKind, string> = {
  interview: "Interview invite",
  reply: "Reply",
  rejection: "Rejection",
  confirmation: "Application received",
  recruiter: "Recruiter",
  assessment: "Assessment",
  scheduling: "Scheduling request",
  offer: "Offer",
  info_request: "Asks for something",
};
// What wants an answer from you comes first.
const JOB_RANK: Record<JobKind, number> = { offer: 0, interview: 1, assessment: 2, scheduling: 3, info_request: 4, reply: 5, recruiter: 6, rejection: 7, confirmation: 8 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function emailAgentReport(input: EmailAgentInput): EmailAgentResult {
  const tagged = tagInbox(input.items, input.prefs);
  const open = tagged.filter((i) => !i.done);
  const summary = summarizeInbox(open);

  const finance = open.filter((i) => i.tag === "finance").length;
  const jobs: JobEmail[] = open
    .filter((i) => i.tag === "job" && i.jobKind)
    .sort((a, b) => JOB_RANK[a.jobKind!] - JOB_RANK[b.jobKind!] || b.receivedAt.localeCompare(a.receivedAt))
    .map((i) => ({ kind: i.jobKind!, fromName: i.fromName, subject: i.subject, receivedAt: i.receivedAt, ...(i.textQuote && i.textVerdict === i.jobKind ? { quote: i.textQuote } : {}) }));
  const subscriptions: SubscriptionUpdate[] = input.prefs.subscriptions.flatMap((name) => {
    const latest = tagged.filter((i) => i.tag === "subscription" && i.matched === name).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0];
    return latest ? [{ name, subject: latest.subject, receivedAt: latest.receivedAt }] : [];
  });
  const proposals = declutter(open, input.prefs);

  const errors =
    input.sync === "error"
      ? [`Gmail could not be read${input.syncMessage ? `: ${input.syncMessage}` : ""}. The inbox shown is from the last good sync.`]
      : input.sync === "not_connected"
        ? ["Gmail is not connected. Set it up in Connectors."]
        : [];

  const parts = [`${plural(summary.needsReply, "email")} need${summary.needsReply === 1 ? "s" : ""} a reply`];
  if (finance) parts.push(`${finance} finance`);
  if (jobs.length) parts.push(`${jobs.length} job`);
  if (proposals.length) parts.push(`${plural(proposals.length, "sender")} to declutter`);

  return {
    sync: input.sync,
    summary,
    declutter: proposals,
    section: {
      needsReply: summary.needsReply,
      fyi: summary.fyi,
      noise: summary.noise,
      waiting: summary.waiting.map((w) => ({ fromName: w.fromName, subject: w.subject })),
      finance,
      jobs: jobs.slice(0, 6),
      subscriptions,
      declutter: proposals.length,
    },
    report: {
      agent: "email",
      headline: `${parts.join(", ")}.`,
      details: [
        ...summary.waiting.map((w) => `Waiting on you: ${w.fromName}: ${w.subject || "(no subject)"}`),
        ...(finance ? [`You have ${plural(finance, "finance email")}.`] : []),
        ...jobs.slice(0, 6).map((j) => `${JOB_LABEL[j.kind]}: ${j.fromName}: ${j.subject}`),
        ...subscriptions.map((s) => `${s.name}: ${s.subject}`),
      ],
      needsApproval: proposals.map((p) => `Unsubscribe from ${p.name} (${p.key}, ${plural(p.count, "email")})`),
      errors,
    },
  };
}

export { JOB_LABEL };
