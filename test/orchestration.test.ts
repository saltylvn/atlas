import { beforeAll, describe, expect, it } from "vitest";
import { loadLive } from "@/lib/agents/live";
import { runSync } from "@/lib/agents/sync";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { AGENTS } from "@/lib/domain/agents";
import { SYNC_TASK } from "@/lib/domain/briefSchedule";
import {
  ago,
  askedAgent,
  DELIVER_MS,
  edgesAmong,
  framesFor,
  groupRuns,
  liveHighlights,
  liveSnapshot,
  MAP_EDGES,
  MAP_GROUPS,
  MAP_NODES,
  MAP_SIZE,
  MODEL_NODE,
  NODE_FACTS,
  related,
  route,
  pollDelay,
  STALL_MS,
  stepNodes,
  took,
  triggerNode,
} from "@/lib/domain/orchestration";
import type { AgentId, AgentRunEvent } from "@/lib/domain/types";

const T0 = Date.parse("2026-11-16T15:05:00Z");
const at = (sec: number) => new Date(T0 + sec * 1000).toISOString();
let seq = 0;
const row = (over: Partial<AgentRunEvent> & Pick<AgentRunEvent, "runId" | "agent" | "status">): AgentRunEvent => ({
  id: `r${seq++}`,
  task: over.agent === "chief-of-staff" ? SYNC_TASK : `${over.agent} task`,
  trigger: "schedule",
  detail: "",
  model: "",
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  at: at(0),
  ...over,
});
const step = (name: string, ms = 100, ok = true, note = "") => ({ name, ms, ok, note });

/** A whole sync: the Chief of Staff, then Email, then Calendar and Finance. Newest first, as the store returns it. */
function syncRows(): AgentRunEvent[] {
  return [
    row({ runId: "s1", agent: "chief-of-staff", status: "started", at: at(0) }),
    row({ runId: "e1", agent: "email", status: "started", at: at(1) }),
    row({ runId: "e1", agent: "email", status: "succeeded", at: at(3), durationMs: 2000, detail: "3 need a reply, starting with Sam Ortiz", trace: [step("Read Gmail (headers only)", 1500, true, "42 new"), step("Sort, tag and look for senders to declutter", 400)] }),
    row({ runId: "c1", agent: "calendar", status: "started", at: at(3) }),
    row({ runId: "f1", agent: "finance", status: "started", at: at(3) }),
    row({ runId: "c1", agent: "calendar", status: "succeeded", at: at(4), durationMs: 900, trace: [step("Read Google Calendar (secret iCal address, read-only)", 800)] }),
    row({ runId: "f1", agent: "finance", status: "failed", at: at(5), durationMs: 1800, detail: "boom", trace: [step("Load the inbox the Email bot synced, and your Renewals list", 300), step("Read bills, payment alerts and deals", 1500, false, "boom")] }),
    row({
      runId: "s1",
      agent: "chief-of-staff",
      status: "succeeded",
      at: at(6),
      durationMs: 6000,
      detail: "3 need a reply, Interview from Northwind Labs",
      trace: [
        step("Sync role order and resumes from Notion", 300, true, "7 roles, 8 resumes"),
        step("Ask the Email bot", 2100, true, "3 need a reply"),
        step("Ask the Calendar bot", 1000),
        step("Ask the Finance bot", 1900, true, "failed: boom"),
        step("Ping your phone about something urgent", 200, true, "1 urgent, sent to 1 device"),
      ],
    }),
  ].reverse();
}
const snap = (rows: AgentRunEvent[], nowSec: number, opts: { detail?: boolean; paused?: AgentId[] } = {}) =>
  liveSnapshot({ rows, paused: opts.paused ?? [], now: new Date(T0 + nowSec * 1000), detail: opts.detail ?? false, nextSync: "around 10 AM", nextBrief: "2:00 PM Brief, today" });

