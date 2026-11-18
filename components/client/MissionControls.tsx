"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { runAgentNow, setAgentPaused, syncNow } from "@/app/actions/agents";
import { Icon } from "../Icon";

export function RunNowButton({ agent, disabled }: { agent: string; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={disabled || pending}
        onClick={() =>
          start(async () => {
            const r = await runAgentNow(agent);
            setNote(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
          })
        }
      >
        <Icon name="refresh" size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Running…" : "Run now"}
      </button>
      {note && <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
    </div>
  );
}

/** Runs the 2-hour sync right now: every agent reports to the Chief of Staff. */
export function SyncNowButton() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await syncNow();
            setNote(r.ok ? { ok: true, text: r.message ?? "Synced" } : { ok: false, text: r.error });
          })
        }
      >
        <Icon name="refresh" size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Syncing…" : "Sync now"}
      </button>
      {note && <span className={`max-w-md text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
    </div>
  );
}

export function PauseToggle({ agent, paused, disabled }: { agent: string; paused: boolean; disabled?: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      disabled={disabled || pending}
      onClick={() => start(async () => void (await setAgentPaused(agent, !paused)))}
    >
      {paused ? "Resume" : "Pause"}
    </button>
  );
}

/**
 * Keeps Mission Control current by re-rendering every few seconds while the tab is
 * visible. The browser only ever talks to Atlas itself (CSP connect-src 'self'), so
 * this polls the server instead of opening a direct Realtime socket to Supabase.
 */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  // Set only on a refresh tick in the browser, so the server-rendered HTML never disagrees with it.
  const [at, setAt] = useState<Date | null>(null);
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
        setAt(new Date());
      }
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
      <span className="h-2 w-2 animate-pulse rounded-full bg-good" /> Live
      {at && ` · refreshed ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`}
    </span>
  );
}
