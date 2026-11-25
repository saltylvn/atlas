import "server-only";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { bundle, dueNow, FRESH_MS, heldForBrief, heldLine, noticesFor } from "@/lib/domain/heardBack";
import type { Application, ApplicationEvent, Notice, Settings } from "@/lib/domain/types";
import { pushConfigured, sendToAll } from "@/lib/push";

// Heard back at run time (docs/design-pipeline.md, 5.7): the Applications Agent's outbox.
// The rules are in lib/domain/heardBack.ts; this file only reads and writes.
//
//   recordHeardBack   right after events are added to timelines: one notice per answer.
//   sendHeardBack     pushes what is due, as one push. It marks the rows sent first, in one
//                     conditional update, and pushes only the rows that update gave it, so
//                     two runs can never ping about the same answer.
//   briefHeld         the brief's line for rejections you asked to hold.
//
// At most once: a push the push service drops is not sent again. It stays unread in the feed.

/**
 * Writes the notices for events just added to timelines. Safe to repeat: an event has one
 * notice. `byYou` is for an email you placed yourself: it is listed, already read, no ping.
 */
export async function recordHeardBack(persist: Store, added: readonly ApplicationEvent[], board: readonly Application[], settings: Pick<Settings, "holdRejections">, now: Date, byYou = false): Promise<Notice[]> {
  const rows = noticesFor(added, board, { holdRejections: settings.holdRejections === true, now, byYou });
  return rows.length ? persist.notifications.add(rows) : [];
}

export interface HeardBackSend {
  /** Answers pushed by this run. */
  sent: number;
  /** Answers waiting for 7 AM. */
  held: number;
  /** Devices the push reached. */
  devices: number;
  /** Why nothing could be sent, when something was due. */
  skipped?: string;
}

/** Swapped in tests, which must not reach a push service. */
export interface PushDeps {
  push: typeof sendToAll;
  ready: () => boolean;
}

/**
 * Pushes the answers that are due: everything waiting, in one push. Nothing in quiet
 * hours, with the kill switch on, or with no device to send to (the rows then stay unsent,
 * and are not sent late once they are older than two days).
 */
export async function sendHeardBack(ctx: Pick<Context, "settings" | "now">, persist: Store, deps: PushDeps = { push: sendToAll, ready: pushConfigured }): Promise<HeardBackSend> {
  const waiting = await persist.notifications.unsent("push", new Date(ctx.now.getTime() - FRESH_MS).toISOString());
  const { send, held } = dueNow(waiting, ctx.now, ctx.settings.timezone);
  const none = (skipped?: string): HeardBackSend => ({ sent: 0, held, devices: 0, ...(skipped ? { skipped } : {}) });
  if (send.length === 0) return none();
  if (!ctx.settings.outboundEnabled) return none("the kill switch is on");
  if (!deps.ready()) return none("push is not set up");
  if ((await persist.push.list()).length === 0) return none("no device is subscribed");
  // Claim, then send: only the rows this run marked are pushed.
  const mine = new Set((await persist.notifications.claim(send.map((r) => r.id), ctx.now.toISOString())).map((r) => r.id));
  const payload = bundle(send.filter((r) => mine.has(r.id)));
  if (!payload) return none();
  const reached = await deps.push(persist, payload).catch(() => ({ sent: 0, removed: 0, failed: 0 }));
  return { sent: mine.size, held: 0, devices: reached.sent };
}

const s = (n: number) => (n === 1 ? "" : "s");

/** What the trace says about a send: counts only. */
export const sendNote = (r: HeardBackSend): string =>
  r.skipped
    ? `No ping: ${r.skipped}.`
    : r.sent
      ? `${r.sent} answer${s(r.sent)} in one push, to ${r.devices} device${s(r.devices)}`
      : r.held
        ? `${r.held} answer${s(r.held)} held until 7 AM (quiet hours)`
        : "No new answers to push.";

/**
 * The brief's line for rejections held for it, or null. Listing them is how they are
 * delivered, so they are marked sent and the next brief does not repeat them.
 */
export async function briefHeld(persist: Store, now: Date): Promise<string | null> {
  const waiting = heldForBrief(await persist.notifications.unsent("brief", new Date(now.getTime() - 14 * 86_400_000).toISOString()));
  if (waiting.length === 0) return null;
  const mine = new Set((await persist.notifications.claim(waiting.map((r) => r.id), now.toISOString())).map((r) => r.id));
  return heldLine(waiting.filter((r) => mine.has(r.id)));
}
