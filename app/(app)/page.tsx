import Link from "next/link";
import { getContext } from "@/lib/context";
import { loadBrief } from "@/lib/briefing";
import { aiConfigured } from "@/lib/ai/model";
import { addDays, greeting, localTime, longDate } from "@/lib/domain/dates";
import { minutesLabel } from "@/lib/domain/planner";
import { dueLabel } from "@/lib/domain/relationships";
import { TaskCheck } from "@/components/client/TaskCheck";
import { Icon } from "@/components/Icon";
import { DayTimeline, NowNextCard } from "@/components/schedule";
import { loadTodaySchedule } from "@/lib/scheduling";
import { AreaDot, CardHeader, Empty, Meter, PriorityPill } from "@/components/ui";
import { BriefView } from "@/components/BriefView";
import { BriefPanel } from "@/components/client/BriefPanel";
import { MentorCard } from "@/components/MentorCard";
import { insightsForToday, mentorRetryReason, TODAY_INSIGHT_DAYS } from "@/lib/domain/mentor";
import { qaAlerts } from "@/lib/domain/qa";
import { buildBriefReport } from "@/lib/agents/chiefOfStaff";
import { BRIEF_NAME, BRIEF_TIMES, catchUpDays, catchUpSummary, currentSlot, hourLabel, nextSync, pickBriefDay, slotsFor, SYNC_TASK, todaysBriefs } from "@/lib/domain/briefSchedule";
import { BriefDays } from "@/components/BriefDays";
import { BriefCatchUp } from "@/components/BriefCatchUp";
import type { BriefReport } from "@/lib/domain/chiefOfStaff";

