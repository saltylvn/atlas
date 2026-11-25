import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWithModel, type ReaderDeps } from "@/lib/agents/mailReader";
import type { AiResult } from "@/lib/ai/model";
import { mailReaderTask, MailReadingOut } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { DEFAULT_SETTINGS, type Store } from "@/lib/data/store";
import { prefsFrom, tagInbox } from "@/lib/domain/emailAgent";
import { MAX_MODEL_CHARS } from "@/lib/domain/jobMailText";
import { checkReading, dateWritten, MODEL_READER_LABEL, modelReaderHint, READER_DAILY_CAP, READER_PER_RUN, READER_PURPOSE, readerCandidates, readerNote, readerPayload, readingEvent, READING_REF, type RawReading } from "@/lib/domain/mailReader";
import { project, type Standing } from "@/lib/domain/pipeline";
import type { Application, InboxItem } from "@/lib/domain/types";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

// Wednesday 18 Nov 2026, 9:00 AM in Denver.
const NOW = new Date("2026-11-18T16:00:00Z");
const SINCE = "2026-11-17T00:00:00Z";
const ARRIVED = "2026-11-18T15:00:00Z";

const mail = (messageId: string, subject: string, over: Partial<InboxItem> = {}): InboxItem => ({
  id: messageId,
  messageId,
  threadId: `t-${messageId}`,
  fromName: "Acme Careers",
  fromEmail: "careers@acme.com",
  subject,
  snippet: "",
  receivedAt: ARRIVED,
  category: "fyi",
  reason: "Update or receipt",
  done: false,
  createdAt: ARRIVED,
  textVerdict: "none",
  textQuote: "",
  textRole: "",
  ...over,
});

const application = (id: string, company: string, over: Partial<Application> = {}): Application => ({
  id,
  company,
  role: "Solutions Engineer",
  targetRole: "",
  source: "Email",
  url: "",
  payText: "",
  tier: "semi",
  status: "applied",
  appliedOn: "2026-11-10",
  statusAt: "2026-11-10T15:00:00Z",
  notes: "",
  origin: "atlas",
  externalId: `x-${id}`,
  createdAt: "2026-11-10T15:00:00Z",
  ...over,
});

const APPLIED: Standing = { stage: "applied", stageAt: "2026-11-10T15:00:00Z", lastHeardAt: null };
const TEXT = "Hi Tyler,\nThanks for your patience. The team has chosen to go in a different direction for the Solutions Engineer opening.\nPlease return the equipment form by December 4, 2026.\nBest,\nMara Whitlock";
const reading = (over: Partial<RawReading> = {}): RawReading => ({
  kind: "rejection",
  stage: "rejected",
  role: "Solutions Engineer",
  ask: "",
  deadline: "",
  people: ["Mara Whitlock"],
  sentence: "The team has chosen to go in a different direction for the Solutions Engineer opening.",
  ...over,
});
const tagged = (items: InboxItem[]) => tagInbox(items, prefsFrom(DEFAULT_SETTINGS));

