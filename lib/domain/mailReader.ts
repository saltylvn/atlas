// The Pipeline's model reader, the pure half (docs/design-pipeline.md, 5.4 to 5.6, 6 and 8).
// No I/O here: lib/agents/mailReader.ts fetches, asks and stores.
//
// A cascade: rules read every job email first (lib/domain/jobMailText.ts). Only what they
// leave as "none" may go to the AI model, and only while the owner's switch is on. This
// file decides three things, all in code and none of them by the model:
//   1. which emails may be sent (`readerCandidates`), and exactly what of each (`readerPayload`);
//   2. whether the model's answer can be believed (`checkReading`): its sentence is in the
//      email word for word, its date is written in the email and within 90 days, and its
//      stage is a move the reducer would make. An answer that fails any of them is dropped;
//   3. what is kept (`readingEvent`): a timeline row decided by "model", which the reducer
//      ignores and nothing shows. A reading is a suggestion (5.6).
// The email is untrusted text. Which application a reading belongs to is settled by the
// matching ladder before the model is asked; nothing the model returns picks an application,
// a recipient or an action.

import { matchMail, eventIndex, ROLE_NOT_LISTED } from "./applications";
import type { TaggedItem } from "./emailAgent";
import { cleanQuote, MAX_MODEL_CHARS, textForModel } from "./jobMailText";
import { scrub, scrubPhones } from "./knowledge";
import { applyEvent, standingOf, type Standing } from "./pipeline";
import type { Application, ApplicationEvent, ApplicationStage, ApplicationStatus, EventKind, NewApplicationEvent } from "./types";

/** What the reader's calls are counted under in the day's AI usage. */
export const READER_PURPOSE = "pipeline-reader";
/** At most this many reader calls a day, inside the shared daily limit (section 8). */
export const READER_DAILY_CAP = 12;
/** At most this many in one sync, so a backlog never holds a run open. */
export const READER_PER_RUN = 6;
/** A deadline further out than this is not believed. */
export const DEADLINE_WITHIN_DAYS = 90;
/** An email with less of its own text than this has nothing to read. */
export const MIN_TEXT_CHARS = 40;

/** The kinds the model may answer. "none": nothing to report, or it cannot tell. */
export const READ_KINDS = ["none", "confirmation", "reply", "info_request", "scheduling", "screen", "assessment", "interview", "offer", "rejection"] as const;
export type ReadKind = (typeof READ_KINDS)[number];
/** The stages the model may answer: every stage an email can put an application at. */
export const READ_STAGES = ["applied", "in_review", "screen", "assessment", "interview", "offer", "rejected"] as const;

/** The model's answer, in the fixed shape of 5.4. `MailReadingOut` in lib/ai/prompts.ts is its schema. */
export interface RawReading {
  kind: ReadKind;
  stage: (typeof READ_STAGES)[number];
  role: string;
  /** What they ask for. */
  ask: string;
  /** "YYYY-MM-DD", or "". */
  deadline: string;
  /** People the email names. */
  people: string[];
  /** The sentence the kind rests on. */
  sentence: string;
}

/** An email the model may read, and the application the ladder placed it on. */
export interface ReaderCandidate {
  messageId: string;
  threadId: string;
  subject: string;
  receivedAt: string;
  applicationId: string;
  company: string;
  role: string;
  /** Where that application stands now. */
  standing: Standing;
}

/** An application still waiting on news, as the rules reader counts it (`openCompanies`). */
const AWAITING: readonly ApplicationStatus[] = ["applied", "replied", "interview"];

/**
 * The emails the model may read, the ones most likely to be an answer first. All of these
 * must hold (5.4, 5.5):
 *   - the switch was on when the email arrived (`since`): turning it on sends no backlog;
 *   - rules read its text and decided nothing ("none");
 *   - it was never handed to the model before;
 *   - it is on the timeline of one application, or the ladder places it on one (a tie is
 *     yours to settle first; the model never picks);
 *   - that application is still open, and has not moved since the email arrived.
 */
export function readerCandidates(
  items: readonly TaggedItem[],
  apps: readonly Application[],
  events: readonly Pick<ApplicationEvent, "applicationId" | "sourceRef" | "threadId">[],
  since: string | undefined,
): ReaderCandidate[] {
  if (!since) return [];
  const placedOn = new Map(events.map((e) => [e.sourceRef, e.applicationId]));
  const index = eventIndex(events);
  const found: (ReaderCandidate & { automatic: boolean })[] = [];
  for (const i of items) {
    if (i.textVerdict !== "none" || i.modelReadAt || i.receivedAt < since) continue;
    // A mailing list or a promotion is never read, whatever tagged it.
    if (i.category === "noise" && /^(Mailing list|Gmail )/.test(i.reason)) continue;
    const match = placedOn.get(`email:${i.messageId}`) ?? ladder(i, apps, index);
    const app = match ? apps.find((a) => a.id === match) : undefined;
    if (!app || !AWAITING.includes(app.status)) continue;
    const standing = standingOf(app);
    // Older than the application's last move: history, which the reducer would not act on.
    if (i.receivedAt < standing.stageAt) continue;
    found.push({ messageId: i.messageId, threadId: i.threadId, subject: i.subject, receivedAt: i.receivedAt, applicationId: app.id, company: app.company, role: app.role, standing, automatic: i.jobKind === "confirmation" });
  }
  return found.sort((a, b) => Number(a.automatic) - Number(b.automatic) || b.receivedAt.localeCompare(a.receivedAt)).map(({ automatic: _automatic, ...c }) => c);
}

