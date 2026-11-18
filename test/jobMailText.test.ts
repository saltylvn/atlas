import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lookUpNote, lookUpRoles, readJobMail, readingNote, trackApplications } from "@/lib/agents/career";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { fromAppliedCompany, openCompanies, ROLE_NOT_IN_EMAIL, ROLE_NOT_LISTED, rolesFromMail, rolesToLookUp } from "@/lib/domain/applications";
import { emailAgentReport, jobKind, prefsFrom } from "@/lib/domain/emailAgent";
import { cleanQuote, cleanRole, htmlToText, MAX_QUOTE_CHARS, pickTextPart, readVerdict, roleFromText } from "@/lib/domain/jobMailText";
import type { InboxItem } from "@/lib/domain/types";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("Reading a job email's text", () => {
  it("finds a rejection the subject hides", () => {
    const r = readVerdict(
      "Hi Tyler,\n\nThank you for your interest in the Forward Deployed Engineer role at Cobalt. After careful consideration, we have decided to move forward with other candidates whose experience more closely matches our needs.\n\nBest,\nThe Cobalt team",
    );
    expect(r.verdict).toBe("rejection");
    expect(r.quote).toContain("decided to move forward with other candidates");
  });

  it.each([
    "Unfortunately, we will not be moving forward with your application at this time.",
    "We regret to inform you that the position has been filled.",
    "Your application was not selected for further consideration.",
    "You are no longer under consideration for this role.",
  ])("reads a rejection in: %s", (s) => {
    expect(readVerdict(`Hello,\n${s}\nThanks`).verdict).toBe("rejection");
  });

  it("finds an interview invite", () => {
    const r = readVerdict("Hi Tyler, thanks for applying! We'd like to schedule a 30-minute phone screen with our hiring manager. Please share your availability for next week.");
    expect(r.verdict).toBe("interview");
    expect(r.quote).toMatch(/schedule a 30-minute phone screen|share your availability/);
  });

  it.each([
    "Please use this link to select a time: https://calendly.com/acme-recruiting/intro",
    "We would like to invite you to an interview with the team.",
    "You've been selected for the next round of interviews.",
  ])("reads an invite in: %s", (s) => {
    expect(readVerdict(s).verdict).toBe("interview");
  });

  it("is not fooled by a confirmation's boilerplate", () => {
    const confirmation =
      "Thank you for applying to Acme! We have received your application. If your qualifications match the role, a recruiter will reach out to schedule an interview. Unfortunately, due to the volume of applications, we cannot respond to every applicant individually.";
    expect(readVerdict(confirmation)).toEqual({ verdict: "none", quote: "", role: "" });
  });

  it("reads only the email's own words, not the quoted message it replies to", () => {
    const reply = "Thanks Tyler, talk soon.\n\nOn Mon, Nov 16, 2026 at 9:00 AM Tyler wrote:\n> I understand you decided to move forward with other candidates.";
    expect(readVerdict(reply).verdict).toBe("none");
  });

  it("a rejection wins over a polite mention of future interviews", () => {
    const r = readVerdict("We have decided not to move forward with your application. We'd like to schedule a call if a new role opens.");
    expect(r.verdict).toBe("rejection");
  });

  it("keeps a quote with no addresses, phone numbers or links, at most 200 characters", () => {
    const q = cleanQuote("Please reply to jane.doe@acme.com or call 801-555-1234, or book at https://calendly.com/jane/30min to schedule an interview " + "x".repeat(300));
    expect(q).not.toMatch(/@|555|calendly|https?:/);
    expect(q.length).toBeLessThanOrEqual(MAX_QUOTE_CHARS);
  });
});

