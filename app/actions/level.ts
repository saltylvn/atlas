"use server";

import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { sweepAboveLevel } from "@/lib/levelSweep";
import { rateLimit } from "@/lib/security/rateLimit";
import type { ActionResult } from "./_shared";

/**
 * "Clear them" on the Apply page: takes every queued job above your level (a senior title, or more
 * years asked than your limit; lib/domain/levelPolicy.ts) out of the Apply Queue. Each is marked
 * rejected and its match dismissed, the same as closing one by hand, and senior titles leave
 * Good fits too. It is not a thumbs-down, and nothing outside Atlas changes. The audit row is
 * written by the sweep (`career.clear-above-level`).
 */
export async function clearAboveLevel(): Promise<ActionResult> {
  if (!rateLimit("clear-above-level", 6, 10 * 60_000).allowed) return { ok: false, error: "Too many tries. Wait a few minutes." };
  const { store, settings, today, now } = await getContext();
  // The same sweep the night shift runs (lib/levelSweep.ts): the Apply Queue, then Good fits. It writes the audit row.
  const r = await sweepAboveLevel(store, settings, today, now, "owner");
  const n = r.queue.length + r.fits.length;
  revalidatePath("/career");
  if (n === 0) return { ok: true, message: "Nothing above your level is in the queue or in Good fits." };
  return { ok: true, message: `${n} job${n === 1 ? "" : "s"} above your level cleared: ${r.queue.length} from the Apply Queue, ${r.fits.length} from Good fits.` };
}
