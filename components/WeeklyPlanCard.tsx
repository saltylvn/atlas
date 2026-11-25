import Link from "next/link";
import { ApprovePlan, PlanWeekButton } from "@/components/client/WeeklyPlanActions";
import { Icon } from "@/components/Icon";
import { shortDate } from "@/lib/domain/dates";
import { minutesLabel } from "@/lib/domain/planner";
import { moveDayName, type WeeklyPlan } from "@/lib/domain/weeklyPlan";
import type { Task } from "@/lib/domain/types";

// This week's plan from the Weekly Strategist: three moves, each with the numbers it rests on.
// Proposed: approve it (the moves become tasks on your days) or pass. Approved: how far along you are.
// A Career card, so it carries the Career desk's orange.

export function WeeklyPlanCard({ plan, tasks, compact = false }: { plan: WeeklyPlan | null; tasks: readonly Pick<Task, "id" | "status">[]; compact?: boolean }) {
  const status = new Map(tasks.map((t) => [t.id, t.status]));
  const done = (i: number) => plan?.status === "approved" && status.get(plan.taskIds?.[i] ?? "") === "done";
  const finished = plan ? plan.moves.filter((_, i) => done(i)).length : 0;
  return (
    <section className="card card-pad border-l-4" style={{ borderLeftColor: "var(--c-career)" }} aria-labelledby="weekly-plan">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="eyebrow flex items-center gap-1.5">
            <Icon name="flow" size={13} /> Planner · agent
          </p>
          <h2 id="weekly-plan" className="h-display mt-1 text-lg font-medium">
            {plan ? `This week's plan · week of ${shortDate(plan.weekOf)}` : "This week's plan"}
          </h2>
        </div>
        {plan?.status === "approved" && (
          <span className="text-sm text-ink-2">
            {finished} of {plan.moves.length} done
          </span>
        )}
      </div>

      {!plan ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">Each Sunday night the Planner reads your funnel, Apply Queue, applications and last week, and proposes three moves for the week. You approve; they land on your days.</p>
          <PlanWeekButton />
        </div>
      ) : plan.status === "dismissed" ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">You passed on this week&apos;s plan. Ask for a new one any time.</p>
          <PlanWeekButton />
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">{plan.headline}</p>
          <ol className="space-y-2">
            {plan.moves.map((m, i) => (
              <li key={m.id} className="flex gap-3 rounded-lg border border-line p-3">
                <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${done(i) ? "bg-[var(--c-green)] text-white" : "bg-surface-2 text-ink-2"}`}>
                  {done(i) ? <Icon name="check" size={13} /> : i + 1}
                </span>
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${done(i) ? "text-ink-3 line-through" : ""}`}>{m.title}</p>
                  <p className="text-xs text-ink-3">
                    {moveDayName(plan.weekOf, m.day)} · {minutesLabel(m.minutes)}
                  </p>
                  {!compact && <p className="mt-1 text-sm text-ink-2">{m.why}</p>}
                </div>
              </li>
            ))}
          </ol>
          {!compact && plan.facts.length > 0 && (
            <details className="text-xs text-ink-3">
              <summary className="cursor-pointer select-none">What it read ({plan.facts.length} facts)</summary>
              <ul className="mt-2 space-y-1">
                {plan.facts.map((f) => (
                  <li key={f.id}>
                    <span className="font-mono">{f.id}</span> {f.text}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {plan.status === "proposed" ? (
            <ApprovePlan weekOf={plan.weekOf} />
          ) : (
            <p className="text-xs text-ink-3">
              On your days as Career tasks. <Link href="/plan" className="underline">Open Plan</Link>
              {plan.writer === "rules" ? " · written by rules (AI was not available)" : ""}
            </p>
          )}
          {plan.status === "proposed" && plan.writer === "rules" && <p className="text-xs text-ink-3">Written by rules: AI was not available.</p>}
        </div>
      )}
    </section>
  );
}
