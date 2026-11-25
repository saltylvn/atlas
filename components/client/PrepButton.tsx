"use client";

import { useState, useTransition } from "react";
import { prepareInterview } from "@/app/actions/prep";
import { Icon } from "../Icon";

/** Runs the Coach on one application. "Continue" when an earlier run paused for time. */
export function PrepButton({ appId, state }: { appId: string; state: "none" | "running" | "done" }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const label = pending ? "Preparing…" : state === "running" ? "Continue prep" : state === "done" ? "Prepare again" : "Prepare for the interview";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-11"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await prepareInterview(appId);
            setNote(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
          })
        }
      >
        <Icon name="wand" size={14} /> {label}
      </button>
      {note && (
        <span role="status" className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>
          {note.text}
        </span>
      )}
    </div>
  );
}