describe("Which emails the model may read", () => {
  const apps = [application("a1", "Acme")];

  it("none while the switch has never been on", () => {
    expect(readerCandidates(tagged([mail("m1", "Regarding your application")]), apps, [], undefined)).toEqual([]);
  });

  it("only what rules read as none, from a company with one open application the ladder can name", () => {
    const got = readerCandidates(tagged([mail("m1", "Regarding your application")]), apps, [], SINCE);
    expect(got).toEqual([{ messageId: "m1", threadId: "t-m1", subject: "Regarding your application", receivedAt: ARRIVED, applicationId: "a1", company: "Acme", role: "Solutions Engineer", standing: APPLIED }]);
  });

  it.each([
    ["rules decided it", { textVerdict: "rejection" as const }],
    ["its text was never read", { textVerdict: undefined }],
    ["it arrived before the switch was turned on", { receivedAt: "2026-11-16T15:00:00Z" }],
    ["it was handed to the model once already", { modelReadAt: "2026-11-18T15:30:00Z" }],
    ["it is a mailing list", { category: "noise" as const, reason: "Mailing list or automated" }],
    ["it is from a company with no application", { fromName: "Globex Careers", fromEmail: "careers@globex.com" }],
  ])("not when %s", (_why, over) => {
    expect(readerCandidates(tagged([mail("m1", "Regarding your application", over)]), apps, [], SINCE)).toEqual([]);
  });

  it("not when the application is closed, not sent yet, or already has an offer", () => {
    for (const status of ["rejected", "saved", "offer"] as const) expect(readerCandidates(tagged([mail("m1", "Regarding your application")]), [application("a1", "Acme", { status })], [], SINCE), status).toEqual([]);
  });

  it("not when two applications could be meant: a tie is yours to settle, never the model's", () => {
    const two = [application("a1", "Acme"), application("a2", "Acme", { role: "AI Engineer" })];
    expect(readerCandidates(tagged([mail("m1", "Regarding your application")]), two, [], SINCE)).toEqual([]);
    // Once the email is on one timeline (you placed it), it may be read.
    expect(readerCandidates(tagged([mail("m1", "Regarding your application")]), two, [{ applicationId: "a2", sourceRef: "email:m1", threadId: "t-m1" }], SINCE).map((c) => c.applicationId)).toEqual(["a2"]);
  });

  it("not when the application has moved since the email arrived", () => {
    expect(readerCandidates(tagged([mail("m1", "Regarding your application")]), [application("a1", "Acme", { status: "interview", statusAt: "2026-11-18T15:30:00Z" })], [], SINCE)).toEqual([]);
  });

  it("puts automatic confirmations last, newest first within each group", () => {
    const items = [
      mail("c1", "Thank you for applying to Acme", { receivedAt: "2026-11-18T15:50:00Z" }),
      mail("p1", "Regarding your application", { receivedAt: "2026-11-18T15:10:00Z" }),
      mail("p2", "Following up", { receivedAt: "2026-11-18T15:40:00Z" }),
    ];
    expect(readerCandidates(tagged(items), apps, [], SINCE).map((c) => c.messageId)).toEqual(["p2", "p1", "c1"]);
  });
});

describe("What is sent for one email", () => {
  const candidate = { company: "Acme", role: "Solutions Engineer", subject: "Regarding your application (reply to mara@acme.com)", receivedAt: ARRIVED, standing: APPLIED };

  it("its own words only, with no address, phone number or link", () => {
    const text = `${TEXT}\nCall me on (801) 555-0142 or write to mara@acme.com. Details: https://acme.com/careers/123 and acme.io/apply/9\n\nOn Mon, Nov 16, 2026 at 9:00 AM Tyler wrote:\n> My number is 801-555-0199 and I live at home.`;
    const { data, sent } = readerPayload(candidate, text);
    expect(sent).toContain("chosen to go in a different direction");
    expect(sent).toContain("Mara Whitlock");
    for (const gone of ["mara@acme.com", "555-0142", "https://", "acme.io/apply", "Tyler wrote", "555-0199"]) expect(data, gone).not.toContain(gone);
    const parsed = JSON.parse(data);
    expect(Object.keys(parsed).sort()).toEqual(["application", "arrived", "email"]);
    expect(parsed.application).toEqual({ company: "Acme", role: "Solutions Engineer", stageNow: "applied" });
    expect(parsed.arrived).toBe("2026-11-18");
    expect(parsed.email.text).toBe(sent);
  });

  it("at most 4,000 characters of the email, subject and text together", () => {
    const { data, sent } = readerPayload(candidate, "We are reviewing your application carefully. ".repeat(400));
    const subject = JSON.parse(data).email.subject as string;
    expect(MAX_MODEL_CHARS).toBe(4000);
    expect(subject.length + sent.length).toBeLessThanOrEqual(MAX_MODEL_CHARS);
    expect(sent.length).toBeGreaterThan(3800);
  });

  it("carries no sender address, message id or thread id", () => {
    const { data } = readerPayload(candidate, TEXT);
    expect(data).not.toMatch(/messageId|threadId|fromEmail|@/);
  });
});

