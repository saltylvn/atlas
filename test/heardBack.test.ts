import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { trackApplications } from "@/lib/agents/career";
import { briefHeld, recordHeardBack, sendHeardBack, sendNote, type PushDeps } from "@/lib/agents/heardBack";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { DEFAULT_SETTINGS } from "@/lib/data/store";
import { ROLE_NOT_LISTED } from "@/lib/domain/applications";
import { careerAgentReport } from "@/lib/domain/careerAgent";
import { bundle, dueNow, FEED_URL, FRESH_MS, heldForBrief, heldLine, inQuietHours, noticesFor, noticeText, tierFor, unreadCount } from "@/lib/domain/heardBack";
import { EVENT_LABEL, HEARD } from "@/lib/domain/pipeline";
import { urgentSince } from "@/lib/domain/urgent";
import { EVENT_KINDS, NOTICE_TIERS, type Application, type ApplicationEvent, type EventKind, type InboxItem, type Notice } from "@/lib/domain/types";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const TZ = "America/Denver";
// Tuesday 17 Nov 2026, 9:00 AM in Denver (UTC-7).
const NOW = new Date("2026-11-17T16:00:00Z");
const HOUR = 3_600_000;
const ago = (hours: number, from: Date = NOW) => new Date(from.getTime() - hours * HOUR).toISOString();
const denver = (hhmm: string, day = "2026-11-17") => new Date(`${day}T${hhmm}:00-07:00`);

const acme = { id: "a1", company: "Acme", role: "Solutions Engineer" };
const event = (kind: EventKind, over: Partial<ApplicationEvent> = {}): ApplicationEvent => ({
  id: `e-${kind}`,
  applicationId: "a1",
  kind,
  occurredAt: ago(1),
  source: "email",
  sourceRef: `email:${kind}`,
  threadId: "",
  decidedBy: "rules",
  stage: null,
  summary: "We would like to schedule a call with you.",
  createdAt: ago(0),
  ...over,
});
const notice = (kind: EventKind, over: Partial<Notice> = {}): Notice => ({
  id: `n-${kind}`,
  eventId: `e-${kind}`,
  applicationId: "a1",
  kind,
  occurredAt: ago(1),
  ...noticeText(kind, acme),
  url: "/applications/a1",
  tier: "push",
  sentAt: null,
  seenAt: null,
  createdAt: ago(0),
  ...over,
});
const ON = { holdRejections: false, now: NOW };

