"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runCalendarAgent } from "@/lib/agents/calendar";
import { loadCareerSnapshot } from "@/lib/career";
import { runAnalyst } from "@/lib/agents/analyst";
import { runChiefOfStaff } from "@/lib/agents/chiefOfStaff";
import { runMentor } from "@/lib/agents/mentor";
import { runScout } from "@/lib/agents/scout";
import { slotAt } from "@/lib/domain/mentor";
import { runCareerAgent } from "@/lib/agents/career";
import { runEmailAgent } from "@/lib/agents/email";
import { runFinanceAgent } from "@/lib/agents/finance";
import { runNewsAgent } from "@/lib/agents/news";
import { runSync } from "@/lib/agents/sync";
import { runAiCheck } from "@/lib/agents/aiCheck";
import { runMentorRefresh } from "@/lib/agents/mentorRefresh";
import { runQa } from "@/lib/agents/qa";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { AGENTS } from "@/lib/domain/agents";
import { currentSlot } from "@/lib/domain/briefSchedule";
import { interviewsFrom } from "@/lib/domain/calendarAgent";
import { AGENT_IDS } from "@/lib/domain/types";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { SCHEDULED_LIMIT_MS } from "@/lib/domain/deadline";
import type { ActionResult } from "./_shared";

const AgentParam = z.enum(AGENT_IDS);

function refresh() {
  revalidatePath("/mission");
  revalidatePath("/");
}

/**
 * The Career Mentor's "Refresh and review": the Scout reads the job boards and the Applications
 * Agent your new job emails, the Analyst recomputes the market report, then the Career Mentor
 * reviews with all of it. Returns what changed, one line per step.
 */
export async function refreshMentor(): Promise<ActionResult<{ lines: string[] }>> {
  if (!rateLimit("mentor-refresh", 5, 10 * 60_000).allowed) return { ok: false, error: "Refreshed five times in ten minutes. Try again in a few minutes." };
  const ctx = await getContext();
  // Job feeds and Gmail are written with the owner-scoped service store, after confirming the session is the owner.
  const persist = ctx.mode === "live" ? (assertSessionIsOwner(ctx), ownerServiceStore()) : ctx.store;
  const out = await runMentorRefresh(ctx, persist);
  const failed = "missing" in out;
  await audit(ctx.store, { actor: "owner", action: "mentor.refresh", target: "mentor", detail: failed ? out.why.slice(0, 120) : "refreshed", outcome: failed ? "error" : "success" });
  refresh();
  revalidatePath("/growth");
  revalidatePath("/applications");
  if (failed) return { ok: false, error: `The refresh did not finish: ${out.why}` };
  return { ok: true, data: { lines: out.lines } };
}

/** Mission Control's "Check the connection": a tiny, timed request to each AI model. The card shows the logged result. */
export async function checkAiConnection(): Promise<ActionResult> {
  if (!rateLimit("ai-check", 3, 10 * 60_000).allowed) return { ok: false, error: "Checked a few times just now. Try again in a few minutes." };
  const ctx = await getContext();
  const out = await runAiCheck(ctx);
  refresh();
  if (!out.ok) return { ok: false, error: out.why };
  return { ok: true };
}

