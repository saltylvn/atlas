// The "Do next" queue for the job hunt: a rules-based list of the few actions that
// move applications forward, each with a reason and a minutes estimate.
// Pure: no I/O. Inputs are the career tracker snapshot, scored postings and contacts.

import { daysBetween, localDate } from "./dates";
import { ACTIVE_STAGES } from "./jobs";
import type { Contact, TrackedApplication, TrackedInterview, CareerSnapshot, JobPosting, LocalDate } from "./types";

export type DoNextKind = "thank-you" | "prep" | "due" | "follow-up" | "apply" | "close-out";

export interface DoNextItem {
  id: string;
  kind: DoNextKind;
  title: string;
  /** One sentence: why this is on the list now. */
  why: string;
  minutes: number;
  /** Higher sorts first. */
  score: number;
  company: string;
  applicationId?: string;
  /** Copy-ready message for follow-ups and thank-you notes. */
  draft?: { subject: string; body: string };
  /** Interview prep checklist. */
  checklist?: string[];
  /** A People contact linked to this company, for the composer (`/people?to=`). */
  contactId?: string;
  url?: string;
}

/** A short purpose line for the People composer (`about=` param). */
export function composeAbout(item: Pick<DoNextItem, "kind" | "company" | "title">): string {
  switch (item.kind) {
    case "thank-you":
      return `Thank you for the interview at ${item.company}`;
    case "follow-up":
      return `Follow up on my application at ${item.company}`;
    default:
      return item.title.slice(0, 120);
  }
}

/** Link into the People composer, pre-selected with an instant draft. */
export function composerHref(item: Pick<DoNextItem, "kind" | "company" | "title" | "contactId">): string | null {
  if (!item.contactId) return null;
  const q = new URLSearchParams({ to: item.contactId, via: "email", about: composeAbout(item) });
  return `/people?${q.toString()}#compose`;
}

export const CAREER_RULES = {
  /** Applied with no reply after this many days: send a follow-up. */
  followUpAfterDays: 7,
  /** Applied with no movement after this many days: close it out. */
  staleAfterDays: 30,
  /** Send a thank-you within this many hours after an interview ends. */
  thankYouWindowHours: 24,
  /** Prep for interviews starting within this many days. */
  prepWindowDays: 3,
  /** Postings at or above this score are worth applying to. */
  applyMinScore: 85,
  /** At most this many apply items, so the queue stays short. */
  maxApply: 3,
  /** At most this many apply items per company, so one big board doesn't crowd the rest. */
  maxApplyPerCompany: 1,
} as const;

export const MINUTES = {
  thankYou: 10,
  followUp: 10,
  due: 15,
  prepBase: 45,
  prepPerRound: 15,
  apply: 45,
  closeOut: 5,
} as const;

const isCancelled = (i: TrackedInterview) => /^cancel/i.test(i.status);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** A contact whose name or notes mention the company, for the People composer. */
export function contactForCompany(company: string, contacts: Contact[]): Contact | undefined {
  const c = norm(company);
  if (!c) return undefined;
  return contacts.find((p) => ` ${norm(p.notes)} `.includes(` ${c} `) || ` ${norm(p.name)} `.includes(` ${c} `));
}

/** The interview round number, e.g. "Interview 2" -> 2. Defaults to 1. */
export function roundNumber(round: string): number {
  const m = /(\d+)/.exec(round);
  return m ? Math.max(1, Number(m[1])) : 1;
}

export function prepChecklist(i: Pick<TrackedInterview, "company" | "role" | "round" | "meetingLink">): string[] {
  const n = roundNumber(i.round);
  const list = [
    `Re-read the ${i.role} posting and map 3 requirements to your stories`,
    `Research ${i.company}: product, customers, last 90 days of news`,
    "Prepare 3 STAR stories (a win, a hard customer, a technical save)",
    "Write 3 questions for them about the team and success in 90 days",
  ];
  if (n >= 2) list.push("Rehearse a 10-minute demo or whiteboard walkthrough");
  if (n >= 3) list.push("Prepare compensation range and start-date answers");
  list.push(i.meetingLink ? "Test the meeting link, camera and mic" : "Confirm the location or meeting link");
  return list;
}

