// The Data Pipeline section: your settings for the job-market data, the setup steps worked out
// from the pipeline's real state, and the Data Mentor's advice.
//
// Rules first, AI for judgment: the steps and their "done" states are rules. The mentor (Gemini,
// through lib/ai/model.ts) may rank and word advice, but every piece of advice must cite facts
// from the list it was given, and any number it writes must be one of those facts' values: the
// rules check (critique) drops the rest, and a second pass (refine) may fix what was dropped.
// The mentor sees numbers and source names only, never scraped text, so a posting cannot
// instruct it. It recommends; it never changes a setting.
//
// Pure: no I/O.

import { z } from "zod";
import { JOB_SOURCES } from "./jobSources";
import { TypeCheckSchema, type TypeCheck } from "./typeCheck";
import type { RunQuality } from "./techMarket";

// ---- your settings ----

export const DETAIL_MODES = ["daily", "every-sync", "off"] as const;
export type DetailMode = (typeof DETAIL_MODES)[number];
export const DETAIL_LABEL: Record<DetailMode, string> = { daily: "Once a day (first sync)", "every-sync": "Every 2-hour sync", off: "Off: titles only" };

export const FLOOR_KEYS = ["pay", "skills", "level", "sources"] as const;
export type FloorKey = (typeof FLOOR_KEYS)[number];
export const FLOOR_LABEL: Record<FloorKey, string> = { pay: "States pay", skills: "Names a skill", level: "States a level", sources: "Sources answering" };

export interface MentorAdvice {
  title: string;
  why: string;
  action: string;
  /** Keys of the facts it rests on. */
  cites: string[];
  /** The setup step it belongs to, when it does. */
  step?: StepId;
}

export interface MentorReview {
  at: string;
  /** "gemini" when the model's advice passed the check, "rules" when the rules wrote it. */
  writer: "model" | "rules";
  focus: StepId | null;
  advice: MentorAdvice[];
  /** What the check dropped, in words. */
  dropped: number;
}

export interface DataPipelineConfig {
  sourcesOff: string[];
  floors: Record<FloorKey, number>;
  companyCap: number;
  details: DetailMode;
  /** Steps you marked as reviewed (the ones no number can finish). */
  reviewed: StepId[];
  review?: MentorReview;
  typeCheck?: TypeCheck;
}

export const PIPELINE_DEFAULTS: DataPipelineConfig = { sourcesOff: [], floors: { pay: 0.25, skills: 0.5, level: 0.25, sources: 0.75 }, companyCap: 25, details: "daily", reviewed: [] };

export const STEP_IDS = ["watchlist", "details", "sources", "benchmarks", "adzuna", "floors"] as const;
export type StepId = (typeof STEP_IDS)[number];

const Floor = z.number().min(0).max(1);
const Advice = z.object({ title: z.string().min(3).max(120), why: z.string().min(3).max(400), action: z.string().min(3).max(240), cites: z.array(z.string().max(40)).max(6), step: z.enum(STEP_IDS).optional() });
export const ConfigSchema = z.object({
  sourcesOff: z.array(z.string().max(80)).max(20).default([]),
  floors: z.object({ pay: Floor, skills: Floor, level: Floor, sources: Floor }).default(PIPELINE_DEFAULTS.floors),
  companyCap: z.number().int().min(5).max(200).default(25),
  details: z.enum(DETAIL_MODES).default("daily"),
  reviewed: z.array(z.enum(STEP_IDS)).max(10).default([]),
  review: z.object({ at: z.string().max(40), writer: z.enum(["model", "rules"]), focus: z.enum(STEP_IDS).nullable(), advice: z.array(Advice).max(6), dropped: z.number().int().min(0) }).optional(),
  /** The last AI check of the engineering-type labels (lib/domain/typeCheck.ts). */
  typeCheck: TypeCheckSchema.optional(),
});

/** Your settings, with defaults for anything missing or malformed: a bad value never stops a sync. */
export function pipelineConfig(raw: unknown): DataPipelineConfig {
  const p = ConfigSchema.safeParse(raw ?? {});
  return p.success ? { ...p.data, sourcesOff: p.data.sourcesOff.filter((s) => JOB_SOURCES.some((j) => j.name === s)) } : PIPELINE_DEFAULTS;
}

