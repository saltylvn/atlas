import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sendHeardBack } from "@/lib/agents/heardBack";
import { runWatch, type WatchDeps } from "@/lib/agents/watch";
import type { SyncResult } from "@/lib/connections/google";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState, type MemoryState } from "@/lib/data/memory";
import { localTime } from "@/lib/domain/dates";
import { inQuietHours } from "@/lib/domain/heardBack";
import { MACHINE_ROUTES } from "@/lib/domain/refusedTokens";
import type { InboxItem } from "@/lib/domain/types";
import { isWatchTime, triesGmail, WATCH_LIMIT_MS, WATCH_TASK, wholePass } from "@/lib/domain/watch";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const TZ = "America/Denver";
/** A moment on Tuesday 17 Nov 2026, Denver time (UTC-7). */
const denver = (hhmm: string, day = "2026-11-17") => new Date(`${day}T${hhmm}:00-07:00`);
const minutesBefore = (at: Date, n: number) => new Date(at.getTime() - n * 60_000).toISOString();

describe("When the watch runs", () => {
  it("runs from 7 AM up to 9 PM: the hours a push may be sent", () => {
    expect(["07:00", "07:15", "12:30", "20:45", "20:59"].map(isWatchTime)).toEqual([true, true, true, true, true]);
    expect(["06:59", "21:00", "23:45", "00:00", "03:15"].map(isWatchTime)).toEqual([false, false, false, false, false]);
    for (const t of ["06:59", "07:00", "20:59", "21:00"]) expect(isWatchTime(t)).toBe(!inQuietHours(t));
  });

  it("backs off to every 30 minutes after a Gmail error", () => {
    const ticks = ["09:00", "09:15", "09:30", "09:45"];
    expect(ticks.map((t) => triesGmail(t, false))).toEqual([true, true, true, true]);
    expect(ticks.map((t) => triesGmail(t, true))).toEqual([true, false, true, false]);
    // A tick that arrives a minute late is still its own tick.
    expect([triesGmail("09:01", true), triesGmail("09:16", true), triesGmail("09:31", true)]).toEqual([true, false, true]);
  });

  it("does the whole pass when Gmail has something new, and always at the top of the hour", () => {
    const last = "2026-11-17T16:15:05Z";
    expect(wholePass("09:30", "2026-11-17T16:20:00Z", last)).toBe(true);
    expect(wholePass("09:30", "2026-11-17T15:00:00Z", last)).toBe(false);
    // Mail that landed while the last sync was running still counts as new.
    expect(wholePass("09:30", "2026-11-17T16:14:00Z", last)).toBe(true);
    expect(wholePass("09:30", null, last)).toBe(false);
    expect(wholePass("09:30", "2026-11-17T15:00:00Z", null)).toBe(true);
    // A read that failed is tried again within the hour, new mail or not.
    expect(wholePass("10:00", "2026-11-17T15:00:00Z", last)).toBe(true);
    expect(wholePass("10:02", null, last)).toBe(true);
  });
});

// ---------------------------------------------------------------------------

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

interface Rig {
  ctx: Context;
  state: MemoryState;
  deps: WatchDeps;
  sent: { title: string; body: string; url: string }[];
  /** What Gmail holds: the next sync puts it in the inbox. */
  gmail: InboxItem[];
  /** The text of each email, by id. Missing: the reader cannot reach Gmail. */
  texts: Map<string, string> | null;
  calls: { sync: number; read: number };
  at(now: Date): Context;
}

