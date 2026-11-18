"use client";

import { useOptimistic, useState, useTransition } from "react";
import { archiveEmails, keepSender, setInboxDone, syncInbox, unsubscribeSenders, type UnsubscribeResult } from "@/app/actions/inbox";
import { Icon } from "../Icon";

/** One-click archive: removes the email from the Gmail inbox (it stays in All Mail). */
export function ArchiveButton({ messageId, label }: { messageId: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={pending}
        aria-label={`Archive "${label}" in Gmail`}
        onClick={() =>
          start(async () => {
            const r = await archiveEmails([messageId]);
            setError(r.ok ? "" : r.error);
          })
        }
      >
        <Icon name="inbox" size={14} /> {pending ? "Archiving…" : "Archive"}
      </button>
      {error && <span className="text-xs text-bad">{error}</span>}
    </>
  );
}

export interface DeclutterRow {
  key: string;
  name: string;
  count: number;
  latestSubject: string;
}

const RESULT_TEXT: Record<UnsubscribeResult["status"], string> = {
  unsubscribed: "Unsubscribed",
  link: "Finish on their page:",
  mailto: "Finish by email:",
  none: "No unsubscribe option in their emails. Use Gmail's Unsubscribe or block the sender.",
  error: "Could not reach Gmail; try again.",
};

/**
 * The declutter list: you pick the senders, Atlas unsubscribes. Senders that support
 * one-click unsubscribe are handled for you; others give you their own link.
 */
export function DeclutterPanel({ rows }: { rows: DeclutterRow[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [results, setResults] = useState<UnsubscribeResult[]>([]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const toggle = (k: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const finished = results.filter((r) => r.status === "link" || r.status === "mailto" || r.status === "none" || r.status === "error");

  return (
    <div>
      {finished.length > 0 && (
        <ul className="mb-3 space-y-1.5 rounded-lg border border-line p-3 text-sm">
          {finished.map((r) => (
            <li key={r.domain}>
              <span className="font-medium">{r.domain}</span>: {RESULT_TEXT[r.status]}{" "}
              {r.url && (
                <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-brand hover:underline">
                  open unsubscribe link
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {rows.length === 0 ? null : (
        <>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.key} className="flex items-start gap-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--brand)]"
                  checked={selected.has(r.key)}
                  onChange={() => toggle(r.key)}
                  aria-label={`Unsubscribe from ${r.name}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {r.name} <span className="font-normal text-ink-3">· {r.key} · {r.count} email{r.count === 1 ? "" : "s"}</span>
                  </p>
                  <p className="truncate text-xs text-ink-3">Latest: {r.latestSubject || "(no subject)"}</p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" disabled={pending} onClick={() => start(async () => void (await keepSender(r.name)))}>
                  Keep
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={pending || selected.size === 0}
              onClick={() =>
                start(async () => {
                  const r = await unsubscribeSenders([...selected].slice(0, 10));
                  if (r.ok) {
                    setResults(r.data ?? []);
                    setSelected(new Set());
                    setNote({ ok: true, text: r.message ?? "Done" });
                  } else setNote({ ok: false, text: r.error });
                })
              }
            >
              {pending ? "Working…" : `Unsubscribe from ${selected.size || ""} selected`.replace("  ", " ")}
            </button>
            {note && <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
          </div>
          <p className="mt-2 text-xs text-ink-3">
            Up to 10 at a time. Atlas sends a one-click unsubscribe where the sender supports it; otherwise you get their own link. Keep moves a sender to your keep list in
            Settings.
          </p>
        </>
      )}
    </div>
  );
}

export function InboxDone({ id, done, label }: { id: string; done: boolean; label: string }) {
  const [, start] = useTransition();
  const [value, setValue] = useOptimistic(done);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={value}
      aria-label={value ? `Mark "${label}" as not handled` : `Mark "${label}" as handled`}
      onClick={() =>
        start(async () => {
          setValue(!value);
          await setInboxDone(id, !value);
        })
      }
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${value ? "border-good bg-good text-white" : "border-line-strong hover:border-good"}`}
    >
      {value && <Icon name="check" size={13} />}
    </button>
  );
}

export function SyncButton() {
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
            const r = await syncInbox();
            setNote(r.ok ? { ok: true, text: r.message ?? "Synced" } : { ok: false, text: r.error });
          })
        }
      >
        <Icon name="refresh" size={14} className={pending ? "animate-spin" : ""} /> {pending ? "Syncing…" : "Sync now"}
      </button>
      {note && <span className={`text-xs ${note.ok ? "text-ink-2" : "text-bad"}`}>{note.text}</span>}
    </div>
  );
}
