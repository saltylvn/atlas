"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { Icon } from "../Icon";

const KEY = "atlas.doNext.done";
const EVENT = "atlas:do-next";

function read(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/**
 * Wraps one Do next item. "Done" hides it on this device until tomorrow; the rules
 * re-surface it if it is still due. Local only: nothing changes on the Applications board.
 */
export function DoNextRow({ id, today, children }: { id: string; today: string; children: ReactNode }) {
  const hidden = useSyncExternalStore(subscribe, () => read()[id] === today, () => false);
  if (hidden) return null;
  return (
    <li className="relative rounded-xl border border-line p-3">
      {children}
      <div className="absolute top-1.5 right-1.5">
        <button
          type="button"
          className="flex h-11 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-ink-3 hover:text-brand"
          onClick={() => {
            // Keep only today's entries so storage stays small.
            const map = Object.fromEntries(Object.entries(read()).filter(([, d]) => d === today));
            map[id] = today;
            localStorage.setItem(KEY, JSON.stringify(map));
            window.dispatchEvent(new Event(EVENT));
          }}
          aria-label="Mark done for today"
        >
          <Icon name="check" size={14} /> Done
        </button>
      </div>
    </li>
  );
}
