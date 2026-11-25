"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { runInterviewPrep } from "@/lib/agents/interviewPrep";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { id, type ActionResult } from "./_shared";

/** The page's function stops at 60 seconds; the agent saves its state and resumes on the next press. */
const RUN_MS = 50_000;

/**
 * "Prepare" on one application: runs the Coach (lib/agents/interviewPrep.ts).
 * It reads your resumes, projects and the job's research, and writes only its own run state.
 */
export async function prepareInterview(appId: string): Promise<ActionResult> {
  const p = id.safeParse(appId);
  if (!p.success) return { ok: false, error: "Bad input" };
  if (!rateLimit("prep", 6, 10 * 60_000).allowed) return { ok: false, error: "Six runs in ten minutes at most: each uses several AI calls. Try again shortly." };
  const ctx = await getContext();
  const app = await ctx.store.applications.get(p.data);
  if (!app || app.status === "saved") return { ok: false, error: "Prepare works on an application you have sent." };
  const persist = ctx.mode === "live" ? (assertSessionIsOwner(ctx), ownerServiceStore()) : ctx.store;
  const res = await runInterviewPrep(ctx, app, { persist, deadline: Date.now() + RUN_MS });
  revalidatePath(`/applications/${app.id}`);
  if (!res.packet) return res.status === "stopped" ? { ok: true, message: `Prep paused: ${res.why} Press Continue to pick up where it stopped.` } : { ok: false, error: `Prep could not finish: ${res.why}` };
  return { ok: true, message: res.writer === "model" ? "Prep finished: your questions, stories and gaps are below." : "AI was not available, so this is the rules' version: likely questions, where your proof is, and honest gaps." };
}