export const metadata = { title: "Today" };
// The live preview can run the Chief of Staff's builders.
export const maxDuration = 60;

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ day?: string | string[] }> }) {
  const ctx = await getContext();
  // ?day= opens a past day's briefs to catch up on: up to two days back, this week only. Anything else is today.
  const briefDay = pickBriefDay((await searchParams).day, ctx.today);
  const back = catchUpDays(ctx.today);
  const pastBriefs = Promise.all(back.map((d) => ctx.store.briefs.forDate(d).catch(() => [])));
  if (briefDay !== ctx.today) {
    const [ledger, pastSaved] = await Promise.all([ctx.store.ledger.since(new Date(ctx.now.getTime() - 7 * 86_400_000).toISOString()).catch(() => []), pastBriefs]);
    const days = catchUpSummary(back, pastSaved, ledger, ctx.settings.timezone);
    return <BriefCatchUp ctx={ctx} day={briefDay} days={days} saved={pastSaved[back.indexOf(briefDay)] ?? []} ledger={ledger} />;
  }
  const dayOff = slotsFor(ctx.today).length === 0;
  // Everything that does not depend on something else loads together, in one round of
  // database calls, so the page waits for the slowest one rather than their sum.
  const [b, savedToday, recentMatches, recentRuns, mentorRows, pastSaved, qaReports] = await Promise.all([
    loadBrief(ctx),
    dayOff ? Promise.resolve([]) : ctx.store.briefs.forDate(ctx.today),
    // Your thumbs and queue state for the briefs' matches (a stored brief keeps only the matches).
    dayOff ? Promise.resolve([]) : ctx.store.jobMatches.since(addDays(ctx.today, -1)).catch(() => []),
    ctx.store.agentRuns.recent(60).catch(() => []),
    // The Mentor runs on its own clock (the evening review is in no brief), so Today asks for its open insights directly.
    ctx.store.mentor.since(addDays(ctx.today, -(TODAY_INSIGHT_DAYS - 1))).catch(() => []),
    pastBriefs,
    // The QA Agent's weekly review: Today points at it only when something serious was found.
    ctx.store.qa.recent(1).catch(() => []),
  ]);
  const qa = qaAlerts(qaReports[0]?.report ?? null, ctx.today);
  const mentor = insightsForToday(mentorRows, ctx.today);
  // When the agents last reported to the Chief of Staff, and when they will next.
  const lastSync = recentRuns.find((r) => r.task === SYNC_TASK && r.status === "succeeded");
  const upcoming = nextSync(ctx.today, ctx.time);
  const { brief } = b;
  const tz = ctx.settings.timezone;
  const day = await loadTodaySchedule(ctx, b.tasks);

  // Every brief saved today stays on the page, newest on top: the 2:00 PM brief sits above
  // the morning one once it comes in. Before the first run, a live preview stands in.
  const saved = todaysBriefs(savedToday);
  const briefs: { report: BriefReport; createdAt?: string }[] = dayOff
    ? []
    : saved.length
      ? saved.map((s) => ({ report: s.report as BriefReport, createdAt: s.createdAt }))
      : [{ report: await buildBriefReport(ctx, currentSlot(ctx.today, ctx.time), b) }];
  const matchState = Object.fromEntries(recentMatches.map((m) => [m.id, { rating: m.rating, status: m.status }]));
  const pastDays = catchUpSummary(back, pastSaved, b.briefLedger, tz);

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{longDate(ctx.today)}</p>
          <h1 className="h-display mt-1 text-[1.9rem] font-medium leading-tight md:text-[2.4rem]">
            {greeting(ctx.time)}, <span className="text-brand">{ctx.settings.displayName}</span>
          </h1>
          <p className="mt-1 text-xs text-ink-3">
            {lastSync ? `Agents synced at ${localTime(new Date(lastSync.at), tz)}.` : "Agents sync every two hours, 6 AM to 4 PM, Monday to Saturday."} Next sync around {hourLabel(upcoming.hour)}
            {upcoming.day === ctx.today ? "" : ` on ${longDate(upcoming.day).split(",")[0]}`}.
          </p>
        </div>
        {b.weather && (
          <div className="card flex items-center gap-3 px-4 py-2.5">
            <span className="h-display text-2xl font-semibold">{Math.round(b.weather.tempNowF)}°</span>
            <span className="text-sm leading-tight text-ink-2">
              {b.weather.summary}
              <br />
              <span className="text-ink-3">
                H {Math.round(b.weather.highF)}° · L {Math.round(b.weather.lowF)}° · {b.weather.place}
              </span>
            </span>
          </div>
        )}
      </section>

      <NowNextCard nn={day.nowNext} schedule={day.schedule} tasks={day.tasks} day={ctx.today} timeZone={tz} now={ctx.now} />

      {qa.length > 0 && (
        <section className="card card-pad border-l-4" style={{ borderLeftColor: "var(--c-red)" }} aria-label="From the QA review">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow flex items-center gap-1.5" style={{ color: "var(--c-red)" }}>
              <Icon name="shield" size={13} /> QA review · {qa.length === 1 ? "1 thing needs" : `${qa.length} things need`} attention
            </p>
            <Link href="/mission#qa" className="btn btn-ghost btn-sm">
              See the review <Icon name="arrow" size={14} />
            </Link>
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {qa.slice(0, 3).map((f) => (
              <li key={f.key} className="break-words">
                {f.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      <MentorCard insights={mentor} retry={mentorRetryReason(recentRuns, aiConfigured() && ctx.settings.aiEnabled)} />

      <BriefDays today={ctx.today} days={pastDays} current={ctx.today} />

      {briefs.length > 0 ? (
        briefs.map(({ report, createdAt }) => (
          <BriefPanel
            key={report.slot}
            slot={report.slot}
            name={BRIEF_NAME[report.slot]}
            meta={`${createdAt ? `ready ${localTime(new Date(createdAt), tz)}` : "live preview"}${report.source === "ai" ? " · worded by Claude" : ""}`}
            headline={report.headline}
            hot={report.hotList.length}
            briefed={b.briefedSlots.includes(report.slot)}
            preview={!createdAt}
            missed={!createdAt && ctx.time >= BRIEF_TIMES[report.slot]}
          >
            <BriefView embedded report={report} timeZone={tz} stored={createdAt ? { createdAt } : undefined} aiReady={aiConfigured() && ctx.settings.aiEnabled} matchState={matchState} />
          </BriefPanel>
        ))
      ) : (
        <section className="card card-brand card-pad md:p-7">
          <p className="eyebrow mb-2 text-brand">Chief of Staff · Weekend Mode</p>
          <h2 className="h-display text-[1.35rem] font-semibold">Sunday is off.</h2>
          <p className="mt-2 text-sm text-ink-2">No brief today. The Morning Brief is back tomorrow at 9:00 AM.</p>
        </section>
      )}

      {brief.risks.length > 0 && (
        <section className="card card-pad border-l-4" style={{ borderLeftColor: "var(--c-orange)" }}>
          <CardHeader title="Watch-outs" icon="alert" />
          <ul className="space-y-1.5">
            {brief.risks.map((r) => (
              <li key={r} className="text-sm text-ink-2">
                {r}
              </li>
            ))}
          </ul>
        </section>
      )}

      <DayTimeline
        schedule={day.schedule}
        tasks={day.tasks}
        nowMin={day.nowMin}
        calendarNote={day.calendar.sample ? "sample calendar" : day.calendar.status === "not_configured" ? "no calendar connected" : day.calendar.status === "error" ? "calendar unavailable" : undefined}
      />

      <div className="grid gap-5">
        <section className="card card-pad min-w-0">
          <CardHeader
            title="Today's top three"
            icon="today"
            hint={`${minutesLabel(brief.plannedMin)} planned of ${minutesLabel(brief.capacityMin)}`}
            action={
              <Link href="/plan" className="btn btn-ghost btn-sm">
                Plan <Icon name="arrow" size={14} />
              </Link>
            }
          />
          <Meter value={brief.plannedMin} max={brief.capacityMin} />
          <ul className="mt-4 divide-y divide-line">
            {brief.focus.length === 0 && <Empty>Nothing planned. Pull something from the backlog.</Empty>}
            {brief.focus.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-3">
                <TaskCheck id={t.id} done={t.status === "done"} label={t.title} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{t.title}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-ink-3">
                    <AreaDot area={t.area} />
                    <span>{minutesLabel(t.estimateMin)}</span>
                    {t.startTime && <span>{t.startTime}</span>}
                    {t.day && t.day < ctx.today && <span className="font-semibold text-bad">overdue</span>}
                  </div>
                </div>
                <PriorityPill priority={t.priority} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="card card-pad">
          <CardHeader
            title="People to reach"
            icon="people"
            action={
              <Link href="/people" className="btn btn-ghost btn-sm">
                All
              </Link>
            }
          />
          {brief.peopleDue.length === 0 ? (
            <Empty>Everyone is up to date.</Empty>
          ) : (
            <ul className="space-y-1">
              {brief.peopleDue.map((p) => (
                <li key={p.contact.id}>
                  <Link href={`/people?to=${p.contact.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 hover:bg-surface-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {p.reason === "birthday" && <Icon name="cake" size={15} className="text-[var(--c-pink)]" />}
                      {p.contact.name}
                    </span>
                    <span className={`text-xs font-semibold ${p.reason === "cadence" && p.days > 3 ? "text-bad" : "text-ink-3"}`}>{dueLabel(p)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>


        <section className="card card-brand card-pad flex flex-col justify-between">
          <div>
            <p className="eyebrow">Time saved this week</p>
            <p className="h-display mt-2 text-5xl font-medium text-brand">{minutesLabel(b.minutesSavedThisWeek)}</p>
            <p className="mt-2 text-sm text-ink-2">Conservative estimates from what your team drafted, planned and condensed for you.</p>
          </div>
          <Link href="/team" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-brand">
            Meet your team <Icon name="arrow" size={14} />
          </Link>
        </section>
      </div>
    </div>
  );
}
