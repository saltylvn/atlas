// The orchestration map: how Atlas is wired, and what is happening on it right now.
//
// Mission Control's live map draws this file. The map itself is fixed (it follows the
// architecture: triggers start the Chief of Staff, the Chief of Staff asks five
// specialists, each specialist reads its own sources, and results are delivered to you).
// What moves on it comes from the activity log every agent already writes: a "started"
// row when a run begins and an ending row, with its traced steps, when it finishes.
//
// Pure: no database, no network, no clock of its own. The server builds a snapshot from
// the log; the browser turns a snapshot into highlights and replay frames.
//
// Privacy: a snapshot carries agent names, task names, step names, timings and results.
// Run details and step notes (which can name a company or a sender) are included only
// when asked for, so a screen left on a wall shows nothing personal by default.

import { agent as profile, spokenName } from "./agents";
import { SLOT_LABEL, SYNC_TASK } from "./briefSchedule";
import { LOOP_AGENTS } from "./registry";
import type { AgentId, AgentRunEvent, RunStatus, TraceStep } from "./types";

// ---- the map ----

/** "client" sits outside Atlas and talks to it (Claude, Supabase Auth); "connector" is Atlas's MCP layer. */
export type NodeKind = "trigger" | "orchestrator" | "agent" | "model" | "source" | "output" | "client" | "connector" | "loop";

export interface MapNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** One quiet line under the label: what this box is. */
  sub: string;
  /** Center of the box on the canvas. */
  x: number;
  y: number;
  w: number;
  h: number;
  agent?: AgentId;
}

export type EdgeKind = "trigger" | "ask" | "read" | "handoff" | "judge" | "deliver" | "connect";

export interface MapEdge {
  /** "from>to". Work or data moves from `from` to `to`. */
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  label?: string;
}

export const MAP_SIZE = { w: 1320, h: 1232 } as const;

const COS = "chief-of-staff";
/** The box for the AI model the marked agents use for judgment (Gemini or Claude). */
export const MODEL_NODE = "ai-model";
/** The box for Atlas's MCP server, which Claude reads through. */
export const MCP_NODE = "mcp";
const box = (id: string, kind: NodeKind, label: string, sub: string, x: number, y: number, w: number, h: number, agentId?: AgentId): MapNode => ({ id, kind, label, sub, x, y, w, h, ...(agentId ? { agent: agentId } : {}) });
/** Each specialist's job in a few words, short enough to fit its box. */
const JOB: Record<Exclude<AgentId, "chief-of-staff">, string> = { calendar: "Today, the week", news: "9 stories", finance: "Bills, deals", email: "Inbox, declutter", career: "Queue, kits, 5 agents", scout: "Postings, GitHub", analyst: "Market, funnel, gaps", mentor: "Insights, proof project", qa: "Weekly review of every bot", apply: "Answers forms; you submit" };

// The two desks sit side by side, each a 2 by 2 grid. Between a desk's columns runs a
// corridor, and between its rows a lane, so lines reach the back row without crossing a box.
const AGENT = { w: 262, h: 88 } as const;
const ROW = [489, 617] as const;
const DESK = {
  daily: { x: 40, cols: [187, 489] as const, corridor: 338 },
  career: { x: 680, cols: [827, 1129] as const, corridor: 978 },
} as const;
const specialist = (id: Exclude<AgentId, "chief-of-staff">, desk: keyof typeof DESK, col: 0 | 1, row: 0 | 1): MapNode =>
  box(id, "agent", profile(id).name, JOB[id], DESK[desk].cols[col], ROW[row], AGENT.w, AGENT.h, id);

/** A labeled outline around boxes that work as one group. Drawn behind the boxes; not a node. */
export interface MapGroup {
  id: string;
  label: string;
  /** Put the label along the bottom edge, where no line runs. */
  labelBottom?: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}
export const MAP_GROUPS: readonly MapGroup[] = [
  { id: "daily-desk", label: "Daily desk", x: DESK.daily.x, y: 410, w: 596, h: 267 },
  { id: "career-desk", label: "Career desk", x: DESK.career.x, y: 410, w: 596, h: 267 },
  { id: "sources", label: "Sources · outside Atlas", x: 40, y: 712, w: 1236, h: 134, labelBottom: true },
  // Two agents sit apart. The QA Agent reads the activity log every agent writes, and reports to you.
  { id: "quality", label: "Quality · reviews the team every Sunday", x: 40, y: 868, w: 596, h: 98, labelBottom: true },
  // The Apply Agent answers forms for Atlas Autofill, on your press; you submit (since 23 Nov 2026 it never applies itself).
  { id: "acts", label: "Answers forms for Autofill · you submit", x: 680, y: 868, w: 596, h: 98, labelBottom: true },
  // Atlas's agents (registry.ts LOOP_AGENTS): the model picks its own tools in a loop. They run under Applications.
  { id: "agents", label: "AI agents · pick their own tools, in a loop · the night shift runs the Researcher, Tailor and Nudger while you sleep, and the Planner plans your week on Sunday", x: 40, y: 990, w: 1236, h: 104, labelBottom: true },
  // Claude reads Atlas through its MCP connector (Step 4, docs/MCP-BUILD.md): read-only, signed in through Supabase Auth.
  { id: "connector", label: "Claude connector (MCP) · read-only · you approve it once", x: 40, y: 1112, w: 1236, h: 104, labelBottom: true },
];

/** Quiet labels over the parts of the map that have no outline. */
export const MAP_LABELS: readonly { text: string; x: number; y: number }[] = [
  { text: "Automations and you · what starts a workflow", x: 55, y: 28 },
  { text: "Delivers to you", x: 40, y: 160 },
  { text: "AI model", x: 950, y: 157 },
];