function rig(now: Date, over: Partial<Context["settings"]> = {}): Rig {
  const state = seedState(now);
  state.inbox.length = 0;
  state.applications = [];
  state.applicationEvents = [];
  state.notifications = [];
  state.agentRuns = [];
  state.jobMatches = [];
  state.push = [{ id: "p1", endpoint: "https://web.push.apple.com/x", p256dh: "k", auth: "a", device: "iPhone", createdAt: now.toISOString() }];
  state.connections = [{ id: "c1", provider: "gmail_imap", accountEmail: "me@example.com", scopes: "", status: "active", lastSyncAt: minutesBefore(now, 15), lastError: "", createdAt: now.toISOString() }];
  state.settings = { ...state.settings, timezone: TZ, ...over };
  const store = createMemoryStore(state);
  const r: Rig = {
    state,
    sent: [],
    gmail: [],
    texts: new Map(),
    calls: { sync: 0, read: 0 },
    ctx: undefined as unknown as Context,
    deps: undefined as unknown as WatchDeps,
    at: (when) => ({ mode: "live", userId: "owner", store, settings: state.settings, now: when, today: "2026-11-17", time: localTime(when, TZ), deadline: Date.now() + WATCH_LIMIT_MS }),
  };
  r.ctx = r.at(now);
  r.deps = {
    syncInbox: vi.fn(async (): Promise<SyncResult> => {
      r.calls.sync++;
      for (const m of r.gmail) if (!state.inbox.some((i) => i.messageId === m.messageId)) state.inbox.push(structuredClone(m));
      const newestAt = r.gmail.reduce<string | null>((n, m) => (m.receivedAt > (n ?? "") ? m.receivedAt : n), null);
      return { status: "ok", fetched: r.gmail.length, needsReply: 0, newestAt };
    }),
    readTexts: vi.fn(async (ids: string[]) => {
      r.calls.read++;
      return r.texts ? new Map(ids.flatMap((id) => (r.texts!.has(id) ? [[id, r.texts!.get(id)!] as const] : []))) : null;
    }),
    push: { ready: () => true, push: vi.fn(async (_store, payload) => (r.sent.push(payload), { sent: 1, removed: 0, failed: 0 })) },
  };
  return r;
}

const THANKS = "Thank you for applying for the AI Engineer role at Acme. We have received your application.";
const INVITE = "Hi Tyler, we would like to schedule an interview with you for the AI Engineer role. Please share your availability.";
const RECEIVED = "Hi Tyler, we received your application for the AI Engineer role. Our team reads every application.";
const NO = "Thank you for your interest. Unfortunately, we have decided to move forward with other candidates for the AI Engineer role.";