describe("Checking the model's answer against the email", () => {
  const ctx = { sent: readerPayload({ company: "Acme", role: "Solutions Engineer", subject: "Regarding your application", receivedAt: ARRIVED, standing: APPLIED }, TEXT).sent, receivedAt: ARRIVED, standing: APPLIED };

  it("keeps a reading whose sentence is in the email, with what it names", () => {
    expect(checkReading(reading(), ctx)).toEqual({
      outcome: "kept",
      reading: { kind: "rejection", stage: "rejected", quote: "The team has chosen to go in a different direction for the Solutions Engineer opening.", role: "Solutions Engineer", ask: "", deadline: null, people: ["Mara Whitlock"] },
    });
  });

  it("keeps nothing for kind none", () => {
    expect(checkReading(reading({ kind: "none", stage: "applied", sentence: "" }), ctx)).toEqual({ outcome: "none" });
  });

  it.each([
    ["a sentence the email does not contain", "We are pleased to offer you the position of Solutions Engineer."],
    ["a sentence changed by one word", "The team has decided to go in a different direction for the Solutions Engineer opening."],
    ["two words", "different direction"],
    ["nothing", ""],
  ])("drops a reading that rests on %s", (_what, sentence) => {
    expect(checkReading(reading({ sentence }), ctx)).toEqual({ outcome: "dropped", why: "quote" });
  });

  it("matches the sentence word for word, spacing and typographic quotes aside", () => {
    const curly = { ...ctx, sent: "We’re sorry:  we won’t be taking\nyour candidacy further this time." };
    expect(checkReading(reading({ sentence: "We're sorry: we won't be taking your candidacy further this time.", role: "", people: [] }), curly).outcome).toBe("kept");
  });

  it("keeps a deadline the email writes, and drops a reading whose date it does not", () => {
    const ask = reading({ kind: "info_request", stage: "in_review", sentence: "Please return the equipment form by December 4, 2026.", ask: "Return the equipment form" });
    expect(checkReading({ ...ask, deadline: "2026-12-04" }, ctx)).toMatchObject({ outcome: "kept", reading: { kind: "info_request", stage: "in_review", deadline: "2026-12-04", ask: "Return the equipment form" } });
    for (const deadline of ["2026-12-05", "2026-11-20", "2027-12-04", "December 4", "2026-13-40"]) expect(checkReading({ ...ask, deadline }, ctx), deadline).toEqual({ outcome: "dropped", why: "date" });
  });

  it("drops a date more than 90 days out, or before the email arrived", () => {
    const far = { ...ctx, sent: "Please send your references by March 1, 2027. Or by November 2, 2026 if you can." };
    const ask = reading({ kind: "info_request", stage: "in_review", sentence: "Please send your references by March 1, 2027.", role: "", people: [] });
    expect(checkReading({ ...ask, deadline: "2027-03-01" }, far)).toEqual({ outcome: "dropped", why: "date" });
    expect(checkReading({ ...ask, deadline: "2026-11-02" }, far)).toEqual({ outcome: "dropped", why: "date" });
    expect(checkReading({ ...ask, deadline: "" }, far).outcome).toBe("kept");
  });

  it("reads a date in the forms an email writes it", () => {
    for (const written of ["by December 4", "by Dec 4th", "by Dec. 4, 2026", "on 4 December", "the 4th of December 2026", "due 12/4", "due 12/04/2026", "due 12-04-26", "by 2026-12-04"]) expect(dateWritten(written, "2026-12-04"), written).toBe(true);
    for (const other of ["by December 14", "by December 4, 2027", "due 12/14", "due 1/12/04", "by Friday", "in 4 days", "December 40"]) expect(dateWritten(other, "2026-12-04"), other).toBe(false);
  });

  it("drops a stage the reducer would not move to", () => {
    // A rejection moves an application to Rejected, nowhere else.
    expect(checkReading(reading({ stage: "offer" }), ctx)).toEqual({ outcome: "dropped", why: "stage" });
    // An interviewing application does not go back to In review for a reply: the stage stays.
    const interviewing = { ...ctx, standing: { ...APPLIED, stage: "interview" as const } };
    const reply = reading({ kind: "reply", sentence: "Thanks for your patience.", role: "", people: [] });
    expect(checkReading({ ...reply, stage: "in_review" }, interviewing)).toEqual({ outcome: "dropped", why: "stage" });
    expect(checkReading({ ...reply, stage: "interview" }, interviewing).outcome).toBe("kept");
    // An offer is not undone by a rejection.
    const offered = { ...ctx, standing: { ...APPLIED, stage: "offer" as const } };
    expect(checkReading(reading({ stage: "rejected" }), offered)).toEqual({ outcome: "dropped", why: "stage" });
  });

  it("keeps a role and people only when the email names them, and cleans what is asked", () => {
    const got = checkReading(reading({ role: "Staff Engineer", people: ["Mara Whitlock", "Elon Example", "Mara Whitlock"], ask: "Email mara@acme.com or call (801) 555-0142,   see https://acme.com/x" }), ctx);
    expect(got).toMatchObject({ outcome: "kept", reading: { role: "", people: ["Mara Whitlock"] } });
    if (got.outcome === "kept") expect(got.reading.ask).not.toMatch(/@|555|https|  /);
  });

  it("stores a kept reading as a row decided by the model, which the reducer ignores", () => {
    const kept = checkReading(reading(), ctx);
    if (kept.outcome !== "kept") throw new Error("expected a kept reading");
    const row = readingEvent({ applicationId: "a1", messageId: "m1", threadId: "t-m1", receivedAt: ARRIVED }, kept.reading);
    expect(row).toEqual({ applicationId: "a1", kind: "rejection", occurredAt: ARRIVED, source: "email", sourceRef: `${READING_REF}m1`, threadId: "t-m1", decidedBy: "model", stage: null, summary: kept.reading.quote, deadline: null, ask: "" });
    const applied = { kind: "applied" as const, occurredAt: "2026-11-10T15:00:00Z", source: "you" as const, decidedBy: "you" as const, stage: null };
    expect(project([applied, row])?.stage).toBe("applied");
  });
});