const SOURCE_X = [134, 309, 484, 659, 834, 1009, 1184] as const;
const source = (id: string, label: string, sub: string, i: number): MapNode => box(id, "source", label, sub, SOURCE_X[i]!, 785, 156, 64);

export const MAP_NODES: readonly MapNode[] = [
  // What starts a run.
  box("trigger-sync", "trigger", "2-hour sync", "Mon to Sat, 6 AM to 4 PM", 195, 70, 280, 64),
  box("trigger-brief", "trigger", "Brief schedule", "9:00 AM and 2:00 PM", 505, 70, 280, 64),
  box("trigger-evening", "trigger", "Evening run", "6 PM resume sync, Career Mentor", 815, 70, 280, 64),
  box("trigger-you", "trigger", "You", "Sync now, Run now", 1125, 70, 280, 64),
  // What a run delivers.
  box("out-brief", "output", "Briefs", "Hot List first", 117, 200, 155, 60),
  box("out-pages", "output", "Atlas pages", "Today, Inbox, Jobs…", 282, 200, 155, 60),
  box("out-approvals", "output", "Apply queues", "Nothing sends alone", 117, 284, 155, 60),
  box("out-phone", "output", "Phone alert", "Urgent only", 282, 284, 155, 60),
  // The orchestrator, and the AI model the marked agents use for judgment.
  box(COS, "orchestrator", profile("chief-of-staff").name, "Routes work and writes the briefs", 660, 255, 420, 100, "chief-of-staff"),
  box(MODEL_NODE, "model", "AI model", "Judgment for 5 agents", 1115, 250, 330, 170),
  // Daily desk.
  specialist("calendar", "daily", 0, 0),
  specialist("news", "daily", 1, 0),
  specialist("finance", "daily", 0, 1),
  specialist("email", "daily", 1, 1),
  // Career desk, in the order work moves through it: Scout, Analyst, Career Mentor; Applications acts on it.
  specialist("scout", "career", 0, 0),
  specialist("analyst", "career", 1, 0),
  specialist("career", "career", 0, 1),
  specialist("mentor", "career", 1, 1),
  // What the agents read. All read-only, except the two Notion writes the focus panel names.
  source("src-gcal", "Google Calendar", "Read-only", 0),
  source("src-feeds", "News feeds", "Allowlisted", 1),
  source("src-gmail", "Gmail", "Read-only", 2),
  source("src-boards", "Job boards", "Your watchlist", 3),
  source("src-github", "GitHub", "Read-only, your repos", 4),
  source("src-figma", "Figma", "Resume, read-only", 5),
  source("src-notion", "Notion", "Roles and resumes", 6),
  // Quality: no lines. It asks no agent and reads no source; it reads what they logged.
  box("qa", "agent", profile("qa").name, JOB.qa, 338, 908, 300, 64, "qa"),
  // No lines either: you start it from the Career page, one approved application at a time.
  box("apply", "agent", profile("apply").name, JOB.apply, 978, 908, 300, 64, "apply"),
  // The MCP layer, left to right: who signs Claude in, Claude itself, Atlas's MCP server, and what it reads.
  // The agents. No lines: you start them (or the sync does, for a new interview), and they read only your own material.
  box("loop-research", "loop", "Researcher", "Researches one company", 164, 1036, 228, 60),
  box("loop-pitch", "loop", "Tailor", "Tailors one application", 411, 1036, 228, 60),
  box("loop-followup", "loop", "Nudger", "Writes one follow-up", 658, 1036, 228, 60),
  box("loop-prep", "loop", "Coach", "Prepares one interview", 905, 1036, 228, 60),
  box("loop-strategist", "loop", "Planner", "Plans your week", 1152, 1036, 228, 60),
  box("mcp-auth", "client", "Supabase Auth", "OAuth sign-in, your consent", 190, 1158, 250, 60),
  box("mcp-claude", "client", "Claude", "Chat or voice: web, phone, Code", 500, 1158, 250, 60),
  box(MCP_NODE, "connector", "MCP server", "/api/mcp · 9 read-only tools", 820, 1158, 250, 60),
  box("mcp-data", "connector", "Atlas data", "Queue, prep, market, proof…", 1130, 1158, 250, 60),
];

const edge = (from: string, to: string, kind: EdgeKind, label?: string): MapEdge => ({ id: `${from}>${to}`, from, to, kind, ...(label ? { label } : {}) });

export const MAP_EDGES: readonly MapEdge[] = [
  edge("trigger-sync", COS, "trigger"),
  edge("trigger-brief", COS, "trigger"),
  edge("trigger-you", COS, "trigger"),
  // The evening run starts its two agents directly, without a brief.
  edge("trigger-evening", "career", "trigger"),
  edge("trigger-evening", "mentor", "trigger"),
  edge(COS, "calendar", "ask"),
  edge(COS, "news", "ask"),
  edge(COS, "career", "ask"),
  edge(COS, "email", "ask"),
  edge(COS, "finance", "ask"),
  edge(COS, "scout", "ask"),
  edge(COS, "analyst", "ask"),
  edge(COS, "mentor", "ask"),
  edge("src-gcal", "calendar", "read"),
  edge("src-feeds", "news", "read"),
  edge("src-boards", "career", "read"),
  edge("src-boards", "scout", "read"),
  edge("src-github", "scout", "read"),
  edge("src-figma", "career", "read"),
  edge("src-notion", "career", "read"),
  edge("src-notion", "mentor", "read"),
  edge("src-gmail", "email", "read"),
  edge("email", "career", "handoff", "job emails"),
  edge("email", "finance", "handoff", "bills"),
  // The Career desk hands off through shared tables: postings, then the market report.
  edge("scout", "analyst", "handoff", "postings"),
  edge("analyst", "mentor", "handoff", "report"),
  // Where the AI model judges. Without a model these agents use their rules.
  edge(MODEL_NODE, COS, "judge", "brief wording"),
  edge(MODEL_NODE, "analyst", "judge", "report wording"),
  edge(MODEL_NODE, "career", "judge", "job fit, drafts"),
  edge(MODEL_NODE, "mentor", "judge", "insights, role order"),
  // The Apply Agent's one use of the model: a draft answer to a form's own open question.
  edge(MODEL_NODE, "apply", "judge", "form answers"),
  edge(COS, "out-brief", "deliver"),
  edge(COS, "out-pages", "deliver"),
  edge(COS, "out-approvals", "deliver"),
  edge(COS, "out-phone", "deliver"),
  // Claude signs in once through Supabase Auth, then calls Atlas's tools with that token; the tools only read.
  edge("mcp-claude", "mcp-auth", "connect", "sign in, token"),
  edge("mcp-claude", MCP_NODE, "connect", "tool calls"),
  edge(MCP_NODE, "mcp-data", "connect", "reads only"),
];

