"use client";

import { useOptimistic, useTransition } from "react";
import { setTaskStatus } from "@/app/actions/plan";
import { Icon } from "../Icon";

export function TaskCheck({ id, done, label }: { id: string; done: boolean; label: string }) {
  const [pending, start] = useTransition();
  const [isDone, setDone] = useOptimistic(done);
  return (
    <button
      type="button"
      aria-pressed={isDone}
      aria-label={`${isDone ? "Reopen" : "Complete"}: ${label}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          setDone(!isDone);
          await setTaskStatus(id, isDone ? "todo" : "done");
        })
      }
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        isDone ? "border-good bg-good text-white" : "border-line hover:border-good"
      }`}
    >
      {isDone && <Icon name="check" size={14} />}
    </button>
  );
}
