import "server-only";
import { after } from "next/server";
import { audit } from "@/lib/audit";
import type { Store } from "@/lib/data/store";
import { MACHINE_ROUTES, refusalKind, refusedDetail, TOKEN_REFUSED, type MachineRoute, type RefusalTally } from "@/lib/domain/refusedTokens";
import { mode } from "@/lib/env";
import { ownerServiceStore, serviceReady } from "@/lib/owner";

// A refused token on a machine endpoint leaves a trace: one "denied" row in the audit
// trail, holding the route and how many requests were refused (lib/domain/refusedTokens.ts
// says what a row holds and what it never holds).
//
// Throttled like lib/security/rateLimit.ts: a fixed window per route, in memory, so per
// server instance. The first refusal at a route opens a ten-minute window and schedules
// one write; every later refusal in that window only adds to a counter. The write waits a
// few seconds first, so a burst is counted in it, and the next window's row carries
// whatever was refused after it. A flood therefore costs one row per route per window,
// never one write per request, and a count is a floor: an instance that is recycled takes
// its unwritten tail with it.
//
// The 401 never waits for any of this. The route calls noteRefusedToken (a counter and a
// clock, nothing awaited) and answers; the write runs after the response has been sent,
// and a write that fails is logged, keeps its count for the next row, and changes nothing
// else.

/** One row per route per this long. */
export const REFUSED_WINDOW_MS = 10 * 60_000;
/** How long a window's write waits, so the row counts the burst that opened it. */
export const REFUSED_SETTLE_MS = 5_000;

interface Slot extends RefusalTally {
  /** When this route's current window opened (epoch ms). */
  opened: number;
}

export interface RefusalRecorderDeps {
  /** True when there is a database to write to: live mode with the secret-key path configured. */
  ready: () => boolean;
  /** The owner-scoped store the row is written with. Called once per write, never per request. */
  store: () => Store;
  /** Runs a task once the response has been sent. */
  defer: (task: () => Promise<void>) => void;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

export function refusalRecorder(deps: RefusalRecorderDeps) {
  // At most one slot per machine route, so memory is bounded whatever arrives.
  const slots = new Map<MachineRoute, Slot>();

  async function write(route: MachineRoute): Promise<void> {
    try {
      await deps.wait(REFUSED_SETTLE_MS);
      const slot = slots.get(route);
      if (!slot || slot.missing + slot.wrong === 0) return;
      const store = deps.store();
      const tally: RefusalTally = { missing: slot.missing, wrong: slot.wrong };
      slot.missing = 0;
      slot.wrong = 0;
      const detail = refusedDetail(route, tally);
      const written = await audit(store, { actor: "system", action: TOKEN_REFUSED, target: route, detail, outcome: "denied" });
      if (!written) {
        // The count is kept and rides on the next window's row. This window does not try again.
        // The host log is the backup trail meanwhile: the same route and counts, nothing else.
        slot.missing += tally.missing;
        slot.wrong += tally.wrong;
        console.error("[audit] refused tokens not recorded yet:", detail);
      }
    } catch (err) {
      // Nothing was taken from the counter, so nothing is lost. The line names the route only.
      console.error("[audit] refused token not recorded", route, (err as Error).message);
    }
  }

  return {
    /**
     * Counts one refused request. Synchronous and never throws: the caller answers 401
     * straight after, whatever happens here. `header` is the Authorization header, looked
     * at only for whether it is there.
     */
    note(route: MachineRoute, header: string | null): void {
      try {
        if (!MACHINE_ROUTES.includes(route) || !deps.ready()) return;
        const now = deps.now();
        let slot = slots.get(route);
        if (!slot) {
          slot = { opened: Number.NEGATIVE_INFINITY, missing: 0, wrong: 0 };
          slots.set(route, slot);
        }
        slot[refusalKind(header)] += 1;
        if (now - slot.opened < REFUSED_WINDOW_MS) return; // this window already has its row
        slot.opened = now;
        deps.defer(() => write(route));
      } catch {
        // Recording a refusal must never change the answer to it.
      }
    },
    /** What is counted and not yet written, per route. For tests. */
    pending(): Partial<Record<MachineRoute, RefusalTally>> {
      return Object.fromEntries([...slots.entries()].map(([route, s]) => [route, { missing: s.missing, wrong: s.wrong }]));
    },
    reset(): void {
      slots.clear();
    },
  };
}

/** After the response: the platform keeps the function alive until the task settles. Outside a request (a test, a script) it runs now, unawaited. */
function afterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}

const recorder = refusalRecorder({
  ready: () => mode() === "live" && serviceReady(),
  store: ownerServiceStore,
  defer: afterResponse,
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: Date.now,
});

/** Call where a bearer token has just been refused, before answering 401. */
export const noteRefusedToken = recorder.note;

export function resetRefusedTokens(): void {
  recorder.reset();
}
