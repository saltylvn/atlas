"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAnalyst } from "@/lib/agents/analyst";
import { careerPrefs } from "@/lib/agents/career";
import { runRolesReview } from "@/lib/agents/mentorRoles";
import { runRoleDescriptions } from "@/lib/agents/roleDescriptions";
import { runRoleProfiles } from "@/lib/agents/roleProfiles";
import { scanPortfolio } from "@/lib/agents/portfolio";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { addDays } from "@/lib/domain/dates";
import { sameOrder } from "@/lib/domain/roleOutlook";
import { profilesMessage } from "@/lib/domain/roleProfile";
import { MAX_ROLES, optionNames, roleNames } from "@/lib/domain/targetRoles";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { id, type ActionResult } from "./_shared";

// Your target roles and their order. Atlas owns them (19 Nov 2026): they live in Settings
// (careerRoles), at most seven of the seven options, and change only by your click, here on the Target Roles page
// or by approving the Career Mentor's proposal. Notion keeps only the resume for each role and is
// never written from here. If your order changed after a proposal was made, approving it
// writes nothing and the proposal is marked stale.

function refresh() {
  revalidatePath("/roles");
  revalidatePath("/growth");
  revalidatePath("/");
  revalidatePath("/mission");
}

const STALE = "Your role order changed after this was proposed, so nothing was written. Ask the Career Mentor again for a proposal against the new order.";

export async function decideRoleProposal(proposalId: string, decision: string): Promise<ActionResult> {
  const p = z.object({ proposalId: id, decision: z.enum(["approved", "dismissed"]) }).safeParse({ proposalId, decision });
  if (!p.success) return { ok: false, error: "Bad input" };
  if (!rateLimit("role-proposal", 6, 10 * 60_000).allowed) return { ok: false, error: "Tried a lot just now. Wait a few minutes." };
  const ctx = await getContext();
  const { store } = ctx;
  const proposal = await store.roleProposals.get(p.data.proposalId);
  if (!proposal || proposal.status !== "new") return { ok: false, error: "That proposal is no longer open." };
  // The pointer the Career Mentor left among its insights is closed with the proposal.
  const closePointer = async (status: "done" | "dismissed") => {
    const open = (await store.mentor.since(addDays(ctx.today, -30)).catch(() => [])).filter((i) => i.key === "roles:proposal" && i.status === "new");
    for (const i of open) await store.mentor.setStatus(i.id, status).catch(() => undefined);
  };

  if (p.data.decision === "dismissed") {
    await store.roleProposals.setStatus(proposal.id, "dismissed");
    await closePointer("dismissed");
    await audit(store, { actor: "owner", action: "roles.proposal", target: "target-roles", detail: "dismissed", outcome: "success" });
    refresh();
    return { ok: true, message: "Dismissed. The Career Mentor will not raise this same order again for three weeks." };
  }

  const current = careerPrefs(ctx.settings).roles.map((r) => r.name);
  if (!sameOrder(current, proposal.base)) {
    await store.roleProposals.setStatus(proposal.id, "stale");
    await closePointer("dismissed");
    refresh();
    return { ok: false, error: STALE };
  }

  // Only the seven can be saved: an older or candidate role in the proposal maps onto them or drops.
  const approved = optionNames(proposal.proposed);
  if (approved.length === 0) return { ok: false, error: "That order has none of your seven roles." };
  await store.settings.update({ careerRoles: approved });
  await store.roleProposals.setStatus(proposal.id, "approved");
  await closePointer("done");
  await audit(store, { actor: "owner", action: "roles.proposal", target: "target-roles", detail: `approved: ${proposal.proposed.length} roles, ${proposal.added.length} added`, outcome: "success" });
  refresh();
  return { ok: true, message: "Approved. Your role order in Atlas is updated." };
}

const RoleList = z.array(z.string().trim().min(2).max(80)).min(1).max(MAX_ROLES);

/** Saves your target roles in the order given: only the seven options, older names mapped onto them. */
export async function saveRoleOrder(roles: string[]): Promise<ActionResult> {
  const p = RoleList.safeParse(roles);
  if (!p.success) return { ok: false, error: `Pick between 1 and ${MAX_ROLES} roles.` };
  if (!rateLimit("role-order", 20, 10 * 60_000).allowed) return { ok: false, error: "Changed a lot just now. Wait a few minutes." };
  const ctx = await getContext();
  const next = optionNames(p.data);
  if (next.length === 0) return { ok: false, error: "Pick from your seven roles." };
  const before = roleNames(ctx.settings.careerRoles);
  if (sameOrder(next, before)) return { ok: true, message: "No change." };
  await ctx.store.settings.update({ careerRoles: next });
  // An open proposal was made against the old order; it no longer applies.
  const waiting = (await ctx.store.roleProposals.recent(10).catch(() => [])).filter((x) => x.status === "new");
  for (const w of waiting) await ctx.store.roleProposals.setStatus(w.id, "stale").catch(() => undefined);
  await audit(ctx.store, { actor: "owner", action: "roles.order", target: "target-roles", detail: next.join(" > ").slice(0, 300), outcome: "success" });
  refresh();
  revalidatePath("/career/roles");
  revalidatePath("/career");
  return { ok: true, message: "Saved. The Applications bot hunts in this order from the next run." };
}

