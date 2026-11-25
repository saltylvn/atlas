"use client";

import { useState, useTransition } from "react";
import { revokeClaude, setClaudeAccess } from "@/app/actions/mcp";
import { CopyButton } from "./CareerActions";

/** The Connect Claude controls: the on/off switch, the URL to paste into Claude, and revoking an app. */
export function ClaudeConnect({ on, url, grants, used }: { on: boolean; url: string; grants: { clientId: string; name: string; since: string }[]; used: string }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (f: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) =>
    start(async () => {
      const r = await f();
      setNote(r.ok ? { ok: true, text: r.message ?? "Done" } : { ok: false, text: r.error });
    });
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" role="switch" aria-checked={on} disabled={pending} className={`btn btn-sm min-h-11 ${on ? "btn-primary" : "btn-ghost"}`} onClick={() => run(() => setClaudeAccess(!on))}>
          {on ? "Claude access: on" : "Claude access: off"}
        </button>
        {used && <span className="text-xs text-ink-3">Last read {used}</span>}
      </div>
      <div>
        <p className="text-xs text-ink-3">Connector URL (paste into Claude: Settings, Connectors, Add custom connector)</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="break-all rounded-md bg-surface-2 px-2 py-1 text-xs">{url}</code>
          <CopyButton text={url} label="Copy" />
        </div>
      </div>
      {grants.length > 0 && (
        <ul className="divide-y divide-line">
          {grants.map((g) => (
            <li key={g.clientId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{g.name}</span>
                <span className="block text-xs text-ink-3">Approved {g.since}</span>
              </span>
              <button type="button" disabled={pending} className="btn btn-ghost btn-sm min-h-11" onClick={() => run(() => revokeClaude(g.clientId))}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
      {note && (
        <p role="status" className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>
          {note.text}
        </p>
      )}
    </div>
  );
}
