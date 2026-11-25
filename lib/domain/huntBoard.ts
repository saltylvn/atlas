// The status board (the iPad view): where every job in your hunt stands, read-only. Pure.
//
// A job is in exactly one stage:
//   fits          good fits, waiting for your thumb
//   queue         in the Apply Queue: you gave a 👍 and have not applied yet
//   applied       sent, and still inside the first week
//   followUp      sent a week or more ago with no answer: time to follow up
//   followedUp    you followed up, and it is still inside the two weeks after that
//   talking       they answered: a reply, an interview or an offer
//   rejected      they said no
//   noLuck        sent, followed up, and still silent two weeks after the follow-up
//
// Nothing here applies, sends or changes anything.

import { openFits } from "./applyLane";
import { FOLLOW_UP_AFTER_DAYS } from "./careerPrep";
import { daysBetween } from "./dates";
import type { Application, Approval, JobMatch, LocalDate } from "./types";

/** Silent this long after your follow-up: a dead end. */
export const NO_LUCK_AFTER_DAYS = 14;

// "Dead end" (noLuck) comes before Rejected: it is where your own work on a job is done.
export const STAGES = ["fits", "queue", "applied", "followUp", "followedUp", "talking", "noLuck", "rejected"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  fits: "Good fits",
  queue: "Apply Queue",
  applied: "Applied",
  followUp: "Time to follow up",
  followedUp: "Followed up",
  talking: "In conversation",
  rejected: "Rejected",
  noLuck: "Dead end",
};

/** The stages that wait on you: a job leaves each only when you act (a thumb, applying, a follow-up). */
export const ACTION_STAGES: ReadonlySet<Stage> = new Set<Stage>(["fits", "queue", "followUp"]);

/** What each stage means, in a line, under its title. */
export const STAGE_HINT: Record<Stage, string> = {
  fits: "Waiting for your 👍 or 👎",
  queue: "You said yes; apply on your MacBook",
  applied: "Sent in the last week",
  followUp: `Silent for ${FOLLOW_UP_AFTER_DAYS} days or more`,
  followedUp: "You nudged them; still waiting",
  talking: "Replied, interviewing or an offer",
  rejected: "They said no",
  noLuck: `Silent ${NO_LUCK_AFTER_DAYS} days after your follow-up: your work here is done`,
};

export interface BoardCard {
  id: string;
  title: string;
  company: string;
  /** A short note for the stage: "applied 3d ago", "interview", "queued yesterday". */
  note: string;
  /** Who applied, once someone has. */
  by: "atlas" | "you" | "";
  url: string;
}

export interface HuntBoard {
  stages: Record<Stage, BoardCard[]>;
  /** Every application sent, and how many got any answer. */
  sent: number;
  answered: number;
}

const ago = (day: LocalDate | null, today: LocalDate): string => {
  if (!day) return "";
  const d = Math.max(0, daysBetween(day, today));
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
};
const STATUS_NOTE: Partial<Record<Application["status"], string>> = { replied: "replied", interview: "interview", offer: "offer" };

/** The day you sent a follow-up for an application: from the queue's record, or the note Atlas adds when you mark it sent. */
function followedUpOn(app: Application, approvals: readonly Approval[]): LocalDate | null {
  const sent = approvals.find((a) => a.kind === "follow-up" && a.applicationId === app.id && a.status === "approved" && a.decidedAt);
  if (sent?.decidedAt) return sent.decidedAt.slice(0, 10);
  const noted = [...app.notes.matchAll(/Followed up (\d{4}-\d{2}-\d{2})/g)].at(-1);
  return noted ? noted[1]! : null;
}

/** Every job in your hunt, sorted into its stage. Newest first inside each stage. */
export function huntBoard(input: { apps: readonly Application[]; approvals: readonly Approval[]; matches: readonly JobMatch[]; today: LocalDate }): HuntBoard {
  const { apps, approvals, matches, today } = input;
  const stages = Object.fromEntries(STAGES.map((s) => [s, [] as BoardCard[]])) as Record<Stage, BoardCard[]>;

  for (const m of openFits(matches)) stages.fits.push({ id: m.id, title: m.title, company: m.company, note: m.payText && m.payText !== "salary not listed" ? m.payText : "", by: "", url: m.url });

  // A 👍 puts a job in the Apply Queue, where it waits for you to apply on your MacBook.
  for (const kit of approvals.filter((a) => a.kind === "application" && a.status === "pending").sort((x, y) => y.createdAt.localeCompare(x.createdAt))) {
    stages.queue.push({ id: kit.id, title: kit.title, company: "", note: `queued ${ago(kit.createdAt.slice(0, 10), today)}`, by: "", url: kit.url });
  }

  const sent = apps.filter((a) => a.status !== "saved");
  for (const a of [...sent].sort((x, y) => (y.appliedOn ?? y.statusAt).localeCompare(x.appliedOn ?? x.statusAt))) {
    const by = a.tier === "auto" ? ("atlas" as const) : ("you" as const);
    const card = (note: string): BoardCard => ({ id: a.id, title: a.role, company: a.company, note, by, url: a.url });
    if (a.status === "rejected") stages.rejected.push(card(ago(a.statusAt.slice(0, 10), today)));
    else if (a.status !== "applied") stages.talking.push(card(STATUS_NOTE[a.status] ?? a.status));
    else {
      const nudged = followedUpOn(a, approvals);
      const since = a.appliedOn ?? a.statusAt.slice(0, 10);
      if (nudged) (daysBetween(nudged, today) >= NO_LUCK_AFTER_DAYS ? stages.noLuck : stages.followedUp).push(card(`followed up ${ago(nudged, today)}`));
      else (daysBetween(since, today) >= FOLLOW_UP_AFTER_DAYS ? stages.followUp : stages.applied).push(card(`applied ${ago(since, today)}`));
    }
  }
  return { stages, sent: sent.length, answered: sent.filter((a) => a.status !== "applied").length };
}
