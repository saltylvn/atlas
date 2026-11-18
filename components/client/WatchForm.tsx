"use client";

import type { ActionResult } from "@/app/actions/_shared";
import { useActionState, useEffect, useRef, useTransition } from "react";
import { addWatch, removeWatch } from "@/app/actions/jobs";
import { JOB_BOARDS } from "@/lib/domain/types";
import { Icon } from "../Icon";

type Result = ActionResult | null;

export function WatchForm() {
  const [state, action, pending] = useActionState(addWatch, null as Result);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input name="company" required maxLength={80} placeholder="Company" aria-label="Company" className="field col-span-2" />
        <select name="board" className="field capitalize" defaultValue="greenhouse" aria-label="Board">
          {JOB_BOARDS.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </select>
        <input name="slug" required placeholder="board slug" pattern="[a-z0-9][a-z0-9-]*" className="field" aria-label="Board slug" />
      </div>
      <p className="text-xs text-ink-3">The slug is the company part of its jobs URL, e.g. boards.greenhouse.io/<b>vercel</b> or jobs.ashbyhq.com/<b>linear</b>.</p>
      <div className="flex items-center gap-2">
        <button className="btn btn-primary btn-sm" disabled={pending}>
          <Icon name="plus" size={14} /> Watch
        </button>
        {state && !state.ok && <span className="text-sm text-bad">{state.error}</span>}
      </div>
    </form>
  );
}

export function UnwatchButton({ id, company }: { id: string; company: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" aria-label={`Stop watching ${company}`} disabled={pending} onClick={() => start(async () => void (await removeWatch(id)))} className="rounded p-1 text-ink-3 hover:text-bad">
      <Icon name="x" size={14} />
    </button>
  );
}
