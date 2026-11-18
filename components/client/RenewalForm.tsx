"use client";

import type { ActionResult } from "@/app/actions/_shared";
import { createRenewal, handleRenewal, removeRenewal } from "@/app/actions/renewals";
import { RENEWAL_CADENCES, RENEWAL_KINDS, type RenewalCadence, type RenewalKind } from "@/lib/domain/renewals";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Icon } from "../Icon";

type Result = ActionResult | null;

const KIND_LABEL: Record<RenewalKind, string> = { bill: "Bill", renewal: "Renewal", document: "Document" };
const CADENCE_LABEL: Record<RenewalCadence, string> = { once: "One time", monthly: "Monthly", yearly: "Yearly" };

export function RenewalForm() {
  const [state, action, pending] = useActionState(createRenewal, null as Result);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="renewal-title">
          Name
        </label>
        <input id="renewal-title" name="title" required maxLength={120} placeholder="HOA dues" className="field" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="renewal-kind">
            Kind
          </label>
          <select id="renewal-kind" name="kind" className="field" defaultValue="renewal">
            {RENEWAL_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="renewal-cadence">
            Repeats
          </label>
          <select id="renewal-cadence" name="cadence" className="field" defaultValue="yearly">
            {RENEWAL_CADENCES.map((cadence) => (
              <option key={cadence} value={cadence}>
                {CADENCE_LABEL[cadence]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label" htmlFor="renewal-due">
            Due
          </label>
          <input id="renewal-due" name="dueOn" type="date" required className="field" />
        </div>
        <div>
          <label className="label" htmlFor="renewal-lead">
            Warn me (days before)
          </label>
          <input id="renewal-lead" name="leadDays" type="number" min={0} max={90} defaultValue={14} required className="field" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor="renewal-url">
          Link (optional, https)
        </label>
        <input id="renewal-url" name="url" type="url" inputMode="url" maxLength={300} placeholder="https://" className="field" />
      </div>
      <div>
        <label className="label" htmlFor="renewal-notes">
          Notes (optional)
        </label>
        <input id="renewal-notes" name="notes" maxLength={300} className="field" />
      </div>
      <div>
        <button className="btn btn-primary min-h-11" disabled={pending}>
          <Icon name="plus" size={14} /> Add
        </button>
        {state && !state.ok && <p className="mt-2 text-sm text-bad">{state.error}</p>}
      </div>
    </form>
  );
}

export function RenewalActions({ id, once }: { id: string; once: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: (id: string) => Promise<ActionResult>) =>
    start(async () => {
      const result = await fn(id);
      setError(result.ok ? null : result.error);
    });
  return (
    <div className="flex items-center gap-1">
      <button type="button" className="btn btn-ghost min-h-11 px-3 text-sm" disabled={pending} onClick={() => run(handleRenewal)}>
        {once ? "Done" : "Handled"}
      </button>
      {!once && (
        <button type="button" className="btn btn-ghost min-h-11 min-w-11 px-2 text-ink-3" aria-label="Remove renewal" disabled={pending} onClick={() => run(removeRenewal)}>
          <Icon name="x" size={14} />
        </button>
      )}
      {error && <span className="text-xs text-bad">{error}</span>}
    </div>
  );
}

/**
 * The Finance Agent's "Track in Renewals" for a bill it found in your email. Nothing is
 * added until you press Track; you can fix the name and date first.
 */
export function TrackBillForm({ title, kind, dueOn, cadence, today }: { title: string; kind: RenewalKind; dueOn: string | null; cadence: RenewalCadence; today: string }) {
  const [state, action, pending] = useActionState(createRenewal, null as Result);
  if (state?.ok) return <p className="text-xs font-semibold text-good">Tracked in Renewals.</p>;
  const idBase = `track-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="cadence" value={cadence} />
      <input type="hidden" name="leadDays" value={kind === "bill" ? 5 : 14} />
      <div className="min-w-0 flex-1">
        <label className="sr-only" htmlFor={`${idBase}-title`}>
          Name
        </label>
        <input id={`${idBase}-title`} name="title" required maxLength={120} defaultValue={title} className="field" />
      </div>
      <div>
        <label className="sr-only" htmlFor={`${idBase}-due`}>
          Next due date
        </label>
        <input id={`${idBase}-due`} name="dueOn" type="date" required defaultValue={dueOn ?? ""} min={dueOn ? undefined : today} className="field" />
      </div>
      <button className="btn btn-ghost min-h-11 px-3 text-sm" disabled={pending}>
        <Icon name="plus" size={14} /> Track {CADENCE_LABEL[cadence].toLowerCase()}
      </button>
      {state && !state.ok && <p className="w-full text-xs text-bad">{state.error}</p>}
    </form>
  );
}
