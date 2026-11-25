// The Data Map: the job-market data pipeline drawn as boxes and lines, like the Live Map draws
// the bots. Five columns, left to right: sources -> the Scout -> cleaning -> stored -> shown.
// A line's width follows the postings that flow along it in the latest run (a Sankey-style
// flow), so where data comes from, and where it is set aside, can be seen at a glance.
//
// Pure: the latest run's numbers in, boxes and lines out. The client lights them up from the
// activity log (a Scout run in progress) and replays the last run step by step.

import type { PipelineView } from "./pipelineView";
import type { LocalDate } from "./types";

export type DataNodeKind = "source" | "bot" | "stage" | "table" | "view" | "benchmark";
/** What a box is, in Atlas's palette: Career orange, Data purple, AI pink, System and connectors yellow. */
export type DataHue = "career" | "data" | "ai" | "system";
export type DataState = "ok" | "idle" | "off" | "down" | "none";

export interface DataNode {
  id: string;
  kind: DataNodeKind;
  label: string;
  /** The live number shown in the box, already worded ("2,547 read"). */
  count: string;
  /** A second quiet line. */
  sub: string;
  state: DataState;
  x: number;
  y: number;
  w: number;
  h: number;
  /** What the details panel says about it. */
  facts: [string, string][];
  /** Its color in Atlas's palette. */
  hue: DataHue;
  /** Who works on it, as a short tag on the box ("Bot", "Bot · AI"). */
  who?: string;
}

export interface DataEdge {
  id: string;
  from: string;
  to: string;
  /** Postings along this line in the latest run; null for a line with no count (benchmarks, views). */
  flow: number | null;
  dashed?: boolean;
  label?: string;
}

export const DATA_MAP_SIZE = { w: 1240, h: 760 } as const;
const COL = { source: 110, bot: 360, stage: 600, table: 850, view: 1100 } as const;
const fmt = (n: number) => n.toLocaleString("en-US");
const pct = (x: number) => `${Math.round(x * 100)}%`;

export interface DataMapInput {
  view: PipelineView;
  sourcesOff: readonly string[];
  benchmarks: { points: number; latest: LocalDate | null; fred: boolean };
  historyDays: number;
}