describe("Which answers ping your phone (docs/design-pipeline.md, 5.7)", () => {
  it("pushes for every real answer, and stays quiet for everything else", () => {
    const pushes = EVENT_KINDS.filter((k) => tierFor(event(k), ON) === "push");
    expect(new Set(pushes)).toEqual(new Set(["interview", "screen", "assessment", "offer", "scheduling", "reply", "info_request", "rejection"]));
    // Exactly the emails the reducer counts as hearing back.
    expect(new Set(pushes)).toEqual(new Set(HEARD));
    // "We received your application" is not an answer: no notice at all.
    expect(tierFor(event("confirmation"), ON)).toBeNull();
    // Your own moves and the Apply Agent's are not answers either.
    for (const source of ["you", "apply-agent", "atlas", "calendar"] as const) expect(tierFor(event("interview", { source }), ON), source).toBeNull();
    // A model's reading is a suggestion: it never pings (5.6).
    expect(tierFor(event("offer", { decidedBy: "model" }), ON)).toBeNull();
  });

  it("holds a rejection for the next brief only when you ask, and the setting starts off", () => {
    expect(DEFAULT_SETTINGS.holdRejections).toBeUndefined();
    expect(tierFor(event("rejection"), ON)).toBe("push");
    expect(tierFor(event("rejection"), { ...ON, holdRejections: true })).toBe("brief");
    // The setting holds rejections and nothing else.
    for (const k of HEARD.filter((x) => x !== "rejection")) expect(tierFor(event(k), { ...ON, holdRejections: true }), k).toBe("push");
  });

  it("never pings for an old email: it lands in the feed already read", () => {
    // The first sync after the timelines shipped put up to 30 days of job mail on them.
    const old = event("interview", { occurredAt: ago(30 * 24) });
    expect(tierFor(old, ON)).toBe("quiet");
    expect(tierFor(event("offer", { occurredAt: new Date(NOW.getTime() - FRESH_MS - 1).toISOString() }), ON)).toBe("quiet");
    expect(tierFor(event("offer", { occurredAt: new Date(NOW.getTime() - FRESH_MS).toISOString() }), ON)).toBe("push");
    // Saturday 4 PM's email, first seen at Monday 8 AM's sync, still pings.
    expect(FRESH_MS).toBeGreaterThanOrEqual(40 * HOUR);
    const [row] = noticesFor([old], [acme], ON);
    expect(row).toMatchObject({ tier: "quiet", sentAt: null, seenAt: NOW.toISOString() });
    expect(dueNow([{ ...row!, id: "n", createdAt: ago(0) }], NOW, TZ).send).toEqual([]);
  });

  it("lists an email you placed yourself without pinging you about it", () => {
    expect(tierFor(event("interview"), { ...ON, byYou: true })).toBe("quiet");
    expect(noticesFor([event("interview")], [acme], { ...ON, byYou: true })[0]).toMatchObject({ tier: "quiet", seenAt: NOW.toISOString() });
  });

  it("writes one notice per answer, for the application it is about", () => {
    const rows = noticesFor([event("confirmation"), event("interview"), event("rejection", { applicationId: "gone" })], [acme], ON);
    expect(rows).toEqual([{ eventId: "e-interview", applicationId: "a1", kind: "interview", occurredAt: ago(1), title: "Acme · Interview invite", body: "Solutions Engineer. Open to reply.", url: "/applications/a1", tier: "push", sentAt: null, seenAt: null }]);
  });
});

describe("What the lock screen says", () => {
  it("is the company, the kind and the role", () => {
    expect(noticeText("interview", acme)).toEqual({ title: "Acme · Interview invite", body: "Solutions Engineer. Open to reply." });
    expect(noticeText("rejection", acme)).toEqual({ title: "Acme · Rejection", body: "Solutions Engineer." });
    expect(noticeText("offer", acme)).toEqual({ title: "Acme · Offer", body: "Solutions Engineer. Open to see it." });
    for (const k of HEARD) expect(noticeText(k, acme).title).toBe(`Acme · ${EVENT_LABEL[k]}`);
    // An application logged before any email named its role says no role.
    expect(noticeText("reply", { company: "Acme", role: ROLE_NOT_LISTED })).toEqual({ title: "Acme · They replied", body: "Open to reply." });
    expect(noticeText("rejection", { company: "", role: ROLE_NOT_LISTED })).toEqual({ title: "A company · Rejection", body: "Open to see it." });
  });

  it("never carries an email's words: the subject and the reader's sentence stay on the timeline", () => {
    const secret = "We regret to inform you that the salary band is $90k and Dana will call 555-0100";
    const [row] = noticesFor([event("rejection", { summary: secret })], [acme], ON);
    const shown = `${row!.title} ${row!.body} ${row!.url}`;
    for (const word of ["regret", "salary", "Dana", "555"]) expect(shown).not.toContain(word);
    // The rules never see an event's summary, an inbox row or a sender.
    const src = read("lib/domain/heardBack.ts");
    expect(src).not.toMatch(/\.summary|subject\b(?!,)|fromName|fromEmail|snippet|textQuote/);
    expect(read("lib/agents/heardBack.ts")).not.toMatch(/\.summary|\.subject|fromName|textQuote|inbox/);
  });

  it("is one short line each: no line breaks or control characters, and clipped", () => {
    const t = noticeText("interview", { company: `Acme\n\u0007Corp\u2028${"x".repeat(200)}`, role: `Engineer\r\n${"y".repeat(300)}` });
    expect(`${t.title}${t.body}`).not.toMatch(/[\u0000-\u001f\u2028\u2029]/);
    expect(t.title.startsWith("Acme Corp ")).toBe(true);
    expect(t.title.length).toBeLessThanOrEqual(120);
    expect(t.body.length).toBeLessThanOrEqual(200);
  });
});

