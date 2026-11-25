"use client";

import { useState, useTransition } from "react";
import { clearAboveLevel } from "@/app/actions/level";

/** Clears every queued job above your level, after you press it. */
export function ClearAboveLevel({ count }: { count: number }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-11"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await clearAboveLevel();
            setNote(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
          })
        }
      >
        {pending ? "Clearing…" : `Clear ${count === 1 ? "it" : `all ${count}`} from the queue`}
      </button>
      {note && (
        <span role="status" className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>
          {note.text}
        </span>
      )}
    </div>
  );
}
