"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { runPitch } from "@/lib/agents/pitch";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { id, type ActionResult } from "./_shared";

/** The page's function stops at 60 seconds; the agent saves its state and resumes on the next press. */
const RUN_MS = 50_000;

/**
 * "Tailor this job" on one job in your Apply Queue: runs the Tailor (lib/agents/pitch.ts).
 * It reads your resumes and the job, and writes only its own run state; you make the changes.
 */
export async function tailorWithPitch(kitId: string): Promise<ActionResult> {
  const p = id.safeParse(kitId);
  if (!p.success) return { ok: false, error: "Bad input" };
  if (!rateLimit("pitch", 6, 10 * 60_000).allowed) return { ok: false, error: "Six runs in ten minutes at most: each uses several AI calls. Try again shortly." };
  const ctx = await getContext();
  const kit = await ctx.store.approvals.get(p.data);
  if (!kit || kit.kind !== "application" || kit.status !== "pending") return { ok: false, error: "That job is no longer in your Apply Queue." };
  const match = kit.matchId ? await ctx.store.jobMatches.get(kit.matchId) : null;
  const persist = ctx.mode === "live" ? (assertSessionIsOwner(ctx), ownerServiceStore()) : ctx.store;
  const res = await runPitch(ctx, { kit, match }, { persist, deadline: Date.now() + RUN_MS });
  revalidatePath("/career");
  if (!res.packet) return res.status === "stopped" ? { ok: true, message: `The Tailor paused: ${res.why} Press Continue to pick up where it stopped.` } : { ok: false, error: `The Tailor could not finish: ${res.why}` };
  return { ok: true, message: res.writer === "model" ? "The Tailor finished: review the map, swaps and note below." : "AI was not available, so this is the rules' version: proof by keyword, no swaps." };
}