export function followUpDraft(a: Pick<TrackedApplication, "company" | "role" | "appliedDate">, name: string): { subject: string; body: string } {
  return {
    subject: `Following up: ${a.role} application`,
    body:
      `Hi there,\n\nI applied for the ${a.role} role at ${a.company} on ${a.appliedDate.slice(0, 10)} and wanted to follow up. ` +
      `I'm still very interested and think my background in solutions engineering would be a strong fit. ` +
      `Is there anything else I can share to help with the review?\n\nThanks for your time,\n${name}`,
  };
}

export function thankYouDraft(i: Pick<TrackedInterview, "company" | "role" | "round">, name: string): { subject: string; body: string } {
  return {
    subject: `Thank you: ${i.role} ${i.round}`,
    body:
      `Hi,\n\nThank you for taking the time to speak with me today about the ${i.role} role at ${i.company}. ` +
      `I enjoyed the conversation and I'm even more excited about the team and the work ahead. ` +
      `Please let me know if there is anything else I can provide.\n\nBest,\n${name}`,
  };
}

const sameJob = (a: { company: string; role: string }, p: { company: string; title: string }) =>
  norm(a.company) === norm(p.company) && norm(a.role) === norm(p.title);

export interface DoNextInput {
  snapshot: CareerSnapshot | null;
  postings?: JobPosting[];
  contacts?: Contact[];
  now: Date;
  today: LocalDate;
  timeZone: string;
  displayName: string;
}