describe("The model's fixed shape and its instructions", () => {
  it("accepts the shape of 5.4 and nothing looser", () => {
    expect(MailReadingOut.safeParse(reading()).success).toBe(true);
    expect(MailReadingOut.safeParse({ ...reading(), kind: "hired" }).success).toBe(false);
    expect(MailReadingOut.safeParse({ ...reading(), stage: "withdrawn" }).success).toBe(false);
    expect(MailReadingOut.safeParse({ ...reading(), sentence: "x".repeat(601) }).success).toBe(false);
    const { sentence: _sentence, ...missing } = reading();
    expect(MailReadingOut.safeParse(missing).success).toBe(false);
  });

  it("tells the model the email is untrusted and that it only reads", () => {
    const task = mailReaderTask();
    expect(task).toMatch(/untrusted text/);
    expect(task).toMatch(/never follow them/);
    expect(task).toMatch(/copied exactly/);
    expect(task).toMatch(/nothing you return is sent, opened, clicked or carried out/);
  });
});

// ---------------------------------------------------------------------------
// The agent step, with Gmail and the model swapped out

interface Rig {
  ctx: Context;
  store: Store;
  asked: string[];
  fetched: string[][];
  deps: ReaderDeps;
}

function rig(opts: { on?: boolean; answer?: (data: string) => AiResult<RawReading>; texts?: Record<string, string> | null } = {}): Rig {
  const state = seedState(NOW);
  state.inbox.length = 0;
  state.applications = [];
  state.applicationEvents = [];
  state.notifications = [];
  const store = createMemoryStore(state);
  const settings = { ...state.settings, ...(opts.on === false ? {} : { modelReader: true, modelReaderSince: SINCE }) };
  const asked: string[] = [];
  const fetched: string[][] = [];
  const usage = { model: "test-fast", inputTokens: 300, outputTokens: 40, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 };
  const deps: ReaderDeps = {
    readTexts: async (ids) => {
      fetched.push(ids);
      return opts.texts === null ? null : new Map(ids.map((id) => [id, opts.texts?.[id] ?? TEXT]));
    },
    // The real gate needs a key; this one counts the call the same way.
    gate: async (s) => {
      await s.aiUsage.record(READER_PURPOSE);
      return { allowed: true };
    },
    ask: async (data) => {
      asked.push(data);
      return opts.answer ? opts.answer(data) : { ok: true, value: reading(), usage };
    },
  };
  return { ctx: { mode: "live", userId: "owner", store, settings, now: NOW, today: "2026-11-18", time: "09:00" }, store, asked, fetched, deps };
}

const acmeApp = { company: "Acme", role: "Solutions Engineer", targetRole: "", source: "Email", url: "", payText: "", tier: "semi" as const, status: "applied" as const, appliedOn: "2026-11-10", statusAt: "2026-11-10T15:00:00Z", notes: "", origin: "atlas" as const, externalId: "x-acme" };
const waitingMail = (id: string, over: Partial<InboxItem> = {}) => {
  const { id: _id, done: _done, createdAt: _createdAt, ...rest } = mail(id, "Regarding your application", over);
  return rest;
};

