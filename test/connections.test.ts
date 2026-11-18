import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { composeBrief } from "@/lib/domain/brief";
import { parseAddress, summarizeInbox, triage, type MailMeta } from "@/lib/domain/inbox";
import { projectsToSurface } from "@/lib/domain/projects";
import type { InboxItem, Project } from "@/lib/domain/types";
import { authorizeUrl, idTokenEmail, pkcePair, toMeta } from "@/lib/integrations/google";
import { isAllowedEndpoint } from "@/lib/push";
import { bearerMatches } from "@/lib/security/bearer";
import { open, parseKey, seal } from "@/lib/security/vault";
import { isPublicPath } from "@/lib/supabase/gate";
import { createHash } from "node:crypto";

describe("vault", () => {
  const key = randomBytes(32);
  it("round-trips and never stores the plaintext", () => {
    const sealed = seal(key, "1//refresh-token", "google:owner");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("refresh");
    expect(open(key, sealed, "google:owner")).toBe("1//refresh-token");
  });
  it("fails on the wrong key, the wrong context, or tampering", () => {
    const sealed = seal(key, "secret", "google:owner");
    expect(() => open(randomBytes(32), sealed, "google:owner")).toThrow();
    expect(() => open(key, sealed, "google:someone-else")).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => open(key, parts.join("."), "google:owner")).toThrow();
  });
  it("uses a fresh IV each time", () => {
    expect(seal(key, "same", "c")).not.toBe(seal(key, "same", "c"));
  });
  it("accepts only 32-byte keys", () => {
    expect(() => parseKey(randomBytes(16).toString("base64"))).toThrow();
    expect(parseKey(randomBytes(32).toString("base64")).length).toBe(32);
  });
});

const mail = (m: Partial<MailMeta>): MailMeta => ({
  id: "m1",
  threadId: "t1",
  from: "Someone <someone@example.com>",
  to: "me@example.com",
  cc: "",
  subject: "Hello",
  snippet: "",
  receivedAt: "2026-11-12T15:00:00.000Z",
  labelIds: ["INBOX"],
  listUnsubscribe: false,
  precedence: "",
  autoSubmitted: "",
  ...m,
});
const contacts = [{ name: "Sam Ortiz", email: "sam@example.com", circle: "friends" as const }];

describe("inbox triage", () => {
  it("parses display names and bare addresses", () => {
    expect(parseAddress('"Ortiz, Sam" <Sam@Example.com>')).toEqual({ name: "Ortiz, Sam", email: "sam@example.com" });
    expect(parseAddress("bare@example.com")).toEqual({ name: "bare@example.com", email: "bare@example.com" });
  });
  it("puts known contacts in reply, even from a list", () => {
    expect(triage(mail({ from: "Sam <sam@example.com>", listUnsubscribe: true }), contacts, "me@example.com")).toMatchObject({ category: "reply", fromName: "Sam Ortiz" });
  });
  it("treats lists, automated mail and notification senders as noise", () => {
    expect(triage(mail({ listUnsubscribe: true, snippet: "Can you join?" }), contacts, "me@example.com").category).toBe("noise");
    expect(triage(mail({ autoSubmitted: "auto-generated" }), contacts, "me@example.com").category).toBe("noise");
    expect(triage(mail({ from: "GitHub <notifications@github.com>" }), contacts, "me@example.com").category).toBe("noise");
    expect(triage(mail({ from: "no-reply@bank.com" }), contacts, "me@example.com").category).toBe("noise");
    expect(triage(mail({ labelIds: ["INBOX", "CATEGORY_PROMOTIONS"] }), contacts, "me@example.com").category).toBe("noise");
  });
  it("flags a direct question as needing a reply, but not when only copied", () => {
    expect(triage(mail({ snippet: "Are you free Thursday?" }), contacts, "me@example.com").category).toBe("reply");
    expect(triage(mail({ to: "team@example.com", cc: "me@example.com", snippet: "Are you free?" }), contacts, "me@example.com")).toMatchObject({ category: "fyi", reason: "You were copied" });
  });
  it("files receipts as FYI", () => {
    expect(triage(mail({ labelIds: ["INBOX", "CATEGORY_UPDATES"], subject: "Your receipt" }), contacts, "me@example.com").category).toBe("fyi");
  });
  it("summarizes open items, oldest reply first", () => {
    const item = (id: string, category: InboxItem["category"], at: string, done = false): InboxItem => ({
      id, messageId: id, threadId: id, fromName: id, fromEmail: "", subject: "", snippet: "", receivedAt: at, category, reason: "", done, createdAt: at,
    });
    const s = summarizeInbox([item("b", "reply", "2026-11-12T10:00:00Z"), item("a", "reply", "2026-11-12T08:00:00Z"), item("c", "reply", "2026-11-12T07:00:00Z", true), item("d", "noise", "2026-11-12T09:00:00Z")]);
    expect(s).toMatchObject({ needsReply: 2, noise: 1, fyi: 0 });
    expect(s.waiting.map((w) => w.id)).toEqual(["a", "b"]);
  });
});

