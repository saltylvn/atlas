"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/app/actions/_shared";
import { updateCareerMap } from "@/app/actions/dataPipeline";
import { Icon } from "../Icon";

/** "Update now": the Career Mentor rebuilds this week's Career Map (rules for facts, AI for steps). */
export function UpdateCareerMapButton() {
  const [state, action, pending] = useActionState(async () => updateCareerMap(), null as ActionResult | null);
  return (
    <form action={action} className="flex flex-col items-start gap-1 sm:items-end">
      <button className="btn btn-sm min-h-11" disabled={pending}>
        <Icon name="sparkle" size={14} /> {pending ? "Updating… (up to a minute)" : "Update now"}
      </button>
      {state && (
        <p role="status" className={`max-w-xs text-xs ${state.ok ? "text-ink-2" : "text-bad"}`}>
          {state.ok ? state.message : state.error}
        </p>
      )}
    </form>
  );
}
