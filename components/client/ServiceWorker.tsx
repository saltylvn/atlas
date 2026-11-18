"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js in production. The worker only provides an offline page and
 * caches nothing, so no personal data survives sign-out. Development skips it to
 * keep hot reload predictable.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Offline support is a nicety; failing to register changes nothing else.
    });
  }, []);
  return null;
}
