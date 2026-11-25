"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/app/actions/_shared";
import { findCompanyBoard } from "@/app/actions/boardFinder";
import type { FinderResult } from "@/lib/agents/boardFinder";
import { JOB_BOARD_INFO } from "@/lib/domain/types";
import { Icon } from "../Icon";
import { SuggestWatchButton } from "./WatchForm";

type State = ActionResult<FinderResult> | null;

/** "Find a company's board": free guesses first, then Firecrawl on its website. You press Watch. */
export function BoardFinder() {
  const [state, action, pending] = useActionState(findCompanyBoard, null as State);
  return (
    <div className="space-y-3">
      <form action={action} className="grid gap-2">
        <label className="space-y-1 text-xs text-ink-3">
          <span className="block">Company</span>
          <input name="company" required maxLength={80} placeholder="Lucid Software" className="field w-full" />
        </label>
        <label className="space-y-1 text-xs text-ink-3">
          <span className="block">Website (optional)</span>
          <input name="website" maxLength={200} placeholder="lucid.co" inputMode="url" className="field w-full" />
        </label>
        <button className="btn btn-primary btn-sm min-h-11 justify-self-start" disabled={pending}>
          <Icon name="sparkle" size={14} /> {pending ? "Looking…" : "Find its board"}
        </button>
      </form>
      <p className="text-xs text-ink-3">Tries the likely board names on eight job-board systems first (free). With a website, and only if that finds nothing, Firecrawl reads the careers page (2 credits).</p>
      {state && !state.ok && (
        <p role="status" className="text-sm text-bad">
          {state.error}
        </p>
      )}
      {state?.ok && state.data && (
        <div role="status" className="space-y-2">
          {state.data.found.length === 0 ? (
            <p className="text-sm text-ink-2">No board found.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {state.data.found.map((f) => (
                <li key={`${f.board}:${f.slug}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{JOB_BOARD_INFO[f.board].label}</span> <code className="text-xs text-ink-2">{f.slug}</code>
                    <span className="block text-xs text-ink-3">
                      {f.jobs} open jobs · {f.us} in the U.S. · {f.utah} in Utah · found by {f.via === "guess" ? "a free check" : "its careers page"}
                    </span>
                  </span>
                  <SuggestWatchButton company={state.data!.company} board={f.board} slug={f.slug} />
                </li>
              ))}
            </ul>
          )}
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-3">
            {state.data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