describe("Quiet hours and bundling", () => {
  it("is quiet from 9 PM until 7 AM", () => {
    expect(["21:00", "23:59", "00:00", "06:59"].map(inQuietHours)).toEqual([true, true, true, true]);
    expect(["07:00", "12:00", "20:59"].map(inQuietHours)).toEqual([false, false, false]);
  });

  it("holds what comes in at night and sends it at 7 AM, your time", () => {
    const night = denver("21:30");
    const rows = [notice("interview", { occurredAt: ago(0.25, night) })];
    expect(dueNow(rows, night, TZ)).toEqual({ send: [], held: 1 });
    expect(dueNow(rows, denver("06:59", "2026-11-18"), TZ)).toEqual({ send: [], held: 1 });
    expect(dueNow(rows, denver("07:00", "2026-11-18"), TZ)).toMatchObject({ held: 0, send: [{ id: "n-interview" }] });
  });

  it("sends only what is waiting: not a sent one, not one you already saw, not one that went stale", () => {
    const rows = [
      notice("offer", { id: "sent", sentAt: ago(0.5) }),
      notice("reply", { id: "seen", seenAt: ago(0.5) }),
      notice("screen", { id: "stale", occurredAt: ago(49) }),
      notice("rejection", { id: "held", tier: "brief" }),
      notice("assessment", { id: "quiet", tier: "quiet" }),
      notice("interview", { id: "due" }),
    ];
    expect(dueNow(rows, NOW, TZ).send.map((r) => r.id)).toEqual(["due"]);
  });

  it("puts several answers in one push, the most pressing first, and opens the feed", () => {
    const rows = [
      notice("rejection", { title: "Beta · Rejection", occurredAt: ago(1) }),
      notice("reply", { title: "Corvid · They replied", occurredAt: ago(2) }),
      notice("interview", { title: "Acme · Interview invite", occurredAt: ago(3) }),
      notice("offer", { title: "Delta · Offer", occurredAt: ago(4) }),
    ];
    const { send } = dueNow(rows, NOW, TZ);
    expect(send.map((r) => r.kind)).toEqual(["offer", "interview", "reply", "rejection"]);
    expect(bundle(send)).toEqual({ title: "4 updates on your applications", body: "Delta · Offer; Acme · Interview invite; Corvid · They replied; +1 more", url: FEED_URL });
    expect(bundle(send.slice(0, 2))).toEqual({ title: "2 updates on your applications", body: "Delta · Offer; Acme · Interview invite", url: FEED_URL });
  });

  it("sends one answer as itself, opening that application, and nothing when nothing is due", () => {
    expect(bundle([notice("interview")])).toEqual({ title: "Acme · Interview invite", body: "Solutions Engineer. Open to reply.", url: "/applications/a1" });
    expect(bundle([])).toBeNull();
  });

  it("always fits what the push sender allows", () => {
    const long = Array.from({ length: 12 }, (_, i) => notice("interview", { id: `n${i}`, ...noticeText("interview", { company: "C".repeat(200), role: "R".repeat(300) }) }));
    // The longest kind label still fits a title.
    expect(Math.max(...HEARD.map((k) => noticeText(k, { company: "C".repeat(200), role: "" }).title.length))).toBeLessThanOrEqual(80);
    for (const p of [bundle(long)!, bundle(long.slice(0, 1))!]) {
      expect(p.title.length).toBeLessThanOrEqual(80);
      expect(p.body.length).toBeLessThanOrEqual(240);
      expect(p.url.startsWith("/applications")).toBe(true);
    }
  });

  it("counts what you have not opened", () => {
    expect(unreadCount([notice("offer"), notice("reply", { seenAt: ago(1) }), notice("rejection", { tier: "brief" })])).toBe(2);
  });
});

// ---------------------------------------------------------------------------

const inboxMail = (messageId: string, subject: string, receivedAt: string, over: Partial<InboxItem> = {}): InboxItem => ({
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
  // Read, and the text decided nothing, unless a test says otherwise: only read mail is tracked.
  textVerdict: "none",
  textQuote: "",
  ...over,
});

