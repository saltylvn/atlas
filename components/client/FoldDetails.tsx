"use client";

import { useState, type ReactNode } from "react";

/**
 * A <details> that remembers whether you opened it. Its starting state comes from the server;
 * after that it is yours, so a refresh after an action (a 👍, Not a Good Fit) never folds a list
 * you are working through, or opens one you closed.
 */
export function FoldDetails({ defaultOpen, className, children }: { defaultOpen: boolean; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className={className}>
      {children}
    </details>
  );
}
