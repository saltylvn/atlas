// Offline drafter: a sensible message with no AI at all. Pure, so it runs in the
// composer as you type and on the server as the fallback when Claude is off.

import type { Channel, Contact } from "./types";

export function templateDraft(contact: Pick<Contact, "name" | "circle">, purpose: string, channel: Channel, ownerName: string): { subject: string; body: string } {
  const first = contact.name.split(/[ (]/)[0] ?? contact.name;
  const p = purpose.trim().replace(/\.$/, "");
  if (channel === "slack") {
    // Casual, no sign-off: Slack already shows who it is from.
    const asks = /\b(can|could|would|want|when|time|available|got|free|anything|need)\b/i.test(p) && !/[!?]$/.test(p);
    const line = `${p.charAt(0).toUpperCase()}${p.slice(1)}${/[!?]$/.test(p) ? "" : asks ? "?" : ""}`;
    return { subject: "", body: `Hey ${first}! ${line}`.slice(0, 300) };
  }
  if (channel === "sms") {
    return { subject: "", body: `Hey ${first}, ${p.charAt(0).toLowerCase()}${p.slice(1)}${/[!?]$/.test(p) ? "" : "."} – ${ownerName}`.slice(0, 320) };
  }
  const subject = p.length > 60 ? `${p.slice(0, 57)}...` : p;
  const work = contact.circle === "team" || contact.circle === "network";
  const asks = /\b(can|could|would|want|when|time|available|schedule|meet|call|coffee)\b/i.test(p);
  return {
    subject: subject.charAt(0).toUpperCase() + subject.slice(1),
    body: [
      work ? `Hi ${first},` : `Hey ${first},`,
      `${p.charAt(0).toUpperCase()}${p.slice(1)}${asks ? "?" : "."}`,
      asks ? "Let me know what works for you." : "",
      `${work ? "Thanks" : "Talk soon"},\n${ownerName}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/**
 * A thought or idea you want to share, shaped for one person: your own words, kept as you
 * wrote them, with a greeting (and a sign-off in email). No AI, so sharing with five
 * people gives five drafts at once.
 */
export function thoughtDraft(contact: Pick<Contact, "name" | "circle">, thought: string, channel: Channel, ownerName: string): { subject: string; body: string } {
  const first = contact.name.split(/[ (]/)[0] ?? contact.name;
  const t = thought.trim();
  if (channel === "slack") return { subject: "", body: `Hey ${first}! ${t}`.slice(0, 600) };
  if (channel === "sms") return { subject: "", body: `Hey ${first}, ${t}`.slice(0, 640) };
  const line = t.split(/\n/)[0] ?? t;
  const work = contact.circle === "team" || contact.circle === "network";
  return {
    subject: line.length > 60 ? `${line.slice(0, 57)}...` : line,
    body: [work ? `Hi ${first},` : `Hey ${first},`, t, `${work ? "Thanks" : "Talk soon"},\n${ownerName}`].join("\n\n"),
  };
}
