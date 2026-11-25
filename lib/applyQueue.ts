import "server-only";
import { audit } from "@/lib/audit";
import type { Store } from "@/lib/data/store";
import { approvalFor, PERFECT, thumbStep, thumbsWithoutKit, type Thumb, type ThumbStep } from "@/lib/domain/applications";
import { addDays } from "@/lib/domain/dates";
import { contactForCompany } from "@/lib/domain/career";
import type { JobMatch, Settings } from "@/lib/domain/types";

// A thumb on a match, carried out: the rating, the apply kit in the queue or taken back,
// and the audit trail. The rule itself is `thumbStep` (pure). One waiting kit per job is
// also enforced by the database (approvals_one_waiting_per_match), so a second tap from
// another tab cannot queue the job twice.

export async function applyThumb(store: Store, settings: Pick<Settings, "careerResumes">, match: JobMatch, thumb: Thumb, now: Date): Promise<ThumbStep> {
  const step = thumbStep(match, await store.approvals.list(), thumb);
  if (step.queue) {
    const who = contactForCompany(match.company, await store.contacts.list());
    const { title, detail } = approvalFor(match, who?.name, settings.careerResumes?.[match.role]);
    try {
      await store.approvals.create({ kind: "application", title, detail, url: match.url, matchId: match.id, status: "pending", decidedAt: null });
    } catch (err) {
      // The database refused a second waiting kit: the first tap already queued it.
      if (!(await store.approvals.list()).some((a) => a.matchId === match.id && a.status === "pending")) throw err;
    }
    await audit(store, { actor: "owner", action: "career.queue", target: match.company.slice(0, 120), detail: match.title.slice(0, 200), outcome: "success" });
  }
  for (const id of step.withdraw) await store.approvals.update(id, { status: "rejected", decidedAt: now.toISOString() });
  if (step.withdraw.length) await audit(store, { actor: "owner", action: "career.withdraw", target: match.company.slice(0, 120), detail: match.title.slice(0, 200), outcome: "success" });
  try {
    await store.jobMatches.update(match.id, { rating: thumb, status: step.status });
  } catch (err) {
    // A database that does not know Perfect fit yet (its migration has not run): keep the
    // thumbs-up, which it does know, and say so. Anything else is a real failure.
    if (thumb !== PERFECT) throw err;
    await store.jobMatches.update(match.id, { rating: 1, status: step.status });
    return { ...step, note: "Saved as a 👍. Perfect fit needs the newest database update; try it again after the next deploy." };
  }
  if (thumb === PERFECT && match.rating !== PERFECT) await audit(store, { actor: "owner", action: "career.perfect-fit", target: match.company.slice(0, 120), detail: match.title.slice(0, 200), outcome: "success" });
  return step;
}

/**
 * "Not a Good Fit" on a job in your apply queue (owner's request, 23 Nov 2026): it leaves the
 * queue and the Tracker for good, and counts as a 👎 so later matches like it rank lower. The
 * kit is closed (rejected) and the match dismissed, so no sync puts it back and the Good fits
 * list never shows it again. Nothing is deleted: the records stay, out of every list.
 */
export async function notAGoodFit(store: Store, approvalId: string, now: Date): Promise<{ ok: true; title: string } | { ok: false; why: string }> {
  const kit = await store.approvals.get(approvalId);
  if (!kit || kit.kind !== "application" || kit.status !== "pending") return { ok: false, why: "Already decided." };
  await store.approvals.update(kit.id, { status: "rejected", decidedAt: now.toISOString() });
  const match = kit.matchId ? await store.jobMatches.get(kit.matchId) : null;
  // Applied already (by Atlas or by you): the job stays on your board; only the kit closes.
  if (match && match.status !== "applied") await store.jobMatches.update(match.id, { rating: -1, status: "dismissed" });
  await audit(store, { actor: "owner", action: "career.not-a-fit", target: (match?.company ?? "job").slice(0, 120), detail: kit.title.slice(0, 200), outcome: "success" });
  return { ok: true, title: kit.title };
}

/** How far back a thumbs-up is still put back in a queue. Matches are kept 120 days. */
const REQUEUE_DAYS = 120;

/**
 * Puts every job you gave a 👍, and have not applied to, back in a queue when it is in none
 * (a kit that was never made, or was lost). Runs at each sync, so the queues heal themselves.
 * Safe to repeat: a job with a waiting kit is skipped, and the database allows one per job.
 */
export async function queueThumbsWithoutKit(store: Store, settings: Pick<Settings, "careerResumes">, today: string, now: Date): Promise<number> {
  const [matches, approvals] = await Promise.all([store.jobMatches.since(addDays(today, -REQUEUE_DAYS)), store.approvals.list()]);
  let queued = 0;
  for (const match of thumbsWithoutKit(matches, approvals).slice(0, 50)) {
    const step = await applyThumb(store, settings, match, match.rating === PERFECT ? PERFECT : 1, now);
    if (step.queue) queued++;
  }
  return queued;
}
