"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/app/actions/_shared";
import { checkTypesNow } from "@/app/actions/dataPipeline";
import { Icon } from "../Icon";

/** "Check now": one AI second opinion on 40 jobs' engineering-type labels. Display-only. */
export function CheckTypesButton() {
  const [state, action, pending] = useActionState(async () => checkTypesNow(), null as ActionResult | null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <button className="btn btn-sm min-h-11" disabled={pending}>
        <Icon name="sparkle" size={14} /> {pending ? "Checking…" : "Check now"}
      </button>
      {state && (
        <p role="status" className={`text-xs ${state.ok ? "text-ink-2" : "text-bad"}`}>
          {state.ok ? state.message : state.error}
        </p>
      )}
    </form>
  );
}