function live(now: Date = NOW, settings: Partial<Context["settings"]> = {}): Context {
  const state = seedState(now);
  state.inbox.length = 0;
  state.applications = [];
  state.applicationEvents = [];
  state.notifications = [];
  state.push = [{ id: "p1", endpoint: "https://web.push.apple.com/x", p256dh: "k", auth: "a", device: "iPhone", createdAt: now.toISOString() }];
  state.settings = { ...state.settings, timezone: TZ, ...settings };
  return { mode: "live", userId: "owner", store: createMemoryStore(state), settings: state.settings, now, today: "2026-11-17", time: "09:00" };
}
function pusher(): PushDeps & { sent: { title: string; body: string; url: string }[] } {
  const sent: { title: string; body: string; url: string }[] = [];
  return { sent, ready: () => true, push: vi.fn(async (_store, payload) => (sent.push(payload), { sent: 1, removed: 0, failed: 0 })) };
}
const confirmation = inboxMail("c1", "Thank you for applying to the AI Engineer role at Acme", ago(72));
const invite = inboxMail("i1", "Interview availability for AI Engineer at Acme", ago(1), { textVerdict: "interview", textQuote: "We would like to schedule a call with you." });

describe("The outbox: one notice per answer, sent once", () => {
  it("the tracker writes a notice for an answer, none for a confirmation, and no second one on a rerun", async () => {
    const ctx = live();
    const first = await trackApplications(ctx, [confirmation, invite], ctx.store);
    expect(first).toMatchObject({ created: 1, heard: 1 });
    const [app] = await ctx.store.applications.list();
    const rows = await ctx.store.notifications.recent(10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ applicationId: app!.id, kind: "interview", title: "Acme · Interview invite", body: "AI Engineer. Open to reply.", url: `/applications/${app!.id}`, tier: "push", sentAt: null, seenAt: null });
    // It points at the invite's own event on the timeline.
    const timeline = await ctx.store.applicationEvents.forApplication(app!.id);
    expect(rows[0]!.eventId).toBe(timeline.find((e) => e.kind === "interview")!.id);
    // The reader's sentence is on the timeline and nowhere in the notice.
    expect(JSON.stringify(rows)).not.toContain("schedule a call");

    expect(await trackApplications(ctx, [confirmation, invite], ctx.store)).toMatchObject({ created: 0, heard: 0 });
    expect(await ctx.store.notifications.recent(10)).toHaveLength(1);
  });

  it("pushes it once: a second run, and a run at the same moment, send nothing more", async () => {
    const ctx = live();
    await trackApplications(ctx, [confirmation, invite], ctx.store);
    const [app] = await ctx.store.applications.list();
    const deps = pusher();

    const [a, b] = await Promise.all([sendHeardBack(ctx, ctx.store, deps), sendHeardBack(ctx, ctx.store, deps)]);
    expect(a.sent + b.sent).toBe(1);
    expect(deps.sent).toEqual([{ title: "Acme · Interview invite", body: "AI Engineer. Open to reply.", url: `/applications/${app!.id}` }]);
    expect((await ctx.store.notifications.recent(10))[0]!.sentAt).toBe(NOW.toISOString());

    expect(await sendHeardBack(ctx, ctx.store, deps)).toEqual({ sent: 0, held: 0, devices: 0 });
    expect(deps.sent).toHaveLength(1);
  });

  it("sends several answers found in one run as one push", async () => {
    const ctx = live();
    const beta = inboxMail("b0", "Thank you for applying to Beta", ago(100), { fromName: "Beta Recruiting", fromEmail: "jobs@beta.io" });
    const no = inboxMail("b1", "Update on your application at Beta", ago(2), { fromName: "Beta Recruiting", fromEmail: "jobs@beta.io", textVerdict: "rejection", textQuote: "We have decided to move forward with other candidates." });
    expect(await trackApplications(ctx, [confirmation, invite, beta, no], ctx.store)).toMatchObject({ heard: 2 });
    const deps = pusher();
    const r = await sendHeardBack(ctx, ctx.store, deps);
    expect(r).toEqual({ sent: 2, held: 0, devices: 1 });
    expect(sendNote(r)).toBe("2 answers in one push, to 1 device");
    expect(deps.sent).toEqual([{ title: "2 updates on your applications", body: "Acme · Interview invite; Beta · Rejection", url: FEED_URL }]);
    expect((await ctx.store.notifications.recent(10)).every((n) => n.sentAt)).toBe(true);
  });

  it("holds an answer that comes in at night, and sends it once at 7 AM", async () => {
    const night = denver("22:10");
    const ctx = live(night);
    await trackApplications(ctx, [inboxMail("c1", "Thank you for applying to Acme", ago(72, night)), inboxMail("i1", "Interview availability for AI Engineer at Acme", ago(1, night), { textVerdict: "interview" })], ctx.store);
    const deps = pusher();
    const held = await sendHeardBack(ctx, ctx.store, deps);
    expect(held).toEqual({ sent: 0, held: 1, devices: 0 });
    expect(sendNote(held)).toBe("1 answer held until 7 AM (quiet hours)");
    expect(deps.sent).toEqual([]);
    expect((await ctx.store.notifications.recent(10))[0]!.sentAt).toBeNull();

    const morning = { ...ctx, now: denver("07:00", "2026-11-18") };
    expect(await sendHeardBack(morning, ctx.store, deps)).toMatchObject({ sent: 1, held: 0 });
    expect(await sendHeardBack({ ...ctx, now: denver("07:15", "2026-11-18") }, ctx.store, deps)).toMatchObject({ sent: 0 });
    expect(deps.sent).toHaveLength(1);
  });

  it("does not ping for the 30 days of old job mail, or for answers that were on timelines before the outbox", async () => {
    const ctx = live();
    const old = [inboxMail("c1", "Thank you for applying to Acme", ago(29 * 24)), inboxMail("i1", "Interview availability for AI Engineer at Acme", ago(20 * 24), { textVerdict: "interview" }), inboxMail("r1", "Update on your application at Acme", ago(9 * 24), { textVerdict: "rejection", textQuote: "We went with someone else." })];
    expect(await trackApplications(ctx, old, ctx.store)).toMatchObject({ heard: 2 });
    const rows = await ctx.store.notifications.recent(10);
    expect(rows.map((r) => [r.kind, r.tier, r.seenAt])).toEqual([["rejection", "quiet", NOW.toISOString()], ["interview", "quiet", NOW.toISOString()]]);
    const deps = pusher();
    expect(await sendHeardBack(ctx, ctx.store, deps)).toEqual({ sent: 0, held: 0, devices: 0 });
    expect(deps.sent).toEqual([]);

    // An answer already on a timeline when the outbox arrived has no notice: only newly added events get one.
    const before = live();
    const [seeded] = await before.store.applicationEvents.append([{ ...event("interview"), applicationId: "a1" }]);
    expect(seeded).toBeDefined();
    expect(await recordHeardBack(before.store, [], [acme as Application], before.settings, NOW)).toEqual([]);
    expect(await sendHeardBack(before, before.store, deps)).toMatchObject({ sent: 0 });
    expect(deps.sent).toEqual([]);
  });

  it("sends nothing with the kill switch on, with push not set up, or with no device, and marks nothing sent", async () => {
    for (const [why, change] of [
      ["the kill switch is on", (c: Context, d: PushDeps) => [{ ...c, settings: { ...c.settings, outboundEnabled: false } }, d] as const],
      ["push is not set up", (c: Context, d: PushDeps) => [c, { ...d, ready: () => false }] as const],
      ["no device is subscribed", (c: Context, d: PushDeps) => [c, d] as const],
    ] as const) {
      const ctx = live();
      if (why === "no device is subscribed") for (const p of await ctx.store.push.list()) await ctx.store.push.remove(p.endpoint);
      await trackApplications(ctx, [confirmation, invite], ctx.store);
      const deps = pusher();
      const [c, d] = change(ctx, deps);
      const r = await sendHeardBack(c, ctx.store, d);
      expect(r, why).toEqual({ sent: 0, held: 0, devices: 0, skipped: why });
      expect(sendNote(r)).toBe(`No ping: ${why}.`);
      expect(deps.sent).toEqual([]);
      expect((await ctx.store.notifications.recent(10))[0]!.sentAt, why).toBeNull();
    }
  });

  it("is at most once: a push the service drops is not sent again, and stays unread in the feed", async () => {
    const ctx = live();
    await trackApplications(ctx, [confirmation, invite], ctx.store);
    const failing: PushDeps = { ready: () => true, push: vi.fn(async () => Promise.reject(new Error("push service down"))) };
    expect(await sendHeardBack(ctx, ctx.store, failing)).toEqual({ sent: 1, held: 0, devices: 0 });
    const deps = pusher();
    expect(await sendHeardBack(ctx, ctx.store, deps)).toMatchObject({ sent: 0 });
    expect(deps.sent).toEqual([]);
    expect(unreadCount(await ctx.store.notifications.recent(10))).toBe(1);
  });
});

