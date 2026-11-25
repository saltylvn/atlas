"use client";

import { useState, useTransition } from "react";
import { approveWeeklyPlan, dismissWeeklyPlan, planMyWeek } from "@/app/actions/weeklyPlan";
import type { ActionResult } from "@/app/actions/_shared";
import { Icon } from "../Icon";

function useAction() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const r = await fn();
      setNote(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
    });
  const status = note && (
    <span role="status" className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>
      {note.text}
    </span>
  );
  return { pending, run, status };
}

/** Runs the Weekly Strategist now. */
export function PlanWeekButton({ again = false }: { again?: boolean }) {
  const { pending, run, status } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={`btn btn-sm min-h-11 ${again ? "btn-ghost" : "btn-primary"}`} disabled={pending} onClick={() => run(planMyWeek)}>
        <Icon name="wand" size={14} /> {pending ? "Planning…" : again ? "Plan again" : "Plan my week"}
      </button>
      {status}
    </div>
  );
}

/** Approve (the moves become tasks on your days) or pass, then a fresh plan if you like. */
export function ApprovePlan({ weekOf }: { weekOf: string }) {
  const { pending, run, status } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="btn btn-primary btn-sm min-h-11" disabled={pending} onClick={() => run(() => approveWeeklyPlan(weekOf))}>
        <Icon name="check" size={14} /> {pending ? "Adding…" : "Approve and add to my days"}
      </button>
      <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => run(() => dismissWeeklyPlan(weekOf))}>
        Pass
      </button>
      <PlanWeekButton again />
      {status}
    </div>
  );
}