describe("Finding the role in an email", () => {
  it.each([
    ["Hi Tyler,\nThank you for applying for the Senior AI Engineer role at Acme. We'll review your application.", "Senior AI Engineer"],
    ["Thanks for your application to the Forward Deployed Engineer position.", "Forward Deployed Engineer"],
    ["Position: Solutions Architect (R-12345)\nLocation: Remote", "Solutions Architect"],
    ["We received your application for Customer Engineer at Halcyon AI.", "Customer Engineer"],
    ["Thanks for your interest in the position of Software Engineer II at Initech.", "Software Engineer II"],
    ["Job Title: Data Analyst", "Data Analyst"],
    ["We're excited you applied for our AI Solutions Engineer opening!", "AI Solutions Engineer"],
    ["Thank you for your interest in Novaline and the Applied AI Engineer - EMEA role.", "Applied AI Engineer - EMEA"],
    ["Thanks for your interest in Acme and our Platform Engineer position!", "Platform Engineer"],
  ])("finds the role in: %s", (text, role) => {
    expect(roleFromText(text)).toBe(role);
  });

  it.each(["Thank you for applying to this position.", "Thank you for your interest in Acme. We have decided to move forward with other candidates.", "Your application for the next step has been received."])(
    "finds no role in: %s",
    (text) => {
      expect(roleFromText(text)).toBe("");
    },
  );

  it("drops a requisition number and refuses what is not a job title", () => {
    expect(cleanRole("AI Engineer - 45210")).toBe("AI Engineer");
    expect(cleanRole("“Platform Engineer” (Req #3391)")).toBe("Platform Engineer");
    expect(cleanRole("your interest in this")).toBe("");
    expect(cleanRole("the team")).toBe("");
  });

  it("reads the role with the verdict", () => {
    expect(readVerdict("Thank you for applying for the Platform Engineer role. Unfortunately, we will not be moving forward with your application.")).toEqual({
      verdict: "rejection",
      quote: "Unfortunately, we will not be moving forward with your application.",
      role: "Platform Engineer",
    });
  });
});

describe("Filling in \"Role not listed\"", () => {
  const app = (id: string, company: string, role: string, externalId = "", notes = "") => ({ id, company, role, externalId, notes });

  it("looks up each unnamed application's own email, once", () => {
    expect(
      rolesToLookUp([app("1", "Acme", ROLE_NOT_LISTED, "email:18c2f0a1b2"), app("2", "Beta", "AI Engineer", "email:18c2f0a1b3"), app("3", "Gamma", ROLE_NOT_LISTED, "match:abc"), app("4", "Delta", ROLE_NOT_LISTED, "email:18c2f0a1b4", ROLE_NOT_IN_EMAIL)]),
    ).toEqual([{ id: "1", messageId: "18c2f0a1b2" }]);
  });

  it("takes the role from the newest read email from that company", () => {
    const item = (fromEmail: string, receivedAt: string, textRole: string) => ({ fromName: "", fromEmail, subject: "Update", receivedAt, textRole });
    expect(
      rolesFromMail(
        [item("careers@acme.com", "2026-11-10T00:00:00Z", "Data Engineer"), item("careers@acme.com", "2026-11-12T00:00:00Z", "AI Engineer"), item("jobs@beta.io", "2026-11-12T00:00:00Z", "")],
        [app("1", "Acme", ROLE_NOT_LISTED), app("2", "Beta", ROLE_NOT_LISTED), app("3", "Acme Two", "Designer")],
      ),
    ).toEqual([{ id: "1", role: "AI Engineer" }]);
  });
});

describe("Turning an HTML email into text", () => {
  it("drops scripts and styles, breaks blocks, and keeps link addresses", () => {
    const t = htmlToText('<html><head><style>p{}</style></head><body><p>Hi&nbsp;Tyler,</p><p>Please <a href="https://calendly.com/acme/intro">pick a time</a>.</p><script>alert(1)</script></body></html>');
    expect(t).toContain("Hi Tyler,");
    expect(t).toContain("pick a time https://calendly.com/acme/intro");
    expect(t).not.toMatch(/alert|p\{\}/);
    expect(readVerdict(t).verdict).toBe("interview");
  });

  it("picks the plain-text part first, then HTML, never an attachment or an attached email", () => {
    expect(
      pickTextPart({ type: "multipart/mixed", childNodes: [{ type: "multipart/alternative", childNodes: [{ type: "text/plain", part: "1.1" }, { type: "text/html", part: "1.2" }] }, { type: "text/plain", part: "2", disposition: "attachment" }] }),
    ).toEqual({ part: "1.1", html: false });
    expect(pickTextPart({ type: "multipart/alternative", childNodes: [{ type: "text/html", part: "1" }] })).toEqual({ part: "1", html: true });
    expect(pickTextPart({ type: "text/plain" })).toEqual({ part: "1", html: false });
    expect(pickTextPart({ type: "multipart/mixed", childNodes: [{ type: "application/pdf", part: "1", disposition: "attachment" }, { type: "message/rfc822", part: "2", childNodes: [{ type: "text/plain", part: "2.1" }] }] })).toBeNull();
  });
});

