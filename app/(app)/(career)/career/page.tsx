import Link from "next/link";
import { getContext } from "@/lib/context";
import { addDays, ago } from "@/lib/domain/dates";
import { Icon } from "@/components/Icon";
import { CardHeader, PageHeader, Pill, QueueFold } from "@/components/ui";
import { ApprovalButtons, FindMoreButtons, FitButton, MatchButtons } from "@/components/client/CareerActions";
import { KIT_CHECK_ID, kitId } from "@/lib/domain/autofill";
import { SaveJobForm } from "@/components/client/CareerDesk";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { ResumeLink } from "@/components/ResumeLink";
import { actionLabel, APPLY_QUEUE, FITS_ID, openFits } from "@/lib/domain/applyLane";
import { targetFromLabel } from "@/lib/domain/careerAgent";
import { MORE_JOBS_ID } from "@/lib/domain/moreMatches";
import { payPrefs } from "@/lib/domain/searchProfile";
import type { JobMatch } from "@/lib/domain/types";
import { TopFive } from "@/components/TopFive";
import { queueLevels, topFive } from "@/lib/domain/scoutFocus";
import { LevelNotice } from "@/components/LevelNotice";
import { maxYearsOf } from "@/lib/domain/levelPolicy";

export const metadata = { title: "Apply" };

/**
 * Apply, the first of Career's three tabs: good fits and the Apply Queue. You apply to every
 * job yourself on your MacBook, with Atlas Autofill in Safari. Where each job stands is on the
 * Tracker; what you set once is on Setup.
 */
export default async function CareerHubPage({ searchParams }: { searchParams: Promise<{ kit?: string }> }) {
  const ctx = await getContext();
  // Atlas Autofill's "Mark submitted" opens this page naming one job. Nothing is changed by the link itself.
  const asked = kitId((await searchParams).kit);
  const { store, settings, today } = ctx;
  const [approvals, matches, queuedMatches, perfect] = await Promise.all([
    store.approvals.list().catch(() => []),
    store.jobMatches.since(addDays(today, -3)).catch(() => []),
    store.jobMatches.since(addDays(today, -45)).catch(() => []),
    store.jobMatches.perfect().catch(() => []),
  ]);
  // Step 1: the five queued jobs to apply to today, by rules.
  const waiting = approvals.filter((a) => a.kind === "application" && a.status === "pending");
  // Your level (lib/domain/levelPolicy.ts): jobs above it never make the five, and are listed to clear.
  const maxYears = maxYearsOf(settings);
  const picks = topFive(waiting, queuedMatches, today, new Set(perfect.map((m) => m.id)), maxYears);
  const levels = queueLevels(waiting, queuedMatches, maxYears);
  // Good fits is the one list you decide from: every job you have not thumbed yet.
  const fits = openFits(matches);
  const target = payPrefs(settings).targetSalary;
  const at = ctx.now.toISOString();
  const checking = asked ? (approvals.find((a) => a.id === asked && a.status === "pending" && a.kind === "application") ?? null) : null;
  return (
    <div className="space-y-5">
      <PageHeader title="Apply" sub="Good fits, a thumb, then apply on your MacBook. Where each job stands is on the Tracker." />

      {/* Opened from the extension after you applied on a job site: one job, one question. You answer; the link changes nothing. */}
      {asked && (
        <section id={KIT_CHECK_ID} className={`card card-pad scroll-mt-20 ${checking ? "card-brand" : ""}`} aria-label="Did you apply?">
          {checking ? (
            <>
              <CardHeader title="Did you apply to this one?" icon="check" hint="Opened from Atlas Autofill. Atlas moves it to Applied on the Tracker only when you say so here." />
              <p className="text-sm font-semibold break-words">{checking.title}</p>
              <div className="mt-2">
                <ApprovalButtons id={checking.id} url={checking.url} kind="applied-check" />
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-2" role="status">
              That job is no longer waiting in a queue: it is already decided. See where it stands on the{" "}
              <Link href="/status" className="font-medium text-brand hover:underline">
                Tracker
              </Link>
              .
            </p>
          )}
        </section>
      )}

      <TopFive picks={picks} waiting={waiting.length} />
      <LevelNotice levels={levels} maxYears={maxYears} />

      {/* Extra jobs on top of the briefs. Above the list they fill. */}
      <div id={MORE_JOBS_ID} className="scroll-mt-20">
        <FindMoreButtons />
      </div>
      <section id={FITS_ID} className="card card-pad scroll-mt-20" aria-label="Good fits">
        <CardHeader title={`Good fits (${fits.length})`} icon="sparkle" hint={`Jobs that match your search. 👍 a job and it goes to your ${APPLY_QUEUE}. 👎 means fewer like it.`} />
        {fits.length === 0 ? (
          <p className="text-sm text-ink-3">No new fits right now. Search with the button above, or wait for the next brief.</p>
        ) : (
          // Every fit waiting for your thumb, folded when the list is long.
          <div className="mt-2">
            <QueueFold count={fits.length} label={fits.length === 1 ? "the 1 good fit" : `the ${fits.length} good fits`} alert={actionLabel(fits.length)}>
              <ul className="divide-y divide-line">
                {fits.map((m) => (
                  <MatchItem key={m.id} m={m} target={target} at={at} />
                ))}
              </ul>
            </QueueFold>
          </div>
        )}
      </section>

      <ApprovalQueue ctx={ctx} />

      <section className="card card-pad">
        <CardHeader title="Save a job" icon="plus" hint="For LinkedIn, Indeed and Glassdoor, which have no public feed. Paste the link and the description; Atlas never opens the link." />
        <SaveJobForm />
      </section>

      {/* Two older pages, used on the Mac. */}
      <ul className="grid gap-4 sm:grid-cols-2">
        <li>
          <Link href="/applications" className="card card-pad flex h-full items-start gap-3 hover:bg-surface-2">
            <Icon name="jobs" size={20} className="mt-0.5 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="h-display block font-medium">Pipeline</span>
              <span className="mt-0.5 block text-sm text-ink-2">Where every application stands, what needs you, and who wrote back. Add one you made elsewhere.</span>
            </span>
          </Link>
        </li>
        <li>
          <Link href="/jobs" className="card card-pad flex h-full items-start gap-3 hover:bg-surface-2">
            <Icon name="hash" size={20} className="mt-0.5 text-brand" />
            <span className="min-w-0 flex-1">
              <span className="h-display block font-medium">Open roles on watched boards</span>
              <span className="mt-0.5 block text-sm text-ink-2">Every open role on the company boards you watch, with interviews and follow-ups due.</span>
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}

/** One match to act on: the posting, its age, place and pay, and the thumbs that queue or dismiss it. `at` is now. */
function MatchItem({ m, target, at }: { m: JobMatch; target: number; at: string }) {
  return (
    <li className="py-2.5">
      <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:text-brand break-words">
        {m.title}
      </a>
      <p className="text-xs text-ink-2 break-words">
        {m.company} · {m.payText} · {m.source}
        {m.postedAt ? ` · posted ${ago(m.postedAt, at)}` : ""}
      </p>
      {m.location && <p className="text-xs text-ink-3 break-words">{m.location}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <Pill color="var(--c-career)">{m.role}</Pill>
        {targetFromLabel(m.payText, target) === "reaches" && <Pill color="var(--c-green)">Reaches your target</Pill>}
        <MatchButtons id={m.id} rating={m.rating} queued={m.status === "pursuing"} />
        <FitButton id={m.id} />
      </div>
      <ResumeLink role={m.role} from="fits" />
    </li>
  );
}
