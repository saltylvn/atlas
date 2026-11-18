import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { FUNCTION_LIMIT_MS } from "@/lib/domain/deadline";
import { slotAt } from "@/lib/domain/mentor";
import { runAnalyst } from "./analyst";
import { readNewJobMail, trackApplications } from "./career";
import { logRun, NO_MODEL } from "./log";
import { runMentor, type MentorResult } from "./mentor";
import { runScout, type ScoutResult } from "./scout";
import { tracer } from "./trace";

// "Refresh and review", from the Mentor's card: the Career desk brings its data up to date,
// then the Mentor reviews with it. Each agent logs its own run as usual; this run's trace
// shows the order and what each step found (counts only).
//
//   1. at once: the Scout reads the job boards; the Applications Agent reads new job
//      emails and updates the board
//   2. the Analyst recomputes the market report from what the Scout just recorded
//   3. the Mentor reviews, and may update today's insights whose numbers moved

export const MENTOR_REFRESH_TASK = "Refresh and review";

export interface RefreshOutcome {
  /** What changed, one line per step, for the button to show. */
  lines: string[];
  mentor: MentorResult | AgentMissing;
}

const missingLine = (who: string, r: AgentMissing) => `${who}: ${r.missing === "skipped" ? `skipped (${r.why})` : `could not run (${r.why})`}`;

export async function runMentorRefresh(ctx: Context, persist: Store): Promise<RefreshOutcome | AgentMissing> {
  // Someone is waiting on this: the page's limit, with every model call cut to the time left.
  ctx = { ...ctx, deadline: ctx.deadline ?? Date.now() + FUNCTION_LIMIT_MS };
  const runId = randomUUID();
  const agent = "mentor" as const;
  await logRun(ctx, { runId, agent, task: MENTOR_REFRESH_TASK, status: "started", trigger: "run-now", detail: "", ...NO_MODEL });
  const t = tracer();
  const lines: string[] = [];
  try {
    const [scout, apps] = await Promise.all([
      t.step(
        "Ask the Scout for fresh postings",
        () => runScout(ctx, { trigger: "run-now", honorPause: false, persist }),
        (r) => ("missing" in r ? `${r.missing}: ${r.why}` : `${r.recorded} recorded, ${r.added} new`),
      ),
      t.step(
        "Update applications from new job emails",
        async () => {
          const reading = await readNewJobMail(ctx, persist);
          return trackApplications(ctx, reading.items, persist).catch(() => ({ created: 0, updated: 0, jobEmails: 0, roles: 0 }));
        },
        (r) => `${r.created} new, ${r.updated} moved forward, ${r.roles} roles filled in`,
      ),
    ]);
    lines.push("missing" in scout ? missingLine("Scout", scout) : `Scout: ${(scout as ScoutResult).added} new posting${(scout as ScoutResult).added === 1 ? "" : "s"} recorded (${(scout as ScoutResult).inWindow} in the last 30 days).`);
    const moved = apps.created + apps.updated + apps.roles;
    lines.push(moved ? `Applications: ${[apps.created && `${apps.created} new`, apps.updated && `${apps.updated} moved forward`, apps.roles && `${apps.roles} roles filled in`].filter(Boolean).join(", ")}.` : "Applications: no changes from your email.");

    // Fresh: never today's earlier report, since the Scout just added to what it reads.
    const analyst = await t.step("Ask the Analyst for a fresh market report", () => runAnalyst(ctx, { trigger: "run-now", honorPause: false, persist, reuseToday: false }), (r) =>
      "missing" in r ? `${r.missing}: ${r.why}` : r.report.headline,
    );
    lines.push("missing" in analyst ? missingLine("Analyst", analyst) : `Analyst: ${analyst.report.headline}`);

    const mentor = await t.step("Ask the Mentor to review with the fresh data", () => runMentor(ctx, slotAt(ctx.time), { trigger: "run-now", honorPause: false, persist, refresh: true }), (r) =>
      "missing" in r ? `${r.missing}: ${r.why}` : `${r.insights.length} insight${r.insights.length === 1 ? "" : "s"}, ${r.updated} updated`,
    );
    if ("missing" in mentor) lines.push(missingLine("Mentor", mentor));
    else {
      const fresh = mentor.insights.length - mentor.updated;
      lines.push(
        mentor.insights.length
          ? `Mentor: ${[fresh > 0 && `${fresh} new insight${fresh === 1 ? "" : "s"}`, mentor.updated > 0 && `${mentor.updated} updated with the new numbers`].filter(Boolean).join(", ")}.`
          : "Mentor: nothing has changed enough to say more; your open insights still stand.",
      );
    }
    await logRun(ctx, { runId, agent, task: MENTOR_REFRESH_TASK, status: "succeeded", trigger: "run-now", detail: lines.map((l) => l.split(":")[0]).join(", ") + " refreshed", ...NO_MODEL, ...t.finish() });
    return { lines, mentor };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: MENTOR_REFRESH_TASK, status: "failed", trigger: "run-now", detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