describe("Hold rejections for the next brief", () => {
  const no = inboxMail("r1", "Update on your application at Acme", ago(2), { textVerdict: "rejection", textQuote: "We have decided to move forward with other candidates." });

  it("off: a rejection pings like any other answer", async () => {
    const ctx = live();
    await trackApplications(ctx, [confirmation, no], ctx.store);
    const deps = pusher();
    expect(await sendHeardBack(ctx, ctx.store, deps)).toMatchObject({ sent: 1 });
    expect(deps.sent[0]).toMatchObject({ title: "Acme · Rejection" });
    expect(await briefHeld(ctx.store, NOW)).toBeNull();
  });

  it("on: no ping; it is unread in the feed and the next brief lists it, once", async () => {
    const ctx = live(NOW, { holdRejections: true });
    await trackApplications(ctx, [confirmation, no, invite], ctx.store);
    const deps = pusher();
    // The invite still pings; the rejection does not.
    expect(await sendHeardBack(ctx, ctx.store, deps)).toMatchObject({ sent: 1 });
    expect(deps.sent).toEqual([expect.objectContaining({ title: "Acme · Interview invite" })]);
    const held = heldForBrief(await ctx.store.notifications.recent(10));
    expect(held.map((r) => [r.kind, r.tier, r.sentAt, r.seenAt])).toEqual([["rejection", "brief", null, null]]);

    const line = await briefHeld(ctx.store, NOW);
    expect(line).toBe("Held for this brief: Acme · Rejection. See Heard back on the Pipeline.");
    const report = careerAgentReport({ slot: "morning", fullTime: [], contacts: [], failedSources: [], sourceCount: 0, pendingApprovals: 0, held: line });
    expect(report.report.details).toContain(line);
    // The brief was its delivery: the next one does not repeat it.
    expect(await briefHeld(ctx.store, NOW)).toBeNull();
    expect(heldLine([])).toBeNull();
    expect(heldLine(Array.from({ length: 5 }, () => notice("rejection")))).toBe("Held for this brief: Acme · Rejection; Acme · Rejection; Acme · Rejection; and 2 more. See Heard back on the Pipeline.");
  });

  it("is a switch in the feed that goes through the same audited action as the other switches", () => {
    expect(read("app/actions/settings.ts")).toContain('z.enum(["outboundEnabled", "aiEnabled", "holdRejections", "modelReader"])');
    expect(read("components/client/HeardBack.tsx")).toContain('await setSwitch("holdRejections", !value)');
    expect(read("app/(app)/(career)/applications/page.tsx")).toContain("<HoldRejectionsSwitch on={settings.holdRejections === true} />");
  });
});

