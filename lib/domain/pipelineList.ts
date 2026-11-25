// The Pipeline page: every application as one row, the filters over them, the two ways to
// group them, and the Needs you lane on top (docs/design-pipeline.md, 7). Pure: no I/O.
//
// A row says where an application stands (its stage), the newest thing on its timeline,
// when the company last wrote, and whether an answer is still unread. "Quiet" is not a
// stage: it is worked out from how long there has been no news (5.2).

import { ROLE_NOT_LISTED, sameCompany, type MailToPlace } from "./applications";
import { FOLLOW_UP_AFTER_DAYS } from "./careerPrep";
import { eventTitle, furthest, STAGE_LABEL, stageOf, stepsFor } from "./pipeline";
import type { Application, ApplicationEvent, ApplicationStage, EventKind, Notice } from "./types";

/** No news for this long and an open application has gone quiet: the same week the follow-up rule waits. */
export const QUIET_AFTER_DAYS = FOLLOW_UP_AFTER_DAYS;

export const FILTERS = ["all", "active", "quiet", "closed"] as const;
export type Filter = (typeof FILTERS)[number];
export const FILTER_LABEL: Record<Filter, string> = { all: "All", active: "Active", quiet: "Quiet", closed: "Closed" };

/** "board" is the six-column grid, kept for a wide screen. */
export const VIEWS = ["stage", "company", "board"] as const;
export type View = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<View, string> = { stage: "By stage", company: "By company", board: "Board" };

/** The filter or view a link asked for, or the first one when it asked for none it knows. */
export const pick = <T extends string>(options: readonly T[], asked: string | undefined): T => options.find((o) => o === asked) ?? options[0]!;

/** What the page reads of an event: no email ids, no threads. */
export type ListedEvent = Pick<ApplicationEvent, "applicationId" | "kind" | "occurredAt" | "source" | "decidedBy" | "stage" | "summary">;

export interface PipelineRow {
  id: string;
  company: string;
  /** "" while no email has named it. */
  role: string;
  stage: ApplicationStage;
  /** Open and in motion, open with no news for a week, or over. Every row is exactly one. */
  state: Exclude<Filter, "all">;
  /** The newest thing on its timeline; null when the timeline is empty. */
  latest: { kind: EventKind; title: string; at: string } | null;
  /** When the company last wrote, not counting "we received your application". */
  lastHeardAt: string | null;
  /** Whole days with no news, when it has gone quiet. */
  quietDays: number | null;
  /** For a closed one: the step it got as far as. */
  reached: string | null;
  /** Answers in Heard back not opened yet. */
  unread: number;
  /** Its newest activity: what the list is ordered by. */
  activeAt: string;
}

const CLOSED: readonly ApplicationStage[] = ["rejected", "withdrawn"];
const DAY_MS = 86_400_000;
const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);
const newest = (...isos: (string | null | undefined)[]): string => isos.reduce<string>((best, iso) => (iso && ms(iso) > ms(best) ? iso : best), "");

/**
 * Every application as the Pipeline lists it, newest activity first. `events` is every
 * timeline event (any order); `notices` is the Heard back feed, for the unread dot.
 */
export function pipelineRows(
  apps: readonly Application[],
  events: readonly ListedEvent[],
  notices: readonly Pick<Notice, "applicationId" | "seenAt">[],
  now: Date,
): PipelineRow[] {
  const timelines = new Map<string, ListedEvent[]>();
  for (const e of events) timelines.set(e.applicationId, [...(timelines.get(e.applicationId) ?? []), e]);
  return apps
    .map((a): PipelineRow => {
      const stage = stageOf(a);
      const timeline = timelines.get(a.id) ?? [];
      const last = timeline.reduce<ListedEvent | null>((best, e) => (!best || ms(e.occurredAt) > ms(best.occurredAt) ? e : best), null);
      const closed = CLOSED.includes(stage);
      // News is the company writing or the application moving. Your own follow-up is neither: still quiet.
      const silentFor = Math.floor((now.getTime() - ms(newest(a.lastHeardAt, a.statusAt))) / DAY_MS);
      const quiet = !closed && stage !== "saved" && silentFor >= QUIET_AFTER_DAYS;
      return {
        id: a.id,
        company: a.company,
        role: a.role === ROLE_NOT_LISTED ? "" : a.role,
        stage,
        state: closed ? "closed" : quiet ? "quiet" : "active",
        latest: last ? { kind: last.kind, title: eventTitle(last), at: last.occurredAt } : null,
        lastHeardAt: a.lastHeardAt ?? null,
        quietDays: quiet ? silentFor : null,
        // The same words the application's own page uses for how far a closed one got.
        reached: closed ? (stepsFor(stage, furthest(timeline)).steps.filter((s) => s.state === "done").at(-1)?.label ?? STAGE_LABEL.applied) : null,
        unread: notices.filter((n) => n.applicationId === a.id && !n.seenAt).length,
        activeAt: newest(last?.occurredAt, a.lastHeardAt, a.statusAt),
      };
    })
    .sort((x, y) => ms(y.activeAt) - ms(x.activeAt));
}

