// The Pipeline: where an application stands, worked out from what happened to it
// (docs/design-pipeline.md, 5.1 and 5.2). Pure: no I/O.
//
// Every application has a timeline of events: you applied, their email arrived, you
// followed up, you moved it by hand. `applyEvent` is the one place that decides what an
// event does to the stage, and `project` replays a whole timeline. The rules are the
// tracker's, unchanged: stages move forward only, a rejection closes anything short of an
// offer, nothing reopens a closed application, and an event older than the last move is
// only history. What is new is the finer stage and that a stage you set yourself always wins.

import type { Application, ApplicationEvent, ApplicationStage, ApplicationStatus, EventKind, NewApplicationEvent } from "./types";

export const STAGE_LABEL: Record<ApplicationStage, string> = {
  saved: "To submit",
  applied: "Applied",
  in_review: "In review",
  screen: "Screen",
  assessment: "Assessment",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const STATUS_OF: Record<ApplicationStage, ApplicationStatus> = {
  saved: "saved",
  applied: "applied",
  in_review: "replied",
  screen: "interview",
  assessment: "interview",
  interview: "interview",
  offer: "offer",
  rejected: "rejected",
  withdrawn: "rejected",
};

/** The board status a stage reads as. */
export const statusOfStage = (stage: ApplicationStage): ApplicationStatus => STATUS_OF[stage];

/** The stage a bare status means, when nothing finer is known. */
export const stageOfStatus = (status: ApplicationStatus): ApplicationStage => (status === "replied" ? "in_review" : status);

/**
 * An application's stage. The stored stage is trusted only while it agrees with the
 * status; otherwise (a row from before the Pipeline, or one a status-only writer moved)
 * the status decides.
 */
export function stageOf(a: Pick<Application, "status" | "stage">): ApplicationStage {
  return a.stage && STATUS_OF[a.stage] === a.status ? a.stage : stageOfStatus(a.status);
}

/** The stage to store when a status is picked: the finer stage is kept if it already reads as that status. */
export function stageForStatus(a: Pick<Application, "status" | "stage">, status: ApplicationStatus): ApplicationStage {
  const now = stageOf(a);
  return STATUS_OF[now] === status ? now : stageOfStatus(status);
}

// A screen, an assessment and an interview come in no fixed order, so they share a rank:
// among them the latest one is where you are.
const RANK: Record<ApplicationStage, number> = { saved: 0, applied: 1, in_review: 2, screen: 3, assessment: 3, interview: 3, offer: 4, rejected: 9, withdrawn: 9 };
const CLOSED: readonly ApplicationStage[] = ["rejected", "withdrawn"];

/** What an event of each kind says about the stage. A follow-up says nothing; "stage_set" carries its own. */
const STAGE_OF_KIND: Partial<Record<EventKind, ApplicationStage>> = {
  saved: "saved",
  applied: "applied",
  confirmation: "applied",
  reply: "in_review",
  info_request: "in_review",
  scheduling: "in_review",
  screen: "screen",
  assessment: "assessment",
  interview: "interview",
  offer: "offer",
  rejection: "rejected",
  withdrawn: "withdrawn",
};

/** Emails that count as hearing back. The automatic "we received your application" does not. */
export const HEARD: readonly EventKind[] = ["reply", "info_request", "scheduling", "screen", "assessment", "interview", "offer", "rejection"];

export const EVENT_LABEL: Record<EventKind, string> = {
  saved: "Saved to submit",
  applied: "Applied",
  confirmation: "Application received",
  reply: "They replied",
  info_request: "They asked for something",
  scheduling: "Scheduling request",
  screen: "Screen",
  assessment: "Assessment",
  interview: "Interview invite",
  offer: "Offer",
  rejection: "Rejection",
  withdrawn: "You withdrew",
  follow_up: "You followed up",
  stage_set: "Stage set",
};

/** One hue per kind of answer, for its dot or badge only (the Atlas look). Your own moves have none. */
export const KIND_HUE: Partial<Record<EventKind, string>> = {
  reply: "var(--c-warn)",
  info_request: "var(--c-warn)",
  scheduling: "var(--c-warn)",
  screen: "var(--c-slate)",
  assessment: "var(--c-indigo)",
  interview: "var(--c-indigo)",
  offer: "var(--c-green)",
  rejection: "var(--c-red)",
};

/** One hue per stage, for its badge only (the Atlas look). */
export const STAGE_HUE: Record<ApplicationStage, string> = {
  saved: "var(--c-grey)",
  applied: "var(--c-slate)",
  in_review: "var(--c-warn)",
  screen: "var(--c-slate)",
  assessment: "var(--c-indigo)",
  interview: "var(--c-indigo)",
  offer: "var(--c-green)",
  rejected: "var(--c-red)",
  withdrawn: "var(--c-grey)",
};

/** Where an application stands. */
export interface Standing {
  stage: ApplicationStage;
  /** When it last moved. */
  stageAt: string;
  lastHeardAt: string | null;
}

type Happened = Pick<ApplicationEvent, "kind" | "occurredAt" | "source" | "decidedBy" | "stage">;

const heardBack = (e: Happened) => e.source === "email" && HEARD.includes(e.kind);

/** Where an application stands as its row says, for events that arrive later. */
export function standingOf(a: Pick<Application, "status" | "stage" | "statusAt" | "lastHeardAt">): Standing {
  return { stage: stageOf(a), stageAt: a.statusAt, lastHeardAt: a.lastHeardAt ?? null };
}

/** What one event does to where an application stands. `before` is null for its first event. */
export function applyEvent(before: Standing | null, e: Happened): Standing {
  // A model's reading is a suggestion: it changes nothing until you confirm it (5.6).
  if (e.decidedBy === "model") return before ?? { stage: "applied", stageAt: e.occurredAt, lastHeardAt: null };
  const lastHeardAt = heardBack(e) && e.occurredAt > (before?.lastHeardAt ?? "") ? e.occurredAt : (before?.lastHeardAt ?? null);
  const target = e.kind === "stage_set" ? e.stage : (STAGE_OF_KIND[e.kind] ?? null);
  if (!before) return { stage: target ?? "applied", stageAt: e.occurredAt, lastHeardAt };
  const stay: Standing = { ...before, lastHeardAt };
  if (!target || target === before.stage) return stay;
  // A stage set outright wins, in any direction.
  if (e.kind === "stage_set") return { stage: target, stageAt: e.occurredAt, lastHeardAt };
  // Older than the last move: history only.
  if (e.occurredAt < before.stageAt) return stay;
  if (CLOSED.includes(before.stage)) return stay;
  const moves = CLOSED.includes(target) ? !(target === "rejected" && before.stage === "offer") : RANK[target] >= RANK[before.stage];
  return moves ? { stage: target, stageAt: e.occurredAt, lastHeardAt } : stay;
}

/** Where an application stands, replayed from its whole timeline; null when it has no events. */
export function project(events: readonly Happened[]): Standing | null {
  return [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)).reduce<Standing | null>((s, e) => applyEvent(s, e), null);
}

