import Link from "next/link";
import { careerPrefs, jobMailsFrom } from "@/lib/agents/career";
import { getContext } from "@/lib/context";
import { eventIndex, mailsToPlace, trackMail } from "@/lib/domain/applications";
import { savedSearches } from "@/lib/domain/careerAgent";
import { weeklyScorecard } from "@/lib/domain/careerPrep";
import { ScorecardTiles } from "@/components/ScorecardTiles";
import { AddApplicationForm, FindPastApplicationsButton } from "@/components/client/CareerActions";
import { HoldRejectionsSwitch, MarkAllReadButton } from "@/components/client/HeardBack";
import { Icon } from "@/components/Icon";
import { Board, CompanyList, NeedsYouLane, StageList } from "@/components/Pipeline";
import { CardHeader, Empty, PageHeader, timeAgo } from "@/components/ui";
import { feedSplit, FEED_LIMIT, unreadCount } from "@/lib/domain/heardBack";
import { KIND_HUE } from "@/lib/domain/pipeline";
import { byCompany, byStage, FILTER_LABEL, filterCounts, filterRows, FILTERS, needsYou, pick, pipelineRows, pipelineStats, VIEW_LABEL, VIEWS } from "@/lib/domain/pipelineList";
import type { Notice } from "@/lib/domain/types";

export const metadata = { title: "Pipeline" };

/** One answer in the Heard back feed. The whole row opens that application's page. */
function HeardRow({ n, now }: { n: Notice; now: Date }) {
  const unread = !n.seenAt;
  return (
    <li>
      <Link href={n.url} className="flex min-h-[44px] items-start gap-3 py-3 hover:text-brand">
        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: unread ? (KIND_HUE[n.kind] ?? "var(--brand)") : "transparent", boxShadow: unread ? undefined : "inset 0 0 0 1px var(--color-line-strong)" }} />
        <span className="min-w-0 flex-1">
          <span className={`block text-sm leading-snug break-words ${unread ? "font-medium" : "text-ink-2"}`}>
            {n.title}
            {unread && <span className="sr-only"> (unread)</span>}
          </span>
          <span className="block text-xs text-ink-3 break-words">
            {n.body}
            {n.tier === "brief" && !n.sentAt ? " Held for your next brief." : ""}
          </span>
        </span>
        <time dateTime={n.occurredAt} className="shrink-0 pt-0.5 text-xs text-ink-3">
          {timeAgo(n.occurredAt, now)}
        </time>
      </Link>
    </li>
  );
}