describe("One watch run", () => {
  it("reads headers, reads the job mail, puts it on the timeline and pushes it, within 15 minutes of arriving", async () => {
    const now = denver("09:30");
    const r = rig(now);
    r.gmail = [mail("c1", "Thank you for applying to the AI Engineer role at Acme", minutesBefore(now, 3 * 24 * 60)), mail("i1", "Next steps with Acme", minutesBefore(now, 6))];
    r.texts = new Map([["c1", THANKS], ["i1", INVITE]]);

    const out = await runWatch(r.ctx, r.ctx.store, r.deps);
    expect(out).toEqual({ status: "succeeded", detail: "1 new applications, 0 moved forward, 1 new in Heard back, 1 pushed" });
    const [app] = await r.ctx.store.applications.list();
    expect(app).toMatchObject({ company: "Acme", status: "interview" });
    expect(r.sent).toEqual([{ title: "Acme · Interview invite", body: "AI Engineer. Open to reply.", url: `/applications/${app!.id}` }]);

    // It is the Applications Agent's run, traced, with no model and no cost.
    const runs = r.state.agentRuns.filter((x) => x.task === WATCH_TASK);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ agent: "career", status: "succeeded", trigger: "schedule", model: "", costUsd: 0 });
    expect(runs[0]!.trace!.map((s) => s.name)).toEqual(["Read Gmail (headers only)", "Read the text of new job emails (read-only, rules only)", "Track applications from job emails", "Tell your phone who wrote back"]);
    // Counts only: nothing an email said is in the log.
    expect(JSON.stringify(runs)).not.toMatch(/schedule an interview|availability|Next steps/);
  });

  it("writes no brief, adds no job match and makes no model call", async () => {
    const now = denver("09:30");
    const r = rig(now);
    r.gmail = [mail("c1", "Thank you for applying to the AI Engineer role at Acme", minutesBefore(now, 5))];
    r.texts = new Map([["c1", THANKS]]);
    await runWatch(r.ctx, r.ctx.store, r.deps);
    expect(r.state.briefs).toEqual([]);
    expect(r.state.jobMatches).toEqual([]);
    expect(r.state.aiCalls).toEqual([]);
    expect(r.state.agentRuns.map((x) => x.agent)).toEqual(["career"]);
    const src = read("lib/agents/watch.ts");
    expect(src).not.toMatch(/lib\/ai\/|takeAiCall|structured|jobFeeds|runNewsAgent|runCalendarAgent|chiefOfStaff|queueFollowUps|lookUpRoles|indexKnowledge/);
  });

  it("a tick with nothing new in Gmail stops after the headers, logs nothing, and still sends what is due", async () => {
    const now = denver("09:30");
    const r = rig(now);
    r.gmail = [mail("old", "Your statement is ready", minutesBefore(now, 300), { fromName: "Bank", fromEmail: "a@bank.example" })];
    expect(await runWatch(r.ctx, r.ctx.store, r.deps)).toEqual({ status: "succeeded", detail: "0 new applications, 0 moved forward, 0 new in Heard back, 0 pushed" });
    expect(r.calls).toEqual({ sync: 1, read: 0 });
    expect(r.state.agentRuns).toEqual([]);

    // An answer the 2-hour sync recorded but could not send (a manual run) goes out with the next tick.
    await r.ctx.store.applications.create({ company: "Beta", role: "Solutions Engineer", targetRole: "", source: "Email", url: "", payText: "", tier: "semi", status: "replied", appliedOn: "2026-11-10", statusAt: minutesBefore(now, 30), notes: "", origin: "atlas", externalId: "email:b0" });
    const [beta] = await r.ctx.store.applications.list();
    const [e] = await r.ctx.store.applicationEvents.append([{ applicationId: beta!.id, kind: "reply", occurredAt: minutesBefore(now, 30), source: "email", sourceRef: "email:b1", threadId: "", decidedBy: "rules", stage: null, summary: "Re: your application" }]);
    await r.ctx.store.notifications.add([{ eventId: e!.id, applicationId: beta!.id, kind: "reply", occurredAt: e!.occurredAt, title: "Beta · They replied", body: "Solutions Engineer. Open to reply.", url: `/applications/${beta!.id}`, tier: "push", sentAt: null, seenAt: null }]);
    const later = r.at(denver("09:45"));
    expect(await runWatch(later, later.store, r.deps)).toMatchObject({ status: "succeeded", detail: "0 new applications, 0 moved forward, 0 new in Heard back, 1 pushed" });
    expect(r.calls.read).toBe(0);
    expect(r.sent).toEqual([{ title: "Beta · They replied", body: "Solutions Engineer. Open to reply.", url: `/applications/${beta!.id}` }]);
  });

  it("never pushes an answer twice: not on the next tick, and not when the 2-hour sync sends too", async () => {
    const now = denver("09:30");
    const r = rig(now);
    r.gmail = [mail("c1", "Thank you for applying to the AI Engineer role at Acme", minutesBefore(now, 3000)), mail("i1", "Next steps with Acme", minutesBefore(now, 6))];
    r.texts = new Map([["c1", THANKS], ["i1", INVITE]]);
    await runWatch(r.ctx, r.ctx.store, r.deps);
    const next = r.at(denver("10:00"));
    await runWatch(next, next.store, r.deps);
    expect(await sendHeardBack(next, next.store, r.deps.push)).toMatchObject({ sent: 0 });
    expect(r.sent).toHaveLength(1);
    expect(r.state.applicationEvents).toHaveLength(2);
    expect(r.state.notifications).toHaveLength(1);
  });

  it("does not place an email by its subject alone: it waits until the text is read, then reads it right", async () => {
    const now = denver("09:30");
    const r = rig(now);
    r.gmail = [mail("c1", "Thank you for applying to the AI Engineer role at Acme", minutesBefore(now, 3000), { textVerdict: "none", textQuote: "" }), mail("u1", "Update on your application at Acme", minutesBefore(now, 4))];
    // Gmail's text could not be reached on this tick.
    r.texts = null;
    expect(await runWatch(r.ctx, r.ctx.store, r.deps)).toMatchObject({ status: "succeeded" });
    expect(r.state.applicationEvents!.map((e) => e.sourceRef)).toEqual(["email:c1"]);
    expect(r.sent).toEqual([]);

    // The next tick reads it: the "update" was a rejection, and that is what it is logged and pushed as.
    r.texts = new Map([["u1", NO]]);
    const next = r.at(denver("10:00"));
    await runWatch(next, next.store, r.deps);
    expect(r.state.applicationEvents!.map((e) => [e.sourceRef, e.kind])).toEqual([["email:c1", "confirmation"], ["email:u1", "rejection"]]);
    expect((await next.store.applications.list())[0]).toMatchObject({ status: "rejected" });
    expect(r.sent).toEqual([expect.objectContaining({ title: "Acme · Rejection" })]);
  });

  it("a subject alone does not make an interview invite once the text is read and says none", async () => {
    for (const subject of ["Next steps for your application", "Your interview with Acme"]) {
      const now = denver("09:30");
      const r = rig(now);
      r.gmail = [mail("c1", "Thank you for applying to the AI Engineer role at Acme", minutesBefore(now, 3 * 24 * 60)), mail("n1", subject, minutesBefore(now, 6))];
      r.texts = new Map([["c1", THANKS], ["n1", RECEIVED]]);
      expect(await runWatch(r.ctx, r.ctx.store, r.deps), subject).toMatchObject({ status: "succeeded" });
      // It is on the timeline and it pings, as a reply: the stage goes no further than In review.
      expect(r.state.applicationEvents!.map((e) => [e.sourceRef, e.kind]), subject).toEqual([["email:c1", "confirmation"], ["email:n1", "reply"]]);
      const [app] = await r.ctx.store.applications.list();
      expect(app, subject).toMatchObject({ company: "Acme", status: "replied", stage: "in_review" });
      expect(r.sent, subject).toEqual([{ title: "Acme · They replied", body: "AI Engineer. Open to reply.", url: `/applications/${app!.id}` }]);
    }
  });

  it("is stopped by the hour, the kill switch and a paused agent, before it reads anything", async () => {
    const quiet = rig(denver("21:00"));
    expect(await runWatch(quiet.ctx, quiet.ctx.store, quiet.deps)).toEqual({ status: "skipped", detail: "outside 7 AM to 9 PM" });
    const early = rig(denver("06:45"));
    expect(await runWatch(early.ctx, early.ctx.store, early.deps)).toMatchObject({ status: "skipped" });
    const killed = rig(denver("09:30"), { outboundEnabled: false });
    expect(await runWatch(killed.ctx, killed.ctx.store, killed.deps)).toEqual({ status: "skipped", detail: "the kill switch is on" });
    for (const agent of ["career", "email"] as const) {
      const paused = rig(denver("09:30"));
      await paused.ctx.store.agentState.setPaused(agent, true);
      expect(await runWatch(paused.ctx, paused.ctx.store, paused.deps), agent).toEqual({ status: "skipped", detail: "paused in Mission Control" });
      expect(paused.calls.sync).toBe(0);
    }
    const none = rig(denver("09:30"));
    none.state.connections.length = 0;
    expect(await runWatch(none.ctx, none.ctx.store, none.deps)).toEqual({ status: "skipped", detail: "Gmail is not connected" });
    for (const r of [quiet, early, killed, none]) {
      expect(r.calls).toEqual({ sync: 0, read: 0 });
      expect(r.state.agentRuns).toEqual([]);
    }
  });

  it("after a Gmail error it tries on the half hour only, and a failed try is logged", async () => {
    const r = rig(denver("09:15"));
    r.state.connections[0]!.status = "error";
    expect(await runWatch(r.ctx, r.ctx.store, r.deps)).toMatchObject({ status: "skipped", detail: expect.stringContaining("every 30 minutes") });
    expect(r.calls.sync).toBe(0);

    const failing: WatchDeps = { ...r.deps, syncInbox: vi.fn(async (): Promise<SyncResult> => ({ status: "error", message: "Could not reach Gmail." })) };
    const half = r.at(denver("09:30"));
    expect(await runWatch(half, half.store, failing)).toEqual({ status: "failed", detail: "Gmail could not be read; trying again in 30 minutes" });
    expect(r.state.agentRuns.map((x) => [x.task, x.status, x.detail])).toEqual([[WATCH_TASK, "failed", "Gmail could not be read; trying again in 30 minutes"]]);
    expect(r.sent).toEqual([]);
  });

  it("holds nothing back at 7 AM: last night's answer goes out with the first tick", async () => {
    const seven = denver("07:00", "2026-11-18");
    const r = rig(seven);
    r.gmail = [mail("c1", "Thank you for applying to the AI Engineer role at Acme", minutesBefore(seven, 5000)), mail("i1", "Next steps with Acme", denver("22:10").toISOString())];
    r.texts = new Map([["c1", THANKS], ["i1", INVITE]]);
    expect(await runWatch(r.ctx, r.ctx.store, r.deps)).toMatchObject({ status: "succeeded" });
    expect(r.sent).toEqual([expect.objectContaining({ title: "Acme · Interview invite" })]);
  });
});

