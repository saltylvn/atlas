"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { checkAiConnection } from "@/app/actions/agents";
import { Icon } from "../Icon";

/**
 * Runs the AI connection check. The result is logged as a run, and the card above shows
 * the last one, so after a check the page refreshes rather than listing it a second time.
 */
export function AiCheckButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            const r = await checkAiConnection();
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        <Icon name="refresh" size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Checking… up to 20 s" : "Check the connection"}
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}