export function buildDoNext(input: DoNextInput): DoNextItem[] {
  const { snapshot, postings = [], contacts = [], now, today, timeZone, displayName } = input;
  const items: DoNextItem[] = [];
  const nowMs = now.getTime();
  const link = (company: string) => contactForCompany(company, contacts)?.id;

  if (snapshot) {
    const apps = new Map(snapshot.applications.map((a) => [a.applicationId, a]));
    const covered = new Set<string>();

    for (const i of snapshot.interviews) {
      if (isCancelled(i)) continue;
      const startMs = new Date(i.start).getTime();
      const endMs = new Date(i.end || i.start).getTime();
      const app = apps.get(i.applicationId);
      if (app && !ACTIVE_STAGES.includes(app.stage)) continue;

      // Thank-you note: the interview ended within the window.
      const hoursSince = (nowMs - endMs) / 3_600_000;
      if (hoursSince >= 0 && hoursSince <= CAREER_RULES.thankYouWindowHours) {
        const left = Math.max(0, Math.round(CAREER_RULES.thankYouWindowHours - hoursSince));
        items.push({
          id: `thank-you:${i.interviewId}`,
          kind: "thank-you",
          title: `Send a thank-you to ${i.company}`,
          why: `${i.round} ended ${Math.max(0, Math.round(hoursSince))}h ago. Thank-you notes land best within 24h (${left}h left).`,
          minutes: MINUTES.thankYou,
          score: 100 + left,
          company: i.company,
          applicationId: i.applicationId,
          draft: thankYouDraft(i, displayName),
          contactId: link(i.company),
        });
        covered.add(i.applicationId);
        continue;
      }

      // Prep: the interview starts within the window.
      if (startMs > nowMs) {
        const days = daysBetween(today, localDate(new Date(startMs), timeZone));
        if (days <= CAREER_RULES.prepWindowDays) {
          const n = roundNumber(i.round);
          const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
          items.push({
            id: `prep:${i.interviewId}`,
            kind: "prep",
            title: `Prep for ${i.company} ${i.round}`,
            why: `${i.round} for ${i.role} is ${when}. Prep now while there is time to fill gaps.`,
            minutes: MINUTES.prepBase + MINUTES.prepPerRound * (n - 1),
            score: 96 - days * 4,
            company: i.company,
            applicationId: i.applicationId,
            checklist: prepChecklist(i),
            url: i.meetingLink || undefined,
          });
          covered.add(i.applicationId);
        }
      }
    }

    for (const a of snapshot.applications) {
      if (!ACTIVE_STAGES.includes(a.stage)) continue;
      const due = a.nextActionDue?.slice(0, 10);

      // The application's next action from its notes, when due (skip if a prep or thank-you item already covers it).
      if (a.nextAction && due && due <= today && !covered.has(a.applicationId)) {
        const late = daysBetween(due, today);
        items.push({
          id: `due:${a.applicationId}`,
          kind: "due",
          title: `${a.company}: ${a.nextAction}`,
          why: late === 0 ? "Its next step is due today." : `Its next step was due ${late} day${late === 1 ? "" : "s"} ago.`,
          minutes: MINUTES.due,
          score: 90 + Math.min(late, 5),
          company: a.company,
          applicationId: a.applicationId,
          contactId: link(a.company),
          url: a.postingUrl || undefined,
        });
        continue;
      }

      if (a.stage !== "Applied" || !a.appliedDate) continue;
      const lastMove = (a.stageUpdatedAt || a.appliedDate).slice(0, 10);
      const quiet = daysBetween(lastMove > a.appliedDate.slice(0, 10) ? lastMove : a.appliedDate.slice(0, 10), today);
      const sinceApplied = daysBetween(a.appliedDate.slice(0, 10), today);

      if (quiet >= CAREER_RULES.staleAfterDays) {
        items.push({
          id: `close-out:${a.applicationId}`,
          kind: "close-out",
          title: `Close out ${a.company}`,
          why: `No reply in ${quiet} days. Move it to Rejected on the Applications board so the pipeline reflects reality.`,
          minutes: MINUTES.closeOut,
          score: 40 + Math.min(quiet - CAREER_RULES.staleAfterDays, 10),
          company: a.company,
          applicationId: a.applicationId,
          url: a.postingUrl || undefined,
        });
      } else if (sinceApplied >= CAREER_RULES.followUpAfterDays) {
        items.push({
          id: `follow-up:${a.applicationId}`,
          kind: "follow-up",
          title: `Follow up with ${a.company}`,
          why: `Applied ${sinceApplied} days ago with no reply. A short nudge after a week roughly doubles reply odds.`,
          minutes: MINUTES.followUp,
          score: 70 + Math.min(sinceApplied - CAREER_RULES.followUpAfterDays, 10),
          company: a.company,
          applicationId: a.applicationId,
          draft: followUpDraft(a, displayName),
          contactId: link(a.company),
          url: a.postingUrl || undefined,
        });
      }
    }
  }

  // New high-scoring postings you haven't applied to.
  const tracked = snapshot?.applications ?? [];
  postings
    .filter((p) => p.score >= CAREER_RULES.applyMinScore && !tracked.some((a) => sameJob(a, p)))
    .sort((a, b) => b.score - a.score || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .filter(
      (p, idx, all) =>
        all.slice(0, idx).filter((q) => norm(q.company) === norm(p.company)).length < CAREER_RULES.maxApplyPerCompany,
    )
    .slice(0, CAREER_RULES.maxApply)
    .forEach((p) => {
      items.push({
        id: `apply:${p.id}`,
        kind: "apply",
        title: `Apply: ${p.title}`,
        why: `${p.company} · match ${p.score} (${p.matched.join(", ") || "title"}). Early applicants get read first.`,
        minutes: MINUTES.apply,
        score: 50 + (p.score - CAREER_RULES.applyMinScore),
        company: p.company,
        url: p.url,
      });
    });

  return items.sort((a, b) => b.score - a.score || a.minutes - b.minutes || a.id.localeCompare(b.id));
}

export function totalMinutesOf(items: DoNextItem[]): number {
  return items.reduce((n, i) => n + i.minutes, 0);
}

export const KIND_LABEL: Record<DoNextKind, string> = {
  "thank-you": "Thank-you",
  prep: "Prep",
  due: "Due",
  "follow-up": "Follow up",
  apply: "Apply",
  "close-out": "Close out",
};