describe("The model reader in a sync", () => {
  it("is off unless you turn it on: nothing is fetched, asked or stored", async () => {
    expect(DEFAULT_SETTINGS.modelReader).toBeUndefined();
    const r = rig({ on: false });
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1")]);
    const out = await readWithModel(r.ctx, r.store, r.deps);
    expect(out.status).toBe("off");
    expect(r.fetched).toEqual([]);
    expect(r.asked).toEqual([]);
    expect(await r.store.aiUsage.countToday()).toBe(0);
    expect(readerNote(out)).toMatch(/no text leaves Atlas/);
  });

  it("keeps a passing reading in shadow: stored, shown nowhere, no stage moved, no ping", async () => {
    const r = rig();
    const app = await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1")]);
    const out = await readWithModel(r.ctx, r.store, r.deps);
    expect(out).toMatchObject({ status: "ran", waiting: 1, sent: 1, kept: 1, dropped: 0, nothing: 0, failed: 0, model: "test-fast", inputTokens: 300, outputTokens: 40 });

    // Stored as a row decided by the model...
    const readings = await r.store.applicationEvents.readings();
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ applicationId: app.id, kind: "rejection", decidedBy: "model", source: "email", sourceRef: `${READING_REF}m1`, summary: "The team has chosen to go in a different direction for the Solutions Engineer opening." });
    // ...which no timeline, list or tracker index sees,
    expect(await r.store.applicationEvents.forApplication(app.id)).toEqual([]);
    expect(await r.store.applicationEvents.listed()).toEqual([]);
    expect(await r.store.applicationEvents.index()).toEqual([]);
    // which moves nothing,
    expect(await r.store.applications.get(app.id)).toMatchObject({ status: "applied", statusAt: "2026-11-10T15:00:00Z" });
    // and which pings nothing.
    expect(await r.store.notifications.recent(50)).toEqual([]);
    expect(readerNote(out)).toBe("1 email sent to the model, 1 reading kept in shadow (stored, not shown, no stage moved), 0 dropped by a check, 0 with nothing to report");
  });

  it("sends each email once, even when asked again", async () => {
    const r = rig();
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1")]);
    await readWithModel(r.ctx, r.store, r.deps);
    expect((await r.store.inbox.list())[0]!.modelReadAt).toBe(NOW.toISOString());
    const again = await readWithModel(r.ctx, r.store, r.deps);
    expect(again).toMatchObject({ status: "ran", waiting: 0, sent: 0 });
    expect(r.asked).toHaveLength(1);
    expect(r.fetched).toHaveLength(1);
    expect(await r.store.aiUsage.countToday(READER_PURPOSE)).toBe(1);
  });

  it("sends only the scrubbed payload, and nothing that names the message", async () => {
    const r = rig({ texts: { m1: `${TEXT}\nReach me at mara@acme.com or (801) 555-0142.` } });
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1")]);
    await readWithModel(r.ctx, r.store, r.deps);
    expect(r.asked).toHaveLength(1);
    expect(r.asked[0]).not.toMatch(/mara@acme\.com|555-0142|careers@acme\.com|"m1"|t-m1/);
    expect(JSON.parse(r.asked[0]!).email.subject).toBe("Regarding your application");
  });

  it("drops a reading that fails a check: nothing is stored, and the email is not sent again", async () => {
    const usage = { model: "test-fast", inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 };
    const r = rig({ answer: () => ({ ok: true, value: reading({ kind: "offer", stage: "offer", sentence: "We are pleased to offer you the position." }), usage }) });
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1")]);
    const out = await readWithModel(r.ctx, r.store, r.deps);
    expect(out).toMatchObject({ sent: 1, kept: 0, dropped: 1 });
    expect(await r.store.applicationEvents.readings()).toEqual([]);
    expect((await readWithModel(r.ctx, r.store, r.deps)).sent).toBe(0);
  });

  it("falls back to rules when a call fails: no retry that run, and the rest wait for the next sync", async () => {
    let calls = 0;
    const r = rig({ answer: () => (++calls === 1 ? { ok: false, reason: "error", status: 503 } : { ok: true, value: reading(), usage: { model: "test-fast", inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 } }) });
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1", { receivedAt: "2026-11-18T15:30:00Z" }), waitingMail("m2", { receivedAt: "2026-11-18T15:10:00Z" })]);
    const first = await readWithModel(r.ctx, r.store, r.deps);
    expect(first).toMatchObject({ waiting: 2, sent: 1, failed: 1, kept: 0, why: "the model gave no answer" });
    expect(r.asked).toHaveLength(1);
    expect(readerNote(first)).toMatch(/1 with no usable answer \(rules stand, not sent again\), 1 waiting for a later sync, stopped early: the model gave no answer/);
    // The next sync asks about the one that waited, and never again about the one that failed.
    const second = await readWithModel(r.ctx, r.store, r.deps);
    expect(second).toMatchObject({ waiting: 1, sent: 1, kept: 1 });
    expect(r.fetched[1]).toEqual(["m2"]);
  });

  it("carries on past an answer the model refused or got wrong in shape", async () => {
    let calls = 0;
    const r = rig({ answer: () => (++calls === 1 ? { ok: false, reason: "invalid" } : { ok: true, value: reading({ kind: "none", stage: "applied", sentence: "" }), usage: { model: "test-fast", inputTokens: 1, outputTokens: 1, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 } }) });
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1", { receivedAt: "2026-11-18T15:30:00Z" }), waitingMail("m2", { receivedAt: "2026-11-18T15:10:00Z" })]);
    expect(await readWithModel(r.ctx, r.store, r.deps)).toMatchObject({ sent: 2, failed: 1, nothing: 1, kept: 0 });
  });

  it("makes at most 6 calls a run and 12 a day", async () => {
    const r = rig();
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert(Array.from({ length: 15 }, (_, i) => waitingMail(`m${i}`, { receivedAt: `2026-11-18T15:${String(10 + i).padStart(2, "0")}:00Z` })));
    expect([READER_PER_RUN, READER_DAILY_CAP]).toEqual([6, 12]);
    expect(await readWithModel(r.ctx, r.store, r.deps)).toMatchObject({ waiting: 15, sent: 6 });
    expect(await readWithModel(r.ctx, r.store, r.deps)).toMatchObject({ waiting: 9, sent: 6 });
    const third = await readWithModel(r.ctx, r.store, r.deps);
    expect(third).toMatchObject({ status: "skipped", sent: 0, why: "today's 12 reader calls are used" });
    expect(r.asked).toHaveLength(12);
    expect(await r.store.aiUsage.countToday(READER_PURPOSE)).toBe(12);
    // Other AI calls that day do not count against the reader's own cap, only against the shared limit.
    expect(await r.store.aiUsage.countToday()).toBe(12);
  });

  it("stops when the shared gate says no, without marking the email", async () => {
    const r = rig();
    r.deps.gate = async () => ({ allowed: false, why: "Daily AI limit reached." });
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1")]);
    const out = await readWithModel(r.ctx, r.store, r.deps);
    expect(out).toMatchObject({ status: "ran", sent: 0, why: "Daily AI limit reached." });
    expect(r.asked).toEqual([]);
    expect((await r.store.inbox.list())[0]!.modelReadAt ?? null).toBeNull();
  });

  it.each([
    ["AI is off", { aiEnabled: false }, {}, /AI is switched off/],
    ["the kill switch is on", { outboundEnabled: false }, {}, /AI is switched off/],
    ["the run is short on time", {}, { deadline: Date.now() + 30_000 }, /not enough time left/],
  ])("does not run when %s", async (_why, settings, extra, why) => {
    const r = rig();
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1")]);
    const out = await readWithModel({ ...r.ctx, ...extra, settings: { ...r.ctx.settings, ...settings } }, r.store, r.deps);
    expect(out.status).toBe("skipped");
    expect(out.why).toMatch(why);
    expect(r.asked).toEqual([]);
    expect((await r.store.inbox.list())[0]!.modelReadAt ?? null).toBeNull();
  });

  it("marks nothing when Gmail cannot be reached", async () => {
    const r = rig({ texts: null });
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1")]);
    expect(await readWithModel(r.ctx, r.store, r.deps)).toMatchObject({ status: "skipped", sent: 0 });
    expect((await r.store.inbox.list())[0]!.modelReadAt ?? null).toBeNull();
  });

  it("settles an email with nothing of its own to read, without a call", async () => {
    const r = rig({ texts: { m1: "On Mon, Nov 16, 2026 at 9:00 AM Tyler wrote:\n> Hello" } });
    await r.store.applications.create(acmeApp);
    await r.store.inbox.upsert([waitingMail("m1")]);
    expect(await readWithModel(r.ctx, r.store, r.deps)).toMatchObject({ sent: 0, nothing: 1 });
    expect(r.asked).toEqual([]);
    expect(await r.store.aiUsage.countToday()).toBe(0);
  });

  it("does not run in the demo against the real Gmail reader", async () => {
    const r = rig();
    const { readJobMailTexts } = await import("@/lib/connections/google");
    expect(await readWithModel({ ...r.ctx, mode: "demo" }, r.store, { ...r.deps, readTexts: readJobMailTexts })).toMatchObject({ status: "skipped", why: "demo mode" });
  });
});