describe("gmail adapter", () => {
  it("reads headers case-insensitively and decodes the snippet", () => {
    const m = toMeta({
      id: "abc",
      threadId: "t",
      labelIds: ["INBOX"],
      snippet: "Tom &amp; Jerry&#39;s",
      internalDate: "1794500000000",
      payload: { headers: [{ name: "from", value: "A <a@x.com>" }, { name: "List-Unsubscribe", value: "<mailto:u@x.com>" }] },
    });
    expect(m).toMatchObject({ from: "A <a@x.com>", snippet: "Tom & Jerry's", listUnsubscribe: true });
  });
  it("builds a PKCE consent URL with offline access and only read-only Gmail", () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    const u = new URL(authorizeUrl({ clientId: "cid", clientSecret: "s", redirectUri: "https://a.test/cb" }, "st", challenge));
    expect(u.hostname).toBe("accounts.google.com");
    expect(u.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/gmail.readonly");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.has("client_secret")).toBe(false);
  });
  it("takes the email from a verified ID token only", () => {
    const jwt = (p: object) => `h.${Buffer.from(JSON.stringify(p)).toString("base64url")}.s`;
    expect(idTokenEmail(jwt({ email: "Me@Gmail.com", email_verified: true }))).toBe("me@gmail.com");
    expect(idTokenEmail(jwt({ email: "me@gmail.com", email_verified: false }))).toBeNull();
    expect(idTokenEmail("garbage")).toBeNull();
  });
});

describe("push and machine endpoints", () => {
  it("accepts only known push services over https", () => {
    expect(isAllowedEndpoint("https://web.push.apple.com/QGx")).toBe(true);
    expect(isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedEndpoint("http://web.push.apple.com/x")).toBe(false);
    expect(isAllowedEndpoint("https://169.254.169.254/latest")).toBe(false);
    expect(isAllowedEndpoint("https://web.push.apple.com.evil.com/x")).toBe(false);
    expect(isAllowedEndpoint("https://user:pw@web.push.apple.com/x")).toBe(false);
  });
  it("compares bearer tokens exactly", () => {
    const t = "t".repeat(40);
    expect(bearerMatches(`Bearer ${t}`, t)).toBe(true);
    expect(bearerMatches(`Bearer ${t}x`, t)).toBe(false);
    expect(bearerMatches(t, t)).toBe(false);
    expect(bearerMatches(`Bearer ${t}`, undefined)).toBe(false);
  });
  it("leaves the OAuth routes and pages behind the session gate", () => {
    expect(isPublicPath("/api/cron/morning")).toBe(true);
    expect(isPublicPath("/api/capture")).toBe(true);
    expect(isPublicPath("/sw.js")).toBe(true);
    expect(isPublicPath("/api/connect/google")).toBe(false);
    expect(isPublicPath("/api/connect/google/callback")).toBe(false);
    expect(isPublicPath("/inbox")).toBe(false);
    expect(isPublicPath("/connectors")).toBe(false);
  });
});

