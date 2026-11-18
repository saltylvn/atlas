import "server-only";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import type { MailMeta } from "@/lib/domain/inbox";
import { htmlToText, pickTextPart, type StructureNode } from "@/lib/domain/jobMailText";

// Gmail over IMAP with an app password. Chosen over OAuth because Google blocks
// unverified apps from Gmail's restricted scopes and expires test-mode tokens weekly.
//
// Read-only, with one exception:
//   - reading opens the mailbox with EXAMINE (readOnly) and fetches with BODY.PEEK, so
//     nothing is marked read or moved;
//   - headers, labels and ids for the inbox; the text part of job emails only (readJobMailText),
//     never attachments, and never any other email's text;
//   - the one write is archiveMessages: it removes the \Inbox label from the emails the
//     owner ticked, by Gmail message id. Nothing is deleted, sent, moved elsewhere or
//     marked read; the email stays in All Mail.
// Logging is off so credentials and addresses never reach platform logs.

export const GMAIL_IMAP_HOST = "imap.gmail.com";
const HEADERS = ["from", "to", "cc", "subject", "list-unsubscribe", "precedence", "auto-submitted"];

export interface ImapCredentials {
  user: string;
  pass: string;
}

function client(creds: ImapCredentials): ImapFlow {
  return new ImapFlow({
    host: GMAIL_IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: creds.user, pass: creds.pass },
    logger: false,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    disableAutoIdle: true,
  });
}

/** Gmail shows ids in hex in its web URLs; IMAP returns them in decimal. */
export function gmailHexId(decimal: string | undefined): string | null {
  if (!decimal || !/^\d{1,20}$/.test(decimal)) return null;
  return BigInt(decimal).toString(16);
}

/** Parses the raw header block Gmail returns for the fields Atlas asked for. */
export function parseHeaders(raw: Buffer | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  // Unfold continuation lines, then read "Name: value".
  const text = raw.toString("utf8").replace(/\r?\n[ \t]+/g, " ");
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = decodeWords(line.slice(i + 1).trim());
  }
  return out;
}

/** Decodes RFC 2047 encoded words (=?utf-8?B?...?= / ?Q?) in subjects and names. */
export function decodeWords(s: string): string {
  return s.replace(/=\?([\w-]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset: string, enc: string, data: string) => {
    try {
      const bytes =
        enc.toUpperCase() === "B"
          ? Buffer.from(data, "base64")
          : Buffer.from(data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_m: string, h: string) => String.fromCharCode(parseInt(h, 16))), "binary");
      return new TextDecoder(charset.toLowerCase() === "utf8" ? "utf-8" : charset).decode(bytes);
    } catch {
      return data;
    }
  });
}

/** One fetched message -> the shape the triage rules read (labels mapped to Gmail API names). */
export function toMailMeta(m: FetchMessageObject, noise: Set<number>, updates: Set<number>): MailMeta | null {
  const id = gmailHexId(m.emailId);
  const threadId = gmailHexId(m.threadId);
  if (!id || !threadId) return null;
  const h = parseHeaders(m.headers);
  const labels = ["INBOX"];
  if (m.labels?.has("\\Important")) labels.push("IMPORTANT");
  if (m.labels?.has("\\Sent")) labels.push("SENT");
  if (noise.has(m.uid)) labels.push("CATEGORY_PROMOTIONS");
  if (updates.has(m.uid)) labels.push("CATEGORY_UPDATES");
  const date = m.internalDate ? new Date(m.internalDate) : new Date();
  return {
    id,
    threadId,
    from: h.from ?? "",
    to: h.to ?? "",
    cc: h.cc ?? "",
    subject: h.subject ?? "",
    // IMAP has no Gmail snippet, and Atlas does not read an email's text to make one.
    snippet: "",
    receivedAt: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
    labelIds: labels,
    listUnsubscribe: Boolean(h["list-unsubscribe"]),
    precedence: h.precedence ?? "",
    autoSubmitted: h["auto-submitted"] ?? "",
  };
}

/** Gmail's hex message id (as stored) back to the decimal X-GM-MSGID IMAP uses. */
export function gmailDecimalId(hex: string): string | null {
  if (!/^[0-9a-f]{1,16}$/i.test(hex)) return null;
  return BigInt(`0x${hex}`).toString(10);
}

