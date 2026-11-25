// The application tracker and apply queue helpers. Pure: no I/O.

import type { BriefMatch } from "./careerAgent";
import { applyEvent, EVENT_LABEL, STAGE_LABEL, stageOf, stageOfStatus, statusOfStage } from "./pipeline";
import type { Application, ApplicationStage, ApplicationStatus, Approval, EventKind, InboxItem, JobMatch, NewApplicationEvent } from "./types";

/** The Applications board columns, in order. "Saved" holds approved jobs you have not submitted yet. */
export const BOARD: { status: ApplicationStatus; title: string; color: string }[] = [
  { status: "saved", title: "To submit", color: "var(--c-grey)" },
  { status: "applied", title: "Applied", color: "var(--c-slate)" },
  { status: "replied", title: "Replied", color: "var(--c-warn)" },
  { status: "interview", title: "Interview", color: "var(--c-indigo)" },
  { status: "offer", title: "Offer", color: "var(--c-green)" },
  { status: "rejected", title: "Rejected", color: "var(--c-red)" },
];

// ---------------------------------------------------------------------------
// Logging applications from email
//
// The Email Agent tags job emails by kind. A "thank you for applying" email puts the
// application on the board as Applied; later emails from that company move it forward
// (a reply, a request for times or for something -> Replied; an interview invite or an
// assessment -> Interview; an offer -> Offer; a rejection -> Rejected). Any of these from a
// company with no application yet also logs one, since some companies never send a
// confirmation. Recruiter outreach never does: it is not an application. Stages only move
// forward; Rejected is final unless an offer came.

export type MailKind = "interview" | "reply" | "rejection" | "confirmation" | "recruiter" | "assessment" | "scheduling" | "offer" | "info_request";

/** A job email, as the Email Agent tagged it. */
export interface JobMail {
  messageId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  receivedAt: string;
  kind: MailKind;
  /** The role its text names, once the Applications Agent has read it. */
  role?: string;
  /** The Gmail thread it belongs to. */
  threadId?: string;
  /** The cleaned sentence that decided its kind, when its text was read. */
  quote?: string;
}

// ---------------------------------------------------------------------------
// When an email may go on a timeline (docs/design-pipeline.md, 13: "unread mail waits")
//
// Each email is placed once (`index.placed` in `trackMail`), so what it was placed as is
// never corrected. A subject can be wrong ("Interview with Acme" over a confirmation or a
// rejection), so an email goes on a timeline only once its text has been read. An unread
// one waits for a run that reads it: late, not wrong. Every run and every page reaches the
// tracker through `jobMailsFrom` (lib/agents/career.ts), which asks here.

/** True once the Applications Agent has read this email's text: a verdict, or "none". */
export const textRead = (i: Pick<InboxItem, "textVerdict">): boolean => i.textVerdict !== undefined && i.textVerdict !== null;

/**
 * What the tracker may place an email as; null while it has to wait for its text.
 * `kind` is what the Email Agent called it, `read` whether its text was read.
 * `neverRead` is for mail no run will ever read (the one-time catch-up's emails that are
 * not in the inbox): there the subject is all there will ever be, so it is placed by its
 * subject, except that a subject cannot make an interview invite. It is a reply.
 */
export function kindToPlace(kind: MailKind, read: boolean, neverRead = false): MailKind | null {
  if (read) return kind;
  if (!neverRead) return null;
  return kind === "interview" ? "reply" : kind;
}

/** The timeline event each kind of job email is. Recruiter outreach is not about an application. */
export const EVENT_OF_MAIL: Partial<Record<MailKind, EventKind>> = {
  confirmation: "confirmation",
  reply: "reply",
  interview: "interview",
  rejection: "rejection",
  assessment: "assessment",
  scheduling: "scheduling",
  offer: "offer",
  info_request: "info_request",
};
/** A job email as the reducer sees it (lib/domain/pipeline.ts): decided by rules, so it applies at once. */
const happened = (kind: EventKind, m: Pick<JobMail, "receivedAt">) => ({ kind, occurredAt: m.receivedAt, source: "email" as const, decidedBy: "rules" as const, stage: null });
const ATS_NAMES = /^(greenhouse|lever|ashby|workday|icims|smartrecruiters|jobvite|bamboohr|workable|recruitee|teamtailor|breezy|rippling|linkedin|indeed|glassdoor|wellfound|no ?reply|notifications?|careers?|recruiting|talent|hiring|jobs)$/i;
/** A hiring system, an email address or a bare domain ("greenhouse-mail.io") is never a company. */
const NOT_A_COMPANY = (s: string) =>
  ATS_NAMES.test(s) || s.includes("@") || /^[\w-]+(\.[\w-]+)+$/.test(s) || /\b(greenhouse|lever\.co|ashby|workday|icims|smartrecruiters|jobvite|workable)\b/i.test(s);

