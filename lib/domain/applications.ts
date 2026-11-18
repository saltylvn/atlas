// The application tracker and Approval Queue helpers. Pure: no I/O.

import type { BriefMatch } from "./careerAgent";
import type { Application, ApplicationStatus, Approval, InboxItem, JobMatch } from "./types";

/** The Applications board columns, in order. "Saved" holds approved jobs you have not submitted yet. */
export const BOARD: { status: ApplicationStatus; title: string; color: string }[] = [
  { status: "saved", title: "To submit", color: "var(--c-grey)" },
  { status: "applied", title: "Applied", color: "var(--c-blue)" },
  { status: "replied", title: "Replied", color: "var(--c-orange)" },
  { status: "interview", title: "Interview", color: "var(--c-purple)" },
  { status: "offer", title: "Offer", color: "var(--c-green)" },
  { status: "rejected", title: "Rejected", color: "var(--c-red)" },
];

// ---------------------------------------------------------------------------
// Logging applications from email
//
// The Email Agent tags job emails by kind. A "thank you for applying" email puts the
// application on the board as Applied; later emails from that company move it forward
// (a reply -> Replied, an interview invite -> Interview, a rejection -> Rejected). An
// interview invite or rejection from a company with no application yet also logs one,
// since some companies never send a confirmation. Recruiter outreach never does: it is
// not an application. Statuses only move forward; Rejected is final unless an offer came.

export type MailKind = "interview" | "reply" | "rejection" | "confirmation" | "recruiter";

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
}

const RANK: Record<ApplicationStatus, number> = { saved: 0, applied: 1, replied: 2, interview: 3, offer: 4, rejected: 5 };
const FROM_KIND: Partial<Record<MailKind, ApplicationStatus>> = { confirmation: "applied", reply: "replied", interview: "interview", rejection: "rejected" };
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

export interface TrackerChanges {
  create: Omit<Application, "id" | "createdAt">[];
  update: { id: string; company: string; from: ApplicationStatus; status: ApplicationStatus; statusAt: string }[];
}

/** What the job emails change on the board. Safe to run again: nothing is logged twice. */
export function trackFromEmail(mails: JobMail[], apps: Application[], roleOf: (title: string) => string = () => ""): TrackerChanges {
  const out: TrackerChanges = { create: [], update: [] };
  const known = new Set(apps.map((a) => a.externalId).filter(Boolean));
  // Working copy: what the board will look like after earlier emails in this batch.
  const board = apps.map((a) => ({ id: a.id, company: a.company, status: a.status, statusAt: a.statusAt, isNew: false }));
  for (const m of [...mails].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))) {
    const target = FROM_KIND[m.kind];
    if (!target) continue;
    const company = companyFromMail(m);
    if (!company) continue;
    const app = board.find((a) => sameCompany(a.company, company));
    if (!app) {
      const externalId = `email:${m.messageId}`.slice(0, 600);
      if (known.has(externalId)) continue;
      known.add(externalId);
      const role = roleFromSubject(m.subject) || m.role || "";
      out.create.push({
        company,
        role: (role || ROLE_NOT_LISTED).slice(0, 200),
        type: "full-time",
        targetRole: role ? roleOf(role) : "",
        source: "Email",
        url: "",
        payText: "",
        tier: "semi",
        status: target,
        appliedOn: m.receivedAt.slice(0, 10),
        statusAt: m.receivedAt,
        notes: `From email: ${m.subject}`.slice(0, 2000),
        origin: "atlas",
        externalId,
      });
      board.push({ id: externalId, company, status: target, statusAt: m.receivedAt, isNew: true });
      continue;
    }
    // Forward only. A rejection closes anything short of an offer; nothing reopens a rejection.
    const forward = target === "rejected" ? app.status !== "offer" && app.status !== "rejected" : app.status !== "rejected" && RANK[target] > RANK[app.status];
    if (!forward || m.receivedAt < app.statusAt) continue;
    if (!app.isNew) {
      const prior = out.update.find((u) => u.id === app.id);
      if (prior) Object.assign(prior, { status: target, statusAt: m.receivedAt });
      else out.update.push({ id: app.id, company: app.company, from: app.status, status: target, statusAt: m.receivedAt });
    } else {
      const created = out.create.find((c) => c.externalId === app.id);
      if (created) Object.assign(created, { status: target, statusAt: m.receivedAt });
    }
    app.status = target;
    app.statusAt = m.receivedAt;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Thumbs on a match
//
// One gesture, one meaning: a thumbs up means you want the job, so its apply kit goes to
// your apply queue (the Approval Queue at the top of Career). Clearing the thumb, or a
// thumbs down, takes back a kit still waiting there. A job you already acted on (kept as
// To submit, or submitted) stays on your Applications board whatever the thumb says.
// Thumbs keep steering the ranking of later matches, as before.

export type Thumb = -1 | 0 | 1;

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
  if (actedOn) return { queue: false, withdraw: [], status: match.status, note: thumb === 1 ? "It is already on your Applications board." : "" };
  if (thumb === 1) return waiting.length ? { queue: false, withdraw: [], status: "pursuing", note: "Already in your apply queue." } : { queue: true, withdraw: [], status: "pursuing", note: "Added to your apply queue." };
  return { queue: false, withdraw: waiting, status: "new", note: waiting.length ? "Taken out of your apply queue." : "" };
}

/** What the Approval Queue shows for a match you gave a thumbs up (Semi-Automation). */
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
  const head = ["Company", "Role", "Type", "Target role", "Status", "Applied on", "Status updated", "Pay", "Source", "Link", "Notes"];
  const rows = apps.map((a) => [a.company, a.role, a.type, a.targetRole, a.status, a.appliedOn, a.statusAt.slice(0, 10), a.payText, a.source, a.url, a.notes].map(cell).join(","));
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