describe("Where the reader runs, and what it may touch", () => {
  it("never runs in the 15-minute watch or the rules reader", () => {
    expect(read("lib/agents/watch.ts")).not.toMatch(/mailReader|readWithModel|lib\/ai\/|takeAiCall|structured/);
    const rules = read("lib/domain/jobMailText.ts") + read("lib/agents/career.ts").split("export async function readJobMail")[1]!.split("export async function trackApplications")[0];
    expect(rules).not.toMatch(/structured|takeAiCall|@\/lib\/ai\/|readWithModel/);
  });

  it("runs in the full sync only while the switch is on", () => {
    expect(read("lib/agents/sync.ts")).toContain("ctx.settings.modelReader === true ? await t.step(");
    expect(read("lib/agents/career.ts")).not.toMatch(/readWithModel/);
  });

  it("calls the model only through the front door, on the fast tier, behind the gate", () => {
    const src = read("lib/agents/mailReader.ts");
    expect(src).toContain('structuredWithin(waitMs, MailReadingOut, mailReaderTask(), data, { tier: "fast", effort: "low" })');
    expect(src).toContain("takeAiCallWithin(store, settings, READER_PURPOSE, waitMs)");
    expect(src).not.toMatch(/lib\/ai\/(gemini|claude)|safeFetch|fetch\(/);
    // Claim, then act: the email is marked before the model is asked.
    expect(src.indexOf("claimForModel(c.messageId")).toBeLessThan(src.indexOf("deps.ask(data"));
    // Nothing of an email is logged or audited, and it writes no notice, no push and no application.
    expect(src).not.toMatch(/console\.|audit\(|notifications\.|sendToAll|applications\.(update|create)|recordHeardBack/);
  });

  it("is switched by an audited action that starts the clock, and worded exactly in Settings", () => {
    const action = read("app/actions/settings.ts");
    expect(action).toContain('z.enum(["outboundEnabled", "aiEnabled", "holdRejections", "modelReader"])');
    expect(action).toContain('p.data.name === "modelReader" && p.data.value ? { modelReaderSince: now.toISOString() } : {}');
    expect(action).toContain("action: `switch.${p.data.name}`");
    expect(read("app/(app)/settings/page.tsx")).toContain('<Switch name="modelReader" on={settings.modelReader === true} label={MODEL_READER_LABEL}');
    expect(MODEL_READER_LABEL).toBe("Let the AI model read job emails rules cannot decide");
    const hint = modelReaderHint("Gemini");
    for (const said of ["Off (the default)", "sent once to Gemini", "no quoted thread", "without email addresses, phone numbers or links", "at most 4,000 characters", "at most 12 emails a day", "Google may use what is sent to improve its products", "its reviewers may read it", "shown nowhere", "never moves a stage"]) expect(hint, said).toContain(said);
  });

  it("has a migration that only adds, and can be run again", () => {
    const sql = read("supabase/migrations/20261121120000_mail_reader.sql");
    expect(sql).toContain("check (text_verdict in ('interview', 'rejection', 'assessment', 'scheduling', 'offer', 'info_request', 'none'))");
    expect(sql).toContain("add column if not exists model_read_at timestamptz");
    expect(sql).toContain("add column if not exists deadline date");
    expect(sql).toContain("add column if not exists ask text not null default '' check (char_length(ask) <= 200)");
    expect(sql.replace(/--.*$/gm, "")).not.toMatch(/drop (table|column)|delete from|truncate|update public|create table|grant |text_body|\bbody\b/i);
  });
});