/** When an email names no role, the board says so (the subject stays in the notes). */
export const ROLE_NOT_LISTED = "Role not listed";

const tidy = (s: string) =>
  s
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:,!.\-–—|]+|[\s:,!.\-–—|]+$/g, "")
    .trim();

/** The company an application email is about: from the subject first, else the sender's name. */
export function companyFromMail(m: Pick<JobMail, "fromName" | "fromEmail" | "subject">): string {
  const subject = m.subject.replace(/^(re|fwd?):\s*/i, "");
  const patterns = [
    // "We received your 3-60 Systems application"
    /\byour\s+([A-Z0-9][^!.,|:()]{1,60}?)\s+application\b/,
    /\b(?:applying|application|applied|interest)\s+(?:to|at|with|in)\s+(?:the\s+)?(?:[^@]*?\s+(?:role|position)\s+(?:at|with)\s+)?([A-Z0-9][^!.,|:()]{1,60}?)(?:\s*[!.,|:(]|\s+-\s|$)/i,
    /\b(?:at|with)\s+([A-Z0-9][^!.,|:()]{1,60}?)(?:\s*[!.,|:(]|\s+-\s|$)/,
    /\bfrom\s+([A-Z0-9][^!.,|:()]{1,60}?)(?:\s*[!.,|:(]|\s+-\s|$)/,
  ];
  for (const p of patterns) {
    const hit = p.exec(subject);
    const c = hit ? tidy(hit[1]!) : "";
    if (c && !NOT_A_COMPANY(c) && !/^(your|our|the|a|an|this|job)\b/i.test(c)) return c.slice(0, 160);
  }
  const name = tidy(m.fromName.replace(/\b(recruiting|recruitment|recruiter|careers?|talent(\s+acquisition)?|hiring(\s+team)?|team|jobs|no[- ]?reply|notifications?|people(\s+ops)?|hr|via\s+\w+|@\s*\w+)\b/gi, " "));
  if (name && !NOT_A_COMPANY(name)) return name.slice(0, 160);
  const domain = (m.fromEmail.split("@")[1] ?? "").split(".").slice(-2, -1)[0] ?? "";
  return domain && !NOT_A_COMPANY(domain) && !/mail$/i.test(domain) ? domain.charAt(0).toUpperCase() + domain.slice(1) : "";
}

/** The role, when the subject names it: "Your application for AI Engineer at Acme". */
export function roleFromSubject(subject: string): string {
  const s = subject.replace(/^(re|fwd?):\s*/i, "");
  const m =
    // The last "for"/"to" before "role" or "position" names it ("...for applying for the X role").
    /^.*\b(?:for|to)\s+(?:the\s+)?(.+?)\s+(?:role|position|opening|opportunity|job)\b/i.exec(s) ??
    /\b(?:application|applying|applied)\s+(?:for|to)\s+(?:the\s+)?(.+?)\s+(?:at|with)\s+/i.exec(s) ??
    /^(?:application|interview)[^:]*:\s*(.+?)(?:\s+(?:at|with|-)\s+.+)?$/i.exec(s);
  const role = m ? tidy(m[1]!) : "";
  return role.length >= 3 && role.length <= 120 && !/\b(you|your|us|our)\b/i.test(role) ? role : "";
}

export const sameCompany = (a: string, b: string) => {
  const n = (s: string) => ` ${s.toLowerCase().replace(/\b(inc|llc|ltd|corp|co|labs?|technologies|technology|ai|hq)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim()} `;
  const x = n(a);
  const y = n(b);
  return x.trim().length >= 2 && y.trim().length >= 2 && (x.includes(y) || y.includes(x));
};

// ---------------------------------------------------------------------------
// Emails from companies you applied to
//
// Companies often write from their own address with a subject that names nothing:
// "Regarding your application", "Your Acme application", "Update from Acme". The subject
// rules miss those, so every email from a company on your board is read too (not its
// newsletters or promotions, and not a bill, receipt or subscription). Its text then
// decides: a rejection or an interview invite makes it job mail, and the role it names
// fills in an application logged as "Role not listed".

/** How long after its last change an application still expects news. */
export const OPEN_FOR_DAYS = 120;
const OPEN: readonly ApplicationStatus[] = ["applied", "replied", "interview"];

/** The companies on your board still waiting on news: applied, replied or interviewing, recently. */
export function openCompanies(apps: Pick<Application, "company" | "status" | "statusAt">[], now: Date): string[] {
  const since = new Date(now.getTime() - OPEN_FOR_DAYS * 86_400_000).toISOString();
  return [...new Set(apps.filter((a) => OPEN.includes(a.status) && a.statusAt >= since && a.company.trim().length >= 2).map((a) => a.company))];
}

const PERSONAL_MAIL = /^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|aol|proton|protonmail)$/;

/** Which of these companies sent the email, by its domain or its name; null when none did. */
export function companyOfMail(item: Pick<InboxItem, "fromName" | "fromEmail" | "subject">, companies: readonly string[]): string | null {
  const domain = item.fromEmail.toLowerCase().split("@")[1] ?? "";
  const label = domain.split(".").slice(-2, -1)[0] ?? "";
  const names = [companyFromMail(item), PERSONAL_MAIL.test(label) ? "" : label].filter(Boolean);
  return companies.find((c) => names.some((n) => sameCompany(c, n))) ?? null;
}

/**
 * The company you applied to that sent this email, or null. Every email from that company
 * (its domain or its name) counts, except its newsletters and promotions. The caller also
 * leaves out bills, receipts and subscriptions (the Email Agent's other tags).
 */
export function fromAppliedCompany(item: Pick<InboxItem, "fromName" | "fromEmail" | "subject" | "category" | "reason">, companies: readonly string[]): string | null {
  if (companies.length === 0) return null;
  if (item.category === "noise" && /^(Mailing list|Gmail )/.test(item.reason)) return null;
  return companyOfMail(item, companies);
}

/** Notes mark for an application whose own email was read and does not name the role. */
export const ROLE_NOT_IN_EMAIL = "Atlas read the application email: it does not name the role.";

/** Applications logged as "Role not listed" whose own email can be read for the role: its Gmail id. */
export function rolesToLookUp(apps: Pick<Application, "id" | "role" | "externalId" | "notes">[]): { id: string; messageId: string }[] {
  return apps.flatMap((a) => {
    const m = /^email:([0-9a-f]{1,16})$/i.exec(a.externalId);
    return a.role === ROLE_NOT_LISTED && m && !a.notes.includes(ROLE_NOT_IN_EMAIL) ? [{ id: a.id, messageId: m[1]! }] : [];
  });
}

/**
 * Roles the read emails fill in: for each application still "Role not listed", the newest
 * read email from that company that names a role.
 */
export function rolesFromMail(items: Pick<InboxItem, "fromName" | "fromEmail" | "subject" | "receivedAt" | "textRole">[], apps: Pick<Application, "id" | "company" | "role">[]): { id: string; role: string }[] {
  const named = items.filter((i) => i.textRole).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  return apps.flatMap((a) => {
    if (a.role !== ROLE_NOT_LISTED) return [];
    const hit = named.find((i) => companyOfMail(i, [a.company]));
    return hit ? [{ id: a.id, role: hit.textRole! }] : [];
  });
}

// ---------------------------------------------------------------------------
// Which application an email is about (docs/design-pipeline.md, 5.3)
//
// A ladder, strongest signal first, that stops guessing when it runs out:
//   1. Its Gmail thread is already on an application's timeline: that application.
//   2. It names a role, and one application at that company has it.
//   3. It names no role, and the company has one open application.
//   4. It cannot be told (several open and no role named, or a role none of them has):
//      it is left for you to place, in the Pipeline's Needs you lane.
//   5. No application at that company: a new one, as before.
// Two cases are new applications rather than questions, because a "we received your
// application" is strong evidence that you applied: one that names a role no application
// there has, and one that arrives after an application there was closed (a confirmation
// never lands on an application that closed before it came).

type BoardApp = Pick<Application, "id" | "company" | "role" | "status" | "statusAt">;

export type Match = { to: "application"; id: string; by: "thread" | "role" | "company" } | { to: "new" } | { to: "ask"; candidates: string[] };

/** What is already on the timelines: which emails, and which application each Gmail thread belongs to. */
export interface EventIndex {
  placed: ReadonlySet<string>;
  threadOf: (threadId: string) => string | undefined;
}
export const NO_EVENTS: EventIndex = { placed: new Set(), threadOf: () => undefined };

/** The index the ladder reads, from the stored events (any order). */
export function eventIndex(rows: readonly { applicationId: string; sourceRef: string; threadId: string }[]): EventIndex {
  const threads = new Map<string, string>();
  for (const r of rows) if (r.threadId && r.sourceRef.startsWith("email:") && !threads.has(r.threadId)) threads.set(r.threadId, r.applicationId);
  return { placed: new Set(rows.map((r) => r.sourceRef)), threadOf: (t) => threads.get(t) };
}

/** How many job emails are held back for their text: about an application, unread, and on no timeline yet. */
export function mailWaiting(items: readonly (Pick<InboxItem, "messageId" | "textVerdict"> & { jobKind: MailKind | null })[], index: EventIndex = NO_EVENTS): number {
  return items.filter((i) => i.jobKind && EVENT_OF_MAIL[i.jobKind] && !textRead(i) && !index.placed.has(`email:${i.messageId}`.slice(0, 600))).length;
}

const LEVEL = /\b(senior|sr|staff|principal|lead|junior|jr|associate|mid|level|entry|i{1,3}|iv|the|of|and|a|an)\b/g;
const roleWords = (role: string) => new Set(role.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9+#]+/g, " ").replace(LEVEL, " ").split(" ").filter(Boolean));

/** Two titles for the same job: the same words once level and punctuation are set aside, or one a fuller form of the other ("Solutions Engineer", "Solutions Engineer, Mid-Market"). */
export function sameRole(a: string, b: string): boolean {
  const x = roleWords(a);
  const y = roleWords(b);
  if (x.size === 0 || y.size === 0) return false;
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  return [...small].every((w) => big.has(w));
}

const isOpen = (a: Pick<Application, "status">) => a.status !== "rejected";

/** Which application a job email is about; null when it is not about one (recruiter outreach, or no company can be read). */
export function matchMail(m: JobMail, apps: readonly BoardApp[], index: EventIndex = NO_EVENTS): Match | null {
  if (!EVENT_OF_MAIL[m.kind]) return null;
  const threaded = m.threadId ? index.threadOf(m.threadId) : undefined;
  if (threaded && apps.some((a) => a.id === threaded)) return { to: "application", id: threaded, by: "thread" };
  const company = companyFromMail(m);
  if (!company) return null;
  // You applied again: an application that closed before this confirmation came is not what it confirms.
  const there = apps.filter((a) => sameCompany(a.company, company) && !(m.kind === "confirmation" && !isOpen(a) && a.statusAt < m.receivedAt));
  if (there.length === 0) return { to: "new" };

  const named = roleFromSubject(m.subject) || m.role || "";
  if (named) {
    // The title word for word (level aside) beats a fuller or shorter form of it.
    const exact = there.filter((a) => sameRole(a.role, named) && roleWords(a.role).size === roleWords(named).size);
    const same = exact.length ? exact : there.filter((a) => sameRole(a.role, named));
    const pick = same.length === 1 ? same : same.filter(isOpen);
    if (pick.length === 1) return { to: "application", id: pick[0]!.id, by: "role" };
    if (same.length > 1) return { to: "ask", candidates: (pick.length ? pick : same).map((a) => a.id) };
    // No application there has that role. The only one, logged before any email named its role, is it.
    if (there.length === 1 && there[0]!.role === ROLE_NOT_LISTED) return { to: "application", id: there[0]!.id, by: "company" };
    return m.kind === "confirmation" ? { to: "new" } : { to: "ask", candidates: there.map((a) => a.id) };
  }

  const open = there.filter(isOpen);
  if (open.length === 1) return { to: "application", id: open[0]!.id, by: "company" };
  if (open.length > 1) return { to: "ask", candidates: open.map((a) => a.id) };
  // Every application there is closed: history on the latest one.
  const latest = [...there].sort((a, b) => b.statusAt.localeCompare(a.statusAt))[0]!;
  return { to: "application", id: latest.id, by: "company" };
}

export interface TrackerChanges {
  create: Omit<Application, "id" | "createdAt">[];
  /** Applications an email moved. `stage` is the finer stage behind `status`: an assessment and an interview are both status "interview". */
  update: { id: string; company: string; from: ApplicationStatus; status: ApplicationStatus; stage: ApplicationStage; statusAt: string }[];
}

export interface Tracked extends TrackerChanges {
  /** Each email put on a timeline this run, and the application it belongs to: its id, or the external id of one in `create`. */
  placed: { mail: JobMail; app: string }[];
  /** Emails that cannot be placed by rules: you choose, in the Pipeline's Needs you lane. */
  ask: { mail: JobMail; candidates: string[] }[];
}

/** The application an email logs when there is none for it yet, at the stage that kind of email means. */
function newFromMail(m: JobMail, company: string, stage: ApplicationStage, roleOf: (title: string) => string): Omit<Application, "id" | "createdAt"> {
  const role = roleFromSubject(m.subject) || m.role || "";
  const status = statusOfStage(stage);
  return {
    company,
    role: (role || ROLE_NOT_LISTED).slice(0, 200),
    targetRole: role ? roleOf(role) : "",
    source: "Email",
    url: "",
    payText: "",
    tier: "semi",
    status,
    stage,
    appliedOn: m.receivedAt.slice(0, 10),
    statusAt: m.receivedAt,
    notes: `From email: ${m.subject}`.slice(0, 2000),
    origin: "atlas",
    externalId: `email:${m.messageId}`.slice(0, 600),
  };
}

/**
 * What the job emails change: applications to log, applications to move, which timeline
 * each email goes on, and the emails only you can place. An email already on a timeline
 * (`index.placed`) is left alone, so each is handled once. Safe to run again.
 */
export function trackMail(mails: JobMail[], apps: Application[], roleOf: (title: string) => string = () => "", index: EventIndex = NO_EVENTS, force: ReadonlyMap<string, string> = new Map()): Tracked {
  const out: Tracked = { create: [], update: [], placed: [], ask: [] };
  // Working copy: what the board will look like after earlier emails in this batch.
  const board = apps.map((a) => ({ id: a.id, company: a.company, role: a.role, status: a.status, stage: stageOf(a), statusAt: a.statusAt, isNew: false }));
  for (const m of [...mails].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
    const kind = EVENT_OF_MAIL[m.kind];
    const ref = `email:${m.messageId}`.slice(0, 600);
    if (!kind || index.placed.has(ref)) continue;
    // `force` is your own answer for an email the ladder could not place: an application's id, or "new".
    const told = force.get(m.messageId);
    // An application logged from this very email is where it belongs (a run that stopped before its timeline was written).
    const own = apps.find((a) => a.externalId === ref);
    const match: Match | null = own ? { to: "application", id: own.id, by: "company" } : told === "new" ? { to: "new" } : told ? { to: "application", id: told, by: "company" } : matchMail(m, board, index);
    if (!match) continue;
    if (match.to === "ask") {
      out.ask.push({ mail: m, candidates: match.candidates });
      continue;
    }
    if (match.to === "new") {
      const company = companyFromMail(m);
      if (!company) continue;
      // Where a first email of this kind puts an application: an assessment is Assessment, not just "interview".
      const made = newFromMail(m, company, applyEvent(null, happened(kind, m)).stage, roleOf);
      out.create.push(made);
      out.placed.push({ mail: m, app: ref });
      board.push({ id: ref, company, role: made.role, status: made.status, stage: made.stage ?? stageOfStatus(made.status), statusAt: m.receivedAt, isNew: true });
      continue;
    }
    const app = board.find((a) => a.id === match.id);
    if (!app) continue;
    out.placed.push({ mail: m, app: app.id });
    // The Pipeline's one rule for what an event does (lib/domain/pipeline.ts): forward only,
    // a rejection closes anything short of an offer, and nothing reopens a rejection.
    const next = applyEvent({ stage: app.stage, stageAt: app.statusAt, lastHeardAt: null }, happened(kind, m));
    const status = statusOfStage(next.stage);
    // The stage decides, not the status: an assessment after an interview moves the stage while the status stays "interview".
    if (next.stage === app.stage) continue;
    if (!app.isNew) {
      const prior = out.update.find((u) => u.id === app.id);
      if (prior) Object.assign(prior, { status, stage: next.stage, statusAt: m.receivedAt });
      else out.update.push({ id: app.id, company: app.company, from: app.status, status, stage: next.stage, statusAt: m.receivedAt });
    } else {
      const created = out.create.find((c) => c.externalId === app.id);
      if (created) Object.assign(created, { status, stage: next.stage, statusAt: m.receivedAt });
    }
    app.status = status;
    app.stage = next.stage;
    app.statusAt = m.receivedAt;
  }
  return out;
}

/** An email only you can place, as the Needs you lane asks about it. */
export interface MailToPlace {
  messageId: string;
  company: string;
  /** "Interview invite", "Rejection"... */
  kind: string;
  subject: string;
  receivedAt: string;
  /** The applications it could be about. */
  choices: { id: string; role: string; stage: string }[];
}

/** The emails waiting for you to say which application they are about, newest first. One whose choices are not all on the board yet waits for the next sync. */
export function mailsToPlace(ask: Tracked["ask"], apps: readonly Application[]): MailToPlace[] {
  return ask
    .flatMap(({ mail: m, candidates }) => {
      const choices = candidates.flatMap((c) => {
        const a = apps.find((x) => x.id === c);
        return a ? [{ id: a.id, role: a.role, stage: STAGE_LABEL[stageOf(a)] }] : [];
      });
      if (choices.length !== candidates.length) return [];
      return [{ messageId: m.messageId, company: companyFromMail(m) || m.fromName, kind: EVENT_LABEL[EVENT_OF_MAIL[m.kind] ?? "reply"], subject: m.subject, receivedAt: m.receivedAt, choices }];
    })
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

/** What the job emails change on the board. Safe to run again: nothing is logged twice. */
export function trackFromEmail(mails: JobMail[], apps: Application[], roleOf: (title: string) => string = () => ""): TrackerChanges {
  const { create, update } = trackMail(mails, apps, roleOf);
  return { create, update };
}

/**
 * The timeline events for the emails `trackMail` placed: one per email, whether or not it
 * moved its application. `idOf` turns the external id of an application the run created
 * into its stored id. Storing them is safe to repeat: an email is on a timeline once.
 */
export function mailEvents(placed: Tracked["placed"], idOf: (app: string) => string | undefined): NewApplicationEvent[] {
  return placed.flatMap(({ mail: m, app }) => {
    const kind = EVENT_OF_MAIL[m.kind];
    const applicationId = idOf(app);
    if (!kind || !applicationId) return [];
    const said = (m.quote || m.subject).replace(/\s+/g, " ").trim();
    return [
      {
        applicationId,
        kind,
        occurredAt: m.receivedAt,
        source: "email" as const,
        sourceRef: `email:${m.messageId}`.slice(0, 600),
        threadId: (m.threadId ?? "").slice(0, 200),
        decidedBy: "rules" as const,
        stage: null,
        summary: said.length > 200 ? `${said.slice(0, 199)}…` : said,
      },
    ];
  });
}

// ---------------------------------------------------------------------------
// Thumbs on a match
//
// One gesture, one meaning: a thumbs up means you want the job, so its apply kit goes to
// your Apply Queue, on Career. Clearing the thumb, or a
// thumbs down, takes back a kit still waiting there. A job you already acted on (kept as
// To submit, or submitted) stays on your Applications board whatever the thumb says.
// Thumbs keep steering the ranking of later matches, as before.
// Perfect fit (2) is a stronger thumbs up: queued the same way, listed first in its queue,
// counted double in ranking, and given to the Career Mentor as a job you most want.

export type Thumb = -1 | 0 | 1 | 2;
/** The rating of a job you marked Perfect fit. */
export const PERFECT = 2;

export interface ThumbStep {
  /** Create the apply kit. */
  queue: boolean;
  /** Waiting kits to take back. */
  withdraw: string[];
  /** The match's status afterwards. */
  status: JobMatch["status"];
  /** What to tell you, or "" when there is nothing to say. */
  note: string;
}

export function thumbStep(match: Pick<JobMatch, "id" | "status">, approvals: readonly Pick<Approval, "id" | "matchId" | "status">[], thumb: Thumb): ThumbStep {
  const mine = approvals.filter((a) => a.matchId === match.id);
  const waiting = mine.filter((a) => a.status === "pending").map((a) => a.id);
  const actedOn = match.status === "applied" || mine.some((a) => a.status === "approved");
  const perfect = thumb === PERFECT;
  if (actedOn) return { queue: false, withdraw: [], status: match.status, note: perfect ? "Marked a perfect fit. It is already on your Applications board." : thumb === 1 ? "It is already on your Applications board." : "" };
  if (thumb >= 1) {
    if (waiting.length) return { queue: false, withdraw: [], status: "pursuing", note: perfect ? "Marked a perfect fit: first in your apply queue." : "Already in your apply queue." };
    return { queue: true, withdraw: [], status: "pursuing", note: perfect ? "Perfect fit: added first in your apply queue. The Career Mentor will look at how to land it." : "Added to your apply queue." };
  }
  return { queue: false, withdraw: waiting, status: "new", note: waiting.length ? "Taken out of your apply queue." : "" };
}

/**
 * Jobs you gave a 👍 that sit in no queue and were never acted on. Each should have a waiting
 * kit: the invariant is "a thumbs-up you have not applied to is in a queue". A job whose kit
 * you approved, or that is applied or dismissed, has moved on and is left alone.
 */
export function thumbsWithoutKit<M extends Pick<JobMatch, "id" | "rating" | "status">>(matches: readonly M[], approvals: readonly Pick<Approval, "matchId" | "status">[]): M[] {
  const held = new Set(approvals.filter((a) => a.matchId && a.status !== "rejected").map((a) => a.matchId));
  return matches.filter((m) => m.rating >= 1 && (m.status === "new" || m.status === "pursuing") && !held.has(m.id));
}

/** What the Apply Queue shows for a match you gave a thumbs up (Semi-Automation). */
export function approvalFor(m: JobMatch | BriefMatch, referral?: string, resumeUrl?: string): { title: string; detail: string } {
  const lines = [
    `${m.role} · ${m.payText} · ${m.source}${m.location ? ` · ${m.location}` : ""}`,
    referral ? `Referral: you know ${referral} there. Ask before you apply.` : "",
    resumeUrl ? `Resume: ${resumeUrl}` : `Use your ${m.role} resume.`,
    "Semi-Automation: open the posting, apply on their site, then mark it submitted.",
  ].filter(Boolean);
  return { title: `${m.title} at ${m.company}`.slice(0, 300), detail: lines.join("\n").slice(0, 4000) };
}

/** A cell that a spreadsheet will not run as a formula. */
function cell(v: string | null): string {
  let s = (v ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The tracker as CSV, for the optional export. */
export function applicationsCsv(apps: Application[]): string {
  const head = ["Company", "Role", "Target role", "Status", "Applied on", "Status updated", "Pay", "Source", "Link", "Notes"];
  const rows = apps.map((a) => [a.company, a.role, a.targetRole, a.status, a.appliedOn, a.statusAt.slice(0, 10), a.payText, a.source, a.url, a.notes].map(cell).join(","));
  return [head.join(","), ...rows].join("\r\n") + "\r\n";
}

/**
 * Which of your target roles a job title you applied for counts as. A posting titled
 * "Senior Solutions Engineer" is skipped when Atlas looks for matches, but once you have
 * applied to it, it is still a Solutions Engineer application: the level is set aside.
 */
export function targetRoleFor(title: string, roleOf: (title: string) => string): string {
  const direct = roleOf(title);
  if (direct) return direct;
  const plain = title.replace(/\b(senior|sr\.?|staff|principal|lead|junior|jr\.?|associate|mid[- ]level|entry[- ]level|i{1,3}|iv)\b/gi, " ").replace(/\s+/g, " ").trim();
  return plain && plain !== title ? roleOf(plain) : "";
}
