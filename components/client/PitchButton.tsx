"use client";

import { useState, useTransition } from "react";
import { tailorWithPitch } from "@/app/actions/pitch";
import { Icon } from "../Icon";

/** Runs the Tailor on one queued job. "Continue" when an earlier run paused for time. */
export function PitchButton({ kitId, state }: { kitId: string; state: "none" | "running" | "done" }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const label = pending ? "Tailoring…" : state === "running" ? "Continue tailoring" : state === "done" ? "Tailor again" : "Tailor this job";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-11"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await tailorWithPitch(kitId);
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