/** Asks the Career Mentor to review your role order now, on a fresh market report. */
export async function reviewRolesNow(): Promise<ActionResult> {
  if (!rateLimit("roles-review", 4, 10 * 60_000).allowed) return { ok: false, error: "Asked a lot just now. Try again in a few minutes." };
  const ctx = await getContext();
  const persist = ctx.mode === "live" ? (assertSessionIsOwner(ctx), ownerServiceStore()) : ctx.store;
  const latest = await ctx.store.market.latestReport().catch(() => null);
  const current = careerPrefs(ctx.settings).roles.map((r) => r.name);
  const fresh = latest?.forDate === ctx.today && latest.report.outlook && sameOrder(latest.report.outlook.filter((o) => o.target).map((o) => o.role), current);
  if (!fresh) {
    const a = await runAnalyst(ctx, { trigger: "run-now", honorPause: false, persist });
    if ("missing" in a) return { ok: false, error: `The Analyst could not write a market report: ${a.why}` };
  }
  // A fresh review replaces a proposal still waiting on you: it was made on older evidence.
  const waiting = (await ctx.store.roleProposals.recent(10).catch(() => [])).filter((p) => p.status === "new");
  for (const p of waiting) await persist.roleProposals.setStatus(p.id, "stale").catch(() => undefined);
  if (waiting.length) {
    const open = (await ctx.store.mentor.since(addDays(ctx.today, -30)).catch(() => [])).filter((i) => i.key === "roles:proposal" && i.status === "new");
    for (const i of open) await persist.mentor.setStatus(i.id, "dismissed").catch(() => undefined);
  }
  const res = await runRolesReview(ctx, { trigger: "run-now", honorPause: false, persist });
  refresh();
  return "missing" in res ? { ok: false, error: res.why } : { ok: true, message: res.headline };
}

/** Reads your GitHub projects now (the Scout does it once a day on its own). */
export async function scanGithubNow(): Promise<ActionResult> {
  if (!rateLimit("github-scan", 3, 10 * 60_000).allowed) return { ok: false, error: "Read a lot just now. Try again in a few minutes." };
  const ctx = await getContext();
  if (ctx.mode !== "live") return { ok: false, error: "Demo mode shows sample projects. GitHub is read in the live app." };
  assertSessionIsOwner(ctx);
  const res = await scanPortfolio(ctx, { trigger: "run-now", honorPause: false, persist: ownerServiceStore(), force: true });
  await audit(ctx.store, { actor: "owner", action: "github.scan", target: "github", detail: "missing" in res ? res.missing : `${res.repos} projects`, outcome: "missing" in res && res.missing === "failed" ? "error" : "success" });
  refresh();
  return "missing" in res ? { ok: false, error: res.why } : { ok: true, message: res.report.headline };
}

/**
 * "Update now" on Target Roles: has the Career Mentor write this week's profile for each of your top
 * four roles again, from the Analyst's current numbers. If there is no recent market report
 * the Analyst runs first. It takes no input, changes no role and sends nothing; each profile
 * is one model call, inside the daily AI cap.
 */
export async function updateRoleProfiles(): Promise<ActionResult<{ written: number }>> {
  if (!rateLimit("role-profiles", 2, 10 * 60_000).allowed) return { ok: false, error: "Updated just now. Try again in a few minutes." };
  const ctx = await getContext();
  let persist = ctx.store;
  if (ctx.mode === "live") {
    assertSessionIsOwner(ctx);
    persist = ownerServiceStore();
  }
  // The profiles rest on the Analyst's outlook: make sure there is a current one.
  const latest = await ctx.store.market.latestReport().catch(() => null);
  if (!latest || latest.forDate < addDays(ctx.today, -3) || !latest.report.outlook?.length) await runAnalyst(ctx, { trigger: "owner", honorPause: false, persist });
  const out = await runRoleProfiles(ctx, { trigger: "owner", honorPause: false, persist, rewrite: true });
  // Descriptions are monthly: this fills in only the roles still missing this month's, so a
  // second press spends no more search credits.
  const described = await runRoleDescriptions(ctx, { trigger: "owner", honorPause: false, persist }).catch(() => null);
  await audit(ctx.store, { actor: "owner", action: "roles.profiles-updated", target: "target roles", detail: "missing" in out ? out.why.slice(0, 120) : out.headline.slice(0, 200), outcome: "missing" in out ? "error" : "success" });
  revalidatePath("/career/roles");
  if ("missing" in out) return { ok: false, error: `The profiles were not updated: ${out.why}` };
  const about = described && !("missing" in described) && described.written.length ? ` ${described.written.length} role description${described.written.length === 1 ? "" : "s"} written.` : "";
  return { ok: true, message: `${profilesMessage(out)}${about}`, data: { written: out.written.length } };
}