// ---- where each line runs ----
//
// Lines run at right angles along lanes that no box sits on: a bus under the triggers, a
// bus under the Chief of Staff, a corridor between each desk's columns, a lane between its
// rows, and a bus over the sources. Asks come into a box from the top, reads from the
// bottom, hand-offs from the side, so two kinds of line never share an entry point.

const TRIGGER_BUS = 140;
const ASK_BUS = 380;
const SOURCE_BUS = 697;
const OUT_LANE = 242;
/** Inside the gap between a desk's two rows (533 to 573): asks, AI judgment and reads each get a lane. */
const ROW_LANE = { ask: 545, judge: 553, read: 561 } as const;
/** Inside each desk's corridor: asks on one side, reads on the other. */
const CORRIDOR_SHIFT = { ask: -8, read: 8 } as const;
/** Down the right edge of the Career desk, from the AI model to the agents it judges. */
const JUDGE_X = 1270;

export type Point = readonly [number, number];

const top = (n: MapNode) => n.y - n.h / 2;
const bottom = (n: MapNode) => n.y + n.h / 2;
const deskOf = (n: MapNode) => (n.x < 660 ? DESK.daily : DESK.career);
const backRow = (n: MapNode) => n.y === ROW[1];

/** Spreads several lines that end on one side of a box, so each has its own entry point. */
function spread(list: readonly MapEdge[], e: MapEdge, gap: number): number {
  const i = list.findIndex((x) => x.id === e.id);
  return (i - (list.length - 1) / 2) * gap;
}

/** The corners a line passes through, from its start to its end. */
export function route(e: MapEdge): Point[] {
  const a = node(e.from);
  const b = node(e.to);
  switch (e.kind) {
    case "trigger": {
      if (a.id !== "trigger-evening") return [[a.x, bottom(a)], [a.x, TRIGGER_BUS], [b.x, TRIGGER_BUS], [b.x, top(b)]];
      // Down between the Chief of Staff and the AI model, then in like an ask, a little to the right.
      const x = 910;
      const entry = b.x + 24;
      if (!backRow(b)) return [[x, bottom(a)], [x, ASK_BUS], [entry, ASK_BUS], [entry, top(b)]];
      const c = deskOf(b).corridor + CORRIDOR_SHIFT.ask;
      return [[x, bottom(a)], [x, ASK_BUS], [c, ASK_BUS], [c, ROW_LANE.ask], [entry, ROW_LANE.ask], [entry, top(b)]];
    }
    case "ask": {
      const start: Point = [a.x, bottom(a)];
      if (!backRow(b)) return [start, [a.x, ASK_BUS], [b.x, ASK_BUS], [b.x, top(b)]];
      const c = deskOf(b).corridor + CORRIDOR_SHIFT.ask;
      return [start, [a.x, ASK_BUS], [c, ASK_BUS], [c, ROW_LANE.ask], [b.x, ROW_LANE.ask], [b.x, top(b)]];
    }
    case "read": {
      const out = MAP_EDGES.filter((x) => x.kind === "read" && x.from === a.id);
      const into = MAP_EDGES.filter((x) => x.kind === "read" && x.to === b.id);
      const sx = a.x + spread(out, e, 30);
      const bx = b.x + spread(into, e, 30);
      if (backRow(b)) return [[sx, top(a)], [sx, SOURCE_BUS], [bx, SOURCE_BUS], [bx, bottom(b)]];
      const c = deskOf(b).corridor + CORRIDOR_SHIFT.read;
      return [[sx, top(a)], [sx, SOURCE_BUS], [c, SOURCE_BUS], [c, ROW_LANE.read], [bx, ROW_LANE.read], [bx, bottom(b)]];
    }
    case "handoff": {
      if (a.y === b.y) {
        const right = b.x > a.x;
        return [[right ? a.x + a.w / 2 : a.x - a.w / 2, a.y], [right ? b.x - b.w / 2 : b.x + b.w / 2, b.y]];
      }
      // Down a column: off-center, clear of the ask that comes into the back row's top.
      const x = a.x + 51;
      return [[x, bottom(a)], [x, top(b)]];
    }
    case "judge": {
      if (b.id === COS) return [[a.x - a.w / 2, b.y], [b.x + b.w / 2, b.y]];
      // A box below the desks (the Apply Agent): down the desk's right edge, then in from the right.
      if (b.y > SOURCE_BUS) return [[JUDGE_X, bottom(a)], [JUDGE_X, b.y], [b.x + b.w / 2, b.y]];
      if (!backRow(b)) return [[b.x + 91, bottom(a)], [b.x + 91, top(b)]];
      if (b.x + b.w / 2 >= JUDGE_X - 20) return [[JUDGE_X, bottom(a)], [JUDGE_X, b.y], [b.x + b.w / 2, b.y]];
      return [[JUDGE_X, bottom(a)], [JUDGE_X, ROW_LANE.judge], [b.x + 76, ROW_LANE.judge], [b.x + 76, top(b)]];
    }
    case "connect": {
      // The connector row: boxes side by side, joined straight across.
      const right = b.x > a.x;
      return [[right ? a.x + a.w / 2 : a.x - a.w / 2, a.y], [right ? b.x - b.w / 2 : b.x + b.w / 2, b.y]];
    }
    case "deliver": {
      const into = b.y < OUT_LANE ? bottom(b) : top(b);
      return [[a.x - a.w / 2, OUT_LANE], [b.x, OUT_LANE], [b.x, into]];
    }
  }
}

