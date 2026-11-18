// A small fixed-window limiter for abuse-prone entry points (sign-in, ingest, AI).
// In-memory, so it is per server instance: a first line of defense that slows
// brute force and runaway loops. The durable control for AI spend is the daily cap
// stored in the database (lib/ai/budget.ts).

interface Window {
  start: number;
  count: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000;

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSec: number } {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    if (windows.size >= MAX_KEYS) windows.clear(); // bounded memory under a flood
    windows.set(key, { start: now, count: 1 });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (w.count >= limit) {
    return { allowed: false, retryAfterSec: Math.ceil((w.start + windowMs - now) / 1000) };
  }
  w.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

export function resetRateLimits(): void {
  windows.clear();
}
