"use client";

import type { ActionResult } from "@/app/actions/_shared";
import { useActionState, useEffect, useRef, useTransition } from "react";
import { addWatch, removeWatch } from "@/app/actions/jobs";
import { JOB_BOARD_INFO, JOB_BOARDS } from "@/lib/domain/types";
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
        <select name="board" className="field" defaultValue="greenhouse" aria-label="Board">
          {JOB_BOARDS.map((b) => (
            <option key={b} value={b}>
              {JOB_BOARD_INFO[b].label}
            </option>
          ))}
        </select>
        <input name="slug" required placeholder="board slug" pattern="[a-z0-9][a-z0-9-]*" className="field" aria-label="Board slug" />
      </div>
      <p className="text-xs text-ink-3">
        The slug is the company part of its jobs URL, e.g. boards.greenhouse.io/<b>vercel</b>, jobs.smartrecruiters.com/<b>visa</b>, <b>bunq</b>.recruitee.com or <b>kiln</b>.bamboohr.com.
      </p>
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

/** One suggested company: its Watch button adds it to the watchlist, the same as the form above. */
export function SuggestWatchButton({ company, board, slug }: { company: string; board: string; slug: string }) {
  const [state, action, pending] = useActionState(addWatch, null as Result);
  if (state?.ok) return <span className="text-xs text-ink-3">Watching</span>;
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="company" value={company} />
      <input type="hidden" name="board" value={board} />
      <input type="hidden" name="slug" value={slug} />
      {state && !state.ok && <span className="text-xs text-bad">{state.error}</span>}
      <button className="btn btn-ghost btn-sm min-h-11" disabled={pending} aria-label={`Watch ${company}`}>
        <Icon name="plus" size={14} /> Watch
      </button>
    </form>
  );
}
