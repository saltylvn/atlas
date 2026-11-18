// Inbox triage, by rules. Each email lands in one of three piles:
//   reply  someone you know, or a direct question to you
//   fyi    addressed to you, worth a glance, no answer needed
//   noise  newsletters, notifications, promotions (hidden by default)
// Rules, not a model: the result is predictable, explainable ("reason"), free, and an
// email's text can never talk its way into a different pile.

import type { Contact, InboxCategory, InboxItem } from "./types";

/** The parts of a Gmail message Atlas reads: headers and Gmail's own snippet. */
export interface MailMeta {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  labelIds: string[];
  listUnsubscribe: boolean;
  precedence: string;
  autoSubmitted: string;
}

export interface Triage {
  category: InboxCategory;
  reason: string;
  fromName: string;
  fromEmail: string;
}

export function parseAddress(raw: string): { name: string; email: string } {
  const angle = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (angle) {
    const email = (angle[2] ?? "").trim().toLowerCase();
    return { name: (angle[1] ?? "").trim() || email, email };
  }
  const email = raw.trim().toLowerCase();
  return { name: email, email };
}

const NOISE_SENDER = /(^|[.+_-])(no-?reply|do-?not-?reply|notifications?|notify|mailer|newsletters?|digest|marketing|alerts?|updates|news)([.+_-]|@)/i;
const NOISE_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS", "SPAM"];
const CODE = /\b((security|verification|login|log-in|sign-?in|access|confirmation|one-?time|temporary)\s+(pass)?code|\w+ (login|security|verification) code|otp|2fa code|two-factor code|verify your (email|account|identity))\b/i;
const QUESTION = /\?|\b(can you|could you|would you|let me know|thoughts on|are you (free|available)|what works|your availability|please (confirm|review|send|reply)|rsvp)\b/i;

export function triage(mail: MailMeta, contacts: Pick<Contact, "name" | "email" | "circle">[], ownerEmail: string): Triage {
  const { name, email } = parseAddress(mail.from);
  const base = { fromName: name.slice(0, 120), fromEmail: email.slice(0, 200) };
  const contact = contacts.find((c) => c.email && c.email.toLowerCase() === email);
  if (contact) return { ...base, fromName: contact.name, category: "reply", reason: `From ${contact.name} (${contact.circle})` };

  const bulk =
    mail.listUnsubscribe ||
    ["bulk", "list", "junk"].includes(mail.precedence.toLowerCase()) ||
    (mail.autoSubmitted !== "" && mail.autoSubmitted.toLowerCase() !== "no");
  if (bulk) return { ...base, category: "noise", reason: "Mailing list or automated" };
  if (NOISE_SENDER.test(email)) return { ...base, category: "noise", reason: "Notification sender" };
  const noiseLabel = mail.labelIds.find((l) => NOISE_LABELS.includes(l));
  if (noiseLabel) return { ...base, category: "noise", reason: `Gmail ${noiseLabel.replace("CATEGORY_", "").toLowerCase()}` };

  // A code you asked for is worth a glance and never needs an answer, whatever Gmail thinks.
  if (CODE.test(mail.subject)) return { ...base, category: "fyi", reason: "Login or security code" };

  const direct = ownerEmail !== "" && mail.to.toLowerCase().includes(ownerEmail.toLowerCase());
  if (direct && QUESTION.test(`${mail.subject} ${mail.snippet}`)) return { ...base, category: "reply", reason: "Asks you something directly" };
  if (mail.labelIds.includes("CATEGORY_UPDATES")) return { ...base, category: "fyi", reason: "Update or receipt" };
  if (direct && mail.labelIds.includes("IMPORTANT")) return { ...base, category: "reply", reason: "Gmail marked it important" };
  return { ...base, category: "fyi", reason: direct ? "Addressed to you" : "You were copied" };
}

export interface InboxSummary {
  needsReply: number;
  fyi: number;
  noise: number;
  /** Up to three senders waiting on you: people you know first, then oldest first. */
  waiting: InboxItem[];
}

export function summarizeInbox(items: InboxItem[]): InboxSummary {
  const open = items.filter((i) => !i.done);
  const known = (i: InboxItem) => (i.reason.startsWith("From ") ? 0 : 1);
  const reply = open.filter((i) => i.category === "reply").sort((a, b) => known(a) - known(b) || a.receivedAt.localeCompare(b.receivedAt));
  return {
    needsReply: reply.length,
    fyi: open.filter((i) => i.category === "fyi").length,
    noise: open.filter((i) => i.category === "noise").length,
    waiting: reply.slice(0, 3),
  };
}

/** Opens the thread in Gmail (the Gmail app on iPhone, when installed). */
export function gmailThreadUrl(threadId: string): string {
  return `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(threadId)}`;
}
