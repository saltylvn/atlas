import type { TraceStep } from "@/lib/domain/types";

// Tracing: every agent run records its steps (what it did, how long each took, and what
// it decided) on the activity-log row that ends the run. Mission Control shows them, so
// "why did the brief say that?" has an answer. Notes hold counts and decisions only:
// never email text, addresses, tokens or URLs.

export interface Tracer {
  /** Runs one step, timing it. `note` turns its result into a short outcome line. */
  step<T>(name: string, fn: () => Promise<T> | T, note?: (value: T) => string): Promise<T>;
  /** Records a decision that took no time of its own. */
  note(name: string, note: string, ok?: boolean): void;
  /** The run so far: total time and every step. */
  finish(): { durationMs: number; trace: TraceStep[] };
  /** The step running now (the latest started, when several run at once), or null. */
  current(): string | null;
}

const MAX_STEPS = 24;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function tracer(now: () => number = Date.now): Tracer {
  const started = now();
  const steps: TraceStep[] = [];
  const running: string[] = [];
  const push = (s: TraceStep) => {
    if (steps.length < MAX_STEPS) steps.push({ name: clip(s.name, 80), ms: Math.max(0, Math.round(s.ms)), ok: s.ok, note: clip(s.note, 240) });
  };
  return {
    async step(name, fn, note) {
      const t0 = now();
      running.push(name);
      const done = () => running.splice(running.lastIndexOf(name), 1);
      try {
        const value = await fn();
        let line = "";
        try {
          line = note ? note(value) : "";
        } catch {
          line = "";
        }
        done();
        push({ name, ms: now() - t0, ok: true, note: line });
        return value;
      } catch (err) {
        // The error's message can carry anything; keep only its first line, clipped.
        done();
        push({ name, ms: now() - t0, ok: false, note: ((err as Error).message ?? "failed").split("\n")[0]!.slice(0, 160) });
        throw err;
      }
    },
    note(name, note, ok = true) {
      push({ name, ms: 0, ok, note });
    },
    finish() {
      return { durationMs: Math.max(0, Math.round(now() - started)), trace: [...steps] };
    },
    current() {
      return running.at(-1) ?? null;
    },
  };
}

/** For callers that do not trace (Today's live preview): steps still run, nothing is kept. */
export const NO_TRACE: Tracer = {
  async step(_name, fn) {
    return fn();
  },
  note() {},
  current() {
    return null;
  },
  finish() {
    return { durationMs: 0, trace: [] };
  },
};
