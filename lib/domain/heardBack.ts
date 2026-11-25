// Heard back: which of a company's emails reach your phone, what the lock screen says, and
// when (docs/design-pipeline.md, 5.7). Pure: no I/O.
//
// Every answer from a company (a reply, a request, an invite, an assessment, an offer, a
// rejection) gets one notice: a row in the outbox that is also a line in the Heard back
// feed. A "we received your application" gets none: it is not an answer.
//
//   push    pings your phone now; between 9 PM and 7 AM it waits until 7.
//   brief   a rejection, when you asked to hold those: no ping, the next brief lists it.
//   quiet   in the feed only, already read: an email that was old when Atlas first saw it,
//           or one you placed on an application yourself.
//
// Several due in one run go out as one push. The text is the company, the kind and the role,
// taken from the application; an email's subject, sender or words are never in it.

import { ROLE_NOT_LISTED } from "./applications";
import { localTime } from "./dates";
import { EVENT_LABEL, HEARD } from "./pipeline";
import type { Application, ApplicationEvent, EventKind, NewNotice, Notice, NoticeTier } from "./types";

/** An email older than this when Atlas first sees it is old news: listed as read, never pushed. A notice not sent within it is not sent late. */
export const FRESH_MS = 48 * 3_600_000;

/** No pings from 9 PM until 7 AM, your time. What comes in is held and sent at 7. */
export const QUIET_FROM = "21:00";
export const QUIET_UNTIL = "07:00";
export const inQuietHours = (hhmm: string) => hhmm >= QUIET_FROM || hhmm < QUIET_UNTIL;

/** How many answers the feed reads. */
export const FEED_LIMIT = 50;
/** How many unread answers it shows before "Earlier". */
export const FEED_SHOWN = 6;

/** Where a push about several answers opens: the feed. */
export const FEED_URL = "/applications#heard-back";

/** The answers, most pressing first: the order of a bundle. */
const PRESSING: readonly EventKind[] = ["offer", "interview", "screen", "assessment", "scheduling", "info_request", "reply", "rejection"];

/** What the lock screen adds after the role. A rejection asks nothing of you. */
const HINT: Partial<Record<EventKind, string>> = {
  offer: "Open to see it.",
  interview: "Open to reply.",
  screen: "Open to reply.",
  assessment: "Open to see it.",
  scheduling: "Open to reply.",
  info_request: "Open to reply.",
  reply: "Open to reply.",
};

export interface NoticePolicy {
  /** Your setting "Hold rejections for the next brief". */
  holdRejections: boolean;
  now: Date;
  /** You placed the email on its application yourself, so you have seen it. */
  byYou?: boolean;
}

type Happened = Pick<ApplicationEvent, "kind" | "source" | "decidedBy" | "occurredAt">;

const isOld = (occurredAt: string, now: Date) => now.getTime() - Date.parse(occurredAt) > FRESH_MS;

/**
 * How an event reaches you, or null when it is not an answer from a company: your own moves,
 * the Apply Agent's, a "we received your application", and a model's reading (a suggestion
 * never pings).
 */
export function tierFor(e: Happened, policy: NoticePolicy): NoticeTier | null {
  if (e.source !== "email" || e.decidedBy === "model" || !HEARD.includes(e.kind)) return null;
  if (policy.byYou || isOld(e.occurredAt, policy.now)) return "quiet";
  return e.kind === "rejection" && policy.holdRejections ? "brief" : "push";
}