export function dataMap(i: DataMapInput): { nodes: DataNode[]; edges: DataEdge[]; maxFlow: number } {
  const { view } = i;
  const stage = (id: string) => view.stages.find((s) => s.id === id);
  const read = stage("read")?.count ?? 0;
  const tech = stage("filter")?.count ?? 0;
  const recorded = stage("dedupe")?.count ?? 0;
  const dropped = (id: string) => stage(id)?.dropped ?? [];
  const nodes: DataNode[] = [];
  const edges: DataEdge[] = [];

  // Sources: one box each, stacked down the left.
  const n = view.sources.length;
  const top = 70;
  const gap = Math.min(62, (DATA_MAP_SIZE.h - 200) / Math.max(1, n));
  view.sources.forEach((s, k) => {
    const off = i.sourcesOff.includes(s.name);
    const state: DataState = off ? "off" : s.ok ? "ok" : s.idle ? "idle" : view.lastRun ? "down" : "none";
    nodes.push({
      id: `src:${s.name}`,
      kind: "source",
      hue: "system",
      label: s.name,
      count: off ? "Off" : s.ok ? `${fmt(s.read)} read` : s.idle ? "Not this run" : view.lastRun ? "No postings" : "No run yet",
      sub: s.ok ? `${fmt(s.tech)} tech · ${s.tech ? pct(s.withPay / s.tech) : "0%"} pay` : off ? "Turned off on Data Pipeline" : s.idle ? "Once a day, with its key" : "",
      state,
      x: COL.source,
      y: top + k * gap + gap / 2,
      w: 190,
      h: Math.min(52, gap - 8),
      facts: [
        ["Last run", s.ok ? `${fmt(s.read)} postings read, ${fmt(s.tech)} tech, ${fmt(s.withPay)} with pay` : off ? "Not read: you turned it off" : s.idle ? "Not read this run: once a day, and only with its key" : "No postings"],
        ["Status", off ? "Off" : s.ok ? "Answering" : s.idle ? "Idle by design" : "Did not answer"],
      ],
    });
    if (!off) edges.push({ id: `src:${s.name}>scout`, from: `src:${s.name}`, to: "scout", flow: s.ok ? s.read : 0 });
  });

  // The Scout, the one bot that writes this data.
  nodes.push({
    id: "scout",
    kind: "bot",
    hue: "career",
    who: "Bot · rules",
    label: "Scout",
    count: `${fmt(read)} read`,
    sub: view.lastRun ? `Last run ${view.lastRun}${view.fresh ? " · today" : ""}` : "No run yet",
    state: view.lastRun ? "ok" : "none",
    x: COL.bot,
    y: 300,
    w: 200,
    h: 84,
    facts: [
      ["Kind", "Bot · rules only, no AI model"],
      ["Runs", "Every 2-hour sync, Monday to Saturday; Sync now"],
      ["Writes", "tech_postings, market_daily, market_quality, market_postings, market_benchmarks"],
    ],
  });

  // Cleaning: what is kept, and what is set aside at each step.
  const filterOut = dropped("filter");
  const dedupeOut = dropped("dedupe");
  nodes.push({
    id: "filter",
    kind: "stage",
    hue: "data",
    label: "Tech, full-time, U.S.",
    count: `${fmt(tech)} kept`,
    sub: filterOut.length ? `−${fmt(filterOut.reduce((s, d) => s + d.n, 0))} set aside` : "",
    state: view.lastRun ? "ok" : "none",
    x: COL.stage,
    y: 200,
    w: 210,
    h: 70,
    facts: [["Labels", "Role family, level, work mode, region, yearly pay"], ...filterOut.map((d): [string, string] => [`Set aside: ${d.reason}`, fmt(d.n)])],
  });
  nodes.push({
    id: "dedupe",
    kind: "stage",
    hue: "data",
    label: "Duplicates merged",
    count: `${fmt(recorded)} jobs`,
    sub: dedupeOut.length ? `−${fmt(dedupeOut[0]!.n)} same job elsewhere` : "",
    state: view.lastRun ? "ok" : "none",
    x: COL.stage,
    y: 330,
    w: 210,
    h: 70,
    facts: [["Rule", "Same company, title and region from two sources is one job"], ...dedupeOut.map((d): [string, string] => ["Merged", fmt(d.n)])],
  });
  edges.push({ id: "scout>filter", from: "scout", to: "filter", flow: read });
  edges.push({ id: "filter>dedupe", from: "filter", to: "dedupe", flow: tech });

  // Stored.
  const tableNode = (id: string, label: string, count: string, sub: string, y: number, facts: [string, string][]): DataNode => ({ id, kind: "table", hue: "data", label, count, sub, state: "ok", x: COL.table, y, w: 200, h: 66, facts });
  const stored = stage("store")?.count ?? 0;
  nodes.push(tableNode("tech_postings", "tech_postings", `${fmt(stored)} jobs`, "Kept 60 days after last seen", 210, [["Holds", "One cleaned row per tech job"], ["Kept", "60 days after it was last seen"]]));
  nodes.push(tableNode("market_daily", "market_daily", `${fmt(i.historyDays)} days`, "Daily summary, kept for good", 320, [["Holds", "Active, new, gone and median pay per day, family, level and region"], ["Kept", "For good"]]));
  nodes.push(tableNode("market_postings", "market_postings", `${fmt(view.yours.postings)} for your roles`, "The older your-roles record", 450, [["Holds", "Postings for your target roles only"], ["Read by", "The Analyst, the Career Mentor and your matches"]]));
  nodes.push(tableNode("market_benchmarks", "market_benchmarks", `${fmt(i.benchmarks.points)} values`, i.benchmarks.latest ? `Latest ${i.benchmarks.latest}` : "Weekly, Mondays", 600, [["Holds", "BLS JOLTS and OEWS pay; FRED when its key is set"], ["Read", "Weekly, Monday evening run"]]));
  edges.push({ id: "dedupe>tech_postings", from: "dedupe", to: "tech_postings", flow: recorded });
  edges.push({ id: "tech_postings>market_daily", from: "tech_postings", to: "market_daily", flow: null, label: "summed daily" });
  edges.push({ id: "scout>market_postings", from: "scout", to: "market_postings", flow: null, label: "your roles" });

  // The national benchmarks, a side branch with its own source.
  nodes.push({ id: "bls", kind: "benchmark", hue: "system", label: "BLS · FRED", count: i.benchmarks.fred ? "Both set" : "BLS set · FRED not", sub: "Public statistics", state: "ok", x: COL.source, y: 680, w: 190, h: 52, facts: [["What", "JOLTS openings, hires, quits; OEWS pay; Indeed postings index (FRED)"], ["When", "Mondays"]] });
  edges.push({ id: "bls>market_benchmarks", from: "bls", to: "market_benchmarks", flow: null, dashed: true, label: "weekly" });

  // Shown.
  const viewNode = (id: string, label: string, sub: string, y: number, hue: DataHue, extra: { who?: string; facts?: [string, string][] } = {}): DataNode => ({ id, kind: "view", hue, label, count: "", sub, state: "ok", x: COL.view, y, w: 200, h: 56, facts: [["Shows", sub], ...(extra.facts ?? [])], ...(extra.who ? { who: extra.who } : {}) });
  nodes.push(viewNode("market", "Market page", "The tech market snapshot", 240, "career"));
  nodes.push(viewNode("mission", "Mission Control", "Timeline and Pipeline", 360, "system"));
  nodes.push(
    viewNode("analyst", "Analyst · Career Mentor", "Your market report and advice", 470, "ai", {
      who: "Bots · AI",
      facts: [
        ["Kind", "Two Career bots, AI-assisted: rules decide the steps, the AI model makes bounded judgments"],
        ["AI", "Sorts job titles the rules cannot place into your six roles (Gemini), words the market report, and the Career Mentor's advice and weekly Career Map"],
      ],
    }),
  );
  nodes.push(viewNode("national", "National trend", "On the Market page", 600, "career"));
  edges.push({ id: "tech_postings>market", from: "tech_postings", to: "market", flow: null });
  edges.push({ id: "market_daily>market", from: "market_daily", to: "market", flow: null });
  edges.push({ id: "market_daily>mission", from: "market_daily", to: "mission", flow: null });
  edges.push({ id: "market_postings>analyst", from: "market_postings", to: "analyst", flow: null });
  edges.push({ id: "market_benchmarks>national", from: "market_benchmarks", to: "national", flow: null, dashed: true });

  return { nodes, edges, maxFlow: Math.max(1, ...edges.map((e) => e.flow ?? 0)) };
}

/**
 * The replay: the Scout's stages in the order lib/agents/scout.ts runs them. "sources" means the
 * sources that answered, plus the Scout.
 */
export const REPLAY: readonly { nodes: string[] | "sources"; title: string }[] = [
  { nodes: "sources", title: "1. The Scout reads every source that is on" },
  { nodes: ["scout", "market_postings", "analyst"], title: "2. Postings for your roles go to the older record, for the Analyst and Career Mentor" },
  { nodes: ["scout", "filter"], title: "3. Every posting is labeled; non-tech, contract and non-U.S. ones are set aside" },
  { nodes: ["filter", "dedupe"], title: "4. The same job from two sources is merged into one" },
  { nodes: ["dedupe", "tech_postings"], title: "5. The jobs are stored; ones unseen for 60 days are removed" },
  { nodes: ["tech_postings", "market_daily"], title: "6. Today's summary is computed again from what is stored" },
  { nodes: ["tech_postings", "market_daily", "market", "mission"], title: "7. The Market page and Mission Control show the result" },
];
