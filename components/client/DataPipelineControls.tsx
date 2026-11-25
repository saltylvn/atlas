"use client";

import { useActionState, useId, useState, useTransition } from "react";
import type { ActionResult } from "@/app/actions/_shared";
import { askDataMentor, markStep, setDetailMode, setFloors, setSourceOn } from "@/app/actions/dataPipeline";
import { DETAIL_LABEL, DETAIL_MODES, FLOOR_KEYS, FLOOR_LABEL, type DetailMode, type FloorKey, type StepId } from "@/lib/domain/dataPipeline";
import { Icon } from "../Icon";

type Result = ActionResult | null;

function Said({ r }: { r: Result }) {
  if (!r) return null;
  return (
    <p role="status" className={`text-xs ${r.ok ? "text-ink-2" : "text-bad"}`}>
      {r.ok ? (r.message ?? "Saved.") : r.error}
    </p>
  );
}

/** One source's on/off switch. */
export function SourceSwitch({ name, on }: { name: string; on: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<Result>(null);
  return (
    <span className="flex items-center gap-2">
      <Said r={state && !state.ok ? state : null} />
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${name}: ${on ? "on" : "off"}`}
        disabled={pending}
        onClick={() => start(async () => setState(await setSourceOn(name, !on)))}
        className="relative inline-flex h-11 w-14 shrink-0 items-center justify-center"
      >
        <span className={`block h-6 w-11 rounded-full transition-colors ${on ? "bg-brand-solid" : "bg-line-strong"}`} />
        <span className={`absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border border-line-strong bg-surface transition-transform motion-reduce:transition-none ${on ? "translate-x-2.5" : "-translate-x-2.5"}`} />
      </button>
    </span>
  );
}

export function DetailModeSelect({ mode }: { mode: DetailMode }) {
  const id = useId();
  const [pending, start] = useTransition();
  const [state, setState] = useState<Result>(null);
  return (
    <div className="space-y-1">
      <label className="text-xs text-ink-3" htmlFor={id}>
        Read full posting details
      </label>
      <select id={id} className="field" defaultValue={mode} disabled={pending} onChange={(e) => start(async () => setState(await setDetailMode(e.target.value)))}>
        {DETAIL_MODES.map((m) => (
          <option key={m} value={m}>
            {DETAIL_LABEL[m]}
          </option>
        ))}
      </select>
      <Said r={state} />
    </div>
  );
}

export function FloorsForm({ floors, cap }: { floors: Record<FloorKey, number>; cap: number }) {
  const [state, action, pending] = useActionState(setFloors, null as Result);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {FLOOR_KEYS.map((k) => (
          <label key={k} className="space-y-1 text-xs text-ink-3">
            <span className="block">{FLOOR_LABEL[k]}: flag below (%)</span>
            <input name={k} type="number" inputMode="numeric" min={0} max={100} defaultValue={Math.round(floors[k] * 100)} className="field w-full" />
          </label>
        ))}
        <label className="space-y-1 text-xs text-ink-3">
          <span className="block">Company cap: postings one company counts for</span>
          <input name="companyCap" type="number" inputMode="numeric" min={5} max={200} defaultValue={cap} className="field w-full" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button className="btn btn-primary btn-sm min-h-11" disabled={pending}>
          <Icon name="check" size={14} /> Save floors and cap
        </button>
        <Said r={state} />
      </div>
    </form>
  );
}

export function MarkStepButton({ step, reviewed, label }: { step: StepId; reviewed: boolean; label: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn btn-ghost btn-sm min-h-11" disabled={pending} onClick={() => start(async () => void (await markStep(step, !reviewed)))}>
      <Icon name={reviewed ? "x" : "check"} size={14} /> {reviewed ? "Undo" : label}
    </button>
  );
}

/** Runs the Data Mentor: the whole pipeline, or one step. */
export function MentorButton({ focus, label, primary = false }: { focus: StepId | null; label: string; primary?: boolean }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<Result>(null);
  return (
    <div className="space-y-1">
      <button type="button" className={`btn ${primary ? "btn-primary" : "btn-ghost"} btn-sm min-h-11`} disabled={pending} onClick={() => start(async () => setState(await askDataMentor(focus)))}>
        <Icon name="sparkle" size={14} /> {pending ? "Thinking…" : label}
      </button>
      {state && !state.ok && <Said r={state} />}
    </div>
  );
}