describe("An interview invite is never pushed twice", () => {
  const prefs = { emailStores: [], emailSubscriptions: [], emailUnsubscribed: [] };
  const since = ago(2);

  it("the old urgent ping leaves an invite that is on a timeline to the outbox", () => {
    expect(urgentSince([invite], prefs, since, [])).toHaveLength(1);
    expect(urgentSince([invite], prefs, since, [], new Set(["email:i1"]))).toEqual([]);
  });

  it("an invite the tracker could not place still pings, without the email's subject", () => {
    const [u] = urgentSince([invite], prefs, since, [], new Set(["email:other"]));
    expect(u).toMatchObject({ kind: "interview", title: "Interview invite: Acme Recruiting", url: "/inbox" });
    expect(u!.body).not.toContain("availability");
    expect(u!.body).toBe("Atlas could not tell which application it is about. Open your inbox to see it.");
  });

  it("the sync passes the timelines in, and pings nothing about job mail while the Applications bot is paused", () => {
    const src = read("lib/agents/sync.ts");
    expect(src).toContain("const onTimeline = new Set((await persist.applicationEvents.index().catch(() => [])).map((e) => e.sourceRef));");
    expect(src).toContain('.filter((u) => career !== null || u.kind !== "interview")');
    // Only a scheduled run sends; the sender is the Applications Agent's own traced step.
    expect(src).toContain('if (trigger === "schedule") await t.step("Tell your phone who wrote back"');
  });

  it("in a whole run: tracked, then one push from the outbox, and nothing from the urgent check", async () => {
    const ctx = live();
    await trackApplications(ctx, [confirmation, invite], ctx.store);
    const deps = pusher();
    await sendHeardBack(ctx, ctx.store, deps);
    const onTimeline = new Set((await ctx.store.applicationEvents.index()).map((e) => e.sourceRef));
    expect(urgentSince([confirmation, invite], prefs, since, [], onTimeline)).toEqual([]);
    expect(deps.sent).toHaveLength(1);
  });
});