// ---- the setup steps ----

export interface SetupInput {
  config: DataPipelineConfig;
  watchCount: number;
  quality: RunQuality | null;
  keys: { bls: boolean; fred: boolean; adzuna: boolean };
}

export interface Step {
  id: StepId;
  title: string;
  why: string;
  /** Where it stands now, in a few words. */
  now: string;
  done: boolean;
  optional?: boolean;
}

const share = (a: number, b: number) => (b === 0 ? 0 : a / b);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function setupSteps(i: SetupInput): Step[] {
  const q = i.quality;
  const paid = q ? share(q.withPay, q.recorded) : 0;
  const on = JOB_SOURCES.length - i.config.sourcesOff.length;
  const reviewed = (id: StepId) => i.config.reviewed.includes(id);
  return [
    { id: "watchlist", title: "Watch at least 10 companies", why: "Company boards are where small and mid-size companies post. More companies means less weight on any one, and a truer picture of the market.", now: `${i.watchCount} of 10 watched`, done: i.watchCount >= 10 },
    { id: "details", title: "Read posting details", why: "Descriptions give the pay and skills that titles never do. Pay figures rest on them.", now: q ? `${DETAIL_LABEL[i.config.details]} · ${pct(paid)} of postings state pay` : `${DETAIL_LABEL[i.config.details]} · no run yet`, done: i.config.details !== "off" && paid >= i.config.floors.pay },
    { id: "sources", title: "Choose your sources", why: "Each feed adds a different slice of the market. Turn off one you do not trust; keep the rest for breadth.", now: `${on} of ${JOB_SOURCES.length} on`, done: reviewed("sources") },
    { id: "benchmarks", title: "Add national benchmarks", why: "Official figures (BLS, FRED) show which way the whole market is moving, beside your sample.", now: `BLS ${i.keys.bls ? "set" : "not set"} · FRED ${i.keys.fred ? "set" : "not set"}`, done: i.keys.bls && i.keys.fred },
    { id: "adzuna", title: "Add Adzuna (optional)", why: "A large aggregator with salary statistics: broader coverage, less detail per posting.", now: i.keys.adzuna ? "Key set" : "Not set", done: i.keys.adzuna || reviewed("adzuna"), optional: true },
    { id: "floors", title: "Set quality floors and the company cap", why: "The floors decide when a figure is flagged as weak; the cap stops one large employer from setting the market's pay.", now: `Pay ${pct(i.config.floors.pay)} · skills ${pct(i.config.floors.skills)} · cap ${i.config.companyCap}`, done: reviewed("floors") },
  ];
}

/** The step to work on now: the first one not done. */
export const currentStep = (steps: readonly Step[]): Step | null => steps.find((s) => !s.done) ?? null;

// ---- the mentor's facts, rules advice and check ----

export interface Fact {
  key: string;
  label: string;
  /** As shown: "70%", "6", "1,592". The model may quote these exactly and no other number. */
  value: string;
}

export function mentorFacts(i: SetupInput & { sources: { name: string; read: number; tech: number; withPay: number }[]; stored: number; historyDays: number }): Fact[] {
  const q = i.quality;
  const n = q?.recorded ?? 0;
  const facts: Fact[] = [
    { key: "watched", label: "Companies watched", value: String(i.watchCount) },
    { key: "recorded", label: "Tech postings recorded in the last run", value: n.toLocaleString("en-US") },
    { key: "stored", label: "Tech postings stored", value: i.stored.toLocaleString("en-US") },
    { key: "history", label: "Days of daily history", value: String(i.historyDays) },
    { key: "pay", label: "Share of postings that state pay", value: pct(share(q?.withPay ?? 0, n)) },
    { key: "skills", label: "Share of postings that name a skill", value: pct(share(q?.withSkills ?? 0, n)) },
    { key: "level", label: "Share of postings that state a level", value: pct(share(q?.levelStated ?? 0, n)) },
    { key: "duplicates", label: "Duplicates merged in the last run", value: (q?.duplicates ?? 0).toLocaleString("en-US") },
    { key: "details", label: "Posting details schedule", value: DETAIL_LABEL[i.config.details] },
    { key: "cap", label: "Company cap", value: String(i.config.companyCap) },
    { key: "fred", label: "FRED key", value: i.keys.fred ? "set" : "not set" },
    { key: "adzuna", label: "Adzuna key", value: i.keys.adzuna ? "set" : "not set" },
    { key: "off", label: "Sources turned off", value: i.config.sourcesOff.length ? i.config.sourcesOff.join(", ") : "none" },
  ];
  const total = i.sources.reduce((s, x) => s + x.tech, 0);
  for (const s of i.sources) facts.push({ key: `src:${s.name}`, label: `${s.name}: share of tech postings`, value: pct(share(s.tech, total)) });
  return facts;
}

