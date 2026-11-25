import Link from "next/link";
import { followUpReplies } from "@/lib/domain/followUpAgent";
import { getContext } from "@/lib/context";
import { AutoRefresh } from "@/components/client/AutoRefresh";
import { RefreshButton } from "@/components/client/RefreshButton";
import { Icon } from "@/components/Icon";
import { PageHeader, Pill } from "@/components/ui";
import { actionLabel } from "@/lib/domain/applyLane";
import { addDays, localTime } from "@/lib/domain/dates";
import { ACTION_STAGES, huntBoard, STAGE_HINT, STAGE_LABEL, STAGES, type BoardCard, type Stage } from "@/lib/domain/huntBoard";
import { FunnelCard } from "@/components/FunnelCard";
import { funnel } from "@/lib/domain/outcomes";

export const metadata = { title: "Tracker" };

// One hue per stage, used for its count and the bar on its column (badges only, as in the Atlas look).
const HUE: Record<Stage, string> = {
  fits: "var(--c-career)",
  queue: "var(--c-indigo)",
  applied: "var(--c-slate)",
  followUp: "var(--c-warn)",
  followedUp: "var(--c-brown)",
  talking: "var(--c-green)",
  rejected: "var(--c-red)",
  noLuck: "var(--c-grey)",
};
/** Cards shown per stage before "+N more": the board is for a glance, not a scroll. */
const SHOWN = 6;

function Card({ c }: { c: BoardCard }) {
  return (
    <li className="rounded-lg border border-line bg-surface p-2.5">
      <p className="text-sm leading-snug font-medium break-words">{c.title}</p>
      {c.company && <p className="text-xs text-ink-2 break-words">{c.company}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {c.note && <span className="text-xs text-ink-3">{c.note}</span>}
        {c.by && <Pill color={c.by === "atlas" ? "var(--c-indigo)" : "var(--c-grey)"}>{c.by === "atlas" ? "Atlas" : "You"}</Pill>}
      </div>
    </li>
  );
}

/**
 * The status board: where every job in your hunt stands, for an iPad on your desk. It only
 * shows; you give thumbs on your phone and apply on your MacBook.
 * It checks for changes every minute by itself.
 */
export default async function StatusBoardPage() {
  const ctx = await getContext();
  const { store, today } = ctx;
  const [apps, approvals, matches] = await Promise.all([
    store.applications.list().catch(() => []),
    store.approvals.list().catch(() => []),
    store.jobMatches.since(addDays(today, -3)).catch(() => []),
  ]);
  const board = huntBoard({ apps, approvals, matches, today });
  const rate = board.sent ? Math.round((board.answered / board.sent) * 100) : 0;
  // Do follow-ups work? Replies heard within a week of one you sent, and of those the agent wrote.
  const agentWritten = new Set((await store.agentRunState.recent("followup", 200).catch(() => [])).filter((r) => r.status === "done").map((r) => r.runId.replace(/^followup:/, "")));
  const fu = followUpReplies(approvals, apps, agentWritten, today);

  return (
    <div className="space-y-4">
      <AutoRefresh everyMs={60_000} />
      <PageHeader
        title="Tracker"
        action={<RefreshButton />}
        sub={`Where every job stands. ${board.sent} sent, ${board.answered} answered (${rate}%). Updated ${localTime(ctx.now, ctx.settings.timezone)}; it refreshes every minute.`}
      />

      {fu.sent > 0 && (
        <p className="text-sm text-ink-2" aria-label="Follow-ups that got a reply">
          Follow-ups: <span className="font-medium text-ink">{fu.replied} of {fu.sent}</span> got a reply within a week
          {fu.agent.sent > 0 && (
            <>
              {" "}
              · written by the Nudger: <span className="font-medium text-ink">{fu.agent.replied} of {fu.agent.sent}</span>
            </>
          )}
          .
        </p>
      )}

      {/* The funnel at a glance: one number per stage, in the order a job moves. */}
      <ol className="grid grid-cols-3 gap-2 text-center lg:grid-cols-8" aria-label="Jobs in each stage">
        {STAGES.map((s) => (
          <li key={s} className="rounded-lg border border-line bg-surface px-1 py-2">
            <p className="h-display text-2xl font-medium" style={{ color: HUE[s] }}>
              {board.stages[s].length}
            </p>
            <p className="text-[0.7rem] font-medium text-ink-2">{STAGE_LABEL[s]}</p>
            {ACTION_STAGES.has(s) && board.stages[s].length > 0 && (
              <p className="mt-1">
                <Pill color="var(--c-warn)" className="!h-auto !px-1.5 text-[0.65rem]">Needs you</Pill>
              </p>
            )}
          </li>
        ))}
      </ol>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STAGES.map((s) => {
          const cards = board.stages[s];
          return (
            <section key={s} className="card card-pad !p-3" aria-label={STAGE_LABEL[s]} style={{ borderTopColor: HUE[s], borderTopWidth: 2 }}>
              <h2 className="h-display flex items-baseline justify-between gap-2 text-[0.95rem] font-medium">
                {STAGE_LABEL[s]}
                <span className="text-sm text-ink-3">{cards.length}</span>
              </h2>
              <p className="mb-2 text-xs text-ink-3">{STAGE_HINT[s]}</p>
              {/* A stage that waits on you says so, as an alert. */}
              {ACTION_STAGES.has(s) && cards.length > 0 && (
                <p className="mb-2">
                  <Pill color="var(--c-warn)" className="!h-auto min-h-6 gap-1 whitespace-normal py-0.5 text-left">
                    <Icon name="alert" size={12} /> {actionLabel(cards.length)}
                  </Pill>
                </p>
              )}
              {cards.length === 0 ? (
                <p className="text-xs text-ink-3">None</p>
              ) : (
                <ul className="space-y-2">
                  {cards.slice(0, SHOWN).map((c) => (
                    <Card key={c.id} c={c} />
                  ))}
                </ul>
              )}
              {cards.length > SHOWN && <p className="mt-2 text-xs text-ink-3">+{cards.length - SHOWN} more</p>}
            </section>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/applications" className="btn btn-ghost btn-sm min-h-[44px]">
          Edit or add an application
        </Link>
        <Link href="/jobs" className="btn btn-ghost btn-sm min-h-[44px]">
          Interviews and follow-ups due
        </Link>
      </div>
      <p className="text-xs text-ink-3">Give thumbs on the Apply tab and apply on your MacBook. This page only shows where things stand.</p>

      <FunnelCard f={funnel(apps, today)} />
    </div>
  );
}