/**
 * Archives emails: removes the \Inbox label, exactly what Gmail's Archive button does.
 * Returns the ids it archived; an id no longer in the inbox is reported as missing.
 */
export async function archiveMessages(creds: ImapCredentials, hexIds: string[]): Promise<{ archived: string[]; missing: string[] }> {
  const c = client(creds);
  await c.connect();
  try {
    const lock = await c.getMailboxLock("INBOX");
    try {
      const archived: string[] = [];
      const missing: string[] = [];
      for (const hex of hexIds) {
        const decimal = gmailDecimalId(hex);
        const uids = decimal ? (await c.search({ emailId: decimal }, { uid: true })) || [] : [];
        if (uids.length === 0) {
          missing.push(hex);
          continue;
        }
        await c.messageFlagsRemove(uids, ["\\Inbox"], { uid: true, useLabels: true });
        archived.push(hex);
      }
      return { archived, missing };
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => c.close());
  }
}

export interface UnsubscribeHeaders {
  /** First https link in List-Unsubscribe, or "". */
  https: string;
  /** First mailto: address in List-Unsubscribe, or "". */
  mailto: string;
  /** The sender supports RFC 8058 one-click unsubscribe (List-Unsubscribe-Post). */
  oneClick: boolean;
}

/** Parses List-Unsubscribe / List-Unsubscribe-Post. Only https and mailto links are kept. */
export function parseUnsubscribe(listUnsubscribe: string, listUnsubscribePost: string): UnsubscribeHeaders {
  const links = [...listUnsubscribe.matchAll(/<([^>]+)>/g)].map((m) => m[1]!.trim());
  let https = "";
  let mailto = "";
  for (const l of links) {
    try {
      const u = new URL(l);
      if (!https && u.protocol === "https:" && !u.username && !u.password && l.length <= 2000) https = u.toString();
      if (!mailto && u.protocol === "mailto:" && l.length <= 500) mailto = l;
    } catch {
      // not a URL: ignored
    }
  }
  return { https, mailto, oneClick: Boolean(https) && /list-unsubscribe=one-click/i.test(listUnsubscribePost) };
}

const SENDER_DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** The unsubscribe headers on the newest inbox email from a sender domain (read-only). */
export async function unsubscribeHeaders(creds: ImapCredentials, domain: string): Promise<UnsubscribeHeaders | null> {
  if (!SENDER_DOMAIN.test(domain) || domain.length > 100) return null;
  const c = client(creds);
  await c.connect();
  try {
    const lock = await c.getMailboxLock("INBOX", { readOnly: true });
    try {
      const uids = (await c.search({ gmraw: `from:${domain} newer_than:60d` }, { uid: true })) || [];
      const newest = uids.at(-1);
      if (newest === undefined) return null;
      const m = await c.fetchOne(String(newest), { headers: ["list-unsubscribe", "list-unsubscribe-post"] }, { uid: true });
      if (!m) return null;
      const h = parseHeaders(m.headers);
      return parseUnsubscribe(h["list-unsubscribe"] ?? "", h["list-unsubscribe-post"] ?? "");
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => c.close());
  }
}

/** Gmail search for application emails: confirmations, status updates, interviews, and hiring systems. */
export const JOB_MAIL_QUERY =
  '-in:sent -in:chats {subject:"thank you for applying" subject:"thanks for applying" subject:"application received" subject:"your application" subject:"application submitted" subject:"received your application" subject:"thank you for your interest" subject:"application status" subject:"update on your application" subject:interview from:greenhouse.io from:greenhouse-mail.io from:lever.co from:ashbyhq.com from:myworkday.com from:workablemail.com from:icims.com from:smartrecruiters.com from:jobvite.com}';

/**
 * Read-only search of All Mail (archived emails count too), headers only, newest last.
 * Used once to catch up on past applications. Falls back to the inbox if All Mail is
 * not shown over IMAP.
 */
