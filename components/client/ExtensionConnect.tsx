"use client";

import { useState, useTransition } from "react";
import { connectExtension, disconnectExtension } from "@/app/actions/settings";
import { Icon } from "../Icon";

/**
 * Connect Atlas Autofill. The new key appears once, in a box the extension reads on this page
 * (the extension must be installed and allowed on this site); you can also copy it into the
 * extension's popup. Atlas keeps only its fingerprint.
 */
export function ExtensionConnect({ connected, label, since, used }: { connected: boolean; label: string; since: string; used: string }) {
  const [pending, start] = useTransition();
  const [key, setKey] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">
        {connected ? (
          <>
            Connected with key <span className="font-mono text-xs">{label}</span>, made {since}
            {used ? `, last used ${used}` : ", not used yet"}.
          </>
        ) : (
          "Not connected. Connect it so the extension can ask Atlas to answer a form, attach your resume and save answers you correct."
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setNote(null);
              const r = await connectExtension();
              if (r.ok && r.data) setKey(r.data.key);
              else if (!r.ok) setNote({ ok: false, text: r.error });
            })
          }
        >
          <Icon name="plug" size={16} /> {connected ? "Make a new key" : "Connect Atlas Autofill"}
        </button>
        {connected && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await disconnectExtension();
                setKey("");
                setNote(r.ok ? { ok: true, text: r.message ?? "Disconnected." } : { ok: false, text: r.error });
              })
            }
          >
            Disconnect
          </button>
        )}
      </div>
      {key && (
        <div className="rounded-lg border border-line bg-surface-2 p-3" role="status">
          <p className="text-sm font-medium">Your new key</p>
          <p className="mt-1 text-xs text-ink-2">If the extension is installed, it picks this up now and this line changes. Otherwise copy it into the extension: click the A in your toolbar, then Connect. It is shown once.</p>
          {/* Read by Atlas Autofill's sync script on this page only. */}
          <input id="atlas-extension-key" readOnly value={key} className="field mt-2 w-full font-mono text-sm" aria-label="Atlas Autofill key" onFocus={(e) => e.currentTarget.select()} />
          <p id="atlas-extension-key-status" className="mt-2 text-xs text-ink-3">
            Waiting for the extension…
          </p>
        </div>
      )}
      {note && <p className={`text-sm ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</p>}
    </div>
  );
}
