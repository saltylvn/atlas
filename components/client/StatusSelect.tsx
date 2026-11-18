"use client";

import { useOptimistic, useTransition } from "react";
import { setTaskStatus } from "@/app/actions/plan";
import { STATUS_META, hue } from "../ui";
import type { TaskStatus } from "@/lib/domain/types";

/** The status cell: a tinted badge that is also a select. */
export function StatusSelect({ id, status }: { id: string; status: TaskStatus }) {
  const [, start] = useTransition();
  const [value, setValue] = useOptimistic(status);
  return (
    <label className="relative block">
      <span className="sr-only">Status</span>
      <select
        value={value}
        onChange={(e) => {
          const next = e.target.value as TaskStatus;
          start(async () => {
            setValue(next);
            await setTaskStatus(id, next);
          });
        }}
        className="pill w-full min-w-[118px] cursor-pointer appearance-none text-center"
        style={hue(STATUS_META[value].color)}
      >
        {(Object.keys(STATUS_META) as TaskStatus[]).map((s) => (
          <option key={s} value={s} style={{ color: "var(--ink)", background: "var(--surface)" }}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>
    </label>
  );
}