describe("The route and its secret", () => {
  it("is a POST with a short limit, handled by the watch alone", () => {
    const route = read("app/api/cron/watch/route.ts");
    expect(route).toContain("export const maxDuration = 60;");
    expect(route).toContain("export function POST(request: NextRequest)");
    expect(route).not.toContain("export function GET");
    expect(WATCH_LIMIT_MS).toBeLessThan(60_000);
    expect(MACHINE_ROUTES).toContain("/api/cron/watch");
  });

  it("has its own secret: CRON_SECRET does not open it, it opens nothing else, and the two may not be the same", () => {
    const src = read("lib/agents/watch.ts");
    expect(src).toContain('if (!bearerMatches(request.headers.get("authorization"), e.ATLAS_WATCH_SECRET)) {');
    expect(src.match(/bearerMatches\(/g)).toHaveLength(1);
    expect(src).toContain("e.ATLAS_WATCH_SECRET === e.CRON_SECRET) return NextResponse.json({ error: \"not configured\" }, { status: 503 });");
    // No other machine route accepts the watch's secret.
    for (const f of ["lib/agents/sync.ts", "lib/agents/cron.ts", "app/api/keepalive/route.ts", "app/api/capture/route.ts"]) expect(read(f), f).not.toContain("ATLAS_WATCH_SECRET");
    const env = read("lib/env.ts");
    expect(env).toContain("ATLAS_WATCH_SECRET: z.string().min(32).optional(),");
    expect(env).toContain('"ATLAS_WATCH_SECRET",');
    expect(read(".env.example")).toContain("\nATLAS_WATCH_SECRET=\n");
  });

  it("answers with a status and counts, nothing from an email", () => {
    expect(read("lib/agents/watch.ts")).toContain("return NextResponse.json({ ok: outcome.status !== \"failed\", watch: outcome.status, detail: outcome.detail });");
  });
});

describe("The schedule you run in Supabase (docs/WATCH.md)", () => {
  const doc = read("docs/WATCH.md");
  const schedule = /'atlas-watch',\s*'([^']+)'/.exec(doc)?.[1] ?? "";

  it("calls the watch every 15 minutes in every hour from 7 AM to 9 PM Mountain time, summer and winter, every day", () => {
    expect(schedule).toBe("*/15 0-3,13-23 * * *");
    const [minutes, hours, dayOfMonth, month, dayOfWeek] = schedule.split(" ");
    expect([minutes, dayOfMonth, month, dayOfWeek]).toEqual(["*/15", "*", "*", "*"]);
    const utcHours = hours!.split(",").flatMap((part) => {
      const [from, to] = part.split("-").map(Number);
      return Array.from({ length: (to ?? from!) - from! + 1 }, (_, i) => from! + i);
    });
    const wanted = Array.from({ length: 14 * 4 }, (_, i) => `${String(7 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
    // A winter day (UTC-7) and a summer day (UTC-6).
    for (const day of ["2026-01-15", "2026-07-15"]) {
      const local = new Set(utcHours.flatMap((h) => [0, 15, 30, 45].map((m) => localTime(new Date(`${day}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`), TZ))));
      for (const tick of wanted) expect(local.has(tick), `${day} ${tick}`).toBe(true);
      expect([...local].filter(isWatchTime).sort()).toEqual(wanted);
    }
  });

  it("reads the secret from Vault when it runs, and the page holds no secret", () => {
    expect(doc).toContain("select decrypted_secret from vault.decrypted_secrets where name = 'atlas_watch_secret'");
    expect(doc).toContain("url := 'https://YOUR-SITE/api/cron/watch'");
    expect(doc).toContain("select net.http_post(");
    // pg_net gives up after 2 seconds unless told otherwise; the route may take longer.
    expect(doc).toContain("timeout_milliseconds := 55000");
    expect(doc).toContain("create extension if not exists pg_net with schema extensions;");
    expect(doc).not.toMatch(/[0-9a-f]{32,}/);
    expect(doc).not.toContain("CRON_SECRET'");
    expect(doc).toContain("**Not run by Atlas or by Claude.**");
  });
});