describe("projects in the brief", () => {
  const p = (x: Partial<Project>): Project => ({ id: x.title ?? "p", title: "p", kind: "idea", status: "idea", why: "", nextStep: "", link: null, reviewOn: null, createdAt: "2026-11-01T00:00:00Z", ...x });
  it("leads with active next steps, then anything due for review", () => {
    const out = projectsToSurface(
      [
        p({ title: "Parked shelf", status: "parked", reviewOn: "2026-11-12" }),
        p({ title: "Future idea", reviewOn: "2026-12-01" }),
        p({ title: "Ship it", status: "active", nextStep: "Deploy" }),
        p({ title: "No step", status: "active" }),
        p({ title: "Finished", status: "done", reviewOn: "2026-11-01" }),
      ],
      "2026-11-12",
    );
    expect(out.map((n) => n.project.title)).toEqual(["Ship it", "Parked shelf"]);
    expect(out[1]?.reason).toMatch(/Parked/);
  });
  it("adds inbox and project lines to the brief summary", () => {
    const waiting: InboxItem = { id: "1", messageId: "1", threadId: "1", fromName: "Sam Ortiz", fromEmail: "", subject: "", snippet: "", receivedAt: "", category: "reply", reason: "", done: false, createdAt: "" };
    const b = composeBrief({
      today: "2026-11-12",
      tasks: [],
      events: [],
      peopleDue: [],
      pipeline: null,
      news: [],
      weather: null,
      dailyCapacityMin: 360,
      timeZone: "America/Denver",
      inbox: { needsReply: 1, fyi: 0, noise: 0, waiting: [waiting] },
    });
    expect(b.summary.join(" ")).toContain("Inbox: 1 needs a reply, starting with Sam Ortiz.");
  });
});

import { decodeWords, gmailHexId, parseHeaders, toMailMeta } from "@/lib/integrations/gmailImap";
import type { FetchMessageObject } from "imapflow";

describe("gmail over IMAP (app password)", () => {
  const raw = (s: string) => Buffer.from(s.replace(/\n/g, "\r\n"));
  const msg = (over: Partial<FetchMessageObject>): FetchMessageObject =>
    ({
      seq: 1,
      uid: 7,
      emailId: "1794512345678901234",
      threadId: "1794512345678900000",
      labels: new Set<string>(),
      internalDate: new Date("2026-11-12T15:00:00Z"),
      headers: raw("From: Sam Ortiz <sam@example.com>\nTo: me@example.com\nSubject: Dinner?\n\n"),
      ...over,
    }) as FetchMessageObject;

  it("converts Gmail's decimal ids to the hex the web app uses, and rejects junk", () => {
    expect(gmailHexId("1794512345678901234")).toBe(BigInt("1794512345678901234").toString(16));
    expect(gmailHexId("abc")).toBeNull();
    expect(gmailHexId(undefined)).toBeNull();
  });
  it("reads folded headers case-insensitively and decodes encoded words", () => {
    const h = parseHeaders(raw("Subject: =?UTF-8?B?Q2Fmw6kgdG9tb3Jyb3c/?=\nList-Unsubscribe:\n <mailto:u@x.com>\nFROM: a@b.com\n\n"));
    expect(h.subject).toBe("Café tomorrow?");
    expect(h["list-unsubscribe"]).toBe("<mailto:u@x.com>");
    expect(h.from).toBe("a@b.com");
    expect(decodeWords("=?utf-8?Q?Hi_there=21?=")).toBe("Hi there!");
  });
  it("maps labels and categories so the same triage rules apply, with no snippet", () => {
    const m = toMailMeta(msg({ labels: new Set(["\\Important"]) }), new Set(), new Set())!;
    expect(m).toMatchObject({ subject: "Dinner?", snippet: "", labelIds: ["INBOX", "IMPORTANT"] });
    expect(triage(m, [], "me@example.com").category).toBe("reply");
    const promo = toMailMeta(msg({ uid: 9 }), new Set([9]), new Set())!;
    expect(triage(promo, [], "me@example.com").category).toBe("noise");
    const update = toMailMeta(msg({ uid: 10, headers: raw("From: a@b.com\nTo: me@example.com\nSubject: Receipt\n\n") }), new Set(), new Set([10]))!;
    expect(triage(update, [], "me@example.com")).toMatchObject({ category: "fyi", reason: "Update or receipt" });
  });
  it("skips a message without usable ids", () => {
    expect(toMailMeta(msg({ emailId: undefined }), new Set(), new Set())).toBeNull();
  });
});