describe("The orchestration map", () => {
  it("has one box per agent, and every line joins two boxes that exist", () => {
    const ids = MAP_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of AGENTS) expect(MAP_NODES.find((n) => n.agent === a.id)?.id).toBe(a.id);
    for (const e of MAP_EDGES) {
      expect(ids).toContain(e.from);
      expect(ids).toContain(e.to);
      expect(e.id).toBe(`${e.from}>${e.to}`);
    }
    expect(new Set(MAP_EDGES.map((e) => e.id)).size).toBe(MAP_EDGES.length);
  });

  it("follows the architecture: triggers start the Chief of Staff, which asks every specialist", () => {
    const specialists = AGENTS.filter((a) => a.reportsTo === "chief-of-staff").map((a) => a.id);
    expect(MAP_EDGES.filter((e) => e.kind === "ask").map((e) => e.to).sort()).toEqual([...specialists].sort());
    // The schedules and you start the Chief of Staff; the 6 PM evening run starts its two agents directly.
    expect(MAP_EDGES.filter((e) => e.kind === "trigger" && e.from !== "trigger-evening").every((e) => e.to === "chief-of-staff")).toBe(true);
    expect(MAP_EDGES.filter((e) => e.from === "trigger-evening").map((e) => e.to)).toEqual(["career", "mentor"]);
    // The AI model judges for exactly the agents that use it.
    expect(MAP_EDGES.filter((e) => e.kind === "judge").map((e) => e.to).sort()).toEqual(AGENTS.filter((a) => a.ai).map((a) => a.id).sort());
    // Only the Email Agent reads Gmail; Career and Finance get the inbox from it.
    expect(MAP_EDGES.filter((e) => e.from === "src-gmail").map((e) => e.to)).toEqual(["email"]);
    expect(MAP_EDGES.filter((e) => e.kind === "handoff").map((e) => e.id)).toEqual(["email>career", "email>finance", "scout>analyst", "analyst>mentor"]);
  });

  it("keeps every box on the canvas, and no two boxes overlap", () => {
    for (const n of MAP_NODES) {
      expect(n.x - n.w / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w / 2).toBeLessThanOrEqual(MAP_SIZE.w);
      expect(n.y - n.h / 2).toBeGreaterThanOrEqual(0);
      expect(n.y + n.h / 2).toBeLessThanOrEqual(MAP_SIZE.h);
    }
    for (const a of MAP_NODES)
      for (const b of MAP_NODES) {
        if (a.id >= b.id) continue;
        const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + 4 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2 + 4;
        expect(apart, `${a.id} overlaps ${b.id}`).toBe(true);
      }
  });
});

describe("The two-desk layout", () => {
  const inside = (n: { x: number; y: number; w: number; h: number }, g: { x: number; y: number; w: number; h: number }) => n.x - n.w / 2 >= g.x && n.x + n.w / 2 <= g.x + g.w && n.y - n.h / 2 >= g.y && n.y + n.h / 2 <= g.y + g.h;

  it("puts each agent in its desk and every source in the sources band", () => {
    const group = (id: string) => MAP_GROUPS.find((g) => g.id === id)!;
    for (const id of ["calendar", "news", "finance", "email"]) expect(inside(MAP_NODES.find((n) => n.id === id)!, group("daily-desk")), id).toBe(true);
    for (const id of ["scout", "analyst", "career", "mentor"]) expect(inside(MAP_NODES.find((n) => n.id === id)!, group("career-desk")), id).toBe(true);
    for (const n of MAP_NODES.filter((x) => x.kind === "source")) expect(inside(n, group("sources")), n.id).toBe(true);
    expect(MAP_NODES.filter((n) => n.kind === "source").map((n) => n.id)).toEqual(expect.arrayContaining(["src-github", "src-figma"]));
    expect(MAP_NODES.find((n) => n.id === MODEL_NODE)?.kind).toBe("model");
  });

  it("runs every line at right angles, from its own box to its own box, without crossing another box", () => {
    for (const e of MAP_EDGES) {
      const pts = route(e);
      expect(pts.length, e.id).toBeGreaterThanOrEqual(2);
      const [from, to] = [MAP_NODES.find((n) => n.id === e.from)!, MAP_NODES.find((n) => n.id === e.to)!];
      const onEdge = (p: readonly [number, number], n: typeof from) => {
        const l = n.x - n.w / 2, r = n.x + n.w / 2, t = n.y - n.h / 2, b = n.y + n.h / 2;
        return p[0] >= l && p[0] <= r && p[1] >= t && p[1] <= b && (p[0] === l || p[0] === r || p[1] === t || p[1] === b);
      };
      expect(onEdge(pts[0]!, from), `${e.id} starts on ${e.from}`).toBe(true);
      expect(onEdge(pts.at(-1)!, to), `${e.id} ends on ${e.to}`).toBe(true);
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1]!;
        const [x2, y2] = pts[i]!;
        expect(x1 === x2 || y1 === y2, `${e.id} segment ${i} is not straight`).toBe(true);
        for (const p of [pts[i - 1]!, pts[i]!]) {
          expect(p[0] >= 0 && p[0] <= MAP_SIZE.w && p[1] >= 0 && p[1] <= MAP_SIZE.h, `${e.id} leaves the canvas`).toBe(true);
        }
        for (const n of MAP_NODES) {
          if (n.id === e.from || n.id === e.to) continue;
          const l = n.x - n.w / 2, r = n.x + n.w / 2, t = n.y - n.h / 2, b = n.y + n.h / 2;
          const hits = x1 === x2 ? x1 > l && x1 < r && Math.max(y1, y2) > t && Math.min(y1, y2) < b : y1 > t && y1 < b && Math.max(x1, x2) > l && Math.min(x1, x2) < r;
          expect(hits, `${e.id} crosses ${n.id}`).toBe(false);
        }
      }
    }
  });

  it("has facts for every box, and focusing a box keeps what it is joined to", () => {
    for (const n of MAP_NODES) expect(NODE_FACTS[n.id]?.length, n.id).toBeGreaterThan(0);
    expect(related(MODEL_NODE).sort()).toEqual([MODEL_NODE, "analyst", "apply", "career", "chief-of-staff", "mentor"].sort());
    expect(related("src-github").sort()).toEqual(["scout", "src-github"]);
  });

  it("lights the evening trigger when the evening run starts Applications or the Career Mentor", () => {
    const s = snap([row({ runId: "rs1", agent: "career", status: "started", task: "Resume sync (Figma to Notion)", at: at(0) })], 5);
    const lit = liveHighlights(s, T0 + 5000);
    expect(lit.nodes).toContain("trigger-evening");
    expect(lit.edges).toContain("trigger-evening>career");
    expect(lit.nodes).toEqual(expect.arrayContaining(["src-figma", "src-notion", "src-boards"]));
  });
});

