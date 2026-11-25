import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplicationFlags, StatusPicker } from "@/components/client/CareerActions";
import { LEVEL_LABEL, levelOf } from "@/lib/domain/outcomes";
import { daysBetween } from "@/lib/domain/dates";
import { SeenBeacon } from "@/components/client/HeardBack";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, Pill, timeAgo } from "@/components/ui";
import { getContext } from "@/lib/context";
import { PrepPanel } from "@/components/PrepPanel";
import { prepRunId } from "@/lib/agents/interviewPrep";
import { ROLE_NOT_LISTED } from "@/lib/domain/applications";
import { localDate, shortDate } from "@/lib/domain/dates";
import { FEED_LIMIT } from "@/lib/domain/heardBack";
import { furthest, KIND_HUE, STAGE_HUE, STAGE_LABEL, stageOf, stepsFor, timelineRows, type TimelineRow } from "@/lib/domain/pipeline";

export const metadata = { title: "Application" };

function Row({ r, timeZone }: { r: TimelineRow; timeZone: string }) {
  const when = new Date(r.at);
  const clock = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(when);
  return (
    <li className="relative pb-4 pl-5 last:pb-0">
      {/* The line down the timeline, and this event's dot on it. */}
      <span aria-hidden="true" className="absolute top-2 bottom-0 left-[3px] w-px bg-line" />
      <span aria-hidden="true" className="absolute top-1.5 left-0 h-[7px] w-[7px] rounded-full" style={{ background: KIND_HUE[r.kind] ?? "var(--color-line-strong)" }} />
      <p className="text-sm leading-snug font-medium break-words">{r.title}</p>
      {r.said && <p className="mt-0.5 text-sm text-ink-2 break-words">&ldquo;{r.said}&rdquo;</p>}
      <p className="mt-0.5 text-xs text-ink-3">
        <time dateTime={r.at}>
          {shortDate(localDate(when, timeZone))} · {clock}
        </time>{" "}
        · {r.via}
      </p>
    </li>
  );
}

/**
 * One application: where it stands, and everything that happened to it, newest first
 * (docs/design-pipeline.md). The timeline is read-only; moving the application adds to it.
 */
export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) notFound();
  const { store, settings, now } = await getContext();
  const app = await store.applications.get(id);
  if (!app) notFound();
  const [events, notices, prepRun] = await Promise.all([store.applicationEvents.forApplication(app.id), store.notifications.recent(FEED_LIMIT).catch(() => []), store.agentRunState.get(prepRunId(app.id)).catch(() => null)]);
  // Opening the page is reading its answers: the beacon marks them read from the browser.
  const unread = notices.some((n) => n.applicationId === app.id && !n.seenAt);
  const stage = stageOf(app);
  const { steps, closed } = stepsFor(stage, furthest(events));
  const rows = timelineRows(events);
  const applied = app.appliedOn ? `applied ${shortDate(app.appliedOn)}` : "not submitted yet";

  return (
    <div className="space-y-5">
      {unread && <SeenBeacon applicationId={app.id} />}
      <Link href="/applications" className="btn btn-ghost btn-sm">
        <Icon name="arrow" size={14} className="rotate-180" /> Pipeline
      </Link>
      <PageHeader
        title={app.company}
        sub={
          <>
            {app.role === ROLE_NOT_LISTED ? "Role not listed yet" : app.role} · {applied}
            {app.status !== "saved" ? ` · ${app.tier === "auto" ? "Atlas applied" : "you applied"}` : ""}
          </>
        }
        action={<Pill color={STAGE_HUE[stage]}>{STAGE_LABEL[stage]}</Pill>}
      />

      <section className="card card-pad" aria-labelledby="stands">
        <h2 id="stands" className="sr-only">
          Where it stands
        </h2>
        <ol className="grid grid-cols-4 gap-1.5">
          {steps.map((s) => (
            <li key={s.label} aria-current={s.state === "current" ? "step" : undefined}>
              <span aria-hidden="true" className={`block h-1 rounded-full ${s.state === "todo" ? "bg-surface-2" : "bg-brand"}`} />
              <span className={`mt-1.5 block text-xs break-words ${s.state === "current" ? "font-medium text-ink" : "text-ink-3"}`}>
                {s.label}
                <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (now)" : " (not yet)"}</span>
              </span>
            </li>
          ))}
        </ol>
        {closed && (
          <p className="mt-3 text-sm text-ink-2">
            {closed === "Rejected" ? "They said no." : "You withdrew."} It got as far as {steps.filter((s) => s.state === "done").at(-1)?.label ?? STAGE_LABEL.applied}.
          </p>
        )}
        {stage === "saved" && <p className="mt-3 text-sm text-ink-2">Saved to submit. It starts moving when you apply.</p>}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-3">Last heard</dt>
            <dd>{app.lastHeardAt ? timeAgo(app.lastHeardAt, now) : "Not yet"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Counts as</dt>
            <dd className="break-words">{app.targetRole || "None of your roles"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Pay</dt>
            <dd>{app.payText || "Not listed"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Found on</dt>
            <dd className="break-words">
              {app.url ? (
                <a href={app.url} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                  {app.source || "The posting"}
                </a>
              ) : (
                app.source || "Unknown"
              )}
            </dd>
          </div>
        </dl>
        {/* What it was sent with (Step 0): the funnel on the Tracker learns from these. */}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-ink-3">Level in its title</dt>
            <dd>{LEVEL_LABEL[app.level ?? levelOf(app.role)]}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Posting age when you applied</dt>
            <dd>{app.postedOn && app.appliedOn ? `${Math.max(0, daysBetween(app.postedOn, app.appliedOn))} days` : "Not known"}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-3">Resume sent</dt>
            <dd className="break-words">{app.resumeVersion || "Not recorded"}</dd>
          </div>
        </dl>
        <div className="mt-3">
          <ApplicationFlags id={app.id} tailored={app.tailored ?? null} warm={app.warm ?? null} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <span className="text-sm text-ink-2">Move it yourself</span>
          <StatusPicker id={app.id} status={app.status} />
        </div>
      </section>

      {/* The Coach (Step 4): on any application you sent; prepared on its own when it reaches interview. */}
      {app.status !== "saved" && <PrepPanel appId={app.id} run={prepRun} />}

      <section className="card card-pad">
        <CardHeader title={`Timeline (${rows.length})`} icon="clock" hint="Every email about this application, and every move, newest first. Emails show their subject or one sentence, never their text." />
        {rows.length === 0 ? (
          <Empty>Nothing on the timeline yet. The next email about this application, or your next move, starts it.</Empty>
        ) : (
          <ol>
            {rows.map((r) => (
              <Row key={r.id} r={r} timeZone={settings.timezone} />
            ))}
          </ol>
        )}
      </section>

      {app.notes && (
        <section className="card card-pad">
          <CardHeader title="Notes" icon="copy" />
          <p className="text-sm whitespace-pre-line text-ink-2 break-words">{app.notes}</p>
        </section>
      )}
    </div>
  );
}
