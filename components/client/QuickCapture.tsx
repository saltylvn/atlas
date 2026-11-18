"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/app/actions/_shared";
import { createTask } from "@/app/actions/plan";
import { Icon } from "../Icon";

type Result = ActionResult | null;
type When = "today" | "tomorrow" | "backlog";

/**
 * Global quick-capture: a thumb-reachable "+" on every tab that opens a one-field
 * sheet. Type, press Enter, done. Reuses the Plan tab's createTask action, so
 * validation, storage and revalidation are identical. Shortcut: "n" (or "c").
 */
export function QuickCapture({ today, tomorrow }: { today: string; tomorrow: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [when, setWhen] = useState<When>("today");
  const [flash, setFlash] = useState("");
  const [state, action, pending] = useActionState(async (prev: Result, fd: FormData) => {
    const r = await createTask(prev, fd);
    if (r.ok) {
      const d = fd.get("day");
      setFlash(`Added to ${d === today ? "today" : d === tomorrow ? "tomorrow" : "the backlog"}.`);
      form.current?.reset();
      input.current?.focus();
    }
    return r;
  }, null as Result);

  const open = () => {
    setFlash("");
    dialog.current?.showModal();
    // Focus after the sheet is in the top layer so iOS raises the keyboard.
    requestAnimationFrame(() => input.current?.focus());
  };
  const close = () => dialog.current?.close();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (dialog.current?.open) return;
      if (e.key === "n" || e.key === "c") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const day = when === "today" ? today : when === "tomorrow" ? tomorrow : "";

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label="Quick add task"
        aria-keyshortcuts="n"
        title="Quick add task (n)"
        className="qc-fab fixed z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg transition-transform hover:bg-brand-strong active:scale-95 motion-reduce:transition-none"
      >
        <Icon name="plus" size={26} />
      </button>

      <dialog
        ref={dialog}
        aria-labelledby="qc-title"
        className="qc-sheet m-0 w-full max-w-none bg-transparent p-0 md:m-auto md:max-w-md"
        onClick={(e) => {
          if (e.target === e.currentTarget) close();
        }}
      >
        <form ref={form} action={action} className="card rounded-b-none p-4 pb-safe md:rounded-b-[var(--radius)] md:pb-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="qc-title" className="h-display text-base font-semibold">
              Quick add
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-2 hover:text-ink"
            >
              <Icon name="x" size={20} />
            </button>
          </div>
          <label className="block">
            <span className="sr-only">Task</span>
            <input
              ref={input}
              name="title"
              required
              maxLength={200}
              autoComplete="off"
              enterKeyHint="done"
              placeholder="What needs doing?"
              className="field min-h-[48px]"
              onInput={() => setFlash("")}
            />
          </label>
          <input type="hidden" name="day" value={day} />
          <fieldset className="mt-3">
            <legend className="sr-only">When</legend>
            <div className="grid grid-cols-3 gap-2">
              {(["today", "tomorrow", "backlog"] as const).map((w) => (
                <label key={w} className={`qc-chip ${when === w ? "qc-chip-on" : ""}`}>
                  <input type="radio" name="qc-when" value={w} checked={when === w} onChange={() => setWhen(w)} className="sr-only" />
                  {w === "backlog" ? "Backlog" : w === "today" ? "Today" : "Tomorrow"}
                </label>
              ))}
            </div>
          </fieldset>
          <button className="btn btn-primary mt-3 min-h-[48px] w-full" disabled={pending}>
            {pending ? "Adding…" : "Add task"}
          </button>
          <p className="mt-2 min-h-5 text-center text-sm" role="status" aria-live="polite">
            {state && !state.ok ? <span className="text-bad">{state.error}</span> : <span className="text-ink-2">{flash}</span>}
          </p>
        </form>
      </dialog>
    </>
  );
}
