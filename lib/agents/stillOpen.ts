import "server-only";
import { audit } from "@/lib/audit";
import type { Store } from "@/lib/data/store";
import { boardCheck, closedBy } from "@/lib/domain/scoutFocus";
import { HttpError, safeFetchJson } from "@/lib/security/safeFetch";

// Step 1 (23 Nov 2026): a job in your Apply Queue whose posting has come down is cleared, so
// the queue holds only jobs you can still apply to. Only Greenhouse and Lever job pages are
// checked (their public APIs answer 404 for a closed job); anything else is never guessed at.
// A few jobs a run, in turn, so the free APIs are asked politely.

export const CHECKS_PER_RUN = 12;

export async function clearClosedPostings(persist: Store, now: Date): Promise<{ checked: number; closed: string[] }> {
  const kits = (await persist.approvals.list())
    .filter((a) => a.kind === "application" && a.status === "pending" && boardCheck(a.url))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (kits.length === 0) return { checked: 0, closed: [] };
  // In turn: each 2-hour slot of the day starts at a different place in the list.
  const start = (Math.floor(now.getUTCHours() / 2) * CHECKS_PER_RUN) % kits.length;
  const batch = [...kits.slice(start), ...kits.slice(0, start)].slice(0, CHECKS_PER_RUN);
  const closed: string[] = [];
  for (const kit of batch) {
    const check = boardCheck(kit.url)!;
    let status: number | null = null;
    try {
      await safeFetchJson(check.api, { revalidate: 0, timeoutMs: 4000, maxBytes: 2_000_000 });
    } catch (err) {
      status = err instanceof HttpError ? err.status : null;
    }
    if (!closedBy(status)) continue;
    await persist.approvals.update(kit.id, { status: "rejected", decidedAt: now.toISOString() });
    if (kit.matchId) await persist.jobMatches.update(kit.matchId, { status: "dismissed" });
    await audit(persist, { actor: "system", action: "career.posting-closed", target: check.board, detail: kit.title.slice(0, 200), outcome: "success" });
    closed.push(kit.title);
  }
  return { checked: batch.length, closed };
}
