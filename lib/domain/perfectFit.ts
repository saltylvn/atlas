// Perfect fit: the jobs you most want. You mark one with the Perfect fit button (a match's
// rating becomes 2). This file turns each into the facts the Career Mentor works from: what the
// posting asks for, which of it you have, what is missing, who you know there, and where the
// job stands. Rules only, no I/O. The Career Mentor's model may word the advice; it never adds facts.

import { contactForCompany } from "./career";
import { daysBetween } from "./dates";
import type { Observation } from "./mentor";
import type { Application, Approval, Contact, JobMatch, LocalDate } from "./types";

/** How many perfect fits one review looks at: enough to act on, few enough to finish. */
export const PERFECT_REVIEWED = 3;
/** A sent application this quiet is worth a follow-up. */
const QUIET_DAYS = 7;

export interface PerfectFitInput {
  today: LocalDate;
  /** Jobs marked Perfect fit, newest first. */
  perfect: readonly JobMatch[];
  approvals: readonly Approval[];
  applications: readonly Application[];
  /** Skills you marked as yours. */
  skills: readonly string[];
  /** Skills your resumes mention, or null when the resumes could not be read. */
  resumeSkills: readonly string[] | null;
  contacts: readonly Contact[];
}

export type PerfectStage = "apply-queue" | "not-queued" | "applied" | "answered";

export interface PerfectFit {
  match: JobMatch;
  /** Skills the posting asks for. */
  asks: string[];
  /** The ones you list as yours or your resumes mention. */
  have: string[];
  missing: string[];
  /** Yours, asked for, and on none of your resumes. Empty when the resumes could not be read. */
  notOnResume: string[];
  /** Experience the posting asks for, as read from it ("3+ years"), or "". */
  years: string;
  /** Someone you know there. */
  referral: string;
  stage: PerfectStage;
  /** Days in the queue, or since you applied. */
  days: number;
}

const lower = (xs: readonly string[]) => new Set(xs.map((s) => s.toLowerCase()));
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Each perfect fit you can still act on, with what it asks and where it stands. A job you dismissed is left out. */
export function perfectFits(input: PerfectFitInput): PerfectFit[] {
  const mine = lower(input.skills);
  const onResume = input.resumeSkills ? lower(input.resumeSkills) : null;
  const out: PerfectFit[] = [];
  for (const match of input.perfect) {
    if (match.rating < 2 || match.status === "dismissed") continue;
    const asks = [...new Set(match.skills ?? [])];
    const have = asks.filter((s) => mine.has(s.toLowerCase()) || onResume?.has(s.toLowerCase()));
    const kit = input.approvals.find((a) => a.matchId === match.id && a.status === "pending" && a.kind === "application");
    const app = input.applications.find((a) => a.externalId === `match:${match.key}` && a.status !== "saved");
    const applied = app?.appliedOn ?? null;
    const stage: PerfectStage = app ? (app.status === "applied" ? "applied" : "answered") : match.status === "applied" ? "applied" : kit ? "apply-queue" : "not-queued";
    out.push({
      match,
      asks,
      have,
      missing: asks.filter((s) => !have.includes(s)),
      notOnResume: onResume ? asks.filter((s) => mine.has(s.toLowerCase()) && !onResume.has(s.toLowerCase())) : [],
      years: /^Asks for: (.{1,60}) of experience$/m.exec(kit?.detail ?? "")?.[1] ?? "",
      referral: contactForCompany(match.company, [...input.contacts])?.name ?? "",
      stage,
      days: Math.max(0, applied ? daysBetween(applied, input.today) : daysBetween((kit?.createdAt ?? match.createdAt).slice(0, 10), input.today)),
    });
  }
  return out;
}

const WHERE: Record<PerfectStage, string> = {
  "apply-queue": "It is first in your Apply Queue, not applied to yet",
  "not-queued": "It is in no queue yet",
  applied: "You applied",
  answered: "The company has answered",
};

function fact(f: PerfectFit): string {
  const { match: m } = f;
  const parts = [`You marked ${m.title} at ${m.company} a perfect fit.`];
  if (f.asks.length) parts.push(`It asks for ${list(f.asks.slice(0, 8))}; you have ${f.have.length} of ${f.asks.length}${f.missing.length ? `, and not ${list(f.missing.slice(0, 4))}` : ""}.`);
  else parts.push("Its posting names no skill Atlas tracks.");
  if (f.years) parts.push(`It asks for ${f.years} of experience.`);
  if (f.notOnResume.length) parts.push(`No resume of yours mentions ${list(f.notOnResume.slice(0, 3))}, which you list as yours.`);
  if (f.referral) parts.push(`You know ${f.referral} there.`);
  parts.push(f.stage === "applied" ? `You applied ${days(f.days)} ago and have no reply yet.` : f.stage === "answered" ? "The company has answered your application." : `${WHERE[f.stage]}${f.days ? `, ${days(f.days)} after you chose it` : ""}.`);
  return parts.join(" ");
}

function action(f: PerfectFit): string {
  const { match: m } = f;
  const lead = f.have.length ? ` Lead your answers with ${list(f.have.slice(0, 3))}.` : "";
  if (f.stage === "answered") return `Reply to ${m.company} today, and write two short stories that show ${list((f.have.length ? f.have : f.asks).slice(0, 2)) || "the work the posting describes"}.`;
  if (f.stage === "applied") return f.days >= QUIET_DAYS ? `Send the follow-up to ${m.company} from your Apply Queue, and message one person who works there.` : `While you wait, write two short stories that show ${list((f.have.length ? f.have : f.asks).slice(0, 2)) || "the work the posting describes"}.`;
  if (f.referral) return `Message ${f.referral} about ${m.company} before you apply, then apply today.${lead}`;
  if (f.notOnResume.length) return `Add one line that shows ${f.notOnResume[0]} to your ${m.role} resume, then apply today.${lead}`;
  if (f.stage === "apply-queue") return `Apply to it on your MacBook today: it is first in your Apply Queue.${lead}`;
  return `Open Apply and give it a thumbs-up again so it is queued, then apply today.${lead}`;
}

/**
 * What the Career Mentor is told about the jobs you most want: one observation per perfect fit, the
 * ones not applied to first, at most three. Each id is stable ("perfect:<match id>") and its
 * metric changes when the job's stage or the gap changes, so the Career Mentor speaks again only
 * when something moved.
 */
export function perfectFitObservations(input: PerfectFitInput): Observation[] {
  const waiting = (f: PerfectFit) => (f.stage === "applied" || f.stage === "answered" ? 1 : 0);
  return perfectFits(input)
    .sort((a, b) => waiting(a) - waiting(b) || b.days - a.days)
    .slice(0, PERFECT_REVIEWED)
    .map((f) => ({
      id: `perfect:${f.match.id}`,
      area: "targeting" as const,
      severity: f.stage === "answered" ? 80 : f.stage === "applied" ? (f.days >= QUIET_DAYS ? 64 : 48) : 76 + Math.min(f.days, 5) * 2,
      metric: `${f.stage}/${f.missing.length}/${f.stage === "applied" ? (f.days >= QUIET_DAYS ? "quiet" : "sent") : Math.min(f.days, 5)}`,
      fact: fact(f),
      action: action(f),
    }));
}
