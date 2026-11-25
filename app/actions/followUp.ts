"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { runFollowUp } from "@/lib/agents/followUp";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { id, type ActionResult } from "./_shared";

/** The page's function stops at 60 seconds; the agent stops cleanly before that. */
const RUN_MS = 50_000;

/**
 * "Rewrite with agent" on a follow-up in your Apply Queue: runs the Nudger
 * (lib/agents/followUp.ts). It rewrites the draft's text only; you send it yourself.
 */
export async function rewriteFollowUp(approvalId: string): Promise<ActionResult> {
  const p = id.safeParse(approvalId);
  if (!p.success) return { ok: false, error: "Bad input" };
  if (!rateLimit("followup", 6, 10 * 60_000).allowed) return { ok: false, error: "Six rewrites in ten minutes at most: each uses several AI calls. Try again shortly." };
  const ctx = await getContext();
  const persist = ctx.mode === "live" ? (assertSessionIsOwner(ctx), ownerServiceStore()) : ctx.store;
  const approval = await persist.approvals.get(p.data);
  if (!approval || approval.kind !== "follow-up" || approval.status !== "pending" || !approval.applicationId) return { ok: false, error: "That follow-up is no longer waiting in your Apply Queue." };
  const app = await persist.applications.get(approval.applicationId);
  if (!app) return { ok: false, error: "The application for this follow-up is gone." };
  const res = await runFollowUp(ctx, { approval, app }, { persist, trigger: "owner", deadline: Date.now() + RUN_MS });
  revalidatePath("/career");
  return res.writer === "model"
    ? { ok: true, message: `Rewritten${res.person ? ` for ${res.person.split(" ")[0]}` : ""}. Read it, then send it from your own email.` }
    : { ok: true, message: `The agent could not do better than the template (${res.why || "nothing specific to say"}), so the template stands.` };
}
