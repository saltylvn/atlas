import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { careerAgentWork, jobMailsFrom, readJobMail, trackApplications, trackedNote } from "@/lib/agents/career";
import { runSync } from "@/lib/agents/sync";
import { NO_TRACE } from "@/lib/agents/trace";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState, type MemoryState } from "@/lib/data/memory";
import { EVENT_OF_MAIL, eventIndex, kindToPlace, mailsToPlace, mailWaiting, NO_EVENTS, textRead, trackMail, type MailKind } from "@/lib/domain/applications";
import { prefsFrom, tagInbox } from "@/lib/domain/emailAgent";
import type { InboxItem } from "@/lib/domain/types";
import { urgentSince } from "@/lib/domain/urgent";

// docs/design-pipeline.md, 13 ("unread mail waits"): each email is placed on a timeline once,
// so no run places one before its text has been read. A subject alone ("Interview with Acme")
// moves no application to Interview and queues no "Interview invite".

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const NOW = new Date("2026-11-17T16:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const mail = (messageId: string, subject: string, receivedAt: string, over: Partial<InboxItem> = {}): InboxItem => ({
  id: messageId,
  messageId,
  threadId: `t-${messageId}`,
  fromName: "Acme Recruiting",
  fromEmail: "no-reply@acme.greenhouse.io",
  subject,
  snippet: "",
  receivedAt,
  category: "noise",
  reason: "Notification sender",
  done: false,
  createdAt: receivedAt,
  ...over,
});

const application = (company: string, role: string) => ({ company, role, targetRole: "", source: "Email", url: "", payText: "", tier: "semi" as const, status: "applied" as const, appliedOn: "2026-11-10", statusAt: "2026-11-10T15:00:00Z", notes: "", origin: "atlas" as const, externalId: `x:${company}:${role}` });

function board(mode: Context["mode"] = "live"): { ctx: Context; state: MemoryState } {
  const state = seedState(NOW);
  state.inbox.length = 0;
  state.applications = [];
  state.applicationEvents = [];
  state.notifications = [];
  state.agentRuns = [];
  return { state, ctx: { mode, userId: "owner", store: createMemoryStore(state), settings: state.settings, now: NOW, today: "2026-11-17", time: "09:00" } };
}

/** One run as the 2-hour sync, the brief and the Career Mentor's refresh do it: read what can be read, then track. */
async function run(ctx: Context, texts: Map<string, string> | null) {
  const reading = await readJobMail(ctx, await ctx.store.inbox.list(), ctx.store, async () => texts);
  return { reading, tracked: await trackApplications(ctx, reading.items, ctx.store) };
}

const INVITE = "Hi Tyler,\nWe would like to schedule an interview with you next week.\nAcme Recruiting";
const REJECTION = "Hi Tyler,\nThank you for your interest. We have decided to move forward with other candidates.\nAcme Recruiting";
const CONFIRMATION = "Hi Tyler,\nThank you for applying to Acme. We have received your application and will review it shortly.\nAcme Recruiting";

describe("The rule: an email goes on a timeline once its text has been read", () => {
  it("places a read email as what it is, and holds an unread one", () => {
    expect(textRead({})).toBe(false);
    expect(textRead({ textVerdict: null })).toBe(false);
    expect(textRead({ textVerdict: "none" })).toBe(true);
    expect(textRead({ textVerdict: "interview" })).toBe(true);
    const kinds = Object.keys(EVENT_OF_MAIL) as MailKind[];
    for (const k of kinds) {
      expect(kindToPlace(k, true), k).toBe(k);
      expect(kindToPlace(k, false), k).toBeNull();
    }
  });

  it("mail no run will ever read is placed by its subject, which cannot make an interview invite", () => {
    expect(kindToPlace("interview", false, true)).toBe("reply");
    for (const k of ["confirmation", "reply", "rejection"] as const) expect(kindToPlace(k, false, true)).toBe(k);
    // Read mail is never touched by that exception.
    expect(kindToPlace("interview", true, true)).toBe("interview");
  });

  it("counts what is held back: about an application, unread, and on no timeline yet", () => {
    const items = [
      { messageId: "a", jobKind: "interview" as const },
      { messageId: "b", jobKind: "confirmation" as const, textVerdict: null },
      { messageId: "c", jobKind: "rejection" as const, textVerdict: "rejection" as const },
      { messageId: "d", jobKind: "recruiter" as const },
      { messageId: "e", jobKind: null },
      { messageId: "f", jobKind: "reply" as const },
    ];
    expect(mailWaiting(items)).toBe(3);
    // One placed before this rule existed is not waiting for anything.
    expect(mailWaiting(items, eventIndex([{ applicationId: "x", sourceRef: "email:f", threadId: "" }]))).toBe(2);
  });

  it("is the tracker's own: no run keeps a filter of its own, and every one hands it the inbox", () => {
    for (const f of ["lib/agents/watch.ts", "lib/agents/sync.ts", "lib/agents/mentorRefresh.ts"]) {
      expect(read(f), f).not.toContain("textVerdict");
      expect(read(f), f).toContain("trackApplications(ctx, reading.items, persist)");
    }
    expect(read("lib/agents/career.ts")).toContain("kindToPlace(i.jobKind, textRead(i), neverRead.has(i.messageId))");
  });
});

