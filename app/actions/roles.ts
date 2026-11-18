"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAnalyst } from "@/lib/agents/analyst";
import { careerPrefs } from "@/lib/agents/career";
import { runRolesReview } from "@/lib/agents/mentorRoles";
import { scanPortfolio } from "@/lib/agents/portfolio";
import { audit } from "@/lib/audit";
import { syncNotion } from "@/lib/connections/notion";
import { getContext } from "@/lib/context";
import { addDays } from "@/lib/domain/dates";
import { priorityPlan, sameOrder } from "@/lib/domain/roleOutlook";
import { rolesFrom } from "@/lib/domain/targetRoles";
import { createRoleRow, NotionError, NOTION_WRITE_HELP, notionConfigured, readRoleRows, writeRolePriority } from "@/lib/integrations/notion";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { id, type ActionResult } from "./_shared";

// Your decision on the Mentor's proposed role order. This is the only place an approved
// order is written, and it is written only by your click:
//   live, with Notion    the Priority numbers on the role rows in the Resumes database
//                        (and a new row for a role you approved adding); Atlas then reads
//                        the order back from Notion like any other sync
//   otherwise            your role order in Settings
// Before writing, Notion's order is read again. If it no longer matches the order the
// proposal was made against, nothing is written and the proposal is marked stale.

function refresh() {
  revalidatePath("/roles");
  revalidatePath("/growth");
  revalidatePath("/");
  revalidatePath("/mission");
}

const STALE = "Your role order changed after this was proposed, so nothing was written. Ask the Mentor again for a proposal against the new order.";

export async function decideRoleProposal(proposalId: string, decision: string): Promise<ActionResult> {
  const p = z.object({ proposalId: id, decision: z.enum(["approved", "dismissed"]) }).safeParse({ proposalId, decision });
  if (!p.success) return { ok: false, error: "Bad input" };
  if (!rateLimit("role-proposal", 6, 10 * 60_000).allowed) return { ok: false, error: "Tried a lot just now. Wait a few minutes." };
  const ctx = await getContext();
  const { store } = ctx;
  const proposal = await store.roleProposals.get(p.data.proposalId);
  if (!proposal || proposal.status !== "new") return { ok: false, error: "That proposal is no longer open." };
  // The pointer the Mentor left among its insights is closed with the proposal.
  const closePointer = async (status: "done" | "dismissed") => {
    const open = (await store.mentor.since(addDays(ctx.today, -30)).catch(() => [])).filter((i) => i.key === "roles:proposal" && i.status === "new");
    for (const i of open) await store.mentor.setStatus(i.id, status).catch(() => undefined);
  };

  if (p.data.decision === "dismissed") {
    await store.roleProposals.setStatus(proposal.id, "dismissed");
    await closePointer("dismissed");
    await audit(store, { actor: "owner", action: "roles.proposal", target: "target-roles", detail: "dismissed", outcome: "success" });
    refresh();
    return { ok: true, message: "Dismissed. The Mentor will not raise this same order again for three weeks." };
  }

  const current = careerPrefs(ctx.settings).roles.map((r) => r.name);
  if (!sameOrder(current, proposal.base)) {
    await store.roleProposals.setStatus(proposal.id, "stale");
    await closePointer("dismissed");
    refresh();
    return { ok: false, error: STALE };
  }

  let wrote = "your role order in Atlas";
  if (ctx.mode === "live" && notionConfigured()) {
    assertSessionIsOwner(ctx);
    let done: { pageId: string; was: number | null }[] = [];
    let priorityProp = "";
    try {
      const read = await readRoleRows(ctx.settings.notionResumesId);
      priorityProp = read.priorityProp;
      // Atlas's names for the rows ("FDE" and "Forward Deployed Engineer" are one role).
      const rows = read.rows.map((r) => ({ ...r, name: r.master ? r.name : rolesFrom([r.name])[0]!.name }));
      const live = rows
        .filter((r) => !r.master)
        .map((r, i) => ({ r, i }))
        .sort((a, b) => (a.r.priority ?? Infinity) - (b.r.priority ?? Infinity) || a.i - b.i)
        .map(({ r }) => r.name);
      if (!sameOrder([...new Set(live)], proposal.base)) {
        await store.roleProposals.setStatus(proposal.id, "stale");
        await closePointer("dismissed");
        refresh();
        return { ok: false, error: STALE };
      }
      const plan = priorityPlan(rows, proposal.proposed);
      for (const s of plan.set) {
        const row = rows.find((r) => !r.master && r.name === s.name)!;
        await writeRolePriority(row.pageId, read.priorityProp, s.priority);
        done.push({ pageId: row.pageId, was: row.priority });
      }
      for (const c of plan.create) await createRoleRow(read, c.name, c.priority);
      done = [];
      wrote = `the Priority numbers in your Notion Resumes database${plan.create.length ? `, and added a row for ${plan.create.map((c) => c.name).join(", ")}` : ""}`;
    } catch (err) {
      // A write that failed part-way must not leave a half-applied order: put back what was changed.
      for (const d of done) if (d.was !== null) await writeRolePriority(d.pageId, priorityProp, d.was).catch(() => undefined);
      await audit(store, { actor: "owner", action: "roles.proposal", target: "notion", detail: "write failed", outcome: "error" });
      const why = err instanceof NotionError ? (err.problem === "forbidden" ? NOTION_WRITE_HELP : err.message) : "Notion could not be updated. Nothing was changed; try again in a minute.";
      return { ok: false, error: why };
    }
    // Read the order back from Notion, the same way every sync does.
    await syncNotion(store, ctx.settings, new Date()).catch(() => null);
  } else {
    await store.settings.update({ careerRoles: proposal.proposed });
  }
  await store.roleProposals.setStatus(proposal.id, "approved");
  await closePointer("done");
  await audit(store, { actor: "owner", action: "roles.proposal", target: "target-roles", detail: `approved: ${proposal.proposed.length} roles, ${proposal.added.length} added`, outcome: "success" });
  refresh();
  return { ok: true, message: `Approved. Atlas updated ${wrote}.` };
}

/** Asks the Mentor to review your role order now, on a fresh market report. */
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
