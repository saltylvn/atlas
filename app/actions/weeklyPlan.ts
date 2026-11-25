"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { runWeeklyStrategist } from "@/lib/agents/weeklyStrategist";
import { tasksForPlan, weeklyPlanOf } from "@/lib/domain/weeklyPlan";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { localDay, type ActionResult } from "./_shared";

// The Weekly Strategist's plan: write one now, approve it (its three moves become tasks on your
// days), or pass on it. Nothing lands on your days until you approve.

/** The page's function stops at 60 seconds; the agent stops cleanly before that. */
const RUN_MS = 50_000;
const WeekOf = z.object({ weekOf: localDay });

function refresh() {
  revalidatePath("/");
  revalidatePath("/plan");
  revalidatePath("/growth");
}

/** Where the plan is written: the owner's store in live mode (after checking the session), the demo store otherwise. */
function persistFor(ctx: Awaited<ReturnType<typeof getContext>>) {
  return ctx.mode === "live" ? (assertSessionIsOwner(ctx), ownerServiceStore()) : ctx.store;
}

/** "Plan my week": runs the Planner now. An approved plan for the week is kept. */
export async function planMyWeek(): Promise<ActionResult> {
  if (!rateLimit("strategist", 4, 30 * 60_000).allowed) return { ok: false, error: "Four plans in half an hour at most: each uses several AI calls. Try again shortly." };
  const ctx = await getContext();
  const persist = persistFor(ctx);
  const res = await runWeeklyStrategist(ctx, { persist, trigger: "owner", deadline: Date.now() + RUN_MS });
  refresh();
  if (res.kept) return { ok: true, message: "This week's plan is already approved and on your days." };
  return { ok: true, message: res.writer === "model" ? "Here is this week's plan. Approve it to put the moves on your days." : "AI was not available, so this is the rules' plan. Approve it to put the moves on your days." };
}

/**
 * Approves the week's plan: each move becomes a high-priority Career task on its day. Safe to
 * press twice: an approved plan is not added again, and a move already on that day is not duplicated.
 */
export async function approveWeeklyPlan(weekOf: string): Promise<ActionResult> {
  const p = WeekOf.safeParse({ weekOf });
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  const persist = persistFor(ctx);
  const settings = await persist.settings.get();
  const plan = weeklyPlanOf(settings.weeklyPlan);
  if (!plan || plan.weekOf !== p.data.weekOf) return { ok: false, error: "That plan is no longer the current one. Refresh the page." };
  if (plan.status === "approved") return { ok: true, message: "Already approved: the moves are on your days." };

  const existing = await persist.tasks.list();
  const taskIds: string[] = [];
  for (const t of tasksForPlan(plan, ctx.today)) {
    // Idempotent by what the task is: the same move on the same day is never added twice.
    const same = existing.find((x) => x.title === t.title && x.day === t.day && x.notes.startsWith("This week's plan:"));
    taskIds.push(same ? same.id : (await persist.tasks.create(t)).id);
  }
  await persist.settings.update({ weeklyPlan: { ...plan, status: "approved", approvedAt: ctx.now.toISOString(), taskIds } });
  await audit(ctx.store, { actor: "owner", action: "career.weekly-plan.approve", target: plan.weekOf, detail: `${taskIds.length} moves added to your days`, outcome: "success" });
  refresh();
  return { ok: true, message: `Approved: ${taskIds.length} moves are on your days this week.` };
}

/** Passes on the week's plan. Nothing is added; "Plan my week" writes a new one. */
export async function dismissWeeklyPlan(weekOf: string): Promise<ActionResult> {
  const p = WeekOf.safeParse({ weekOf });
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  const persist = persistFor(ctx);
  const plan = weeklyPlanOf((await persist.settings.get()).weeklyPlan);
  if (!plan || plan.weekOf !== p.data.weekOf) return { ok: false, error: "That plan is no longer the current one. Refresh the page." };
  if (plan.status === "approved") return { ok: false, error: "This plan is already on your days. Move or finish its tasks in Plan instead." };
  await persist.settings.update({ weeklyPlan: { ...plan, status: "dismissed" } });
  await audit(ctx.store, { actor: "owner", action: "career.weekly-plan.dismiss", target: plan.weekOf, detail: "", outcome: "success" });
  refresh();
  return { ok: true, message: "Passed. Press Plan my week for a new one." };
}