describe("A run that cannot read the text", () => {
  async function unreadInvite() {
    const b = board();
    await b.ctx.store.applications.create(application("Acme", "AI Engineer"));
    await b.ctx.store.inbox.upsert([mail("i1", "Interview with Acme", ago(1))]);
    return b;
  }

  it("moves nothing to Interview and queues no notice from a subject alone", async () => {
    const { ctx, state } = await unreadInvite();
    // Gmail's text could not be fetched: no app-password connection, slow, or more than a dozen waiting.
    const first = await run(ctx, null);
    expect(first.reading).toMatchObject({ read: 0 });
    expect(first.reading.skipped).toMatch(/not reachable/);
    expect(first.tracked).toMatchObject({ created: 0, updated: 0, jobEmails: 0, toPlace: 0, heard: 0, waiting: 1 });
    expect(trackedNote(first.tracked)).toBe("0 job emails: 0 new applications, 0 moved forward, 1 not placed until its text is read");

    expect((await ctx.store.applications.list())[0]).toMatchObject({ company: "Acme", status: "applied" });
    expect(state.applicationEvents).toEqual([]);
    expect(state.notifications).toEqual([]);
    // The phone is not told "Interview invite" by the urgent check either.
    expect(urgentSince(await ctx.store.inbox.list(), ctx.settings, ago(2), [], new Set())).toEqual([]);

    // A second run that still cannot read it changes nothing.
    await run(ctx, null);
    expect((await ctx.store.applications.list())[0]!.status).toBe("applied");
    expect(state.notifications).toEqual([]);
  });

  it.each([
    { said: "an invite", text: INVITE, status: "interview", kind: "interview", title: "Acme · Interview invite" },
    { said: "a rejection", text: REJECTION, status: "rejected", kind: "rejection", title: "Acme · Rejection" },
    // The text decides nothing, so the subject cannot make it an interview: it is a reply.
    { said: "a plain confirmation", text: CONFIRMATION, status: "replied", kind: "reply", title: "Acme · They replied" },
  ])("the next run reads it and places it by what the text says: $said", async ({ text, status, kind, title }) => {
    const { ctx, state } = await unreadInvite();
    await run(ctx, null);

    const next = await run(ctx, new Map([["i1", text]]));
    expect(next.reading).toMatchObject({ read: 1 });
    expect(next.tracked).toMatchObject({ updated: 1, heard: 1, waiting: 0 });
    expect((await ctx.store.applications.list())[0]).toMatchObject({ status });
    expect(state.applicationEvents!.map((e) => [e.sourceRef, e.kind])).toEqual([["email:i1", kind]]);
    expect(state.notifications!.map((n) => [n.kind, n.title])).toEqual([[kind, title]]);

    // Placed once: a later run adds nothing.
    expect((await run(ctx, new Map())).tracked).toMatchObject({ updated: 0, heard: 0 });
    expect(state.applicationEvents).toHaveLength(1);
  });

  it("holds every kind of unread job email, not only an invite", async () => {
    const { ctx, state } = board();
    await ctx.store.inbox.upsert([mail("c1", "Thank you for applying to Acme", ago(30)), mail("u1", "Update on your application at Acme", ago(2))]);
    expect((await run(ctx, null)).tracked).toMatchObject({ created: 0, waiting: 2 });
    expect(state.applications).toEqual([]);

    // Read: the application is logged from the confirmation, and the "update" was a rejection.
    await run(ctx, new Map([["c1", CONFIRMATION], ["u1", REJECTION]]));
    expect((await ctx.store.applications.list()).map((a) => [a.company, a.status])).toEqual([["Acme", "rejected"]]);
    expect(state.applicationEvents!.map((e) => e.kind)).toEqual(["confirmation", "rejection"]);
  });
});