export const node = (id: string): MapNode => MAP_NODES.find((n) => n.id === id)!;

/** Every edge whose two ends are both in `ids`. */
export function edgesAmong(ids: readonly string[]): string[] {
  const set = new Set(ids);
  return MAP_EDGES.filter((e) => set.has(e.from) && set.has(e.to)).map((e) => e.id);
}

/** What a specialist reads while it works: its sources, and the inbox hand-off from the Email Agent. */
const INPUT_EDGES: Record<AgentId, string[]> = {
  "chief-of-staff": [],
  calendar: ["src-gcal>calendar"],
  news: ["src-feeds>news"],
  career: ["src-boards>career", "src-notion>career", "src-figma>career", "email>career"],
  email: ["src-gmail>email"],
  finance: ["email>finance"],
  scout: ["src-boards>scout", "src-github>scout"],
  analyst: ["scout>analyst"],
  mentor: ["analyst>mentor"],
  qa: [],
  apply: [],
};
const SOURCES: Record<AgentId, string[]> = {
  "chief-of-staff": [],
  calendar: ["src-gcal"],
  news: ["src-feeds"],
  career: ["src-boards", "src-notion", "src-figma"],
  email: ["src-gmail"],
  finance: [],
  scout: ["src-boards", "src-github"],
  analyst: [],
  mentor: [],
  qa: [],
  apply: [],
};

// ---- what the focus panel says about each box ----

