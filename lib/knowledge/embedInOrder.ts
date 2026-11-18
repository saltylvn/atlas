// Embeds a list of texts one small request at a time.
//
// The embedding function has a CPU limit per worker. Several requests at once land on
// the same worker and trip it together, so nothing here runs in parallel. A request that
// fails is tried again with half as many texts, down to one; a single text that still
// fails is retried twice after a short pause (a worker that just hit its limit needs a
// moment to restart) before the whole run gives up.

export type EmbedFn = (texts: string[]) => Promise<number[][] | null>;

export interface EmbedInOrderOptions {
  /** Texts in the first request. */
  batch?: number;
  /** Give up after this instant (ms since epoch). */
  deadline?: number;
  /** Wait between retries of a single text, in ms. */
  pauseMs?: number;
}

const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** One vector per text, in order, or null when the function would not answer. */
export async function embedInOrder(texts: readonly string[], embed: EmbedFn, opts: EmbedInOrderOptions = {}): Promise<number[][] | null> {
  const { batch = 4, deadline = Number.POSITIVE_INFINITY, pauseMs = 600 } = opts;
  const out: number[][] = [];
  let size = Math.max(1, batch);
  let retries = 0;
  let i = 0;
  while (i < texts.length) {
    if (Date.now() > deadline) return null;
    const slice = texts.slice(i, i + size);
    const got = await embed(slice);
    if (got && got.length === slice.length) {
      out.push(...got);
      i += slice.length;
      retries = 0;
      continue;
    }
    if (size > 1) {
      size = Math.floor(size / 2);
      continue;
    }
    if (++retries > 2) return null;
    if (pauseMs > 0) await wait(pauseMs);
  }
  return out;
}
