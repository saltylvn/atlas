// Hand-off logic for the composer: which app to open, with what, and how to get
// there in one tap. Pure, so it is unit-tested. Atlas never sends anything: these
// links open the owner's own Mail, Messages or Slack with the draft ready.

import type { ContactDue } from "./relationships";
import type { Channel, Circle, Contact, OutboundMessage } from "./types";

/** The contact fields the hand-off needs (a subset of Contact, safe to send to the client). */
export type Reachable = Pick<Contact, "email" | "phone"> & Partial<Pick<Contact, "slackTeamId" | "slackUserId">>;

export interface HandOff {
  /** Opens the app. */
  href: string;
  /** Web fallback when the native app is not installed (Slack only). */
  fallbackHref: string | null;
  /**
   * True when the app cannot be pre-filled through the link, so the draft must be
   * copied to the clipboard first and pasted (Slack deep links take no message text).
   */
  copyFirst: boolean;
}

export const CHANNEL_LABEL: Record<Channel, { short: string; app: string }> = {
  email: { short: "Email", app: "Mail" },
  sms: { short: "Text", app: "Messages" },
  slack: { short: "Slack", app: "Slack" },
};

const SLACK_TEAM = /^T[A-Z0-9]{2,20}$/;
const SLACK_USER = /^[UW][A-Z0-9]{2,20}$/;

export const isSlackTeamId = (s: string) => SLACK_TEAM.test(s);
export const isSlackUserId = (s: string) => SLACK_USER.test(s);

/**
 * Reads Slack IDs from what a person can actually copy: a member ID ("U012AB3CD"),
 * "T…/U…", or a Slack web URL like https://app.slack.com/client/T012/U034.
 */
export function parseSlackRef(input: string): {
  teamId: string | null;
  userId: string | null;
} {
  const s = input.trim();
  if (!s) return { teamId: null, userId: null };
  const tokens = s.split(/[/?&=#\s]+/).filter(Boolean);
  const teamId = tokens.find((t) => SLACK_TEAM.test(t)) ?? null;
  const userId = tokens.find((t) => SLACK_USER.test(t)) ?? null;
  return { teamId, userId };
}

export function hasChannel(c: Reachable, channel: Channel): boolean {
  if (channel === "email") return Boolean(c.email);
  if (channel === "sms") return Boolean(c.phone);
  return Boolean(c.slackTeamId && c.slackUserId);
}

export function availableChannels(c: Reachable): Channel[] {
  return (["email", "sms", "slack"] as const).filter((ch) => hasChannel(c, ch));
}

/** Builds the link that opens the owner's own app with the draft (or the right chat) ready. */
export function handOffLink(channel: Channel, c: Reachable, subject: string, body: string): HandOff | null {
  if (channel === "email") {
    if (!c.email) return null;
    const href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return { href, fallbackHref: null, copyFirst: false };
  }
  if (channel === "sms") {
    if (!c.phone) return null;
    // "?&body=" works on both iOS and Android Messages.
    return {
      href: `sms:${c.phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`,
      fallbackHref: null,
      copyFirst: false,
    };
  }
  const team = c.slackTeamId ?? "";
  const user = c.slackUserId ?? "";
  if (!isSlackTeamId(team) || !isSlackUserId(user)) return null;
  return {
    href: `slack://user?team=${team}&id=${user}`,
    fallbackHref: `https://app.slack.com/client/${team}/${user}`,
    copyFirst: true,
  };
}

/** What lands on the clipboard: the subject is kept for email so nothing is lost. */
export function clipboardText(channel: Channel, subject: string, body: string): string {
  return channel === "email" && subject.trim() ? `${subject.trim()}\n\n${body}` : body;
}

/**
 * The channel most likely to be right for this person: the one you used last if it
 * still works, else Slack for team, a text for family and friends, email otherwise.
 */
export function bestChannel(c: Reachable & Pick<Contact, "circle">, lastUsed?: Channel | null): Channel {
  const options = availableChannels(c);
  if (lastUsed && options.includes(lastUsed)) return lastUsed;
  const order: Channel[] = c.circle === "team" ? ["slack", "email", "sms"] : c.circle === "network" ? ["email", "slack", "sms"] : ["sms", "email", "slack"];
  return order.find((ch) => options.includes(ch)) ?? "email";
}

/**
 * The channel for sharing a thought: a text whenever the person has a phone number, else
 * whatever reaches them. Null when nothing does.
 */
export function textFirst(c: Reachable & Pick<Contact, "circle">, lastUsed?: Channel | null): Channel | null {
  const options = availableChannels(c);
  if (options.length === 0) return null;
  return options.includes("sms") ? "sms" : bestChannel(c, lastUsed);
}

/** Last channel used per contact, from handed-off messages. */
export function lastChannels(messages: Pick<OutboundMessage, "contactId" | "channel" | "status" | "handedOffAt">[]): Map<string, Channel> {
  const out = new Map<string, { channel: Channel; at: string }>();
  for (const m of messages) {
    if (m.status !== "handed_off" || !m.handedOffAt) continue;
    const prev = out.get(m.contactId);
    if (!prev || m.handedOffAt > prev.at) out.set(m.contactId, { channel: m.channel, at: m.handedOffAt });
  }
  return new Map([...out].map(([k, v]) => [k, v.channel]));
}

/** A one-line purpose for the composer, from why the person is due. */
export function suggestPurpose(contact: Pick<Contact, "circle" | "notes">, due?: Pick<ContactDue, "reason" | "days"> | null): string {
  if (due?.reason === "birthday") return due.days === 0 ? "Happy birthday!" : "Happy early birthday, any plans?";
  if (due?.reason === "never")
    return contact.circle === "network" ? "Great meeting you, would love to stay in touch" : "Checking in to see how things are going";
  const hint = contact.notes.trim();
  if (/^ask about /i.test(hint)) return `Checking in. How's ${hint.replace(/^ask about (the |your )?/i, "the ").replace(/\.$/, "")} going?`;
  if (contact.circle === "team") return "Quick check-in, anything you need from me?";
  return "Checking in to see how things are going";
}

/** Text length and SMS segment count (GSM-7 160/153, otherwise UCS-2 70/67). */
export function smsStats(body: string): {
  chars: number;
  segments: number;
  unicode: boolean;
} {
  const chars = [...body].length;
  // GSM-7 basic set plus the extension table, approximately: printable ASCII and newlines.
  const unicode = /[^\n\r\x20-\x7E£¥èéùìòÇØøÅåÆæßÉÄÖÑÜ§¿äöñüà€]/.test(body);
  const [single, multi] = unicode ? [70, 67] : [160, 153];
  const segments = chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi);
  return { chars, segments, unicode };
}

/** Fills {first} and {name} in a saved snippet. */
export function fillSnippet(template: string, contact: Pick<Contact, "name">, ownerName: string): string {
  const first = contact.name.split(/[ (]/)[0] || contact.name;
  return template.replaceAll("{first}", first).replaceAll("{name}", contact.name).replaceAll("{me}", ownerName);
}

/** Max body length to keep per channel when an AI draft comes back long. */
export const BODY_LIMIT: Record<Channel, number> = {
  email: 2500,
  sms: 640,
  slack: 600,
};

/** Starting tone for a person: brief with the team, warm with family and friends, formal with your network. */
export function defaultTone(circle: Circle): "warm" | "concise" | "formal" {
  return circle === "team" ? "concise" : circle === "network" ? "formal" : "warm";
}