/** Mission Control's Run Now: reruns an agent right away, even if it is paused. */
export async function runAgentNow(agent: string): Promise<ActionResult> {
  const p = AgentParam.safeParse(agent);
  if (!p.success) return { ok: false, error: "Unknown agent" };
  const profile = AGENTS.find((a) => a.id === p.data)!;
  if (profile.status !== "live") return { ok: false, error: `${profile.name} isn't built yet (build step ${profile.buildStep}).` };
  if (!rateLimit(`run-now:${p.data}`, 4, 10 * 60_000).allowed) return { ok: false, error: "Ran a lot just now. Try again in a few minutes." };

  const ctx = await getContext();
  const slot = currentSlot(ctx.today, ctx.time);

  if (p.data === "calendar") {
    // The Calendar Agent on its own: reviews the calendar for the current slot and logs the
    // run. It does not rewrite today's brief; the Chief of Staff's next run picks it up.
    const snapshot = await loadCareerSnapshot(ctx).catch(() => null);
    const res = await runCalendarAgent(ctx, slot, { trigger: "run-now", interviews: interviewsFrom(snapshot), honorPause: false });
    const failed = "missing" in res || res.status === "error";
    await audit(ctx.store, { actor: "owner", action: "agent.run-now", target: p.data, detail: `${slot}: ${failed ? "failed" : "succeeded"}`, outcome: failed ? "error" : "success" });
    refresh();
    if ("missing" in res) return { ok: false, error: `Run failed: ${res.why}` };
    return res.status === "error" ? { ok: false, error: res.report.headline } : { ok: true, message: res.report.headline };
  }

  // Gmail is read with the owner-scoped service store, only after confirming the session is the owner.
  const service = () => {
    if (ctx.mode !== "live") return null;
    assertSessionIsOwner(ctx);
    return ownerServiceStore();
  };

  if (p.data === "email") {
    // The Email Agent on its own: syncs the inbox and reports. Archiving and unsubscribing
    // happen only from the Inbox page, on your click.
    const res = await runEmailAgent(ctx, slot === "saturday" ? "morning" : slot, { trigger: "run-now", honorPause: false, sync: service() });
    const failed = "missing" in res || res.sync === "error";
    await audit(ctx.store, { actor: "owner", action: "agent.run-now", target: p.data, detail: `${slot}: ${failed ? "failed" : "succeeded"}`, outcome: failed ? "error" : "success" });
    refresh();
    if ("missing" in res) return { ok: false, error: `Run failed: ${res.why}` };
    return res.sync === "error" ? { ok: false, error: res.report.errors[0] ?? "Gmail sync failed" } : { ok: true, message: res.report.headline };
  }

  if (p.data === "career") {
    // The Applications Agent on its own: finds this brief's matches (tops each of the brief's two lists up to 5).
    const res = await runCareerAgent(ctx, slot === "saturday" ? "morning" : slot, { trigger: "run-now", honorPause: false, persist: service() ?? ctx.store });
    const failed = "missing" in res || res.allFailed;
    await audit(ctx.store, { actor: "owner", action: "agent.run-now", target: p.data, detail: `${slot}: ${failed ? "failed" : "succeeded"}`, outcome: failed ? "error" : "success" });
    refresh();
    if ("missing" in res) return { ok: false, error: `Run failed: ${res.why}` };
    return res.allFailed ? { ok: false, error: res.report.errors[0] ?? "Every job source failed." } : { ok: true, message: res.report.headline };
  }

  if (p.data === "qa") {
    // The QA Agent on its own: reviews the seven days ending today and saves the report.
    const res = await runQa(ctx, { trigger: "run-now", honorPause: false, persist: service() ?? ctx.store });
    const failed = "missing" in res;
    await audit(ctx.store, { actor: "owner", action: "agent.run-now", target: p.data, detail: failed ? "failed" : "succeeded", outcome: failed ? "error" : "success" });
    refresh();
    if ("missing" in res) return { ok: false, error: `Run failed: ${res.why}` };
    return { ok: true, message: res.report.headline };
  }

  if (p.data === "scout" || p.data === "analyst" || p.data === "mentor") {
    // A Career desk agent on its own. Each writes only its own table.
    const persist = service() ?? ctx.store;
    const res =
      p.data === "scout"
        ? await runScout(ctx, { trigger: "run-now", honorPause: false, persist })
        : p.data === "analyst"
          ? await runAnalyst(ctx, { trigger: "run-now", honorPause: false, persist })
          : await runMentor(ctx, slotAt(ctx.time), { trigger: "run-now", honorPause: false, persist });
    const failed = "missing" in res;
    await audit(ctx.store, { actor: "owner", action: "agent.run-now", target: p.data, detail: failed ? "failed" : "succeeded", outcome: failed ? "error" : "success" });
    refresh();
    revalidatePath("/growth");
    if ("missing" in res) return { ok: false, error: `Run failed: ${res.why}` };
    return { ok: true, message: res.report.headline };
  }

  if (p.data === "finance") {
    // The Finance Agent on its own: checks the stored inbox and your Renewals list. It
    // never reads Gmail itself, connects to a bank, or adds anything to Renewals.
    const res = await runFinanceAgent(ctx, { trigger: "run-now", honorPause: false });
    const failed = "missing" in res;
    await audit(ctx.store, { actor: "owner", action: "agent.run-now", target: p.data, detail: `${slot}: ${failed ? "failed" : "succeeded"}`, outcome: failed ? "error" : "success" });
    refresh();
    revalidatePath("/renewals");
    if ("missing" in res) return { ok: false, error: `Run failed: ${res.why}` };
    return { ok: true, message: res.report.headline };
  }

  if (p.data === "news") {
    // The News Agent on its own: picks stories for the current slot and logs the run.
    const res = await runNewsAgent(ctx, slot, { trigger: "run-now", honorPause: false });
    const failed = "missing" in res || res.allFailed;
    await audit(ctx.store, { actor: "owner", action: "agent.run-now", target: p.data, detail: `${slot}: ${failed ? "failed" : "succeeded"}`, outcome: failed ? "error" : "success" });
    refresh();
    if ("missing" in res) return { ok: false, error: `Run failed: ${res.why}` };
    return res.allFailed ? { ok: false, error: res.report.errors[0] ?? "Every feed failed." } : { ok: true, message: res.report.headline };
  }

  const outcome = await runChiefOfStaff(ctx, slot, "run-now", { service: service() });
  await audit(ctx.store, {
    actor: "owner",
    action: "agent.run-now",
    target: p.data,
    detail: `${slot}: ${outcome.status}`,
    outcome: outcome.status === "failed" ? "error" : "success",
  });
  refresh();
  if (outcome.status === "succeeded") {
    return { ok: true, message: outcome.costUsd ? `Brief ready ($${outcome.costUsd.toFixed(3)}).` : "Brief ready." };
  }
  return { ok: false, error: outcome.status === "failed" ? `Run failed: ${outcome.why}` : "Skipped." };
}

