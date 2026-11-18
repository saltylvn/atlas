"use client";

import type { ActionResult } from "@/app/actions/_shared";
import { useActionState, useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { createProject, deleteProject, setProjectStatus } from "@/app/actions/projects";
import { PROJECT_KINDS, PROJECT_STATUSES, type ProjectStatus } from "@/lib/domain/types";
import { Icon } from "../Icon";

type Result = ActionResult | null;

export function ProjectForm() {
  const [state, action, pending] = useActionState(createProject, null as Result);
  const ref = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="card card-pad">
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="sr-only">New project or idea</span>
          <input name="title" required maxLength={160} placeholder="A project or idea to keep in mind…" className="field" onFocus={() => setOpen(true)} />
        </label>
        <button className="btn btn-primary" disabled={pending}>
          <Icon name="plus" size={16} /> <span className="hidden sm:inline">Add</span>
        </button>
      </div>
      {open && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label>
            <span className="label">Kind</span>
            <select name="kind" className="field capitalize" defaultValue="idea">
              {PROJECT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.replace("-", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Status</span>
            <select name="status" className="field capitalize" defaultValue="idea">
              {PROJECT_STATUSES.filter((s) => s !== "done").map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Bring it back on</span>
            <input name="reviewOn" type="date" className="field" />
          </label>
          <label>
            <span className="label">Link (optional)</span>
            <input name="link" type="url" placeholder="https://" maxLength={500} className="field" />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Next step</span>
            <input name="nextStep" maxLength={300} placeholder="The smallest concrete action" className="field" />
          </label>
          <label className="sm:col-span-2">
            <span className="label">Why it matters</span>
            <input name="why" maxLength={1000} className="field" />
          </label>
        </div>
      )}
      {state && !state.ok && <p className="mt-2 text-sm text-bad">{state.error}</p>}
    </form>
  );
}

export function ProjectStatusSelect({ id, status }: { id: string; status: ProjectStatus }) {
  const [, start] = useTransition();
  const [value, setValue] = useOptimistic(status);
  return (
    <label>
      <span className="sr-only">Status</span>
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value as ProjectStatus;
          start(async () => {
            setValue(next);
            await setProjectStatus(id, next);
          });
        }}
        className="field !min-h-[32px] !py-0 text-sm capitalize"
      >
        {PROJECT_STATUSES.map((s) => (
          <option key={s}>{s}</option>
        ))}
      </select>
    </label>
  );
}

export function DeleteProject({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={`Delete ${title}`}
      disabled={pending}
      onClick={() => {
        if (confirm(`Delete "${title}"?`)) start(async () => void (await deleteProject(id)));
      }}
      className="rounded p-1.5 text-ink-3 hover:text-bad"
    >
      <Icon name="x" size={15} />
    </button>
  );
}
