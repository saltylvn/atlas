"use client";

import { useState, useTransition } from "react";
import { updateRoleProfiles } from "@/app/actions/roles";
import { Icon } from "../Icon";

/**
 * "Update now" on Target Roles: has the Career Mentor write this week's profiles again from the
 * Analyst's current numbers. The Career Mentor also does this by itself every Monday evening.
 */
export function UpdateProfilesButton() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        className="btn btn-ghost"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(async () => {
            setNote(null);
            const res = await updateRoleProfiles();
            setNote(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.error });
          })
        }
      >
        <Icon name="refresh" size={16} /> {pending ? "The Career Mentor is writing…" : "Update now"}
      </button>
      {note && (
        <span role="status" className={`text-sm break-words ${note.ok ? "text-ink-2" : "text-bad"}`}>
          {note.text}
        </span>
      )}
    </div>
  );
}