/** Plain facts about each box for the panel under the map. Nothing personal: the same for everyone. */
export const NODE_FACTS: Record<string, readonly (readonly [string, string])[]> = {
  "trigger-sync": [["Kind", "Automation: a schedule (Vercel Cron) that fires on its own"], ["Workflow it starts", "2-hour sync"], ["Runs", "Monday to Saturday, every two hours from 6 AM to 4 PM"], ["Starts", "The Chief of Staff, which asks each bot for fresh data"]],
  "trigger-brief": [["Kind", "Automation: a schedule (Vercel Cron) that fires on its own"], ["Workflows it starts", "Morning brief and 2:00 PM brief"], ["Runs", "9:00 AM and 2:00 PM on weekdays, one brief Saturday morning"], ["Starts", "The Chief of Staff, which writes the brief"]],
  "trigger-evening": [["Kind", "Automation: a schedule (Vercel Cron) that fires on its own"], ["Workflow it starts", "Evening run"], ["Runs", "6 PM, Monday to Saturday"], ["Starts", "On Mondays Applications updates your resume text in Notion from Figma; every evening the Career Mentor reviews"]],
  "trigger-you": [["Kind", "Manual: nothing here runs until you press a button"], ["Buttons", "Sync now, Run now, Ask the Career Mentor now, and Refresh and review (Scout, Applications, Analyst, then the Career Mentor)"]],
  "out-brief": [["What", "The Morning, 2:00 PM and Saturday briefs, Hot List first"], ["Catch up", "Today and the two days before it, never before this week's Monday"]],
  "out-pages": [["What", "Today, Inbox, Jobs and the other pages, never more than two hours old"]],
  "out-approvals": [["What", "Everything that would send, apply or change something"], ["Rule", "Nothing goes out until you approve it"]],
  "out-phone": [["What", "An alert on your phone"], ["When", "Only for something urgent"]],
  "chief-of-staff": [["Workflows it runs", "Morning brief, 2:00 PM brief, 2-hour sync, evening run, refresh and review: fixed steps, in order"], ["Reads", "Every bot's report"], ["Delivers", "Briefs, Atlas pages, the apply queues, phone alerts"]],
  calendar: [["Reads", "Google Calendar, read-only"], ["Gives", "Today and the week ahead, conflicts and interviews"]],
  news: [["Reads", "Allowlisted news feeds"], ["Gives", "Nine stories for the brief"]],
  finance: [["Reads", "Bills and payment alerts from the Email bot, and your Renewals list"], ["Gives", "Bills due and deals"]],
  email: [["Reads", "Gmail, headers only"], ["Hands off", "Job emails to Applications, bills to Finance"]],
  scout: [["Reads", "Job boards on your watchlist, and your GitHub repos once a day"], ["Hands off", "Postings to the Analyst"]],
  analyst: [["Reads", "The Scout's postings, your applications and your GitHub projects"], ["Writes", "The market report, your proof project, lessons from your results, and which role an unclear job title belongs to"], ["Hands off", "The market report and lessons to the Career Mentor"]],
  career: [["Reads", "Job boards, Notion roles and resumes, your Figma resume, and the text of job emails and of emails from companies you applied to, for rejections, interview invites and the role"], ["Writes", "Your resume text to Notion at 6 PM on Mondays"], ["Level", "Junior to 2 years asked at most; senior roles are ignored"], ["Runs", "Atlas's agents: the Researcher, Tailor, Coach, Planner and Nudger"], ["Never", "Submits an application for you"]],
  mentor: [["Reads", "The market report, your proof project, lessons from your results, your Action Taken notes, your GitHub projects and target roles; once a month a web search per role (Firecrawl, snippets only)"], ["Writes", "Role profiles and descriptions; your role order in Atlas only after you approve it"]],
  qa: [["Reads", "The activity log, saved briefs, eval scores, connections and your queues. Counts and times, never content"], ["Gives", "A ranked weekly review on Mission Control, each finding with a suggested fix"], ["Never", "Changes anything, or uses the AI model"]],
  apply: [["Answers", "The form you are looking at, for Atlas Autofill in Safari: from your answer bank, your fixed answers and your resume"], ["When", "Only when you press Help me apply; you review every answer"], ["Never", "Submits, clicks or signs in anywhere: you submit every application yourself"]],
  "loop-research": [["Kind", "Agent · tool-using loop with a reviewer and a judge"], ["Does", "Looks one company up on the public web, choosing its own next search or page, and writes what it does, why them, your angle and what to ask"], ["Tools", "readJob, companyNews, searchWeb, readPage, checkLines"], ["Limits", "3 searches, 3 pages, 12 steps and 8 AI calls a run; inside Firecrawl's monthly budget"], ["Runs", "Every night for your top picks (night shift), or Research this company"], ["Never", "Reads LinkedIn, Indeed or Glassdoor, opens a page its own search did not return, or states a number its sources lack"]],
  "loop-pitch": [["Kind", "Agent · tool-using loop with a reviewer and a judge"], ["Does", "Maps each must-have of one queued job to proof from your resume or names a gap, proposes up to 3 resume swaps in the posting's words, drafts a note"], ["Tools", "readJob, readResume, findEvidence, checkClaims"], ["Limits", "12 steps and 10 AI calls a run; rules version when AI is off"], ["Never", "Edits your resume or sends anything"]],
  "loop-followup": [["Kind", "Agent · tool-using loop with a reviewer and a judge"], ["Does", "Rewrites a waiting follow-up with one specific, true reason to reply, from saved research or the pitch, and greets someone you know there"], ["Tools", "readApplication, readResearch, readPitch, findPerson, checkDraft"], ["Limits", "10 steps and 6 AI calls a run; two a night; the template stands when it cannot do better"], ["Runs", "Every night (night shift), or Rewrite with agent in the Apply Queue"], ["Never", "Sends an email or uses an email address"]],
  "loop-strategist": [["Kind", "Agent · tool-using loop with a reviewer and a judge"], ["Does", "Reads your funnel, queue, applications, market, proof project and last week, and proposes exactly three moves for the week, each citing its numbers"], ["Tools", "readFunnel, readQueue, readLastWeek, readApplications, readMarket, readProof, checkPlan"], ["Limits", "12 steps and 9 AI calls a run; rules version when AI is off"], ["Runs", "Sunday night (night shift), or Plan my week on Growth"], ["Never", "Puts anything on your days before you approve"]],
  "loop-prep": [["Kind", "Agent · tool-using loop with a reviewer and a judge"], ["Does", "Likely questions for one interview, a true story for each from your material, honest gaps, questions to ask"], ["Tools", "readJob, readCompany, findStory, checkClaims"], ["Limits", "14 steps and 10 AI calls a run; one new interview per sync"], ["Never", "Invents a story or a number, or sends anything"]],
  "mcp-claude": [["What", "Claude on the web, the Mac app, the phone app (voice mode included) or Claude Code, talking with you about your job search"], ["Reads Atlas", "Only through the MCP server, with a token you approved"], ["Never", "Sends, applies or changes anything in Atlas"]],
  "mcp-auth": [["What", "Supabase Auth acting as the OAuth 2.1 server: Claude registers itself, you approve it once on Atlas's consent page"], ["Who", "Only the owner's account, signed in with the second factor"], ["Revoke", "Settings, Connect Claude"]],
  [MCP_NODE]: [["Endpoint", "/api/mcp, stateless Streamable HTTP, a fresh server per request"], ["Checks", "The OAuth token is the owner's, Claude access is on in Settings, 60 requests per 10 minutes"], ["Tools", "9, all read-only, each with a 10-second limit and an audit entry"], ["Guide", "docs/MCP-BUILD.md"]],
  "mcp-data": [["Reads", "Apply Queue, applications, the funnel, the market report and role profiles, the proof project, Tailor and Coach packets, resume and project passages"], ["Removed", "Email addresses and phone numbers, before anything leaves Atlas"], ["Never", "A write: the tools file is checked for one in CI"]],
  [MODEL_NODE]: [["Guardrails", "Judges inside the rules' bounds. Every change still waits for your approval. The key stays in Vercel and is never logged."]],
  "src-gcal": [["Access", "Read-only"], ["Read by", "Calendar"]],
  "src-feeds": [["Access", "Allowlisted sites only"], ["Read by", "News"]],
  "src-gmail": [["Access", "Read-only. Headers for the inbox; the text of job emails and companies you applied to only, never kept"], ["Read by", "Email (headers), Applications (job emails, by rules)"]],
  "src-boards": [["Access", "Public feeds. LinkedIn, Indeed and Glassdoor stay semi-automated"], ["Read by", "Scout, Applications"]],
  "src-github": [["Access", "Read-only token, the repos you chose"], ["Read by", "Scout. The Career Mentor uses it as evidence"]],
  "src-figma": [["Access", "Read-only token"], ["Read by", "Applications, at 6 PM"]],
  "src-notion": [["Access", "Reads roles and resumes. Writes your resume text and the role order you approve"], ["Used by", "Applications, Career Mentor"]],
};