/** The newest time the company wrote among these events, or `prior` when none is newer. */
export function heardAt(events: readonly Happened[], prior: string | null | undefined): string | null {
  return events.filter(heardBack).reduce<string | null>((latest, e) => (e.occurredAt > (latest ?? "") ? e.occurredAt : latest), prior ?? null);
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * An event that did not come from an email: your own click, or the Apply Agent. `ref`
 * names what caused it, so the same click or run is never logged twice.
 */
export function ownEvent(
  applicationId: string,
  kind: EventKind,
  occurredAt: string,
  ref: string,
  opts: { source?: "you" | "apply-agent"; stage?: ApplicationStage; summary?: string } = {},
): NewApplicationEvent {
  const source = opts.source ?? "you";
  return {
    applicationId,
    kind,
    occurredAt,
    source,
    sourceRef: ref.slice(0, 600),
    threadId: "",
    decidedBy: source === "you" ? "you" : "rules",
    stage: kind === "stage_set" ? (opts.stage ?? "applied") : null,
    summary: clip(opts.summary ?? EVENT_LABEL[kind], 200),
  };
}

/**
 * The event for an application that was just put at `stage` by you or the Apply Agent.
 * `before` is the row as it was, or null for a new one. "Saved" and "Applied" are logged
 * as what they are when the timeline would land there anyway; anything else, or a move the
 * forward-only rule would not make by itself, is logged as the stage being set outright.
 * So replaying the timeline always gives the stage the row was given.
 */
export function stageEvent(
  before: Pick<Application, "status" | "stage" | "statusAt" | "lastHeardAt"> | null,
  applicationId: string,
  stage: ApplicationStage,
  occurredAt: string,
  ref: string,
  opts: { source?: "you" | "apply-agent"; summary?: string } = {},
): NewApplicationEvent {
  if (stage === "saved" || stage === "applied") {
    const plain = ownEvent(applicationId, stage, occurredAt, ref, opts);
    if (applyEvent(before ? standingOf(before) : null, plain).stage === stage) return plain;
  }
  return ownEvent(applicationId, "stage_set", occurredAt, ref, { ...opts, stage, summary: opts.summary ?? `Set to ${STAGE_LABEL[stage]}` });
}

// ---------------------------------------------------------------------------
// An application's page: how far it got, and its timeline

export interface Step {
  label: string;
  state: "done" | "current" | "todo";
}

/** The open stage a timeline got furthest to; "applied" when it has no events. */
export function furthest(events: readonly Happened[]): ApplicationStage {
  let standing: Standing | null = null;
  let best: ApplicationStage = "applied";
  for (const e of [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    standing = applyEvent(standing, e);
    if (!CLOSED.includes(standing.stage) && RANK[standing.stage] >= RANK[best]) best = standing.stage;
  }
  return best;
}

/**
 * The four steps on an application's page. An open application is at one of them; a closed
 * one shows how far it got (`reached`, from `furthest`) with nothing current. The third
 * step is named for what it actually is: a screen, an assessment or an interview.
 */
export function stepsFor(stage: ApplicationStage, reached: ApplicationStage = "applied"): { steps: Step[]; closed: "Rejected" | "Withdrawn" | null } {
  const closed = stage === "rejected" ? "Rejected" : stage === "withdrawn" ? "Withdrawn" : null;
  const shown = closed ? reached : stage;
  const talking = RANK[shown] === 3 ? STAGE_LABEL[shown] : STAGE_LABEL.interview;
  const labels = [STAGE_LABEL.applied, STAGE_LABEL.in_review, talking, STAGE_LABEL.offer];
  // Rank 1 (Applied) is the first step; "To submit" (rank 0) is before all of them.
  const here = RANK[shown] - 1;
  return { steps: labels.map((label, i) => ({ label, state: i < here || (closed && i === here) ? "done" : i === here ? "current" : "todo" })), closed };
}

export interface TimelineRow {
  id: string;
  kind: EventKind;
  title: string;
  /** For an email: its subject, or the one sentence the reader kept. Else "". */
  said: string;
  at: string;
  via: "Email" | "You" | "Atlas" | "Calendar";
}

const VIA: Record<ApplicationEvent["source"], TimelineRow["via"]> = { email: "Email", you: "You", "apply-agent": "Atlas", atlas: "Atlas", calendar: "Calendar" };

/** What an event is called on a timeline: an email by its kind, your own move or Atlas's by what was done. */
export const eventTitle = (e: Pick<ApplicationEvent, "kind" | "source" | "summary">): string => (e.source === "email" ? EVENT_LABEL[e.kind] : e.summary || EVENT_LABEL[e.kind]);

/** A timeline as its page lists it: newest first. An email shows what kind it was and what it said; your own moves say what you did. */
export function timelineRows(events: readonly ApplicationEvent[]): TimelineRow[] {
  return [...events]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .map((e) => {
      const mail = e.source === "email";
      return { id: e.id, kind: e.kind, title: eventTitle(e), said: mail && e.summary !== EVENT_LABEL[e.kind] ? e.summary : "", at: e.occurredAt, via: VIA[e.source] };
    });
}

