import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCallWithin } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import type { Usage } from "@/lib/ai/models";
import { RolesOut, rolesData, rolesTask } from "@/lib/ai/prompts";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { addDays } from "@/lib/domain/dates";
import { AFTER_SPECIALIST_MS, aiCap, modelWait } from "@/lib/domain/deadline";
import type { NewInsight } from "@/lib/domain/mentor";
import { acceptJudgment, draftProposal, sameOrder, withoutPrivate, worthProposing, type RoleProposal, type RoleProposalDraft } from "@/lib/domain/roleOutlook";
import type { AgentRunEvent } from "@/lib/domain/types";
import { careerPrefs } from "./career";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Mentor's review of your target roles. It reads the Analyst's outlook (how qualified
// you are for each role, measured against your GitHub projects and resumes, with demand,
// pay and your own results) and decides whether your order should change.
//
// Facts from rules, judgment from the model:
//   - the rules draft a proposal and decide whether one is worth raising at all;
//   - the model (Gemini) is then asked to judge the order, within bounds: it may not drop
//     a role, may add at most one of the roles it is offered, must give a reason for each
//     move, and may not write a number that is not in the facts. An answer outside those
//     bounds is dropped and the rules' proposal stands;
//   - if the model judges that nothing should change, nothing is proposed.
// It writes one row to role_proposals and one pointer to mentor_insights. It never changes
// your roles: that happens only when you approve, in app/actions/roles.ts.

export const ROLES_TASK = "Mentor: target roles review";
// Inside a run, the run's deadline still cuts this (modelWait).
const MODEL_WAIT_MS = 24_000;

export interface RolesReviewOptions {
  trigger: AgentRunEvent["trigger"];
  honorPause: boolean;
  persist: Store;
  /** The Mentor's slot, for the pointer it leaves among its insights. */
  slot?: NewInsight["slot"];
}

export type RolesReview = { proposal: RoleProposal | null; headline: string };

export async function runRolesReview(ctx: Context, opts: RolesReviewOptions): Promise<RolesReview | AgentMissing> {
  const agent = "mentor" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  if (opts.honorPause && (await isPaused(ctx, agent))) return { missing: "skipped", why: "paused in Mission Control" };

  const [market, prior, repos] = await Promise.all([ctx.store.market.latestReport().catch(() => null), ctx.store.roleProposals.recent(20).catch(() => []), ctx.store.portfolio.list().catch(() => [])]);
  // A report older than three days describes a market that has moved on.
  const outlook = market && market.forDate >= addDays(ctx.today, -3) ? market.report.outlook : undefined;
  if (!outlook || outlook.length === 0) return { proposal: null, headline: "No role outlook yet: the Analyst computes it with the next market report." };
  // The outlook was computed for the order of that day. If your roles changed since, wait for a fresh one.
  const current = careerPrefs(ctx.settings).roles.map((r) => r.name);
  if (!sameOrder(outlook.filter((o) => o.target).map((o) => o.role), current)) return { proposal: null, headline: "Your roles changed since the last market report. The next report will use the new order." };

  const draft = draftProposal(outlook);
  if (!draft) return { proposal: null, headline: "Too few postings to judge your role order yet." };
  if (!worthProposing(draft, prior, ctx.today)) {
    const open = prior.find((p) => p.status === "new");
    return { proposal: open ?? null, headline: open ? "A proposal is already waiting for your decision." : sameOrder(draft.base, draft.order) ? "Your role order already matches what you can show and what the market asks." : "Nothing new to propose since the last decision." };
  }

  await logRun(ctx, { runId, agent, task: ROLES_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  let usage: Usage | null = null;
  try {
    let chosen: RoleProposalDraft = draft;
    let writer: RoleProposal["writer"] = "rules";
    let declined = false;
    const wait = modelWait(aiCap(ctx, MODEL_WAIT_MS), ctx.deadline, Date.now(), AFTER_SPECIALIST_MS);
    const gate = await takeAiCallWithin(ctx.store, ctx.settings, "mentor:roles", wait);
    if (!gate.allowed) t.note("Judge the order", `rules proposal: ${gate.why}`);
    else {
      // Names of private repositories are not sent to the model.
      const shown = draftProposal(withoutPrivate(outlook, new Set(repos.filter((r) => r.isPrivate).map((r) => r.name)))) ?? draft;
      const prefs = careerPrefs(ctx.settings);
      const pay = prefs.minSalary > 0 ? ` paying at least $${Math.round(prefs.minSalary / 1000)}k a year` : "";
      const goal = `A full-time engineering role${pay}, remote or in Salt Lake County.`;
      const res = await t.step(
        "Judge the order",
        () => structuredWithin(wait, RolesOut, rolesTask(goal), rolesData({ current: draft.base, rules: draft.order, mayAdd: draft.mayAdd, facts: shown.facts })),
        (r) => (r.ok ? `${aiName()} ${r.value.change ? "proposed an order" : "judged no change"}` : `rules proposal (${whyNoAnswer(r)})`),
      );
      usage = res.usage ?? null;
      if (res.ok) {
        if (!res.value.change || sameOrder(res.value.order.map((r) => r.trim()), draft.base)) declined = true;
        else {
          const accepted = acceptJudgment({ ...draft, facts: shown.facts }, res.value);
          if (accepted) {
            chosen = { ...accepted, facts: draft.facts };
            writer = "model";
          } else t.note("Check the judgment against the facts", "it dropped a role, added one it was not offered, moved a role without a reason, or wrote a number that is not in the facts: the rules' proposal stands", false);
        }
      }
    }

    const row = await t.step(
      declined ? "Record that no change was judged best" : "Save the proposal",
      () =>
        persist.roleProposals.add({
          forDate: ctx.today,
          base: draft.base,
          // A declined row remembers which order was considered, so it is not reconsidered daily.
          proposed: declined ? draft.order : chosen.order,
          added: declined ? [] : chosen.added,
          focus: declined ? draft.base.slice(0, 3) : chosen.focus,
          headline: declined ? "No change: your current order holds up." : chosen.headline,
          reasons: declined ? [] : chosen.reasons,
          facts: draft.facts.slice(0, 16),
          writer: declined ? "model" : writer,
          ...(declined ? { status: "declined" as const } : {}),
        }),
    );
    if (!declined) {
      // A pointer among the Mentor's insights, so the proposal shows on Today and Growth.
      const moved = chosen.order.filter((r) => chosen.base.includes(r) && chosen.order.filter((x) => chosen.base.includes(x)).indexOf(r) < chosen.base.indexOf(r)).length;
      await persist.mentor
        .add([
          {
            forDate: ctx.today,
            slot: opts.slot ?? "morning",
            key: "roles:proposal",
            area: "targeting",
            title: chosen.headline.slice(0, 160),
            body: `Proposed order: ${chosen.order.join(", ")}.`.slice(0, 600),
            action: "Open Target roles, read the reasons, and approve or dismiss the proposed order. Nothing changes until you do.",
            evidence: chosen.facts.slice(0, 4).map((f) => f.slice(0, 400)),
            metric: `${moved} moved, ${chosen.added.length} added`,
            writer,
            status: "new",
          },
        ])
        .catch(() => undefined);
    }
    const moved = declined ? 0 : chosen.order.filter((r) => chosen.base.includes(r) && chosen.order.filter((x) => chosen.base.includes(x)).indexOf(r) < chosen.base.indexOf(r)).length;
    const headline = declined ? "The Mentor reviewed your role order and judged it should stay as it is." : `Proposed a new role order: ${moved} moved up, ${chosen.added.length} added. It waits for your approval.`;
    await logRun(ctx, {
      runId,
      agent,
      task: ROLES_TASK,
      status: "succeeded",
      trigger,
      detail: `${headline.replace(/\.$/, "")}, judged by ${writer === "model" || declined ? aiName() : "rules"}`,
      ...(usage ? { model: usage.model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: usage.costUsd } : NO_MODEL),
      ...t.finish(),
    });
    return { proposal: declined ? null : row, headline };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: ROLES_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
