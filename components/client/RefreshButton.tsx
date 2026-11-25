"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icon } from "@/components/Icon";

/** "Refresh": reads the page's data again now, for when you just gave a thumb on another device. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [at, setAt] = useState("");
  return (
    <span className="flex items-center gap-2">
      {at && !pending && (
        <span role="status" className="text-xs text-ink-3">
          Refreshed {at}
        </span>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-[44px]"
        disabled={pending}
        aria-busy={pending}
        onClick={() =>
          start(() => {
            router.refresh();
            setAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
          })
        }
      >
        <Icon name="refresh" size={14} /> {pending ? "Refreshing…" : "Refresh"}
      </button>
    </span>
  );
}