describe("The feed and reading it", () => {
  it("the demo has answers to show, two of them unread", () => {
    const state = seedState(NOW);
    const rows = state.notifications!;
    expect(rows.map((r) => r.kind).sort()).toEqual(["interview", "rejection", "reply"]);
    expect(unreadCount(rows)).toBe(2);
    for (const r of rows) {
      const app = state.applications!.find((a) => a.id === r.applicationId)!;
      expect(r).toMatchObject({ ...noticeText(r.kind, app), url: `/applications/${app.id}` });
      expect(state.applicationEvents!.some((e) => e.id === r.eventId && e.source === "email")).toBe(true);
    }
  });

  it("is newest first, and opening an application marks only its answers read", async () => {
    const store = createMemoryStore(seedState(NOW));
    const rows = await store.notifications.recent(50);
    expect(rows.map((r) => r.occurredAt)).toEqual([...rows.map((r) => r.occurredAt)].sort().reverse());
    const first = rows.find((r) => !r.seenAt)!;
    expect(await store.notifications.markSeen(NOW.toISOString(), first.applicationId)).toBe(1);
    expect(unreadCount(await store.notifications.recent(50))).toBe(1);
    expect(await store.notifications.markSeen(NOW.toISOString())).toBe(1);
    expect(unreadCount(await store.notifications.recent(50))).toBe(0);
    expect(await store.notifications.markSeen(NOW.toISOString())).toBe(0);
  });

  it("the store keeps one notice per event and claims a row once", async () => {
    const store = createMemoryStore({ ...seedState(NOW), notifications: [] });
    const row = noticesFor([event("interview")], [acme], ON)[0]!;
    expect(await store.notifications.add([row, row])).toHaveLength(1);
    expect(await store.notifications.add([row])).toEqual([]);
    const [saved] = await store.notifications.unsent("push", ago(48));
    expect(await store.notifications.unsent("brief", ago(48))).toEqual([]);
    expect(await store.notifications.unsent("push", ago(0.5))).toEqual([]);
    expect(await store.notifications.claim([saved!.id], NOW.toISOString())).toHaveLength(1);
    expect(await store.notifications.claim([saved!.id], NOW.toISOString())).toEqual([]);
    expect(await store.notifications.unsent("push", ago(48))).toEqual([]);
  });

  it("the page shows the count and the feed, and the application page marks read from the browser", () => {
    const page = read("app/(app)/(career)/applications/page.tsx");
    expect(page).toContain("store.notifications.recent(FEED_LIMIT)");
    expect(page).toContain('<section id="heard-back"');
    expect(page).toContain("title={unread ? `Heard back (${unread} new)` : \"Heard back\"}");
    // A push about several answers opens the feed's anchor.
    expect(FEED_URL).toBe("/applications#heard-back");
    const one = read("app/(app)/(career)/applications/[id]/page.tsx");
    expect(one).toContain("{unread && <SeenBeacon applicationId={app.id} />}");
    // Not during render: a link that prefetches the page must not mark anything read.
    expect(one).not.toContain("markSeen(");
    expect(read("components/client/HeardBack.tsx")).toContain("void markHeardBackSeen(applicationId);");
  });

  it("the actions go through getContext and zod, and an email you place is recorded by the server as read", () => {
    const actions = read("app/actions/career.ts");
    const seen = actions.split("export async function markHeardBackSeen")[1]!.split("\nexport async function ")[0]!;
    expect(seen).toContain("z.object({ applicationId: id.optional() }).safeParse({ applicationId })");
    expect(seen).toContain("await getContext()");
    expect(seen).toContain("store.notifications.markSeen(now.toISOString(), p.data.applicationId)");
    const place = actions.split("export async function placeJobMail")[1]!.split("\nexport async function ")[0]!;
    expect(place).toContain("recordHeardBack(ownerWriteStore(ctx), added, board, settings, ctx.now, true)");
  });
});