describe("The real runs", () => {
  beforeAll(() => {
    // No network in tests: the News Agent reads no feeds.
    process.env.ATLAS_OFFLINE = "1";
  });

  /** The demo has no Gmail, so a new email's text cannot be fetched: an unread invite by subject, half an hour old. */
  function demoWithUnreadInvite() {
    const b = board("demo");
    b.state.applications = [{ ...application("Acme", "AI Engineer"), id: "acme", createdAt: ago(200) }];
    b.state.inbox.push(mail("i1", "Interview with Acme", ago(0.5)));
    return b;
  }

  it("the 2-hour sync places nothing and pings nothing for it", async () => {
    const { ctx, state } = demoWithUnreadInvite();
    const outcome = await runSync(ctx, "run-now", null);
    expect(outcome.status).toBe("succeeded");
    expect(state.applications![0]).toMatchObject({ company: "Acme", status: "applied" });
    expect(state.applicationEvents).toEqual([]);
    expect(state.notifications).toEqual([]);
    expect(outcome.urgent.filter((u) => u.kind === "interview")).toEqual([]);
    // The Applications Agent's trace says why, in counts.
    const career = (await ctx.store.agentRuns.recent(50)).find((r) => r.agent === "career" && r.status === "succeeded")!;
    expect(career.trace!.find((s) => s.name === "Track applications from job emails")!.note).toContain("1 not placed until its text is read");
  });

  it("the brief's run places nothing for it", async () => {
    const { ctx, state } = demoWithUnreadInvite();
    await careerAgentWork(ctx, "morning", ctx.store, NO_TRACE, async () => ({ jobs: [], failed: [], sourceCount: 0 }));
    expect(state.applications![0]).toMatchObject({ status: "applied" });
    expect(state.applicationEvents).toEqual([]);
    expect(state.notifications).toEqual([]);
  });

  it("the demo's own job emails come already read, so the demo still tracks them", () => {
    const state = seedState(NOW);
    const jobMail = tagInbox(state.inbox, prefsFrom(state.settings)).filter((i) => i.jobKind && EVENT_OF_MAIL[i.jobKind]);
    expect(jobMail.map((i) => i.messageId).sort()).toEqual(["demo14", "demo7"]);
    expect(mailWaiting(jobMail)).toBe(0);
    expect(jobMailsFrom(state.inbox, state.settings).map((m) => [m.messageId, m.kind]).sort()).toEqual([["demo14", "rejection"], ["demo7", "interview"]]);
  });
});

describe("Needs you asks only about read mail", () => {
  it("does not offer an unread email to place as an interview invite; once read, it does", async () => {
    const { ctx } = board();
    await ctx.store.applications.create(application("Acme", "AI Engineer"));
    await ctx.store.applications.create(application("Acme", "Solutions Engineer"));
    const apps = await ctx.store.applications.list();
    const lane = (inbox: InboxItem[]) => mailsToPlace(trackMail(jobMailsFrom(inbox, ctx.settings), apps, () => "", NO_EVENTS).ask, apps);

    // Two open applications at Acme and no role named: it would be a question, if it had been read.
    const unread = mail("i1", "Interview with Acme", ago(1));
    expect(lane([unread])).toEqual([]);
    expect(lane([{ ...unread, textVerdict: "interview", textQuote: "We would like to schedule an interview with you." }])).toMatchObject([{ messageId: "i1", kind: "Interview invite" }]);
    // The page and the action behind it both ask the tracker's own list.
    expect(read("app/(app)/(career)/applications/page.tsx")).toContain("trackMail(jobMailsFrom(inbox, settings)");
    expect(read("app/actions/career.ts").split("export async function placeJobMail")[1]!.split("\nexport async function ")[0]).toContain("trackMail(jobMailsFrom(inbox, settings)");
  });
});

describe("The one-time catch-up", () => {
  it("logs past emails it will never read by their subject, never as an interview invite", async () => {
    const { ctx, state } = board();
    // Found in All Mail and not in the inbox: no run reads their text.
    const past = [mail("h0", "Thank you for applying to Acme", ago(40 * 24)), mail("h1", "Interview with Acme", ago(35 * 24))];
    // Still in the inbox and unread: it waits for the reader like any other.
    const inInbox = mail("i2", "Interview availability at Beta", ago(3), { fromName: "Beta Recruiting", fromEmail: "jobs@beta.io" });
    const tracked = await trackApplications(ctx, [...past, inInbox], ctx.store, new Set(["h0", "h1"]));
    expect(tracked).toMatchObject({ created: 1, jobEmails: 2, waiting: 1 });

    expect((await ctx.store.applications.list()).map((a) => [a.company, a.status])).toEqual([["Acme", "replied"]]);
    expect(state.applicationEvents!.map((e) => [e.sourceRef, e.kind])).toEqual([["email:h0", "confirmation"], ["email:h1", "reply"]]);
    expect(state.notifications!.map((n) => n.kind)).toEqual(["reply"]);
  });

  it("the action names what is outside the inbox, and uses the inbox's reading for the rest", () => {
    const src = read("app/actions/career.ts").split("export async function findPastApplications")[1]!.split("\nexport async function ")[0]!;
    expect(src).toContain("items = found.items.map((i) => stored.get(i.messageId) ?? i)");
    expect(src).toContain("neverRead = new Set(found.items.filter((i) => !stored.has(i.messageId)).map((i) => i.messageId))");
    expect(src).toContain("trackApplications(ctx, items, persist, neverRead)");
  });
});