/** The boxes joined to this one by a line: what stays bright when you focus a box. */
export function related(id: string): string[] {
  const out = new Set([id]);
  for (const e of MAP_EDGES) {
    if (e.from === id) out.add(e.to);
    if (e.to === id) out.add(e.from);
  }
  return [...out];
}

// ---- reading the activity log ----

/** The Chief of Staff's runs that orchestrate the team: the 2-hour sync and the briefs. */
const BRIEF_TASKS: readonly string[] = Object.values(SLOT_LABEL);
export const missionKind = (task: string): "sync" | "brief" | null => (task === SYNC_TASK ? "sync" : BRIEF_TASKS.includes(task) ? "brief" : null);

/** A run that started this long ago and never logged an ending did not finish. */
export const STALL_MS = 3 * 60_000;

export interface LiveStep {
  name: string;
  ms: number;
  ok: boolean;
  /** Only when details are shown. */
  note?: string;
}

export interface LiveRun {
  runId: string;
  agent: AgentId;
  task: string;
  trigger: AgentRunEvent["trigger"];
  /** "started" means it is running right now; "stalled" means it started and never finished. */
  status: RunStatus | "stalled";
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  /** Only when details are shown. */
  detail?: string;
  steps: LiveStep[];
}

/** One entry per run (a "started" row and its ending row share a run id), newest first. */
export function groupRuns(rows: readonly AgentRunEvent[], nowMs: number, detail: boolean): LiveRun[] {
  const byRun = new Map<string, { start?: AgentRunEvent; end?: AgentRunEvent }>();
  for (const r of rows) {
    const slot = byRun.get(r.runId) ?? {};
    if (r.status === "started") slot.start ??= r;
    else if (!slot.end || r.at > slot.end.at) slot.end = r;
    byRun.set(r.runId, slot);
  }
  const runs: LiveRun[] = [];
  for (const [runId, { start, end }] of byRun) {
    const row = (end ?? start)!;
    const durationMs = end?.durationMs ?? (start && end ? Math.max(0, Date.parse(end.at) - Date.parse(start.at)) : null);
    const startedAt = start?.at ?? (end && end.durationMs ? new Date(Date.parse(end.at) - end.durationMs).toISOString() : null);
    const status: LiveRun["status"] = end ? end.status : nowMs - Date.parse(start!.at) > STALL_MS ? "stalled" : "started";
    const steps = (end?.trace ?? []).map((s: TraceStep): LiveStep => ({ name: s.name, ms: s.ms, ok: s.ok, ...(detail && s.note ? { note: s.note } : {}) }));
    runs.push({ runId, agent: row.agent, task: row.task, trigger: row.trigger, status, startedAt, endedAt: end?.at ?? null, durationMs, ...(detail && end?.detail ? { detail: end.detail } : {}), steps });
  }
  const when = (r: LiveRun) => r.endedAt ?? r.startedAt ?? "";
  return runs.sort((a, b) => when(b).localeCompare(when(a)));
}

export type NodeState = "idle" | "running" | "ok" | "failed" | "skipped" | "stalled" | "paused";

export interface AgentLive {
  agent: AgentId;
  state: NodeState;
  paused: boolean;
  /** The task of its latest run. */
  task: string;
  /** When its latest run ended (or started, while it runs). */
  at: string | null;
  durationMs: number | null;
}

/** The latest sync or brief, with the specialists' runs that belong to it. */
export interface Mission {
  kind: "sync" | "brief";
  run: LiveRun;
  members: LiveRun[];
  /** Output boxes this run delivered to. Empty until it succeeds. */
  delivered: string[];
}

export interface LiveSnapshot {
  /** Server time when this was built. */
  at: string;
  /** True when run details and step notes are included. */
  detail: boolean;
  agents: AgentLive[];
  mission: Mission | null;
  /** The latest runs, newest first, without their steps. */
  feed: LiveRun[];
  nextSync: string;
  nextBrief: string;
  /** Calls to the AI model today against the daily limit, for the AI model's box. */
  aiCalls?: { used: number; limit: number };
  /** Atlas's agents: each one's latest run, from the activity log (by task name). */
  loops?: Record<string, { state: NodeState; at: string | null }>;
  /** Claude's MCP connector today, from the audit log: counts and times only. */
  mcp?: McpLive;
}

/** What the MCP server's box shows: whether Claude access is on, and today's calls. */
export interface McpLive {
  on: boolean;
  state: NodeState;
  calls: number;
  errors: number;
  /** The latest call today, or null. */
  lastAt: string | null;
}

/**
 * The MCP box's state from today's audit rows (action "mcp.<tool>"): blue while Claude read in the
 * last 90 seconds, red when the latest call failed, green after calls, grey when there were none,
 * dashed (paused) when Claude access is off.
 */
/** Your own MCP actions in the audit log (the switch, revoking an app): not Claude's reads. Consent rows have a dot and never match. */
const MCP_OWNER_ACTIONS = new Set(["mcp.enabled", "mcp.disabled", "mcp.revoke"]);

export function mcpLive(on: boolean, events: readonly { action: string; outcome: string; at: string }[], now: Date, since: string): McpLive {
  const calls = events.filter((e) => /^mcp\.[a-z_]+$/.test(e.action) && !MCP_OWNER_ACTIONS.has(e.action) && e.at >= since).sort((a, b) => b.at.localeCompare(a.at));
  const last = calls[0] ?? null;
  const errors = calls.filter((e) => e.outcome === "error").length;
  const state: NodeState = !on ? "paused" : !last ? "idle" : now.getTime() - Date.parse(last.at) < 90_000 ? "running" : last.outcome === "error" ? "failed" : "ok";
  return { on, state, calls: calls.length, errors, lastAt: last?.at ?? null };
}

