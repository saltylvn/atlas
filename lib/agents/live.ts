import "server-only";
import type { Context } from "@/lib/context";
import { hourLabel, nextBrief, nextSync, SLOT_LABEL } from "@/lib/domain/briefSchedule";
import { shortDate, zonedToUtc } from "@/lib/domain/dates";
import { liveSnapshot, mcpLive, type LiveSnapshot } from "@/lib/domain/orchestration";
import { env } from "@/lib/env";

/** How far back the live map looks: enough for several full syncs (a sync writes about 12 rows). */
const ROWS = 90;
/** Audit rows read for the MCP box: plenty for a day of Claude's reads. */
const AUDIT_ROWS = 300;

/**
 * What Mission Control's live map shows right now, read from the activity log.
 * `detail` adds run details and step notes; without it the snapshot holds names,
 * timings and results only, so it is safe on a screen anyone can see.
 */
export async function loadLive(ctx: Pick<Context, "store" | "now" | "today" | "time" | "settings">, detail: boolean): Promise<LiveSnapshot> {
  const [rows, states, used, audit] = await Promise.all([
    ctx.store.agentRuns.recent(ROWS).catch(() => []),
    ctx.store.agentState.list().catch(() => []),
    // A count only: which calls, and what they said, stay out of the snapshot.
    ctx.store.aiUsage.countToday().catch(() => 0),
    // Claude's MCP reads today: counts and times only, from the audit log.
    ctx.store.audit.recent(AUDIT_ROWS).catch(() => []),
  ]);
  const sync = nextSync(ctx.today, ctx.time);
  const brief = nextBrief(ctx.today, ctx.time);
  return liveSnapshot({
    rows,
    paused: states.filter((s) => s.paused).map((s) => s.agent),
    now: ctx.now,
    detail,
    nextSync: `around ${hourLabel(sync.hour)}${sync.day === ctx.today ? "" : `, ${shortDate(sync.day)}`}`,
    nextBrief: `${SLOT_LABEL[brief.slot]}, ${brief.day === ctx.today ? "today" : shortDate(brief.day)}`,
    aiCalls: { used, limit: env().ATLAS_AI_DAILY_LIMIT },
    mcp: mcpLive(ctx.settings.mcpEnabled === true, audit, ctx.now, zonedToUtc(ctx.today, "00:00", ctx.settings.timezone).toISOString()),
  });
}
