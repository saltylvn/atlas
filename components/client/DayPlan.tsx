"use client";

import { useEffect, useState, useTransition } from "react";
import { acceptDayPlan, applyMoves, restoreTaskTimes, rollForwardUnfinished, type PreviousTimes } from "@/app/actions/plan";
import { Icon } from "../Icon";

function untilLabel(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "now";
  if (min < 60) return `in ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

/** "in 23 min", kept fresh every 30 seconds. The first paint uses the server's clock. */
export function Countdown({ target, serverNow, prefix = "" }: { target: string; serverNow: string; prefix?: string }) {
  const t = Date.parse(target);
  const [label, setLabel] = useState(() => untilLabel(t - Date.parse(serverNow)));
  useEffect(() => {
    const tick = () => setLabel(untilLabel(t - Date.now()));
    tick();
    const h = setInterval(tick, 30_000);
    return () => clearInterval(h);
  }, [t]);
  return (
    <span suppressHydrationWarning>
      {prefix}
      {label}
    </span>
  );
}

function UndoBar({ message, previous, onDone }: { message: string; previous: PreviousTimes; onDone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <div role="status" className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
      <span className="font-medium">{message}</span>
      {previous.length > 0 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-[44px]"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await restoreTaskTimes(previous);
              onDone();
            })
          }
        >
          Undo
        </button>
      )}
    </div>
  );
}

/** One tap: pin the suggested focus blocks onto today's tasks. Reversible with Undo. */
export function AcceptPlanButton({ count }: { count: number }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ message: string; previous: PreviousTimes } | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (result) return <UndoBar message={result.message} previous={result.previous} onDone={() => setResult(null)} />;
  return (
    <div>
      <button
        type="button"
        className="btn btn-primary w-full min-h-[44px] sm:w-auto"
        disabled={pending || count === 0}
        onClick={() =>
          start(async () => {
            const r = await acceptDayPlan();
            if (r.ok) setResult({ message: r.message ?? "Done", previous: r.data?.previous ?? [] });
            else setError(r.error);
          })
        }
      >
        <Icon name="check" size={16} /> {pending ? "Blocking…" : count === 0 ? "Plan accepted" : `Accept plan · ${count} block${count === 1 ? "" : "s"}`}
      </button>
      {error && <p className="mt-2 text-sm text-bad">{error}</p>}
    </div>
  );
}

export interface MoveRow {
  taskId: string;
  to: string;
  title: string;
  detail: string;
  toLabel: string;
}

/**
 * Suggested moves with one-tap Move / Move all. Stays mounted after the server re-renders
 * (when the suggestions disappear) so Undo is still there.
 */
export function MoveList({ rows }: { rows: MoveRow[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ message: string; previous: PreviousTimes } | null>(null);
  const run = (moves: { taskId: string; to: string }[]) =>
    start(async () => {
      const r = await applyMoves(moves);
      if (r.ok) setResult({ message: r.message ?? "Moved", previous: r.data?.previous ?? [] });
    });
  if (rows.length === 0 && !result) return null;
  return (
    <div className="mt-4 border-t border-line pt-3">
      {result && (
        <div className="mb-2">
          <UndoBar message={result.message} previous={result.previous} onDone={() => setResult(null)} />
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">Move overflow to lighter days</p>
            {rows.length > 1 && (
              <button type="button" className="btn btn-primary btn-sm min-h-[44px] shrink-0" disabled={pending} onClick={() => run(rows.map((r) => ({ taskId: r.taskId, to: r.to })))}>
                Move all {rows.length}
              </button>
            )}
          </div>
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.taskId} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{r.title}</p>
                  <p className="text-xs text-ink-3">
                    {r.detail} → <span className="font-semibold text-ink-2">{r.toLabel}</span>
                  </p>
                </div>
                <button type="button" className="btn btn-ghost btn-sm min-h-[44px] shrink-0" disabled={pending} onClick={() => run([{ taskId: r.taskId, to: r.to }])}>
                  {pending ? "Moving…" : "Move"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * A bulk move with Undo. `moves` = specific tasks; omit it for the end-of-day shutdown
 * (everything unfinished rolls forward). Renders nothing when there is nothing to do.
 */
export function RollButton({ count, label, moves }: { count: number; label: string; moves?: { taskId: string; to: string }[] }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ message: string; previous: PreviousTimes } | null>(null);
  if (result) return <UndoBar message={result.message} previous={result.previous} onDone={() => setResult(null)} />;
  if (count === 0) return null;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm min-h-[44px]"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = moves ? await applyMoves(moves) : await rollForwardUnfinished();
          if (r.ok) setResult({ message: r.message ?? "Done", previous: r.data?.previous ?? [] });
        })
      }
    >
      {pending ? "Moving…" : label}
    </button>
  );
}