/** Pause or resume an agent's scheduled runs without touching the others. */
export async function setAgentPaused(agent: string, paused: boolean): Promise<ActionResult> {
  const p = z.object({ agent: AgentParam, paused: z.boolean() }).safeParse({ agent, paused });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store } = await getContext();
  await store.agentState.setPaused(p.data.agent, p.data.paused);
  await audit(store, { actor: "owner", action: p.data.paused ? "agent.pause" : "agent.resume", target: p.data.agent, detail: "", outcome: "success" });
  refresh();
  return { ok: true };
}

/** Mission Control's Sync now: every agent reports to the Chief of Staff right away. No brief is written. */
export async function syncNow(): Promise<ActionResult> {
  if (!rateLimit("sync-now", 4, 10 * 60_000).allowed) return { ok: false, error: "Synced a lot just now. Try again in a few minutes." };
  const ctx = await getContext();
  let service = null;
  if (ctx.mode === "live") {
    assertSessionIsOwner(ctx);
    service = ownerServiceStore();
  }
  // The same limit as the scheduled sync (Mission Control's maxDuration is 300 for this), with a
  // deadline so model calls and the watchdog know when the function will be stopped.
  const outcome = await runSync({ ...ctx, deadline: ctx.deadline ?? Date.now() + SCHEDULED_LIMIT_MS }, "run-now", service);
  await audit(ctx.store, { actor: "owner", action: "agent.sync-now", target: "sync", detail: outcome.status, outcome: outcome.status === "failed" ? "error" : "success" });
  for (const path of ["/", "/mission", "/inbox", "/applications", "/renewals", "/roles", "/connectors"]) revalidatePath(path);
  return outcome.status === "failed" ? { ok: false, error: `Sync failed: ${outcome.detail}` } : { ok: true, message: `Synced: ${outcome.detail}.` };
}
