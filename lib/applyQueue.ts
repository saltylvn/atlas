import "server-only";
import { audit } from "@/lib/audit";
import type { Store } from "@/lib/data/store";
import { approvalFor, thumbStep, type Thumb, type ThumbStep } from "@/lib/domain/applications";
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
      await store.approvals.create({ kind: match.type === "gig" ? "gig-proposal" : "application", title, detail, url: match.url, matchId: match.id, status: "pending", decidedAt: null });
    } catch (err) {
      // The database refused a second waiting kit: the first tap already queued it.
      if (!(await store.approvals.list()).some((a) => a.matchId === match.id && a.status === "pending")) throw err;
    }
    await audit(store, { actor: "owner", action: "career.queue", target: match.company.slice(0, 120), detail: match.title.slice(0, 200), outcome: "success" });
  }
  for (const id of step.withdraw) await store.approvals.update(id, { status: "rejected", decidedAt: now.toISOString() });
  if (step.withdraw.length) await audit(store, { actor: "owner", action: "career.withdraw", target: match.company.slice(0, 120), detail: match.title.slice(0, 200), outcome: "success" });
  await store.jobMatches.update(match.id, { rating: thumb, status: step.status });
  return step;
}
