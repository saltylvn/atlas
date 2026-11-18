import Link from "next/link";
import type { Context } from "@/lib/context";
import { BRIEF_NAME, briefedSlots, todaysBriefs } from "@/lib/domain/briefSchedule";
import type { BriefReport } from "@/lib/domain/chiefOfStaff";
import { addDays, localTime, longDate } from "@/lib/domain/dates";
import type { LedgerEntry, LocalDate, StoredBrief } from "@/lib/domain/types";
import { BriefView } from "./BriefView";
import { BriefDays, type BriefDay } from "./BriefDays";
import { BriefPanel } from "./client/BriefPanel";
import { Icon } from "./Icon";

/**
 * Catching up on a past day: that day's briefs, each with everything it had on the day
 * (Mark as briefed, thumbs, fit check). Anything you do here happens now: a 👍 queues the
 * match today, and confirming a brief counts for the day it was written.
 */
export async function BriefCatchUp({ ctx, day, days, saved, ledger }: { ctx: Context; day: LocalDate; days: BriefDay[]; saved: StoredBrief[]; ledger: Pick<LedgerEntry, "agent" | "activity" | "at">[] }) {
  const tz = ctx.settings.timezone;
  // Your current thumbs and queue state for that day's matches.
  const matches = await ctx.store.jobMatches.since(addDays(day, -1)).catch(() => []);
  const matchState = Object.fromEntries(matches.map((m) => [m.id, { rating: m.rating, status: m.status }]));
  const briefed = briefedSlots(ledger, day, tz);
  const briefs = todaysBriefs(saved);

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-brand">Catching up</p>
          <h1 className="h-display mt-1 text-[1.9rem] font-medium leading-tight md:text-[2.4rem]">{longDate(day)}</h1>
          <p className="mt-1 max-w-2xl text-xs text-ink-3">
            That day&apos;s briefs, with every action they had. What you do here happens now: a match you give a 👍 joins your apply queue today, and Briefed counts for {longDate(day).split(",")[0]}.
          </p>
        </div>
        <Link href="/" className="btn btn-ghost btn-sm">
          <Icon name="arrow" size={14} className="rotate-180" /> Back to today
        </Link>
      </section>

      <BriefDays today={ctx.today} days={days} current={day} />

      {briefs.length === 0 ? (
        <section className="card card-pad text-sm text-ink-2">No brief was saved that day.</section>
      ) : (
        briefs.map((b) => {
          const report = b.report as BriefReport;
          return (
            <BriefPanel
              key={b.slot}
              slot={b.slot}
              day={day}
              name={BRIEF_NAME[b.slot]}
              meta={`ready ${localTime(new Date(b.createdAt), tz)}`}
              headline={report.headline}
              hot={report.hotList.length}
              briefed={briefed.includes(b.slot)}
              preview={false}
            >
              <BriefView embedded report={report} timeZone={tz} stored={{ createdAt: b.createdAt }} aiReady={false} matchState={matchState} />
            </BriefPanel>
          );
        })
      )}
    </div>
  );
}