describe("Reading the activity log", () => {
  it("joins a run's start and end, newest first", () => {
    const runs = groupRuns(syncRows(), T0 + 10_000, false);
    expect(runs.map((r) => r.runId)).toEqual(["s1", "f1", "c1", "e1"]);
    expect(runs[0]).toMatchObject({ agent: "chief-of-staff", status: "succeeded", startedAt: at(0), endedAt: at(6), durationMs: 6000 });
    expect(runs[0]!.steps).toHaveLength(5);
  });

  it("shows a run as working until it ends, and as not finished after three minutes", () => {
    const rows = [row({ runId: "x", agent: "news", status: "started", at: at(0) })];
    expect(groupRuns(rows, T0 + 5000, false)[0]!.status).toBe("started");
    expect(groupRuns(rows, T0 + STALL_MS + 1000, false)[0]!.status).toBe("stalled");
    expect(snap(rows, 5).agents.find((a) => a.agent === "news")!.state).toBe("running");
    expect(snap(rows, 600).agents.find((a) => a.agent === "news")!.state).toBe("stalled");
  });

  it("leaves out details and step notes unless they are asked for", () => {
    const hidden = JSON.stringify(snap(syncRows(), 10));
    for (const secret of ["Northwind", "Sam Ortiz", "42 new", "boom", "7 roles"]) expect(hidden).not.toContain(secret);
    // Names, timings and results are still there.
    expect(hidden).toContain("Read Gmail (headers only)");
    const shown = JSON.stringify(snap(syncRows(), 10, { detail: true }));
    expect(shown).toContain("Northwind");
    expect(shown).toContain("42 new");
  });

  it("gives each agent its latest state", () => {
    const s = snap(syncRows(), 10, { paused: ["news"] });
    const state = Object.fromEntries(s.agents.map((a) => [a.agent, a.state]));
    expect(state).toEqual({ "chief-of-staff": "ok", calendar: "ok", news: "paused", career: "idle", email: "ok", finance: "failed", scout: "idle", analyst: "idle", mentor: "idle" });
    expect(s.feed).toHaveLength(4);
    expect(s.feed.every((r) => r.steps.length === 0)).toBe(true);
  });

  it("finds the latest sync or brief and the specialists that reported to it", () => {
    const earlier = [row({ runId: "old", agent: "email", status: "succeeded", at: at(-7200), durationMs: 10 }), row({ runId: "manual", agent: "news", status: "succeeded", trigger: "run-now", at: at(4), durationMs: 10 })];
    const m = snap([...syncRows(), ...earlier], 10).mission!;
    expect(m.kind).toBe("sync");
    expect(m.members.map((r) => r.agent).sort()).toEqual(["calendar", "email", "finance"]);
    // Pages always; the phone because the run pinged it; no brief (a sync writes none) and no apply queues (Career did not run).
    expect(m.delivered).toEqual(["out-pages", "out-phone"]);
    // The daily eval run is logged under the Chief of Staff but orchestrates nothing.
    const evalOnly = snap([row({ runId: "ev", agent: "chief-of-staff", status: "succeeded", task: "Agent evals" })], 10);
    expect(evalOnly.mission).toBeNull();
  });
});