const STATE: Record<LiveRun["status"], NodeState> = { started: "running", succeeded: "ok", failed: "failed", skipped: "skipped", stalled: "stalled" };
const AGENT_ORDER: readonly AgentId[] = ["chief-of-staff", "calendar", "news", "finance", "email", "career", "scout", "analyst", "mentor"];

function missionFrom(runs: readonly LiveRun[]): Mission | null {
  const run = runs.find((r) => r.agent === "chief-of-staff" && missionKind(r.task));
  if (!run) return null;
  const from = run.startedAt ? Date.parse(run.startedAt) - 2000 : null;
  const to = run.endedAt ? Date.parse(run.endedAt) + 2000 : Infinity;
  const members =
    from === null
      ? []
      : runs
          .filter((r) => r.agent !== "chief-of-staff" && r.trigger === run.trigger)
          .filter((r) => {
            const t = Date.parse(r.startedAt ?? r.endedAt ?? "");
            return t >= from && t <= to;
          });
  const delivered: string[] = [];
  if (run.status === "succeeded") {
    delivered.push("out-pages");
    if (missionKind(run.task) === "brief") delivered.push("out-brief");
    if (members.some((m) => m.agent === "career" && m.status === "succeeded")) delivered.push("out-approvals");
    if (run.steps.some((s) => /ping your phone/i.test(s.name))) delivered.push("out-phone");
  }
  return { kind: missionKind(run.task)!, run, members, delivered };
}

export function liveSnapshot(input: { rows: readonly AgentRunEvent[]; paused: readonly AgentId[]; now: Date; detail: boolean; nextSync: string; nextBrief: string; aiCalls?: { used: number; limit: number }; mcp?: McpLive }): LiveSnapshot {
  const runs = groupRuns(input.rows, input.now.getTime(), input.detail);
  const agents = AGENT_ORDER.map((id): AgentLive => {
    const last = runs.find((r) => r.agent === id);
    const paused = input.paused.includes(id);
    const state: NodeState = last?.status === "started" ? "running" : paused ? "paused" : last ? STATE[last.status] : "idle";
    return { agent: id, state, paused, task: last?.task ?? "", at: last ? (last.endedAt ?? last.startedAt) : null, durationMs: last?.durationMs ?? null };
  });
  // Atlas's agents log under the Applications bot: each one's latest run is found by its task name.
  const loops = Object.fromEntries(
    LOOP_AGENTS.map((a) => {
      const last = runs.find((r) => r.task === a.task);
      return [`loop-${a.id}`, { state: (last ? (last.status === "started" ? "running" : STATE[last.status]) : "idle") as NodeState, at: last ? (last.endedAt ?? last.startedAt) : null }];
    }),
  );
  return {
    at: input.now.toISOString(),
    detail: input.detail,
    agents,
    loops,
    mission: missionFrom(runs),
    feed: runs.slice(0, 10).map((r) => ({ ...r, steps: [] })),
    nextSync: input.nextSync,
    nextBrief: input.nextBrief,
    ...(input.aiCalls ? { aiCalls: input.aiCalls } : {}),
    ...(input.mcp ? { mcp: input.mcp } : {}),
  };
}

// ---- what to light up ----

/** Tasks the 6 PM evening run starts. */
export const EVENING_TASKS: readonly string[] = ["Resume sync (Figma to Notion)", "Mentor: evening review", "Mentor: target roles review"];

export interface Highlights {
  nodes: string[];
  edges: string[];
}

/** How long a finished run's deliveries stay lit. */
export const DELIVER_MS = 25_000;

export function triggerNode(run: Pick<LiveRun, "task" | "trigger">): string {
  if (run.trigger !== "schedule") return "trigger-you";
  return missionKind(run.task) === "brief" ? "trigger-brief" : "trigger-sync";
}

/** Live mode: everything that is working right now, and what a run just delivered. */
export function liveHighlights(snap: LiveSnapshot, nowMs: number): Highlights {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const running = snap.agents.filter((a) => a.state === "running").map((a) => a.agent);
  const orchestrating = snap.mission?.run.status === "started";
  if (orchestrating) {
    const t = triggerNode(snap.mission!.run);
    nodes.add(t).add(COS);
    edges.add(`${t}>${COS}`);
  }
  for (const id of running) {
    nodes.add(id);
    if (id === "chief-of-staff") continue;
    if (orchestrating) edges.add(`${COS}>${id}`);
    // The evening run starts Applications and the Career Mentor on its own schedule.
    const a = snap.agents.find((x) => x.agent === id);
    if (!orchestrating && (id === "career" || id === "mentor") && a && EVENING_TASKS.includes(a.task)) {
      nodes.add("trigger-evening");
      edges.add(`trigger-evening>${id}`);
    }
    for (const s of SOURCES[id]) nodes.add(s);
    for (const e of INPUT_EDGES[id]) edges.add(e);
  }
  const m = snap.mission;
  if (m && m.run.endedAt && nowMs - Date.parse(m.run.endedAt) < DELIVER_MS) {
    for (const out of m.delivered) {
      nodes.add(out);
      edges.add(`${COS}>${out}`);
    }
  }
  return { nodes: [...nodes], edges: [...edges] };
}

// ---- replay ----