export const filterRows = (rows: readonly PipelineRow[], filter: Filter): PipelineRow[] => rows.filter((r) => filter === "all" || r.state === filter);

/** How many rows each filter shows, for its chip. */
export function filterCounts(rows: readonly PipelineRow[]): Record<Filter, number> {
  const count = (state: PipelineRow["state"]) => rows.filter((r) => r.state === state).length;
  return { all: rows.length, active: count("active"), quiet: count("quiet"), closed: count("closed") };
}

/** The order "By stage" lists them: furthest along first, what is over last. */
export const STAGE_ORDER: readonly ApplicationStage[] = ["offer", "interview", "assessment", "screen", "in_review", "applied", "saved", "rejected", "withdrawn"];

export interface StageGroup {
  stage: ApplicationStage;
  label: string;
  closed: boolean;
  rows: PipelineRow[];
}

/** The rows under their stage. A stage with none is left out; the order inside one is kept. */
export function byStage(rows: readonly PipelineRow[]): StageGroup[] {
  return STAGE_ORDER.flatMap((stage) => {
    const mine = rows.filter((r) => r.stage === stage);
    return mine.length ? [{ stage, label: STAGE_LABEL[stage], closed: CLOSED.includes(stage), rows: mine }] : [];
  });
}

export interface CompanyGroup {
  /** The name on its newest application. */
  company: string;
  rows: PipelineRow[];
  unread: number;
}

/**
 * One group per company with every role there, so two roles at one company are seen as
 * two. "Acme" and "Acme Inc" are one company. Groups and their rows keep the order given.
 */
export function byCompany(rows: readonly PipelineRow[]): CompanyGroup[] {
  const groups: CompanyGroup[] = [];
  for (const r of rows) {
    const group = groups.find((g) => sameCompany(g.company, r.company));
    if (group) {
      group.rows.push(r);
      group.unread += r.unread;
    } else groups.push({ company: r.company, rows: [r], unread: r.unread });
  }
  return groups;
}

/** The page's one line of numbers: applications sent, and how many got any answer. */
export function pipelineStats(apps: readonly Pick<Application, "status">[]): { sent: number; answered: number; rate: number } {
  const sent = apps.filter((a) => a.status !== "saved");
  const answered = sent.filter((a) => a.status !== "applied").length;
  return { sent: sent.length, answered, rate: sent.length ? Math.round((answered / sent.length) * 100) : 0 };
}

// ---------------------------------------------------------------------------
// Needs you: the only place on the page that asks for something. One action per card.
//
// Two kinds of card today, both things only you can settle:
//   place   an email the matching ladder could not put on one application (5.3, step 4)
//   role    an application logged from an email that never named its role
// A model's reading to confirm joins them in Phase 3, and a next step in Phase 4.

type Unnamed = Pick<Application, "id" | "company" | "status" | "stage" | "appliedOn" | "statusAt" | "notes">;

export type NeedsYou = { kind: "place"; key: string; mail: MailToPlace } | { kind: "role"; key: string; app: Unnamed };

/** The lane, most pressing first: emails to place (newest first), then roles to fill in (newest application first). */
export function needsYou(toPlace: readonly MailToPlace[], apps: readonly (Unnamed & Pick<Application, "role">)[]): NeedsYou[] {
  const place = [...toPlace].sort((a, b) => ms(b.receivedAt) - ms(a.receivedAt)).map((mail): NeedsYou => ({ kind: "place", key: `place:${mail.messageId}`, mail }));
  const role = apps
    .filter((a) => a.role === ROLE_NOT_LISTED)
    .sort((a, b) => (b.appliedOn ?? b.statusAt).localeCompare(a.appliedOn ?? a.statusAt))
    .map((app): NeedsYou => ({ kind: "role", key: `role:${app.id}`, app }));
  return [...place, ...role];
}
