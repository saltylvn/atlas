"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

// The Apply Queue as a list you work through (owner's request, 23 Nov 2026): a job you close
// out (Not a Good Fit, I submitted it, Approve for later) leaves the list at once, where it
// is, and the page does not reset: what you opened stays open, and the next job takes focus.

interface ListCtx {
  hidden: ReadonlySet<string>;
  close: (id: string, message: string, li: HTMLLIElement | null) => void;
}
const List = createContext<ListCtx | null>(null);
const Item = createContext<((message: string) => void) | null>(null);

/** Inside a queue item: closes that item, saying `message` for screen readers and on the list. Null outside a queue. */
export const useCloseItem = (): ((message: string) => void) | null => useContext(Item);

/** The list of jobs in the Apply Queue: each one its own card, closed in place. */
export function QueueList({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [message, setMessage] = useState("");
  const close = useCallback((id: string, msg: string, li: HTMLLIElement | null) => {
    // The job after this one takes focus (or the one before, at the end), so you keep moving.
    const items = li?.parentElement ? [...li.parentElement.querySelectorAll<HTMLLIElement>("li[data-queue-item]")] : [];
    const at = li ? items.indexOf(li) : -1;
    const next = items[at + 1] ?? items[at - 1] ?? null;
    setHidden((h) => new Set([...h, id]));
    setMessage(msg);
    requestAnimationFrame(() => next?.focus());
  }, []);
  return (
    <List.Provider value={{ hidden, close }}>
      {message && (
        <p role="status" className="mb-2 text-xs text-ink-2">
          {message}
        </p>
      )}
      <ul className="space-y-3">{children}</ul>
    </List.Provider>
  );
}

/** One job in the queue: a card of its own, gone the moment you close it out. */
export function QueueItem({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const list = useContext(List);
  const ref = useRef<HTMLLIElement>(null);
  const close = useCallback((msg: string) => list?.close(id, msg, ref.current), [list, id]);
  if (list?.hidden.has(id)) return null;
  return (
    <li ref={ref} data-queue-item tabIndex={-1} aria-label={label} className="rounded-xl border border-line-strong bg-surface p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand sm:p-4">
      <Item.Provider value={close}>{children}</Item.Provider>
    </li>
  );
}
