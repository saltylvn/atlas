// Career Agent, part 5b: the answer bank, application prep, follow-ups and the Friday
// scorecard. Pure: callers pass the applications, settings and dates in.

import { byMethod, type MethodSplit } from "./applyLane";
import { addDays, daysBetween, weekdayIndex } from "./dates";
import type { Application, Approval, LocalDate } from "./types";

// ---------------------------------------------------------------------------
// Answer bank

/** Where a question is used: "contact" details only by autofill, "common" ones in every apply kit. */
export type BankTrack = "contact" | "common";

export interface BankQuestion {
  id: string;
  question: string;
  /** Shown when you have not written an answer yet. {company} and {role} are filled in per job. */
  starter: string;
  track: BankTrack;
  /** A line under the question in the form, when it needs one. */
  hint?: string;
}

/**
 * The questions most applications ask. Your answers live in your settings row.
 *
 * Left out on purpose: demographic and EEO questions (gender, race, veteran and
 * disability status). Those are yours to answer on each form, and Atlas never stores or
 * suggests them. Work authorization is here but is never drafted: only you can say it.
 */
export const ANSWER_BANK: readonly BankQuestion[] = [
  // Contact details: used only by the Atlas Autofill extension, never shown in an apply kit.
  { id: "fullName", track: "contact", question: "Full name", starter: "", hint: "As you sign applications. Autofill splits it into first and last name when a form asks." },
  { id: "email", track: "contact", question: "Email for applications", starter: "" },
  { id: "phone", track: "contact", question: "Phone", starter: "" },
  { id: "city", track: "contact", question: "City and state", starter: "", hint: "For a short location field, e.g. Denver, CO." },
  { id: "intro", track: "common", question: "Tell us about yourself", starter: "", hint: "Each apply kit also offers the summary from the resume that matches the job." },
  { id: "workHistory", track: "common", question: "Work history (most recent first)", starter: "" },
  { id: "project", track: "common", question: "Tell us about a project you're proud of", starter: "" },
  { id: "aiExperience", track: "common", question: "Describe your experience with AI and LLMs", starter: "" },
  { id: "authorization", track: "common", question: "Are you authorized to work in the U.S.? Will you need sponsorship?", starter: "", hint: "Atlas never drafts this one." },
  { id: "startDate", track: "common", question: "When can you start?", starter: "Two weeks after an offer." },
  { id: "location", track: "common", question: "Location, remote and relocation", starter: "" },
  { id: "links", track: "common", question: "LinkedIn, GitHub and portfolio", starter: "" },
  { id: "salary", track: "common", question: "Salary expectations", starter: "Flexible for the right role and total package." },
  { id: "whyCompany", track: "common", question: "Why do you want to work at {company}?", starter: "I'm excited about {company} because ... As a {role}, I'd bring ...", hint: "In your apply queues, Gemini can draft the \"what I'd bring\" half for each job from your resume." },
  { id: "whyLooking", track: "common", question: "Why are you looking for a new role?", starter: "" },
  { id: "yearsExperience", track: "common", question: "Years of relevant experience", starter: "" },
  { id: "heardFrom", track: "common", question: "How did you hear about this job?", starter: "", hint: "Your default answer. Used as written in a text box; when a form offers a list, only if it is exactly one of the choices." },
];

export const BANK_TRACK_LABEL: Record<BankTrack, string> = { contact: "Contact details (for Safari autofill)", common: "Every application" };

/** The questions an apply kit answers: all but the contact details. */
export const kitQuestions = (): readonly BankQuestion[] => ANSWER_BANK.filter((q) => q.track === "common");

/** Fills {company} and {role} in an answer for one job. */
export function fillAnswer(text: string, job: { company: string; role: string }): string {
  return text.replace(/\{company\}/g, job.company || "your company").replace(/\{role\}/g, job.role || "this role");
}

export interface PreparedAnswer {
  id: string;
  question: string;
  answer: string;
  /** True when you have not written your own answer yet (the starter text is shown). */
  isStarter: boolean;
  /** Set when the answer comes from a resume rather than your answer bank: that resume's name. */
  fromResume?: string;
}

export interface PrepareOptions {
  /** The summary of the resume that matches this job, and that resume's name. */
  roleSummary?: { resume: string; text: string } | null;
}