const ASKED: [RegExp, AgentId][] = [
  [/ask the email (agent|bot)/i, "email"],
  [/ask the calendar (agent|bot)/i, "calendar"],
  [/ask the news (agent|bot)/i, "news"],
  [/ask the (career|applications) (agent|bot)/i, "career"],
  [/ask the scout/i, "scout"],
  [/ask the analyst/i, "analyst"],
  [/ask the mentor/i, "mentor"],
  [/ask the finance (agent|bot)/i, "finance"],
];
/** The specialist a Chief of Staff step hands work to, if any. */
export const askedAgent = (step: string): AgentId | null => ASKED.find(([re]) => re.test(step))?.[1] ?? null;

const TOUCHES: [RegExp, string[]][] = [
  [/notion/i, ["src-notion", "career"]],
  [/read gmail/i, ["src-gmail"]],
  [/google calendar/i, ["src-gcal"]],
  [/allowlisted feeds/i, ["src-feeds"]],
  [/job feeds/i, ["src-boards"]],
  [/github/i, ["src-github"]],
  [/figma/i, ["src-figma"]],
  [/inbox the email (agent|bot) synced|job emails/i, ["email"]],
  [/queue follow-ups/i, ["out-approvals"]],
  [/save the brief/i, ["out-brief"]],
  [/ping your phone/i, ["out-phone"]],
];
/** The other boxes a step touches, read from its name. */
export function stepNodes(step: string): string[] {
  return [...new Set(TOUCHES.filter(([re]) => re.test(step)).flatMap(([, ids]) => ids))];
}

export interface Frame {
  /** Whose step this is. */
  actor: AgentId;
  title: string;
  nodes: string[];
  edges: string[];
  /** True when results travel back up an edge (a specialist reporting to the Chief of Staff). */
  reverse: boolean;
  /** How long the real step took. Null for a frame that is not a step. */
  ms: number | null;
  ok: boolean;
  note?: string;
  /** How long the frame stays on screen. */
  playMs: number;
}

/** Real steps take milliseconds; a frame stays long enough to read, longer for slower steps. */
const playFor = (ms: number | null) => 1500 + Math.min(1500, Math.round((ms ?? 0) / 2));

const TRIGGER_LINE: Record<string, string> = { "trigger-sync": "The schedule starts the", "trigger-brief": "The schedule starts the", "trigger-you": "You started the" };

/** A finished sync or brief, step by step, in the order it happened. */
export function framesFor(m: Mission): Frame[] {
  const frames: Frame[] = [];
  const add = (f: Omit<Frame, "playMs" | "reverse"> & { reverse?: boolean }) => frames.push({ ...f, reverse: f.reverse ?? false, playMs: playFor(f.ms) });
  const t = triggerNode(m.run);
  add({ actor: "chief-of-staff", title: `${TRIGGER_LINE[t]} ${m.run.task}`, nodes: [t, COS], edges: [`${t}>${COS}`], ms: null, ok: true });

  const used = new Set<string>();
  for (const s of m.run.steps) {
    const who = askedAgent(s.name);
    if (!who) {
      const nodes = [COS, ...stepNodes(s.name)];
      add({ actor: "chief-of-staff", title: s.name, nodes, edges: edgesAmong(nodes), ms: s.ms, ok: s.ok, ...(s.note ? { note: s.note } : {}) });
      continue;
    }
    const name = spokenName(profile(who));
    const ask = `${COS}>${who}`;
    add({ actor: "chief-of-staff", title: `Chief of Staff asks the ${name}`, nodes: [COS, who], edges: [ask], ms: null, ok: true });
    const member = m.members.find((r) => r.agent === who && !used.has(r.runId));
    if (member) used.add(member.runId);
    for (const step of member?.steps ?? []) {
      const nodes = [who, ...stepNodes(step.name)];
      add({ actor: who, title: step.name, nodes, edges: edgesAmong(nodes), ms: step.ms, ok: step.ok, ...(step.note ? { note: step.note } : {}) });
    }
    const skipped = member?.status === "skipped";
    add({ actor: who, title: skipped ? `${name} skipped this run` : `${name} reports back`, nodes: [who, COS], edges: [ask], reverse: true, ms: s.ms, ok: s.ok && member?.status !== "failed", ...(s.note ? { note: s.note } : {}) });
  }

  if (m.run.status === "succeeded" && m.delivered.length > 0) {
    add({ actor: "chief-of-staff", title: m.kind === "brief" ? "The brief is delivered" : "Every page in Atlas is fresh", nodes: [COS, ...m.delivered], edges: m.delivered.map((d) => `${COS}>${d}`), ms: m.run.durationMs, ok: true });
  } else if (m.run.status !== "succeeded") {
    add({ actor: "chief-of-staff", title: m.run.status === "failed" ? `The ${m.run.task} failed` : `The ${m.run.task} did not finish`, nodes: [COS], edges: [], ms: m.run.durationMs, ok: false });
  }
  return frames;
}

// ---- pacing and wording ----

/**
 * How long to wait before asking the server again: quickly while agents work, a little
 * slower just after, and slowly when nothing has happened for a while. A screen left on
 * all day then costs a few requests a minute, not twenty.
 */
export function pollDelay(snap: LiveSnapshot, nowMs: number): number {
  if (snap.agents.some((a) => a.state === "running")) return 2500;
  const latest = snap.feed[0];
  const at = latest ? Date.parse(latest.endedAt ?? latest.startedAt ?? "") : NaN;
  if (Number.isFinite(at) && nowMs - at < 2 * 60_000) return 5000;
  return 15_000;
}

/** "just now", "4 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string | null, nowMs: number): string {
  if (!iso) return "";
  const sec = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** "850 ms", "4.2 s", "1 min 5 s". */
export function took(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export const STATE_WORD: Record<NodeState, string> = { idle: "No runs yet", running: "Working…", ok: "Done", failed: "Failed", skipped: "Skipped", stalled: "Did not finish", paused: "Paused" };
