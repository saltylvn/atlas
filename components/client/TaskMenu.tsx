"use client";

import { useTransition } from "react";
import { deleteTask, moveTask } from "@/app/actions/plan";

export function TaskMenu({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  return (
    <label className="relative">
      <span className="sr-only">Move or delete {title}</span>
      <select
        disabled={pending}
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          start(async () => {
            if (v === "delete") {
              if (confirm(`Delete “${title}”?`)) await deleteTask(id);
            } else {
              await moveTask(id, v);
            }
          });
        }}
        className="field !min-h-[32px] w-[104px] !py-0 text-xs"
      >
        <option value="">Move…</option>
        <option value="today">Today</option>
        <option value="tomorrow">Tomorrow</option>
        <option value="backlog">Backlog</option>
        <option value="delete">Delete</option>
      </select>
    </label>
  );
}