/** The answer bank, tailored to one job, ready to paste. Empty answers are left out. */
export function prepareAnswers(saved: Record<string, string> | undefined, job: { company: string; role: string }, opts: PrepareOptions = {}): PreparedAnswer[] {
  const out = kitQuestions().flatMap((q): PreparedAnswer[] => {
    const own = (saved?.[q.id] ?? "").trim();
    const text = own || q.starter;
    if (!text) return [];
    return [{ id: q.id, question: fillAnswer(q.question, job), answer: fillAnswer(text, job), isStarter: !own }];
  });
  // The matching resume's own summary, offered beside your general intro. Never instead of it.
  const summary = opts.roleSummary?.text.trim();
  if (summary && summary !== (saved?.intro ?? "").trim()) {
    const at = out.findIndex((a) => a.id === "intro");
    out.splice(at < 0 ? 0 : at + 1, 0, { id: "introResume", question: "Tell us about yourself", answer: summary, isStarter: false, fromResume: opts.roleSummary!.resume });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Follow-ups

export const FOLLOW_UP_AFTER_DAYS = 7;

/**
 * Applications that went quiet: Applied at least a week ago with no movement since, and
 * no follow-up queued for them yet. Each gets one follow-up, never more.
 */
export function followUpsDue(apps: Application[], approvals: Pick<Approval, "kind" | "applicationId">[], today: LocalDate): Application[] {
  const queued = new Set(approvals.filter((a) => a.kind === "follow-up" && a.applicationId).map((a) => a.applicationId!));
  return apps.filter((a) => {
    if (a.status !== "applied" || !a.appliedOn || queued.has(a.id)) return false;
    const lastMove = a.statusAt.slice(0, 10) > a.appliedOn ? a.statusAt.slice(0, 10) : a.appliedOn;
    return daysBetween(lastMove, today) >= FOLLOW_UP_AFTER_DAYS;
  });
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-11-12" as "November 12": how a person writes a date in an email. */
export function emailDate(day: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? "");
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${month} ${Number(m[3])}` : "";
}

/**
 * A job title as you would say it in a sentence: without the place, work arrangement, level
 * codes or requisition numbers a posting tacks on ("Applied AI Engineer - USA", "Solutions
 * Engineer (Remote)", "Engineer II | R-1234"), and without a trailing "role" or "position".
 * "" when the application names no role.
 */
export function spokenRole(role: string): string {
  if (!role || /^role not listed$/i.test(role.trim())) return "";
  let r = role.replace(/\([^)]*\)|\[[^\]]*\]/g, " ");
  // Cut at a separator when what follows is a place, an arrangement or a code, not part of the title.
  r = r.replace(/\s+[-–—|,/:]\s+(remote|hybrid|on-?site|usa?|u\.s\.a?\.?|united states|north america|americas|emea|apac|canada|uk|[A-Z][a-z]+,\s*[A-Z]{2}|[A-Z]{2}|r-?\d+|req\b.*|#?\d{3,}).*$/i, "");
  r = r.replace(/\b(remote|hybrid|on-?site)\b\s*$/i, "").replace(/\b(role|position|job|opening)\s*$/i, "");
  return r.replace(/\s+/g, " ").replace(/[\s\-–—|,/:]+$/, "").trim().slice(0, 80);
}

export interface FollowUp {
  subject: string;
  body: string;
}

/** Three wordings, so a week's follow-ups do not all read the same. Each says the same three things. */
const WORDINGS: readonly ((f: { applied: string; company: string }) => string)[] = [
  (f) => `${f.applied} and wanted to follow up. I'm still very interested and would welcome the chance to talk about how I can help the team. Is there anything else I can share for your review?`,
  (f) => `${f.applied}, and I'm writing to check on its status. The work at ${f.company} is a strong match for what I do, and I'd be glad to walk through my background whenever it suits you. Please let me know if anything further would help.`,
  (f) => `${f.applied}. I remain interested and wanted to see whether there is an update on the timeline. I'm happy to send anything that would be useful, or to find a time to talk.`,
];

/** A stable pick per company: the same application always gets the same wording. */
const pick = (company: string, n: number) => [...company.toLowerCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % n;

/** A short follow-up you send yourself, tailored to the role. Rules only; see `acceptPolish` for the model's pass. */
export function followUpEmail(a: Pick<Application, "company" | "role" | "appliedOn">, name: string): FollowUp {
  const role = spokenRole(a.role);
  const company = a.company.replace(/\s+/g, " ").trim();
  const when = emailDate(a.appliedOn);
  const applied = `I applied ${role ? `for the ${role} role at` : "to"} ${company}${when ? ` on ${when}` : " recently"}`;
  return {
    subject: role ? `Following up on my ${role} application` : `Following up on my application to ${company}`,
    body: `Hi,\n\n${WORDINGS[pick(company, WORDINGS.length)]!({ applied, company })}\n\nThank you,\n${name.trim() || "Tyler"}`,
  };
}

/** A draft written by the older template, which doubled words and printed raw dates: it is written again. */
export const isOldFollowUp = (detail: string): boolean => /the role I applied for at| on \d{4}-\d{2}-\d{2} and wanted| role role |Following up: /.test(detail);

const wordsIn = (s: string) => s.toLowerCase().match(/[a-z']+/g) ?? [];

/**
 * Whether a model's rewrite of a follow-up may replace the rules' draft. It must keep the
 * facts (company, role, your name), add none (no number or link the draft did not have),
 * stay short, and read cleanly: no doubled word, no sentence said twice, no placeholder.
 * Returns the cleaned rewrite, or null to keep the rules' draft.
 */
export function acceptPolish(draft: FollowUp, polished: FollowUp, facts: { company: string; role: string; name: string }, extraNumbers: readonly string[] = []): FollowUp | null {
  const subject = polished.subject.replace(/\s+/g, " ").trim();
  const body = polished.body.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const text = `${subject}\n${body}`;
  const count = wordsIn(body).length;
  if (subject.length < 8 || subject.length > 110 || count < 35 || count > 130) return null;
  if (!body.toLowerCase().includes(facts.company.toLowerCase())) return null;
  if (facts.role && !text.toLowerCase().includes(facts.role.toLowerCase())) return null;
  if (!body.endsWith(facts.name)) return null;
  if (/[\[\]{}<>]|https?:|www\.|@|\bXX+\b|\bTBD\b|lorem/i.test(text)) return null;
  // No number the draft did not have (a date, a salary, a count made up), unless a fact it cites has it.
  const had = new Set([...(`${draft.subject} ${draft.body}`.match(/\d+/g) ?? []), ...extraNumbers]);
  if ((text.match(/\d+/g) ?? []).some((n) => !had.has(n))) return null;
  // No doubled word ("the the", "role role"), and no sentence said twice.
  const w = wordsIn(body);
  if (w.some((x, i) => i > 0 && x === w[i - 1] && x.length > 1)) return null;
  const sentences = body.split(/(?<=[.?!])\s+/).map((x) => x.toLowerCase().replace(/[^a-z ]/g, "").trim()).filter((x) => x.length > 12);
  if (new Set(sentences).size !== sentences.length) return null;
  return { subject, body };
}

// ---------------------------------------------------------------------------
// Friday scorecard

export interface Scorecard {
  from: LocalDate;
  to: LocalDate;
  sent: number;
  replies: number;
  interviews: number;
  offers: number;
  rejections: number;
  /** All time: share of sent applications that got any answer (reply, interview, offer or rejection). */
  responseRate: number;
  open: number;
  /** All time, by who applied: Atlas (after your approval) or you. The pilot's stop rule reads it. */
  method?: MethodSplit;
}

/** The last seven days of your job search, ending today. */
export function weeklyScorecard(apps: Application[], today: LocalDate): Scorecard {
  const from = addDays(today, -6);
  const inWeek = (day: string | null) => Boolean(day) && day! >= from && day! <= today;
  const movedTo = (s: Application["status"]) => apps.filter((a) => a.status === s && inWeek(a.statusAt.slice(0, 10))).length;
  const sent = apps.filter((a) => a.status !== "saved");
  const answered = sent.filter((a) => a.status !== "applied").length;
  return {
    from,
    to: today,
    sent: apps.filter((a) => inWeek(a.appliedOn)).length,
    replies: movedTo("replied"),
    interviews: movedTo("interview"),
    offers: movedTo("offer"),
    rejections: movedTo("rejected"),
    responseRate: sent.length ? Math.round((answered / sent.length) * 100) : 0,
    open: apps.filter((a) => ["applied", "replied", "interview", "offer"].includes(a.status)).length,
    method: byMethod(apps),
  };
}

/** Fridays get the scorecard in the brief. weekdayIndex: 0 = Monday ... 4 = Friday. */
export const isScorecardDay = (day: LocalDate) => weekdayIndex(day) === 4;