/** Advice the rules write: used when the model is off, over its limit, or fails the check. */
export function rulesAdvice(i: SetupInput, facts: readonly Fact[]): MentorAdvice[] {
  const out: MentorAdvice[] = [];
  const f = (k: string) => facts.find((x) => x.key === k);
  if (i.watchCount < 10) out.push({ title: "Watch more companies", why: `You watch ${f("watched")!.value}; the market view leans on few employers.`, action: "Add companies from the Utah suggestions on Setup, or any company you would apply to.", cites: ["watched"], step: "watchlist" });
  const top = facts.filter((x) => x.key.startsWith("src:")).sort((a, b) => parseInt(b.value) - parseInt(a.value))[0];
  if (top && parseInt(top.value) >= 60) out.push({ title: `${top.key.slice(4)} dominates the sample`, why: `It gives ${top.value} of tech postings, so it shapes every figure.`, action: "Watch more companies on other boards, or keep the company cap where it is.", cites: [top.key, "cap"], step: "sources" });
  if (i.quality && parseInt(f("pay")!.value) < Math.round(i.config.floors.pay * 100)) out.push({ title: "Few postings state pay", why: `Only ${f("pay")!.value} do, under your floor.`, action: i.config.details === "off" ? "Turn posting details back on." : "Watch more companies on Lever or Ashby, which publish pay ranges.", cites: ["pay", "details"], step: "details" });
  if (!i.keys.fred) out.push({ title: "Add the FRED key", why: "Indeed's software-development index is the closest public measure to what the Scout records.", action: "Add FRED_API_KEY in Vercel (free).", cites: ["fred"], step: "benchmarks" });
  if (i.quality && parseInt(f("level")!.value) < Math.round(i.config.floors.level * 100)) out.push({ title: "Most titles state no level", why: `${f("level")!.value} of postings state one, so pay by level rests on few.`, action: "Read pay by level as a direction, not a figure.", cites: ["level"], step: "floors" });
  return out.slice(0, 5);
}

/** Every number written in a piece of advice, as text ("70%", "1,592", "6"). */
const numbersIn = (s: string) => s.match(/\d[\d,.]*%?/g) ?? [];

/**
 * The critique: keep advice that cites known facts and writes no number those facts do not
 * contain. Returns what passed and how many were dropped.
 */
export function checkAdvice(advice: readonly MentorAdvice[], facts: readonly Fact[]): { kept: MentorAdvice[]; dropped: MentorAdvice[] } {
  const keys = new Set(facts.map((f) => f.key));
  const kept: MentorAdvice[] = [];
  const dropped: MentorAdvice[] = [];
  for (const a of advice) {
    const cited = facts.filter((f) => a.cites.includes(f.key));
    const allowed = new Set(cited.flatMap((f) => numbersIn(f.value)));
    const ok = a.cites.length > 0 && a.cites.every((k) => keys.has(k)) && numbersIn(`${a.title} ${a.why} ${a.action}`).every((num) => allowed.has(num) || /^(10|1)$/.test(num));
    (ok ? kept : dropped).push(a);
  }
  return { kept, dropped };
}

export const MentorOut = z.object({ advice: z.array(Advice).max(5) });
