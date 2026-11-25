"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runDataMentor } from "@/lib/agents/dataMentor";
import { runTypeCheck } from "@/lib/agents/typeCheck";
import { runCareerMap } from "@/lib/agents/careerMap";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { audit } from "@/lib/audit";
import { getContext, type Context } from "@/lib/context";
import { DETAIL_MODES, pipelineConfig, STEP_IDS, type DataPipelineConfig } from "@/lib/domain/dataPipeline";
import { JOB_SOURCES } from "@/lib/domain/jobSources";
import type { ActionResult } from "./_shared";

// The Data Pipeline page's controls. Each one calls getContext() first (owner and two-step),
// validates its input, and saves on your settings. The ones that change what Atlas reads from
// outside (sources, the detail schedule) are audited.

async function save(ctx: Context, patch: (c: DataPipelineConfig) => DataPipelineConfig): Promise<DataPipelineConfig> {
  const next = patch(pipelineConfig(ctx.settings.dataPipeline));
  await ctx.store.settings.update({ dataPipeline: next });
  revalidatePath("/data");
  return next;
}

const SourceToggle = z.object({ name: z.enum(JOB_SOURCES.map((s) => s.name) as [string, ...string[]]), on: z.boolean() });

export async function setSourceOn(name: string, on: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  const p = SourceToggle.safeParse({ name, on });
  if (!p.success) return { ok: false, error: "Unknown source" };
  const next = await save(ctx, (c) => ({ ...c, sourcesOff: p.data.on ? c.sourcesOff.filter((s) => s !== p.data.name) : [...new Set([...c.sourcesOff, p.data.name])] }));
  await audit(ctx.store, { actor: "owner", action: "data.source", target: p.data.name, detail: p.data.on ? "on" : "off", outcome: "success" });
  return { ok: true, message: `${p.data.name} is ${p.data.on ? "on" : "off"}. ${next.sourcesOff.length} off in all.` };
}

export async function setDetailMode(mode: string): Promise<ActionResult> {
  const ctx = await getContext();
  const p = z.enum(DETAIL_MODES).safeParse(mode);
  if (!p.success) return { ok: false, error: "Unknown schedule" };
  await save(ctx, (c) => ({ ...c, details: p.data }));
  await audit(ctx.store, { actor: "owner", action: "data.details", target: "posting-details", detail: p.data, outcome: "success" });
  return { ok: true, message: "Saved. It applies from the next sync." };
}

const pct = z.coerce.number().int().min(0).max(100);
const Floors = z.object({ pay: pct, skills: pct, level: pct, sources: pct, companyCap: z.coerce.number().int().min(5).max(200) });

export async function setFloors(_: unknown, fd: FormData): Promise<ActionResult> {
  const ctx = await getContext();
  const p = Floors.safeParse(Object.fromEntries(fd.entries()));
  if (!p.success) return { ok: false, error: "Floors are 0 to 100%, and the cap 5 to 200." };
  const { pay, skills, level, sources, companyCap } = p.data;
  await save(ctx, (c) => ({ ...c, floors: { pay: pay / 100, skills: skills / 100, level: level / 100, sources: sources / 100 }, companyCap, reviewed: [...new Set([...c.reviewed, "floors" as const])] }));
  return { ok: true, message: "Saved." };
}

export async function markStep(step: string, reviewed: boolean): Promise<ActionResult> {
  const ctx = await getContext();
  const p = z.enum(STEP_IDS).safeParse(step);
  if (!p.success) return { ok: false, error: "Unknown step" };
  await save(ctx, (c) => ({ ...c, reviewed: reviewed ? [...new Set([...c.reviewed, p.data])] : c.reviewed.filter((s) => s !== p.data) }));
  return { ok: true };
}

export async function askDataMentor(focus: string | null): Promise<ActionResult> {
  const ctx = await getContext();
  const f = focus === null ? null : z.enum(STEP_IDS).safeParse(focus);
  if (f && !f.success) return { ok: false, error: "Unknown step" };
  const res = await runDataMentor(ctx, { focus: f ? f.data : null, trigger: "owner" });
  revalidatePath("/data");
  return "missing" in res ? { ok: false, error: `The mentor ${res.missing === "skipped" ? "is paused" : "could not run"}: ${res.why}` } : { ok: true, message: res.headline };
}

/** "Check now" on the Market page: one AI check of the engineering-type labels. Three a minute at most. */
export async function checkTypesNow(): Promise<ActionResult> {
  const ctx = await getContext();
  if (!rateLimit("type-check", 3, 60_000).allowed) return { ok: false, error: "Three checks a minute at most. Try again shortly." };
  const res = await runTypeCheck(ctx, { trigger: "owner" });
  revalidatePath("/career/market");
  return "missing" in res ? { ok: false, error: `The check did not run: ${res.why}` } : { ok: true, message: res.headline };
}

/** "Update now" on the Career Map page: rebuild this week's map. Two a minute at most (up to five model calls each). */
export async function updateCareerMap(): Promise<ActionResult> {
  const ctx = await getContext();
  if (!rateLimit("career-map", 2, 60_000).allowed) return { ok: false, error: "Two updates a minute at most. Try again shortly." };
  const res = await runCareerMap(ctx, { trigger: "owner", persist: ctx.mode === "live" ? (assertSessionIsOwner(ctx), ownerServiceStore()) : ctx.store });
  revalidatePath("/career/map");
  return "missing" in res ? { ok: false, error: `The map was not updated: ${res.why}` } : { ok: true, message: res.headline };
}