/** One line of plain text: no line breaks or control characters, and no longer than `max`. */
function plain(s: string, max: number): string {
  // Control and format characters (line and paragraph separators among them) become a space.
  const t = s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** What the lock screen and the feed say: "Acme · Interview invite" / "Solutions Engineer. Open to reply." */
export function noticeText(kind: EventKind, app: Pick<Application, "company" | "role">): { title: string; body: string } {
  // Short enough that the longest kind still fits a push title (80), and three fit a bundle (240).
  const company = plain(app.company, 40) || "A company";
  const role = app.role === ROLE_NOT_LISTED ? "" : plain(app.role, 100);
  const body = [role ? `${role.replace(/[.\s]+$/, "")}.` : "", HINT[kind] ?? ""].filter(Boolean).join(" ");
  return { title: `${company} · ${EVENT_LABEL[kind]}`, body: body || "Open to see it." };
}

/**
 * The notices for events just put on timelines: one per answer, none for anything else.
 * `apps` is the board the events belong to. A quiet one arrives already read.
 */
export function noticesFor(events: readonly ApplicationEvent[], apps: readonly Pick<Application, "id" | "company" | "role">[], policy: NoticePolicy): NewNotice[] {
  return events.flatMap((e) => {
    const tier = tierFor(e, policy);
    const app = apps.find((a) => a.id === e.applicationId);
    if (!tier || !app) return [];
    return [{ eventId: e.id, applicationId: app.id, kind: e.kind, occurredAt: e.occurredAt, ...noticeText(e.kind, app), url: `/applications/${app.id}`, tier, sentAt: null, seenAt: tier === "quiet" ? policy.now.toISOString() : null }];
  });
}

/**
 * What to push now, most pressing first: push notices not sent, not already seen in Atlas,
 * and still fresh. In quiet hours nothing is sent; `held` says how many wait for 7 AM.
 */
export function dueNow(rows: readonly Notice[], now: Date, timeZone: string): { send: Notice[]; held: number } {
  const waiting = rows.filter((r) => r.tier === "push" && !r.sentAt && !r.seenAt && !isOld(r.occurredAt, now));
  if (inQuietHours(localTime(now, timeZone))) return { send: [], held: waiting.length };
  const rank = (r: Notice) => (PRESSING.includes(r.kind) ? PRESSING.indexOf(r.kind) : PRESSING.length);
  return { send: [...waiting].sort((a, b) => rank(a) - rank(b) || b.occurredAt.localeCompare(a.occurredAt)), held: 0 };
}

export interface Push {
  title: string;
  body: string;
  /** Where it opens in Atlas. */
  url: string;
}

/** How many answers a bundled push names before "+N more". */
const NAMED = 3;

/** One push for everything due: a single answer as itself, several as one summary that opens the feed. */
export function bundle(rows: readonly Notice[]): Push | null {
  const [first] = rows;
  if (!first) return null;
  if (rows.length === 1) return { title: first.title, body: first.body, url: first.url };
  const more = rows.length - NAMED;
  return { title: `${rows.length} updates on your applications`, body: [...rows.slice(0, NAMED).map((r) => r.title), ...(more > 0 ? [`+${more} more`] : [])].join("; "), url: FEED_URL };
}

/** Rejections held for a brief that no brief has listed yet. */
export const heldForBrief = (rows: readonly Notice[]): Notice[] => rows.filter((r) => r.tier === "brief" && !r.sentAt);

/** The brief's line for them, or null when there are none. */
export function heldLine(rows: readonly Notice[]): string | null {
  if (rows.length === 0) return null;
  const more = rows.length - NAMED;
  return `Held for this brief: ${[...rows.slice(0, NAMED).map((r) => r.title), ...(more > 0 ? [`and ${more} more`] : [])].join("; ")}. See Heard back on the Pipeline.`;
}

/**
 * The feed as the Pipeline shows it: what is new on top, everything else behind "Earlier".
 * `top` is the newest unread answers (up to `FEED_SHOWN`); `rest` is the others, in feed
 * order. With nothing unread the card is one line, so the list below it stays in reach.
 */
export function feedSplit<N extends Pick<Notice, "id" | "seenAt">>(rows: readonly N[]): { top: N[]; rest: N[] } {
  const top = rows.filter((r) => !r.seenAt).slice(0, FEED_SHOWN);
  const shown = new Set(top.map((r) => r.id));
  return { top, rest: rows.filter((r) => !shown.has(r.id)) };
}

/** How many answers you have not opened yet. */
export const unreadCount = (rows: readonly Pick<Notice, "seenAt">[]): number => rows.filter((r) => !r.seenAt).length;
