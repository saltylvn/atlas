import "server-only";
import { audit } from "@/lib/audit";
import type { Store } from "@/lib/data/store";
import { openFits } from "@/lib/domain/applyLane";
import { addDays } from "@/lib/domain/dates";
import { aboveLevel, maxYearsOf } from "@/lib/domain/levelPolicy";
import { queueLevels } from "@/lib/domain/scoutFocus";
import type { LocalDate, Settings } from "@/lib/domain/types";

// Keeps jobs above your level out of what you decide from (owner's instruction, 24 Nov 2026:
// senior roles are to be removed from Good fits and the Apply Queue, on their own). By the one
// level rule (lib/domain/levelPolicy.ts): a senior, staff, lead, manager or level III+ title, or
// more years asked than your limit. Rules only, so it is exact and costs nothing.
//
// A queued job is marked rejected and its match dismissed, the same as closing it by hand; a
// Good fit is dismissed. It is not a thumbs-down: the company and role are not held against
// later matches. Every sweep that removes something is audited with what it removed.

export interface SweepResult {
  queue: string[];
  fits: string[];
}

export async function sweepAboveLevel(store: Store, settings: Pick<Settings, "careerMaxYears">, today: LocalDate, now: Date, actor: "owner" | "system"): Promise<SweepResult> {
  const maxYears = maxYearsOf(settings);
  const [kits, matches] = await Promise.all([store.approvals.list(), store.jobMatches.since(addDays(today, -120))]);
  const above = queueLevels(kits, matches, maxYears).filter((q) => q.verdict.fit === "above");
  const byId = new Map(kits.map((k) => [k.id, k]));
  const gone = new Set<string>();
  for (const q of above) {
    await store.approvals.update(q.kitId, { status: "rejected", decidedAt: now.toISOString() });
    const matchId = byId.get(q.kitId)?.matchId;
    if (matchId) {
      await store.jobMatches.update(matchId, { status: "dismissed" });
      gone.add(matchId);
    }
  }
  // Good fits: the matches you have not decided on. A match holds its title, not the posting's text.
  const fits = openFits(matches).filter((m) => !gone.has(m.id) && aboveLevel(m.title, "", maxYears));
  for (const m of fits) await store.jobMatches.update(m.id, { status: "dismissed" });
  const out = { queue: above.map((q) => q.title), fits: fits.map((m) => `${m.title} at ${m.company}`) };
  if (out.queue.length + out.fits.length > 0) {
    await audit(store, { actor, action: "career.clear-above-level", target: "apply-queue", detail: `${out.queue.length} from the Apply Queue, ${out.fits.length} from Good fits: ${[...out.queue, ...out.fits].slice(0, 4).map((t) => t.slice(0, 50)).join("; ")}`, outcome: "success" });
  }
  return out;
}
