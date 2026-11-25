"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reads the page's data again every `everyMs`, for a board left open on a desk. */
export function AutoRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}
