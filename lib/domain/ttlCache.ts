// A tiny in-memory TTL cache with in-flight de-duplication. Pure: the clock is injected.
// Used to keep normalized job-board results between renders so a large board
// (OpenAI's Ashby feed is ~18 MB) is downloaded at most once per TTL per server instance.

export interface TtlCache<T> {
  /** The cached value if present and fresh. */
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  /**
   * Fresh value, else the pending load for this key, else a new load. Failed loads are
   * not cached, so the next call retries.
   */
  getOrLoad(key: string, load: () => Promise<T>): Promise<T>;
  size(): number;
  clear(): void;
}

export function createTtlCache<T>({ ttlMs, maxEntries = 100, now = () => Date.now() }: { ttlMs: number; maxEntries?: number; now?: () => number }): TtlCache<T> {
  const entries = new Map<string, { value: T; expires: number }>();
  const pending = new Map<string, Promise<T>>();

  const get = (key: string): T | undefined => {
    const e = entries.get(key);
    if (!e) return undefined;
    if (e.expires <= now()) {
      entries.delete(key);
      return undefined;
    }
    return e.value;
  };

  const set = (key: string, value: T) => {
    entries.delete(key);
    entries.set(key, { value, expires: now() + ttlMs });
    // Evict oldest insertions first.
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
  };

  return {
    get,
    set,
    getOrLoad(key, load) {
      const hit = get(key);
      if (hit !== undefined) return Promise.resolve(hit);
      const inflight = pending.get(key);
      if (inflight) return inflight;
      const p = load()
        .then((value) => {
          set(key, value);
          return value;
        })
        .finally(() => pending.delete(key));
      pending.set(key, p);
      return p;
    },
    size: () => entries.size,
    clear: () => {
      entries.clear();
      pending.clear();
    },
  };
}
