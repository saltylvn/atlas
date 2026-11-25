"use client";

import { useState, useTransition } from "react";
import { rewriteFollowUp } from "@/app/actions/followUp";
import { Icon } from "../Icon";

/** Runs the Nudger on one waiting follow-up. */
export function RewriteFollowUp({ approvalId, written }: { approvalId: string; written: boolean }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await rewriteFollowUp(approvalId);
            setNote(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
          })
        }
      >
        <Icon name="wand" size={14} /> {pending ? "Rewriting…" : written ? "Rewrite again" : "Rewrite with agent"}
      </button>
      {note && (
        <span role="status" className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>
          {note.text}
        </span>
      )}
    </span>
  );
}