/**
 * The Pipeline (docs/design-pipeline.md, 7): where every application stands, phone first.
 * Needs you is on top, then what is new in Heard back, then every application as a list:
 * by stage, by company, or as the six-column board on a wide screen.
 */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ role?: string; show?: string; view?: string }> }) {
  const q = await searchParams;
  const { store, settings, now, today } = await getContext();
  const [apps, inbox, events, timeline, heard] = await Promise.all([
    store.applications.list(),
    store.inbox.list().catch(() => []),
    store.applicationEvents.index().catch(() => []),
    store.applicationEvents.listed().catch(() => []),
    store.notifications.recent(FEED_LIMIT).catch(() => []),
  ]);
  const unread = unreadCount(heard);
  const feed = feedSplit(heard);
  const roles = careerPrefs(settings).roles;
  // Job emails the tracker could not place by rules (several applications at one company,
  // and nothing in the email says which). Worked out here as the tracker does it; nothing is written.
  const toPlace = mailsToPlace(trackMail(jobMailsFrom(inbox, settings), apps, () => "", eventIndex(events)).ask, apps);
  const lane = needsYou(toPlace, apps);
  const stats = pipelineStats(apps);

  const role = roles.find((r) => r.name === q.role)?.name ?? null;
  const filter = pick(FILTERS, q.show);
  const view = pick(VIEWS, q.view);
  const inRole = apps.filter((a) => !role || a.targetRole === role);
  const rows = pipelineRows(inRole, timeline, heard, now);
  const counts = filterCounts(rows);
  const shown = filterRows(rows, filter);
  const shownIds = new Set(shown.map((r) => r.id));

  const href = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams({ ...(role ? { role } : {}), ...(filter !== "all" ? { show: filter } : {}), ...(view !== "stage" ? { view } : {}) });
    for (const [k, v] of Object.entries(patch)) if (v === null) p.delete(k); else p.set(k, v);
    const s = p.toString();
    return s ? `/applications?${s}` : "/applications";
  };
  const chip = (label: string, to: string, on: boolean, extra = "") => (
    <Link key={label} href={to} aria-current={on ? "page" : undefined} className={`btn btn-sm ${on ? "btn-primary" : "btn-ghost"} ${extra}`}>
      {label}
    </Link>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Pipeline"
        sub={`${stats.sent} sent · ${stats.rate}% answered`}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {heard.length > 0 && (
              <a href="#heard-back" className="btn btn-ghost btn-sm" aria-label={unread ? `Heard back: ${unread} unread` : "Heard back: nothing unread"}>
                <Icon name="bell" size={14} /> {unread > 0 && <span className="font-medium text-brand">{unread}</span>}
              </a>
            )}
            <a href="/api/applications.csv" className="btn btn-ghost btn-sm">
              <Icon name="download" size={14} /> CSV
            </a>
          </div>
        }
      />

      <NeedsYouLane items={lane} roles={roles.map((r) => r.name)} timeZone={settings.timezone} />

      {(heard.length > 0 || apps.length > 0) && (
        <section id="heard-back" className="card card-pad scroll-mt-20">
          <CardHeader title={unread ? `Heard back (${unread} new)` : "Heard back"} icon="bell" action={unread > 0 ? <MarkAllReadButton /> : undefined} />
          {heard.length === 0 && <Empty>No answers yet. When a company writes back about an application, it shows here and on your phone.</Empty>}
          {feed.top.length > 0 && (
            <ul className="divide-y divide-line">
              {feed.top.map((n) => (
                <HeardRow key={n.id} n={n} now={now} />
              ))}
            </ul>
          )}
          {/* Everything already read, and the feed's one setting, stay one tap away. */}
          <details className={`group/fold ${feed.top.length > 0 ? "border-t border-line" : ""}`}>
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
              <Icon name="chevron" size={16} className="group-open/fold:rotate-180" />
              <span className="group-open/fold:hidden">{feed.rest.length > 0 ? `Show ${feed.rest.length} earlier` : "How this works"}</span>
              <span className="hidden group-open/fold:inline">{feed.rest.length > 0 ? "Hide earlier" : "Hide"}</span>
            </summary>
            {feed.rest.length > 0 && (
              <ul className="divide-y divide-line">
                {feed.rest.map((n) => (
                  <HeardRow key={n.id} n={n} now={now} />
                ))}
              </ul>
            )}
            <p className="border-t border-line pt-3 text-xs text-ink-3">Every answer from a company, newest first. Each one pings your phone, except between 9 PM and 7 AM, when it waits until 7.</p>
            <HoldRejectionsSwitch on={settings.holdRejections === true} />
          </details>
        </section>
      )}

      {apps.length === 0 ? (
        <section className="card card-brand card-pad">
          <CardHeader title="Start your tracker" icon="jobs" />
          <p className="text-sm text-ink-2">
            The Applications bot logs an application whenever a company emails to thank you for applying, and moves it along as replies, interviews and rejections
            arrive. To catch up on the last 90 days, search Gmail once. A 👍 on a match in your brief adds it too, or add one below.
          </p>
          <div className="mt-3">
            <FindPastApplicationsButton />
          </div>
        </section>
      ) : (
        <section className="space-y-3" aria-labelledby="pipeline-list">
          <h2 id="pipeline-list" className="sr-only">
            Applications
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <nav className="flex flex-wrap gap-2" aria-label="Show">
              {FILTERS.map((f) => chip(`${FILTER_LABEL[f]} ${counts[f]}`, href({ show: f === "all" ? null : f }), filter === f))}
            </nav>
            <nav className="flex flex-wrap gap-2" aria-label="Group by">
              {/* The board is a wide-screen view: its chip is not offered on a phone. */}
              {VIEWS.map((v) => chip(VIEW_LABEL[v], href({ view: v === "stage" ? null : v }), view === v, v === "board" ? "hidden lg:inline-flex" : ""))}
            </nav>
          </div>
          {roles.length > 0 && (
            // One row that scrolls sideways on a phone, so your roles never push the list down the page.
            <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0 md:pb-0" aria-label="Role">
              {chip("All roles", href({ role: null }), !role, "shrink-0")}
              {roles.map((r) => chip(r.name, href({ role: r.name }), role === r.name, "shrink-0"))}
            </nav>
          )}

          {shown.length === 0 ? (
            <Empty>No applications match. Try All, or another role.</Empty>
          ) : view === "board" ? (
            <Board apps={inRole.filter((a) => shownIds.has(a.id))} />
          ) : (
            <div className="card px-[1.15rem] py-1">{view === "company" ? <CompanyList groups={byCompany(shown)} now={now} /> : <StageList groups={byStage(shown)} now={now} openClosed={filter === "closed"} />}</div>
          )}
        </section>
      )}

      {apps.length > 0 && (
        <section className="card card-pad">
          <CardHeader title="This week" icon="jobs" hint="The same scorecard comes in Friday's brief" />
          <ScorecardTiles s={weeklyScorecard(apps, today)} />
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card card-pad">
          <CardHeader title="Add an application" icon="plus" hint="One you made outside Atlas" />
          <AddApplicationForm />
          {apps.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <FindPastApplicationsButton />
            </div>
          )}
        </section>
        <section className="card card-pad">
          <CardHeader title="Saved searches" icon="external" hint="Sites with no public feed: open with your roles set" />
          <ul className="space-y-1.5 text-sm">
            {savedSearches(roles).map((s) => (
              <li key={s.site}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                  {s.site}
                </a>
                <span className="text-xs text-ink-3"> · {s.note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">LinkedIn, Indeed and Glassdoor always stay Semi-Automation: their terms ban automated applying.</p>
        </section>
      </div>
    </div>
  );
}