export async function searchJobMailImap(creds: ImapCredentials, days: number, max = 300): Promise<MailMeta[]> {
  const c = client(creds);
  await c.connect();
  try {
    let lock;
    try {
      lock = await c.getMailboxLock("[Gmail]/All Mail", { readOnly: true });
    } catch {
      lock = await c.getMailboxLock("INBOX", { readOnly: true });
    }
    try {
      const uids = ((await c.search({ gmraw: `newer_than:${Math.max(1, Math.min(365, days))}d ${JOB_MAIL_QUERY}` }, { uid: true })) || []).slice(-max);
      if (uids.length === 0) return [];
      const out: MailMeta[] = [];
      for await (const m of c.fetch(uids, { uid: true, emailId: true, threadId: true, labels: true, internalDate: true, headers: HEADERS }, { uid: true })) {
        const meta = toMailMeta(m, new Set(), new Set());
        if (meta) out.push(meta);
      }
      return out;
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => c.close());
  }
}

/** The most job emails read in one run, and how much of each. */
export const MAX_TEXTS_PER_RUN = 12;
const MAX_TEXT_BYTES = 48_000;

async function readStream(s: NodeJS.ReadableStream, max: number): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of s as AsyncIterable<Buffer | string>) {
    const b = typeof c === "string" ? Buffer.from(c) : c;
    chunks.push(b);
    n += b.length;
    if (n >= max) break;
  }
  return Buffer.concat(chunks).subarray(0, max).toString("utf8");
}

/**
 * The text of the given job emails (Gmail hex ids), read-only: the plain-text part, or
 * the HTML part turned into text. Never an attachment. Searches All Mail, so an email you
 * archived is still read. An id not found maps to "". The text is returned to the caller,
 * which keeps only a verdict; nothing here stores or logs it.
 */
export async function readJobMailText(creds: ImapCredentials, hexIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = hexIds.slice(0, MAX_TEXTS_PER_RUN);
  if (ids.length === 0) return out;
  const c = client(creds);
  await c.connect();
  try {
    let lock;
    try {
      lock = await c.getMailboxLock("[Gmail]/All Mail", { readOnly: true });
    } catch {
      lock = await c.getMailboxLock("INBOX", { readOnly: true });
    }
    try {
      for (const hex of ids) {
        const decimal = gmailDecimalId(hex);
        const uid = decimal ? ((await c.search({ emailId: decimal }, { uid: true })) || [])[0] : undefined;
        if (uid === undefined) {
          out.set(hex, "");
          continue;
        }
        const m = await c.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
        const pick = m ? pickTextPart(m.bodyStructure as StructureNode | undefined) : null;
        if (!pick) {
          out.set(hex, "");
          continue;
        }
        // download() fetches with BODY.PEEK, decodes the transfer encoding and converts to UTF-8.
        const d = await c.download(String(uid), pick.part, { uid: true, maxBytes: MAX_TEXT_BYTES });
        const raw = "content" in d && d.content ? await readStream(d.content, MAX_TEXT_BYTES) : "";
        out.set(hex, pick.html ? htmlToText(raw) : raw);
      }
      return out;
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => c.close());
  }
}

/** Signs in and out once. Used to check an app password before it is stored. */
export async function verifyLogin(creds: ImapCredentials): Promise<boolean> {
  const c = client(creds);
  try {
    await c.connect();
    await c.logout();
    return true;
  } catch {
    c.close();
    return false;
  }
}

/** Inbox messages from the last few days, headers only, newest first, at most `max`. */
export async function listInboxImap(creds: ImapCredentials, days = 3, max = 40): Promise<MailMeta[]> {
  const c = client(creds);
  await c.connect();
  try {
    const lock = await c.getMailboxLock("INBOX", { readOnly: true });
    try {
      const since = `newer_than:${days}d`;
      const all = ((await c.search({ gmraw: since }, { uid: true })) || []).slice(-max);
      if (all.length === 0) return [];
      const noise = new Set((await c.search({ gmraw: `${since} (category:promotions OR category:social OR category:forums)` }, { uid: true })) || []);
      const updates = new Set((await c.search({ gmraw: `${since} category:updates` }, { uid: true })) || []);

      const out: MailMeta[] = [];
      for await (const m of c.fetch(all, { uid: true, emailId: true, threadId: true, labels: true, internalDate: true, headers: HEADERS }, { uid: true })) {
        const meta = toMailMeta(m, noise, updates);
        if (meta) out.push(meta);
      }
      return out.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => c.close());
  }
}