describe("What lights up", () => {
  it("lights the trigger, the Chief of Staff, and each working agent with what it reads", () => {
    const rows = syncRows().filter((r) => Date.parse(r.at) <= T0 + 3000 && !(r.runId === "s1" && r.status !== "started"));
    const h = liveHighlights(snap(rows, 3.5), T0 + 3500);
    expect(new Set(h.nodes)).toEqual(new Set(["trigger-sync", "chief-of-staff", "calendar", "src-gcal", "finance"]));
    expect(new Set(h.edges)).toEqual(new Set(["trigger-sync>chief-of-staff", "chief-of-staff>calendar", "src-gcal>calendar", "chief-of-staff>finance", "email>finance"]));
  });

  it("lights what a run delivered for a short while after it ends, then goes quiet", () => {
    const s = snap(syncRows(), 7);
    expect(new Set(liveHighlights(s, T0 + 7000).edges)).toEqual(new Set(["chief-of-staff>out-pages", "chief-of-staff>out-phone"]));
    expect(liveHighlights(s, T0 + 6000 + DELIVER_MS + 1)).toEqual({ nodes: [], edges: [] });
  });

  it("names the trigger: the sync schedule, the brief schedule, or you", () => {
    expect(triggerNode({ task: SYNC_TASK, trigger: "schedule" })).toBe("trigger-sync");
    expect(triggerNode({ task: "Morning Brief", trigger: "schedule" })).toBe("trigger-brief");
    expect(triggerNode({ task: SYNC_TASK, trigger: "run-now" })).toBe("trigger-you");
  });

  it("reads which boxes a step touches from its name", () => {
    expect(askedAgent("Ask the Applications bot to log applications and queue follow-ups")).toBe("career");
    expect(askedAgent("Check for anything urgent")).toBeNull();
    expect(stepNodes("Read Gmail (headers only)")).toEqual(["src-gmail"]);
    expect(stepNodes("Track applications from job emails")).toEqual(["email"]);
    expect(stepNodes("Sync role order and resumes from Notion")).toEqual(["src-notion", "career"]);
    expect(edgesAmong(["finance", "email"])).toEqual(["email>finance"]);
  });
});