const NOW = new Date("2026-11-17T16:00:00Z");
function live(): Context {
  const state = seedState(NOW);
  // Only the emails each test adds.
  state.inbox.length = 0;
  return { mode: "live", userId: "owner", store: createMemoryStore(state), settings: state.settings, now: NOW, today: "2026-11-17", time: "09:00" };
}

const mail = (messageId: string, subject: string, fromEmail = "no-reply@acme.greenhouse.io"): InboxItem => ({
  id: messageId,
  messageId,
  threadId: messageId,
  fromName: "Acme Recruiting",
  fromEmail,
  subject,
  snippet: "",
  receivedAt: "2026-11-17T15:00:00Z",
  category: "noise",
  reason: "Notification sender",
  done: false,
  createdAt: "2026-11-17T15:00:00Z",
});

describe("The Applications Agent reading job emails", () => {
  it("lets the text decide the kind once read", () => {
    const m = mail("a", "Update on your application");
    expect(jobKind(m)).toBe("reply");
    expect(jobKind({ ...m, textVerdict: "rejection" })).toBe("rejection");
    expect(jobKind({ ...m, textVerdict: "none" })).toBe("reply");
    // A company's vaguely titled email becomes job mail once its text says so.
    const vague = { ...mail("v", "Regarding your application", "careers@acme.com"), category: "fyi" as const, reason: "Update or receipt" };
    expect(jobKind(vague)).toBeNull();
    expect(jobKind({ ...vague, textVerdict: "rejection" })).toBe("rejection");
    expect(jobKind({ ...vague, textVerdict: "none" })).toBeNull();
  });

  it("knows every email from a company you applied to, except its newsletters and promotions", () => {
    const acme = ["Acme Robotics"];
    const from = (fromEmail: string, subject: string, extra: Partial<InboxItem> = {}) => ({ fromName: "", fromEmail, subject, category: "fyi" as const, reason: "Update or receipt", ...extra });
    // The vague subjects companies send from their own address.
    for (const s of ["Regarding your application", "Your Acme application", "Update from Acme", "Following up on your candidacy", "Acme Careers: an update"]) expect(fromAppliedCompany(from("careers@acmerobotics.com", s, { fromName: "Acme Robotics Careers" }), acme), s).toBe("Acme Robotics");
    expect(fromAppliedCompany(from("talent@acme.com", "Hello from the team", { fromName: "Acme Talent" }), ["Acme"])).toBe("Acme");
    // A person at the company writing to you.
    expect(fromAppliedCompany(from("jane@acme.com", "Quick question", { fromName: "Jane Doe", category: "reply", reason: "Asks you something directly" }), ["Acme"])).toBe("Acme");
    // An automated sender counts too, whatever the subject.
    expect(fromAppliedCompany(from("no-reply@acme.com", "Your account was created"), ["Acme"])).toBe("Acme");
    expect(fromAppliedCompany(from("no-reply@acme.com", "An update on your application"), ["Acme"])).toBe("Acme");
    expect(fromAppliedCompany(from("deals@acme.com", "50% off this week", { category: "noise", reason: "Gmail promotions" }), ["Acme"])).toBeNull();
    // Never a mailing list or a promotion, a company you did not apply to, or a personal mailbox's domain.
    expect(fromAppliedCompany(from("news@acme.com", "Acme careers newsletter", { category: "noise", reason: "Mailing list or automated" }), ["Acme"])).toBeNull();
    expect(fromAppliedCompany(from("careers@globex.com", "Regarding your application", { fromName: "Globex Careers" }), ["Acme"])).toBeNull();
    expect(fromAppliedCompany(from("someone@gmail.com", "Regarding your application", { fromName: "Someone" }), ["Gmail"])).toBeNull();
  });

  it("counts only applications still waiting on news", () => {
    const now = new Date("2026-11-17T16:00:00Z");
    const app = (company: string, status: "applied" | "replied" | "interview" | "rejected" | "offer" | "saved", statusAt = "2026-11-10T00:00:00Z") => ({ company, status, statusAt });
    expect(openCompanies([app("Acme", "applied"), app("Beta", "interview"), app("Gamma", "rejected"), app("Delta", "saved"), app("Old Co", "applied", "2026-05-01T00:00:00Z"), app("Acme", "replied")], now)).toEqual(["Acme", "Beta"]);
  });

  it("reads only job emails, only once, and moves the application to rejected", async () => {
    const ctx = live();
    const persist = ctx.store;
    await persist.applications.create({ company: "Acme", role: "AI Engineer", type: "full-time", targetRole: "", source: "Email", url: "", payText: "", tier: "semi", status: "applied", appliedOn: "2026-11-10", statusAt: "2026-11-10T15:00:00Z", notes: "", origin: "atlas", externalId: "x" });
    await persist.inbox.upsert([mail("job1", "Update on your application with Acme"), { ...mail("p1", "Dinner Friday?", "sam@example.com"), fromName: "Sam Ortiz", category: "reply", reason: "From Sam" }]);
    const asked: string[][] = [];
    const reader = async (ids: string[]) => {
      asked.push(ids);
      return new Map(ids.map((id) => [id, "Thank you for applying. We have decided to move forward with other candidates for this role."]));
    };
    const items = await persist.inbox.list();
    const r = await readJobMail(ctx, items, persist, reader);
    expect(asked).toEqual([["job1"]]);
    expect(r).toMatchObject({ read: 1, rejections: 1, interviews: 0 });
    expect(readingNote(r)).toBe("1 read: 1 rejection, 0 interview invites");
    // Stored: the verdict and the quote, nothing else.
    const stored = (await persist.inbox.list()).find((i) => i.messageId === "job1")!;
    expect(stored.textVerdict).toBe("rejection");
    expect(stored.textQuote).toContain("decided to move forward with other candidates");

    const tracked = await trackApplications(ctx, r.items, persist);
    expect(tracked.updated).toBe(1);
    expect((await persist.applications.list()).find((a) => a.company === "Acme")!.status).toBe("rejected");

    // Read once: the next run asks Gmail for nothing.
    await readJobMail(ctx, await persist.inbox.list(), persist, reader);
    expect(asked).toHaveLength(1);
  });

  it("reads a company's own vaguely titled email, but never a bill from it", async () => {
    const ctx = live();
    const persist = ctx.store;
    await persist.applications.create({ company: "Initech", role: "AI Engineer", type: "full-time", targetRole: "", source: "Email", url: "", payText: "", tier: "semi", status: "applied", appliedOn: "2026-11-10", statusAt: "2026-11-10T15:00:00Z", notes: "", origin: "atlas", externalId: "i" });
    await persist.inbox.upsert([
      { ...mail("co1", "Regarding your application", "careers@initech.com"), fromName: "Initech Careers", category: "fyi", reason: "Update or receipt" },
      { ...mail("co2", "Your statement is ready", "no-reply@initech.com"), fromName: "Initech", category: "fyi", reason: "Update or receipt" },
    ]);
    const asked: string[] = [];
    const r = await readJobMail(ctx, await persist.inbox.list(), persist, async (ids) => {
      asked.push(...ids);
      return new Map(ids.map((id) => [id, "We regret to inform you that we will not be moving forward with your application."]));
    });
    expect(asked).toEqual(["co1"]);
    expect(r.rejections).toBe(1);
    await trackApplications(ctx, r.items, persist);
    expect((await persist.applications.list()).find((a) => a.company === "Initech")!.status).toBe("rejected");
  });

  it("fills in the role from the email each application was logged from", async () => {
    const ctx = live();
    const persist = ctx.store;
    for (const a of await persist.applications.list()) await persist.applications.remove(a.id);
    const base = { type: "full-time" as const, targetRole: "", source: "Email", url: "", payText: "", tier: "semi" as const, status: "applied" as const, appliedOn: "2026-11-10", statusAt: "2026-11-10T15:00:00Z", origin: "atlas" as const };
    await persist.applications.create({ ...base, company: "Acme", role: ROLE_NOT_LISTED, notes: "From email: Thank you for applying", externalId: "email:aa01" });
    await persist.applications.create({ ...base, company: "Beta", role: ROLE_NOT_LISTED, notes: "", externalId: "email:bb02" });
    const asked: string[][] = [];
    const reader = async (ids: string[]) => {
      asked.push(ids);
      return new Map([
        ["aa01", "Thank you for applying for the Senior AI Engineer role at Acme."],
        ["bb02", "Thank you for applying. We will be in touch."],
      ]);
    };
    const r = await lookUpRoles(ctx, persist, reader);
    expect(r).toEqual({ looked: 2, found: 1 });
    expect(lookUpNote(r)).toBe("1 of 2 roles found in the application emails");
    const apps = await persist.applications.list();
    expect(apps.find((a) => a.company === "Acme")!.role).toBe("Senior AI Engineer");
    expect(apps.find((a) => a.company === "Beta")!.notes).toContain(ROLE_NOT_IN_EMAIL);
    // Both are settled: the next run asks Gmail for nothing.
    expect(await lookUpRoles(ctx, persist, reader)).toEqual({ looked: 0, found: 0 });
    expect(asked).toHaveLength(1);
  });

  it("a new application logged from a confirmation takes the role from its text", async () => {
    const ctx = live();
    const persist = ctx.store;
    await persist.inbox.upsert([mail("c1", "Thank you for applying!", "no-reply@zeta.greenhouse.io")]);
    const r = await readJobMail(ctx, await persist.inbox.list(), persist, async (ids) => new Map(ids.map((id) => [id, "Thanks for applying to the Platform Engineer position at Zeta Labs."])));
    expect(r.items.find((i) => i.messageId === "c1")!.textRole).toBe("Platform Engineer");
    await trackApplications(ctx, r.items, persist);
    const created = (await persist.applications.list()).find((a) => a.externalId === "email:c1");
    expect(created?.role).toBe("Platform Engineer");
  });

  it("marks nothing when Gmail cannot be reached, so the next run tries again", async () => {
    const ctx = live();
    await ctx.store.inbox.upsert([mail("job2", "Your application to Acme")]);
    const r = await readJobMail(ctx, await ctx.store.inbox.list(), ctx.store, async () => null);
    expect(r.read).toBe(0);
    expect(r.skipped).toMatch(/not reachable/);
    expect((await ctx.store.inbox.list()).find((i) => i.messageId === "job2")!.textVerdict ?? null).toBeNull();
  });

  it("waits for the next sync when a brief's run is short on time", async () => {
    const ctx = { ...live(), deadline: Date.now() + 10_000 };
    await ctx.store.inbox.upsert([mail("job3", "Your application to Acme")]);
    let called = false;
    const r = await readJobMail(ctx, await ctx.store.inbox.list(), ctx.store, async () => ((called = true), new Map()));
    expect(called).toBe(false);
    expect(r.skipped).toMatch(/next sync/);
  });

  it("shows the deciding sentence on Inbox, and the demo has a sample", () => {
    const state = seedState(NOW);
    const report = emailAgentReport({ slot: "morning", items: state.inbox, prefs: prefsFrom(state.settings), sync: "not_run" });
    const cobalt = report.section.jobs!.find((j) => j.fromName.startsWith("Cobalt"))!;
    expect(cobalt.kind).toBe("rejection");
    expect(cobalt.quote).toContain("move forward with other candidates");
  });

  it("never sends the text to an AI model or logs it", () => {
    const src = read("lib/domain/jobMailText.ts") + read("lib/agents/career.ts").split("export async function readJobMail")[1]!.split("export async function trackApplications")[0];
    expect(src).not.toMatch(/structured|takeAiCall|@\/lib\/ai\//);
    expect(src).not.toMatch(/console\.|audit\(/);
    // The column the text could live in does not exist: only the verdict and the quote.
    const migration = read("supabase/migrations/20261117184026_job_mail_text.sql");
    expect(migration).toContain("text_verdict");
    expect(migration).toContain("char_length(text_quote) <= 240");
    expect(migration).not.toMatch(/\bbody\b|text_body|content/);
  });
});