/** The matching ladder for an email not on a timeline yet: an application's id only when rules can tell which. */
function ladder(i: TaggedItem, apps: readonly Application[], index: ReturnType<typeof eventIndex>): string | undefined {
  const m = matchMail({ messageId: i.messageId, fromName: i.fromName, fromEmail: i.fromEmail, subject: i.subject, receivedAt: i.receivedAt, kind: "reply", threadId: i.threadId, ...(i.textRole ? { role: i.textRole } : {}) }, apps, index);
  return m?.to === "application" ? m.id : undefined;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const noContacts = (s: string) => scrubPhones(scrub(s)).replace(/\b[\w.-]+\.(?:com|io|co|ai|org|net)\/\S*/gi, "");

/**
 * Exactly what is sent for one email, and nothing else: its subject and its own words (no
 * quoted thread), both without email addresses, phone numbers or links, 4,000 characters
 * together at most; and three facts Atlas already holds about the application (company,
 * role, stage) plus the day the email arrived. No sender address, no message or thread id.
 * `sent` is the text as sent: the model's sentence is checked against it.
 */
export function readerPayload(c: Pick<ReaderCandidate, "company" | "role" | "subject" | "receivedAt" | "standing">, text: string): { data: string; sent: string } {
  const subject = oneLine(noContacts(c.subject)).slice(0, 200);
  const sent = textForModel(text, MAX_MODEL_CHARS - subject.length);
  const data = JSON.stringify({
    application: { company: oneLine(c.company), role: c.role === ROLE_NOT_LISTED ? "" : oneLine(c.role), stageNow: c.standing.stage },
    arrived: c.receivedAt.slice(0, 10),
    email: { subject, text: sent },
  });
  return { data, sent };
}

/** A reading that passed every check. */
export interface KeptReading {
  kind: EventKind;
  /** Where the reducer would put the application if this were confirmed. */
  stage: ApplicationStage;
  /** The sentence it rests on, cleaned as the rules' quotes are. */
  quote: string;
  role: string;
  ask: string;
  deadline: string | null;
  people: string[];
}

export type DropReason = "quote" | "date" | "stage";
export type Checked = { outcome: "none" } | { outcome: "dropped"; why: DropReason } | { outcome: "kept"; reading: KeptReading };

/** Text with typographic quotes and dashes made plain and spacing collapsed: how "word for word" is compared. */
const flat = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** True when the email writes this date out: "December 4", "Dec. 4th, 2026", "4 December", "12/04", "12/4/26", "2026-12-04". A year, when written, must agree. */
export function dateWritten(text: string, iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const name = MONTHS[month - 1];
  if (!name || day < 1 || day > 31) return false;
  const mon = `(?:${name}|${name.slice(0, 3)}\\.?${name === "September" ? "|Sept\\.?" : ""})`;
  const yy = String(year).slice(2);
  const sameYear = (found: string | undefined) => !found || found === String(year) || found === yy;
  const patterns = [
    new RegExp(`\\b${mon}\\s+${day}(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4})\\b)?`, "gi"),
    new RegExp(`(?<!\\d)${day}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${mon}(?![a-z])(?:,?\\s+(\\d{4})\\b)?`, "gi"),
    new RegExp(`(?<![\\d/.-])0?${month}[/.-]0?${day}(?![\\d])(?:[/.-](\\d{4}|\\d{2})(?!\\d))?`, "g"),
  ];
  if (text.includes(iso)) return true;
  return patterns.some((p) => [...text.matchAll(p)].some((hit) => sameYear(hit[1])));
}

const dayOf = (iso: string, addDays: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + addDays * 86_400_000).toISOString().slice(0, 10);

/**
 * Whether the model's answer can be believed (5.4). Pure, and the only way a reading is
 * kept. `sent` is the text the model was given; `standing` is where the application stands.
 *   - the sentence is in that text word for word (spacing and typographic quotes aside);
 *   - a deadline is a real date, written in the email, from the day it arrived to 90 days on;
 *   - the stage is exactly where the reducer would put the application for that kind of
 *     email (`applyEvent`): a move it would not make is not a legal one.
 * The role and the people are kept only when the email names them; what is asked is cleaned
 * of addresses, phone numbers and links.
 */
export function checkReading(raw: RawReading, ctx: { sent: string; receivedAt: string; standing: Standing }): Checked {
  if (raw.kind === "none") return { outcome: "none" };
  const text = flat(ctx.sent);
  const sentence = flat(raw.sentence);
  if (sentence.length < 12 || sentence.split(" ").length < 3 || !text.includes(sentence)) return { outcome: "dropped", why: "quote" };

  const deadline = raw.deadline.trim();
  if (deadline) {
    const real = /^\d{4}-\d{2}-\d{2}$/.test(deadline) && !Number.isNaN(Date.parse(`${deadline}T00:00:00Z`)) && new Date(`${deadline}T00:00:00Z`).toISOString().slice(0, 10) === deadline;
    // The day before it arrived is allowed for: the email's own day may be a time zone behind UTC.
    if (!real || deadline < dayOf(ctx.receivedAt, -1) || deadline > dayOf(ctx.receivedAt, DEADLINE_WITHIN_DAYS) || !dateWritten(ctx.sent, deadline)) return { outcome: "dropped", why: "date" };
  }

  const after = applyEvent(ctx.standing, { kind: raw.kind, occurredAt: ctx.receivedAt, source: "email", decidedBy: "rules", stage: null });
  if (raw.stage !== after.stage) return { outcome: "dropped", why: "stage" };

  const lower = text.toLowerCase();
  const named = (s: string) => {
    const n = flat(s);
    return n.length >= 2 && lower.includes(n.toLowerCase()) ? n : "";
  };
  return {
    outcome: "kept",
    reading: {
      kind: raw.kind,
      stage: after.stage,
      quote: cleanQuote(sentence),
      role: named(raw.role).slice(0, 120),
      ask: oneLine(noContacts(raw.ask)).slice(0, 200),
      deadline: deadline || null,
      people: [...new Set(raw.people.map(named).filter(Boolean))].slice(0, 5).map((p) => p.slice(0, 80)),
    },
  };
}

/**
 * What marks a reading's row. It is not the email's own "email:<id>": the timeline's unique
 * key is (source, kind), so a reading that agrees with the rules' event for the same email
 * would otherwise be skipped as a repeat, and the comparison in shadow mode needs both.
 */
export const READING_REF = "reading:email:";

/** The row a kept reading is stored as: decided by "model", so the reducer ignores it and nothing lists it. */
export function readingEvent(c: Pick<ReaderCandidate, "applicationId" | "messageId" | "threadId" | "receivedAt">, r: KeptReading): NewApplicationEvent {
  return {
    applicationId: c.applicationId,
    kind: r.kind,
    occurredAt: c.receivedAt,
    source: "email",
    sourceRef: `${READING_REF}${c.messageId}`.slice(0, 600),
    threadId: c.threadId.slice(0, 200),
    decidedBy: "model",
    stage: null,
    summary: r.quote,
    deadline: r.deadline,
    ask: r.ask,
  };
}

/** One run of the reader, in counts. Never anything from an email. */
export interface ReaderOutcome {
  /** "off": the switch is off, so nothing was considered. */
  status: "off" | "skipped" | "ran";
  /** Why it did not run, or why it stopped early. */
  why?: string;
  /** Emails the model could have read this run. */
  waiting: number;
  /** Emails sent to the model. */
  sent: number;
  /** Readings that passed every check and were stored (not shown). */
  kept: number;
  /** Readings that failed a check and were dropped. */
  dropped: number;
  /** Emails the model had nothing to report on. */
  nothing: number;
  /** Calls that gave no usable answer; rules stand for those emails. */
  failed: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export const NOT_READ: ReaderOutcome = Object.freeze({ status: "off", waiting: 0, sent: 0, kept: 0, dropped: 0, nothing: 0, failed: 0, model: "", inputTokens: 0, outputTokens: 0, costUsd: 0 });

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** What the trace says about a reader run: counts and a reason only. */
export function readerNote(r: ReaderOutcome): string {
  if (r.status === "off") return "off in Settings: rules read every job email, and no text leaves Atlas";
  if (r.status === "skipped") return `not run: ${r.why ?? "unknown"}`;
  if (r.waiting === 0) return "nothing rules left undecided";
  const left = r.waiting - r.sent;
  return [
    `${n(r.sent, "email")} sent to the model`,
    `${n(r.kept, "reading")} kept in shadow (stored, not shown, no stage moved)`,
    `${r.dropped} dropped by a check`,
    `${r.nothing} with nothing to report`,
    r.failed ? `${r.failed} with no usable answer (rules stand, not sent again)` : "",
    left > 0 ? `${left} waiting for a later sync` : "",
    r.why ? `stopped early: ${r.why}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** The switch as Settings words it: what turning it on sends, to whom, and what happens to the answer. */
export const MODEL_READER_LABEL = "Let the AI model read job emails rules cannot decide";
export const modelReaderHint = (model: string): string =>
  `Off (the default): rules read every job email and none of its text leaves Atlas. On: an email that arrives from then on, from a company with an open application, that rules cannot decide is sent once to ${model}: its subject and its own words only (no quoted thread), without email addresses, phone numbers or links, at most ${MAX_MODEL_CHARS.toLocaleString("en-US")} characters, at most ${READER_DAILY_CAP} emails a day. Names stay in. On Gemini's free plan, Google may use what is sent to improve its products, and its reviewers may read it. For now the model's reading is only recorded: it is shown nowhere, pings nothing and never moves a stage.`;