describe("Replay", () => {
  const frames = framesFor(snap(syncRows(), 10, { detail: true }).mission!);

  it("plays the run in order: trigger, each ask, the agent's own steps, its report, then delivery", () => {
    expect(frames.map((f) => f.title)).toEqual([
      "The schedule starts the 2-hour sync",
      "Sync role order and resumes from Notion",
      "Chief of Staff asks the Email bot",
      "Read Gmail (headers only)",
      "Sort, tag and look for senders to declutter",
      "Email bot reports back",
      "Chief of Staff asks the Calendar bot",
      "Read Google Calendar (secret iCal address, read-only)",
      "Calendar bot reports back",
      "Chief of Staff asks the Finance bot",
      "Load the inbox the Email bot synced, and your Renewals list",
      "Read bills, payment alerts and deals",
      "Finance bot reports back",
      "Ping your phone about something urgent",
      "Every page in Atlas is fresh",
    ]);
  });

  it("lights real boxes and lines, sends reports back up the line, and marks what failed", () => {
    const ids = new Set(MAP_NODES.map((n) => n.id));
    const edges = new Set(MAP_EDGES.map((e) => e.id));
    for (const f of frames) {
      expect(f.nodes.every((n) => ids.has(n))).toBe(true);
      expect(f.edges.every((e) => edges.has(e))).toBe(true);
      expect(f.playMs).toBeGreaterThanOrEqual(1500);
      expect(f.playMs).toBeLessThanOrEqual(3000);
    }
    const gmail = frames.find((f) => f.title.startsWith("Read Gmail"))!;
    expect(gmail).toMatchObject({ actor: "email", edges: ["src-gmail>email"], note: "42 new", ms: 1500 });
    expect(frames.find((f) => f.title === "Email bot reports back")).toMatchObject({ reverse: true, edges: ["chief-of-staff>email"], ok: true });
    expect(frames.find((f) => f.title === "Read bills, payment alerts and deals")!.ok).toBe(false);
    expect(frames.find((f) => f.title === "Finance bot reports back")!.ok).toBe(false);
    expect(frames.at(-1)!.edges).toEqual(["chief-of-staff>out-pages", "chief-of-staff>out-phone"]);
  });

  it("carries no notes when details are hidden", () => {
    expect(framesFor(snap(syncRows(), 10).mission!).every((f) => f.note === undefined)).toBe(true);
  });
});

describe("Pacing and wording", () => {
  it("asks often while agents work, less just after, and slowly when idle", () => {
    const working = snap(syncRows().filter((r) => Date.parse(r.at) <= T0 + 1000), 2);
    expect(pollDelay(working, T0 + 2000)).toBe(2500);
    const done = snap(syncRows(), 10);
    expect(pollDelay(done, T0 + 30_000)).toBe(5000);
    expect(pollDelay(done, T0 + 10 * 60_000)).toBe(15_000);
    expect(pollDelay(snap([], 0), T0)).toBe(15_000);
  });

  it("words times plainly", () => {
    expect([10, 200, 3 * 3600, 3 * 86_400].map((s) => ago(at(0), T0 + s * 1000))).toEqual(["just now", "3 min ago", "3 h ago", "3 d ago"]);
    expect(ago(null, T0)).toBe("");
    expect([850, 4200, 65_000].map(took)).toEqual(["850 ms", "4.2 s", "1 min 5 s"]);
  });
});

describe("A real sync on the map", () => {
  beforeAll(() => {
    process.env.ATLAS_OFFLINE = "1";
  });

  it("shows every agent reporting, and replays it end to end", async () => {
    const NOW = new Date("2026-11-16T15:05:00Z");
    const state = { ...seedState(NOW), agentRuns: [] };
    const store = createMemoryStore(state);
    const ctx = { mode: "demo", userId: "demo", store, settings: state.settings, now: NOW, today: "2026-11-16", time: "08:05" } as Context;
    await runSync(ctx, "run-now", null);

    const live = await loadLive({ ...ctx, now: new Date() }, false);
    expect(live.mission).toMatchObject({ kind: "sync", run: { status: "succeeded", trigger: "run-now" } });
    expect(new Set(live.mission!.members.map((m) => m.agent))).toEqual(new Set(["email", "calendar", "news", "career", "finance", "scout"]));
    // Everyone in the sync has reported; the Analyst and the Career Mentor only run with the briefs.
    expect(live.agents.filter((a) => a.agent !== "analyst" && a.agent !== "mentor").every((a) => a.state !== "idle" && a.state !== "running")).toBe(true);
    expect(live.agents.filter((a) => a.agent === "analyst" || a.agent === "mentor").map((a) => a.state)).toEqual(["idle", "idle"]);
    expect(live.mission!.delivered).toContain("out-pages");
    expect(live.mission!.delivered).toContain("out-approvals");
    expect(live.nextSync).toBe("around 10 AM");

    const frames = framesFor(live.mission!);
    expect(frames[0]!.title).toBe("You started the 2-hour sync");
    expect(frames.filter((f) => /reports back|skipped this run/.test(f.title))).toHaveLength(6);
    expect(frames.some((f) => f.title === "Track applications from job emails" && f.edges.includes("email>career"))).toBe(true);
    expect(frames.at(-1)!.title).toBe("Every page in Atlas is fresh");
    expect(JSON.stringify(live)).not.toContain('"note"');
    expect(JSON.stringify(live)).not.toContain('"detail":"');
  });
});
