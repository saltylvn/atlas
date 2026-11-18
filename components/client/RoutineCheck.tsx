"use client";

import { useOptimistic, useTransition } from "react";
import { toggleRoutine } from "@/app/actions/plan";
import { Icon } from "../Icon";

export function RoutineCheck({ id, title, minutes, done }: { id: string; title: string; minutes: number; done: boolean }) {
  const [, start] = useTransition();
  const [isDone, setDone] = useOptimistic(done);
  return (
    <button
      type="button"
      aria-pressed={isDone}
      onClick={() =>
        start(async () => {
          setDone(!isDone);
          await toggleRoutine(id);
        })
      }
      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-2"
    >
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 ${isDone ? "border-brand-solid bg-brand-solid text-white" : "border-line"}`}>
        {isDone && <Icon name="check" size={12} />}
      </span>
      <span className={`flex-1 text-sm ${isDone ? "text-ink-3 line-through" : ""}`}>{title}</span>
      <span className="text-xs text-ink-3">{minutes}m</span>
    </button>
  );
}