describe("The notifications table", () => {
  const sql = read("supabase/migrations/20261121090000_notifications.sql");
  const list = (values: readonly string[]) => `(${values.map((v) => `'${v}'`).join(", ")})`;

  it("is the owner's alone: a session reads, and may only set seen_at; the server writes", () => {
    expect(sql).toContain("alter table public.notifications enable row level security");
    expect(sql.match(/create policy \w+ on public\.notifications for (\w+)/g)).toEqual(["create policy owner_read on public.notifications for select", "create policy owner_seen on public.notifications for update"]);
    expect(sql.match(/is_owner_aal2\(\)/g)).toHaveLength(3);
    expect(sql.match(/owner_id = \(select auth\.uid\(\)\)/g)).toHaveLength(3);
    expect(sql).toContain("revoke all on public.notifications from authenticated, anon;");
    expect(sql).toContain("grant select on public.notifications to authenticated;");
    expect(sql).toContain("grant update (seen_at) on public.notifications to authenticated;");
    expect(sql).not.toMatch(/grant[^;]*(insert|delete)[^;]*notifications/i);
    expect(sql.match(/grant update[^;]*;/g)).toEqual(["grant update (seen_at) on public.notifications to authenticated;"]);
  });

  it("has one row per event, and allows the tiers and kinds the code uses", () => {
    expect(sql).toContain("event_id uuid not null unique references public.application_events (id) on delete cascade");
    expect(sql).toContain("application_id uuid not null references public.applications (id) on delete cascade");
    expect(sql).toContain(`tier in ${list(NOTICE_TIERS)}`);
    expect(sql).toContain(`kind in ${list(EVENT_KINDS)}`);
    // The store's "skip a repeat" names that key, and a claim only takes rows still unsent.
    const store = read("lib/data/supabase.ts");
    expect(store).toContain('onConflict: "event_id", ignoreDuplicates: true');
    expect(store).toContain('.update({ sent_at: sentAt }).in("id", ids).is("sent_at", null)');
  });

  it("holds no email text, and only opens an application's page", () => {
    const columns = sql.slice(sql.indexOf("create table"), sql.indexOf(");"));
    expect(columns).not.toMatch(/subject|snippet|summary|quote|from_name|from_email|sender/);
    expect(columns).toContain("check (url ~ '^/applications/[A-Za-z0-9-]{1,64}$')");
    expect(columns).toContain("check (char_length(title) between 1 and 120)");
    expect(columns).toContain("check (char_length(body) <= 200)");
  });

  it("is additive and safe to run again", () => {
    expect(sql).toContain("create table if not exists public.notifications");
    expect(sql.match(/create index if not exists/g)).toHaveLength(2);
    expect(sql.match(/drop policy if exists \w+ on public\.notifications;/g)).toHaveLength(2);
    expect(sql).not.toMatch(/\b(drop table|alter table public\.(?!notifications)|delete from|update public|truncate|insert into)\b/i);
  });
});
