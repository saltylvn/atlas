// Career Agent, part 5b: the answer bank, application prep, follow-ups and the Friday
// scorecard. Pure: callers pass the applications, settings and dates in.

import { addDays, daysBetween, weekdayIndex } from "./dates";
import type { Application, Approval, LocalDate } from "./types";

// ---------------------------------------------------------------------------
// Answer bank

/** Which applications a question belongs to: every one, full-time jobs, or gigs. */
export type BankTrack = "contact" | "common" | "full-time" | "gig";

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
  { id: "salary", track: "full-time", question: "Salary expectations", starter: "Flexible for the right role and total package." },
  { id: "whyCompany", track: "full-time", question: "Why do you want to work at {company}?", starter: "I'm excited about {company} because ... As a {role}, I'd bring ...", hint: "In the Approval Queue, Gemini can draft the \"what I'd bring\" half for each job from your resume." },
  { id: "whyLooking", track: "full-time", question: "Why are you looking for a new role?", starter: "" },
  { id: "yearsExperience", track: "full-time", question: "Years of relevant experience", starter: "" },
  { id: "proposalOpener", track: "gig", question: "Proposal opener (Upwork and similar)", starter: "", hint: "The first lines of a proposal. {role} becomes the gig's title." },
  { id: "rate", track: "gig", question: "Hourly rate", starter: "" },
  { id: "availability", track: "gig", question: "Weekly availability", starter: "" },
];

export const BANK_TRACK_LABEL: Record<BankTrack, string> = { contact: "Contact details (for Safari autofill)", common: "Every application", "full-time": "Full-time jobs", gig: "Gigs" };

/** Questions an application of this type asks: the common ones plus its own track. */
export const questionsFor = (type: "full-time" | "gig"): readonly BankQuestion[] => ANSWER_BANK.filter((q) => q.track === "common" || q.track === type);

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
  /** Full-time unless the application is a gig. */
  type?: "full-time" | "gig";
  /** The summary of the resume that matches this job, and that resume's name. */
  roleSummary?: { resume: string; text: string } | null;
}

/** The answer bank, tailored to one job, ready to paste. Empty answers are left out. */
export function prepareAnswers(saved: Record<string, string> | undefined, job: { company: string; role: string }, opts: PrepareOptions = {}): PreparedAnswer[] {
  const out = questionsFor(opts.type ?? "full-time").flatMap((q): PreparedAnswer[] => {
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

/** A short follow-up you send yourself, tailored to the role. */
export function followUpEmail(a: Pick<Application, "company" | "role" | "appliedOn">, name: string): { subject: string; body: string } {
  const role = a.role && a.role !== "Role not listed" ? a.role : "open";
  const what = role === "open" ? `the role I applied for` : `the ${role} role`;
  return {
    subject: role === "open" ? `Following up on my application to ${a.company}` : `Following up: ${role} application`,
    body:
      `Hi,\n\nI applied for ${what} at ${a.company}${a.appliedOn ? ` on ${a.appliedOn}` : ""} and wanted to follow up. ` +
      `I'm still very interested and would welcome the chance to talk about how I can help the team. ` +
      `Is there anything else I can share for the review?\n\nThank you,\n${name}`,
  };
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
  };
}

/** Fridays get the scorecard in the brief. weekdayIndex: 0 = Monday ... 4 = Friday. */
export const isScorecardDay = (day: LocalDate) => weekdayIndex(day) === 4;
