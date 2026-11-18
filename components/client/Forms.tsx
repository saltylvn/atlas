"use client";

import type { ActionResult } from "@/app/actions/_shared";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { addGoal, autoPlanWeek, createTask, toggleGoal } from "@/app/actions/plan";
import { AREAS, PRIORITIES, RECURRENCE } from "@/lib/domain/types";
import { Icon } from "../Icon";

type Result = ActionResult | null;

function useResetOnSuccess(state: Result) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return ref;
}

export function AddTaskForm({ days }: { days: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(createTask, null as Result);
  const ref = useResetOnSuccess(state);
  const [open, setOpen] = useState(false);
  return (
    <form ref={ref} action={action} className="card card-pad">
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">New task</span>
          <input name="title" required maxLength={200} placeholder="Add a task… e.g. Call the insurance company" className="field" onFocus={() => setOpen(true)} />
        </label>
        <button className="btn btn-primary" disabled={pending}>
          <Icon name="plus" size={16} /> <span className="hidden sm:inline">Add</span>
        </button>
      </div>
      {open && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Select name="priority" label="Priority" options={PRIORITIES} defaultValue="medium" />
          <Select name="area" label="Area" options={AREAS} defaultValue="work" />
          <label>
            <span className="label">Minutes</span>
            <input name="estimateMin" type="number" min={5} max={600} step={5} defaultValue={30} className="field" />
          </label>
          <label>
            <span className="label">Day</span>
            <select name="day" className="field" defaultValue="">
              <option value="">Backlog</option>
              {days.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <Select name="energy" label="Energy" options={["shallow", "deep"] as const} defaultValue="shallow" />
          <Select name="recurrence" label="Repeats" options={RECURRENCE} defaultValue="none" />
        </div>
      )}
      {state && !state.ok && <p className="mt-2 text-sm text-bad">{state.error}</p>}
    </form>
  );
}

function Select<T extends string>({ name, label, options, defaultValue }: { name: string; label: string; options: readonly T[]; defaultValue: T }) {
  return (
    <label>
      <span className="label">{label}</span>
      <select name={name} defaultValue={defaultValue} className="field capitalize">
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AutoPlanButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-sm text-ink-2">{msg}</span>}
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await autoPlanWeek();
            if (r.ok && r.data) setMsg(r.data.placed === 0 ? "Nothing to place." : `Placed ${r.data.placed}${r.data.unplaced ? `, ${r.data.unplaced} didn't fit` : ""}.`);
          })
        }
      >
        <Icon name="wand" size={16} />
        {pending ? "Planning…" : "Auto-plan my week"}
      </button>
    </div>
  );
}

export function GoalForm() {
  const [state, action, pending] = useActionState(addGoal, null as Result);
  const ref = useResetOnSuccess(state);
  return (
    <form ref={ref} action={action} className="mt-3 flex gap-2">
      <input name="title" required maxLength={200} placeholder="A goal for this week" aria-label="Weekly goal" className="field" />
      <select name="area" className="field !w-28 capitalize" defaultValue="work" aria-label="Area">
        {AREAS.map((a) => (
          <option key={a}>{a}</option>
        ))}
      </select>
      <button className="btn btn-ghost" disabled={pending} aria-label="Add goal">
        <Icon name="plus" size={16} />
      </button>
      {state && !state.ok && <p className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}

export function GoalToggle({ id, done, title }: { id: string; done: boolean; title: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(async () => void (await toggleGoal(id)))} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-good bg-good text-white" : "border-line"}`}>{done && <Icon name="check" size={12} />}</span>
      <span className={`text-sm ${done ? "text-ink-3 line-through" : "font-medium"}`}>{title}</span>
    </button>
  );
}
