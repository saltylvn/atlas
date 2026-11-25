"use client";

import { useState, useTransition } from "react";
import { researchCompany } from "@/app/actions/career";
import { Icon } from "@/components/Icon";

/** "Research this company": news, its own pages and the angle, for one job's apply brief. */
export function ResearchButton({ approvalId, again }: { approvalId: string; again: boolean }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            setNote(null);
            const res = await researchCompany(approvalId);
            setNote(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error });
          })
        }
      >
        <Icon name="refresh" size={14} /> {pending ? "Researching…" : again ? "Research again" : "Research this company"}
      </button>
      {note && (
        <span role="status" className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>
          {note.text}
        </span>
      )}
    </span>
  );
}
