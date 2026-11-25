import { APPLY_QUEUE } from "@/lib/domain/applyLane";
import Link from "next/link";
import type { BriefReport, HotKind } from "@/lib/domain/chiefOfStaff";
import { SLOT_LABEL } from "@/lib/domain/briefSchedule";
import type { BriefEvent, ImportantKind } from "@/lib/domain/calendarAgent";
import { JOB_LABEL } from "@/lib/domain/emailAgent";
import { billLine } from "@/lib/domain/financeAgent";
import { areaOf, type NewsArea } from "@/lib/domain/newsAgent";
import { ago, localDate, localTime, shortDate } from "@/lib/domain/dates";
import { MORE_JOBS_HREF } from "@/lib/domain/moreMatches";
import { TIER_LABEL } from "@/lib/domain/workplace";
import { BriefBody } from "./client/BriefActions";
import { FitButton, MatchButtons } from "./client/CareerActions";
import { ResumeLink } from "./ResumeLink";
import { ScorecardTiles } from "./ScorecardTiles";
import { Icon } from "./Icon";
import { APPROVALS_HREF } from "@/components/ApprovalQueue";
import { CardHeader, Empty, Pill, hue } from "./ui";

// The Chief of Staff's brief: Hot List first, then each specialist's section.
// Server-rendered from a stored BriefReport (or a live preview of one).

const HOT: Record<HotKind, { label: string; color: string }> = {
  offer: { label: "Offer", color: "var(--c-green)" },
  interview: { label: "Interview", color: "var(--c-indigo)" },
  reply: { label: "Reply", color: "var(--c-warn)" },
};
const AREA_COLOR: Record<NewsArea, string> = { tech: "var(--c-blue)", politics: "var(--c-brown)", world: "var(--c-slate)" };
const AREA_SHORT: Record<NewsArea, string> = { tech: "Tech", politics: "Politics", world: "World" };

const KIND: Record<ImportantKind, { label: string; color: string }> = {
  interview: { label: "Interview", color: "var(--c-indigo)" },
  appointment: { label: "Appointment", color: "var(--c-blue)" },
};

/** Briefs saved before the Calendar Agent shipped mark interviews by source only. */
function importance(e: BriefEvent): ImportantKind | null {
  return e.important ?? (e.source === "interview" ? "interview" : null);
}

function when(e: { start: string; end: string; allDay: boolean }, tz: string): string {
  return e.allDay ? "All day" : `${localTime(new Date(e.start), tz)}–${localTime(new Date(e.end), tz)}`;
}

export function BriefView({
  report,
  timeZone,
  stored,
  aiReady,
  archive = false,
  embedded = false,
  matchState,
}: {
  report: BriefReport;
  timeZone: string;
  /** Present for a saved brief; absent for the live preview. */
  stored?: { createdAt: string };
  aiReady: boolean;
  /** Brief history: read-only, no polish button. */
  archive?: boolean;
  /** Inside a brief panel on Today, which already names the brief and when it was ready. */
  embedded?: boolean;
  /** Your current thumbs and queue state for this brief's matches, by match id. */
  matchState?: Record<string, { rating: number; status: string }>;
}) {
  const tz = timeZone;
  const r = report;
  // The brief keeps its order: Utah first, then remote, then offices nearby.
  const fits = r.matches?.fullTime ?? [];
  return (
    <div className="space-y-5">
      <section className="card card-brand card-pad md:p-7">
        {!embedded && (
          <p className="eyebrow mb-2 flex flex-wrap items-center gap-1.5 text-brand">
            <Icon name="sparkle" size={14} /> Chief of Staff · {SLOT_LABEL[r.slot]}
            <span className="text-ink-3">
              {stored ? `· ready ${localTime(new Date(stored.createdAt), tz)}` : "· live preview"}
              {r.source === "ai" ? " · worded by Claude" : ""}
            </span>
          </p>
        )}

        {r.mentor && r.mentor.length > 0 && (
          <div className="mb-5 rounded-lg border border-[color-mix(in_oklab,var(--c-ai)_35%,transparent)] bg-[color-mix(in_oklab,var(--c-ai)_7%,transparent)] p-3">
            <p className="eyebrow mb-2 flex items-center gap-1.5 text-[var(--c-ai-ink)]">
              <Icon name="sparkle" size={13} /> From your Career Mentor
            </p>
            <ul className="space-y-2">
              {r.mentor.map((m) => (
                <li key={m.title} className="text-sm">
                  <p className="font-semibold break-words">{m.title}</p>
                  {m.body.replace(/\.$/, "") !== m.title && <p className="text-ink-2 break-words">{m.body}</p>}
                  <p className="mt-0.5 break-words">
                    <span className="font-medium">Do today: </span>
                    {m.action}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}

        {r.hotList.length > 0 && (
          <div className="mb-5 rounded-lg border border-[color-mix(in_oklab,var(--c-warn)_40%,transparent)] bg-[color-mix(in_oklab,var(--c-warn)_8%,transparent)] p-3">
            <p className="eyebrow mb-2 flex items-center gap-1.5 text-[var(--c-warn-ink)]">
              <Icon name="alert" size={13} /> Hot List
            </p>
            <ul className="space-y-2">
              {r.hotList.map((h) => (
                <li key={`${h.company}-${h.role}`} className="flex flex-wrap items-start gap-2">
                  <Pill color={HOT[h.kind].color}>{HOT[h.kind].label}</Pill>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">
                      {h.link ? (
                        <a href={h.link} target="_blank" rel="noopener noreferrer" className="hover:text-brand">
                          {h.company} · {h.role}
                        </a>
                      ) : (
                        `${h.company} · ${h.role}`
                      )}
                    </p>
                    <p className="text-xs text-ink-2">{h.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {archive ? (
          <div>
            <h2 className="h-display text-[1.35rem] font-semibold leading-snug md:text-[1.6rem]">{r.headline}</h2>
            <ul className="mt-3 space-y-2">
              {r.summary.map((line, i) => (
                <li key={i} className="flex gap-2.5 text-[0.95rem] leading-relaxed text-ink-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <BriefBody headline={r.headline} summary={r.summary} aiReady={aiReady && !stored} />
        )}
      </section>

      {/* Good fits first, one list. */}
      {fits.length > 0 && (
        <FitsSection
          title={`Good fits (${fits.length})`}
          hint={`👍 sends a job to your ${APPLY_QUEUE}, to apply to on your MacBook with the Safari extension`}
          empty="None in this brief."
          matches={fits}
          at={stored?.createdAt ?? r.generatedAt}
          state={archive ? undefined : matchState}
          links={!archive}
        />
      )}

      {r.errors.length > 0 && (
        <section className="banner-warn rounded-lg px-4 py-3 text-sm">
          <p className="font-medium">Some parts of this brief are incomplete:</p>
          <ul className="mt-1 list-disc pl-5">
            {r.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        {r.calendar && (
          <section className="card card-pad lg:col-span-2">
            <CardHeader title="Calendar" icon="plan" hint={r.slot === "saturday" ? "Today and tomorrow" : "Today and the week ahead"} />
            {r.calendar.conflicts.length > 0 && (
              <ul className="mb-3 space-y-1">
                {r.calendar.conflicts.map((c) => (
                  <li key={c} className="text-sm font-medium text-bad">
                    Conflict: {c}
                  </li>
                ))}
              </ul>
            )}
            {r.calendar.today.length === 0 ? (
              <Empty>Nothing on the calendar today.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {r.calendar.today.map((e, i) => {
                  const kind = importance(e);
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <span className="w-28 shrink-0 text-xs font-medium text-ink-3">{when(e, tz)}</span>
                      <span className={kind ? "font-semibold" : "font-medium"}>{e.title}</span>
                      {kind && <Pill color={KIND[kind].color}>{KIND[kind].label}</Pill>}
                    </li>
                  );
                })}
              </ul>
            )}

            {r.calendar.interviews && r.calendar.interviews.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="eyebrow mb-2">Interviews</p>
                <ul className="space-y-3">
                  {r.calendar.interviews.map((iv) => (
                    <li key={`${iv.company}-${iv.start}`} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill color={KIND.interview.color}>{iv.round}</Pill>
                        <span className="font-semibold">
                          {iv.link ? (
                            <a href={iv.link} target="_blank" rel="noopener noreferrer" className="hover:text-brand">
                              {iv.company} · {iv.role}
                            </a>
                          ) : (
                            `${iv.company} · ${iv.role}`
                          )}
                        </span>
                        <span className="text-xs text-ink-3">
                          {shortDate(localDate(new Date(iv.start), tz))} · {localTime(new Date(iv.start), tz)}
                        </span>
                      </div>
                      {!iv.onCalendar && iv.addUrl && (
                        <p className="mt-1 text-xs text-ink-2">
                          Not on your calendar yet.{" "}
                          <a href={iv.addUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
                            Add it to Google Calendar
                          </a>{" "}
                          (nothing is added until you save it there).
                        </p>
                      )}
                      {iv.prep && iv.prep.length > 0 && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-xs font-medium text-ink-2">Prep notes from the Applications bot</summary>
                          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-ink-2">
                            {iv.prep.map((p) => (
                              <li key={p}>{p}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {r.calendar.ahead.length > 0 && (
              <div className="mt-4 border-t border-line pt-3">
                <p className="eyebrow mb-2">Ahead</p>
                <ul className="space-y-1">
                  {r.calendar.ahead.map((d) => (
                    <li key={d.day} className="text-sm">
                      <span className="font-medium">{shortDate(d.day)}</span>
                      <span className="text-ink-2">
                        {d.events.map((e, i) => {
                          const kind = importance(e);
                          return (
                            <span key={i}>
                              {" · "}
                              <span className={kind ? "font-semibold" : undefined} style={kind ? { color: KIND[kind].color } : undefined}>
                                {e.title}
                              </span>
                            </span>
                          );
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {r.email && (
          <section className="card card-pad">
            <CardHeader
              title="Email"
              icon="inbox"
              hint={`${r.email.needsReply} need a reply · ${r.email.fyi} to skim · ${r.email.noise} noise`}
              action={
                <Link href="/inbox" className="btn btn-ghost btn-sm">
                  Open
                </Link>
              }
            />
            {r.email.waiting.length === 0 ? (
              <Empty>Nobody is waiting on a reply.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {r.email.waiting.map((w, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-medium">{w.fromName}</span>
                    <span className="block truncate text-xs text-ink-3">{w.subject || "(no subject)"}</span>
                  </li>
                ))}
              </ul>
            )}
            {r.email.jobs && r.email.jobs.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="eyebrow mb-1.5">Job emails</p>
                <ul className="space-y-1">
                  {r.email.jobs.map((j, i) => (
                    <li key={i} className="text-sm">
                      <span className="font-medium" style={{ color: j.kind === "interview" ? "var(--c-warn)" : undefined }}>
                        {JOB_LABEL[j.kind]}
                      </span>{" "}
                      · {j.fromName}
                      <span className="block truncate text-xs text-ink-3">{j.subject}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.email.subscriptions && r.email.subscriptions.length > 0 && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="eyebrow mb-1.5">Subscriptions</p>
                <ul className="space-y-1">
                  {r.email.subscriptions.map((s) => (
                    <li key={s.name} className="text-sm">
                      <span className="font-medium">{s.name}</span>
                      <span className="block truncate text-xs text-ink-3">{s.subject || "(no subject)"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(r.email.finance !== undefined || (r.email.declutter ?? 0) > 0) && (
              <p className="mt-3 border-t border-line pt-3 text-sm text-ink-2">
                {r.email.finance !== undefined && `You have ${r.email.finance} finance email${r.email.finance === 1 ? "" : "s"}.`}
                {(r.email.declutter ?? 0) > 0 && (
                  <>
                    {" "}
                    <Link href="/inbox" className="font-medium text-brand hover:underline">
                      {r.email.declutter} sender{r.email.declutter === 1 ? "" : "s"} to declutter
                    </Link>
                    .
                  </>
                )}
              </p>
            )}
          </section>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card card-pad lg:col-span-2">
          <CardHeader
            title={r.slot === "afternoon" ? "News since the morning" : "News"}
            icon="news"
            action={
              <Link href="/news" className="btn btn-ghost btn-sm">
                More
              </Link>
            }
          />
          {r.news.length === 0 ? (
            <Empty>{r.slot === "afternoon" ? "Nothing new since the morning brief." : "Feeds are quiet or unreachable right now."}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {r.news.map((n) => {
                const area = n.area ?? areaOf(n.topic);
                return (
                  <li key={n.url} className="py-2.5">
                    <a href={n.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-3">
                      <span className="pill mt-0.5 min-w-[64px] shrink-0 justify-center uppercase" style={hue(AREA_COLOR[area])}>
                        {n.topic === "ai" ? "AI" : AREA_SHORT[area]}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium group-hover:text-brand">{n.title}</span>
                        <span className="text-xs text-ink-3">
                          {n.source}
                          {n.alsoIn && n.alsoIn.length > 0 && ` · also ${n.alsoIn.join(", ")}`}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          {r.jobs && (
            <section className="card card-pad">
              <CardHeader
                title="Job search"
                icon="jobs"
                action={
                  <Link href="/applications" className="btn btn-ghost btn-sm">
                    Open
                  </Link>
                }
              />
              <div className="grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ["Active", r.jobs.active, "var(--c-slate)"],
                    ["Interviews", r.jobs.interviewing, "var(--c-indigo)"],
                    ["Offers", r.jobs.offers, "var(--c-green)"],
                  ] as const
                ).map(([label, n, color]) => (
                  <div key={label} className="rounded-lg bg-surface-2 py-2">
                    <p className="h-display text-xl font-semibold" style={{ color }}>
                      {n}
                    </p>
                    <p className="text-[0.7rem] font-semibold text-ink-3">{label}</p>
                  </div>
                ))}
              </div>
              {r.jobs.followUps.length > 0 && <p className="mt-3 text-sm text-ink-2">Follow up: {r.jobs.followUps.join(", ")}</p>}
            </section>
          )}

          {r.finance && (
            <section className="card card-pad">
              <CardHeader
                title="Money"
                icon="clock"
                hint="Bills, payment alerts and deals, from your email and Renewals"
                action={
                  <Link href="/renewals" className="btn btn-ghost btn-sm">
                    Open
                  </Link>
                }
              />
              {r.finance.alerts.length + r.bills.length + r.finance.bills.length + r.finance.deals.length === 0 ? (
                <Empty>No bills due, no payment alerts, no deals.</Empty>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {r.finance.alerts.map((b) => (
                    <li key={`a-${b.key}-${b.name}`} className="font-semibold text-bad">
                      {billLine(b)}
                    </li>
                  ))}
                  {r.bills.map((b) => (
                    <li key={`r-${b.title}`} className="flex justify-between gap-3">
                      <span className="font-medium">{b.title}</span>
                      <span className={b.when.includes("overdue") ? "text-xs font-semibold text-bad" : "text-xs text-ink-3"}>{b.when}</span>
                    </li>
                  ))}
                  {r.finance.bills.slice(0, 5).map((b) => (
                    <li key={`b-${b.key}-${b.name}`} className="text-ink-2">
                      {billLine(b)}
                    </li>
                  ))}
                  {r.finance.deals.slice(0, 4).map((d) => (
                    <li key={`d-${d.store}`} className="text-ink-2">
                      <span className="font-medium text-ink">{d.store}</span>
                      {d.major && (
                        <span className="ml-1.5">
                          <Pill color="var(--c-green)">{d.holiday ? "Holiday sale" : "Big sale"}</Pill>
                        </span>
                      )}{" "}
                      {d.subject}
                    </li>
                  ))}
                </ul>
              )}
              {r.finance.untracked > 0 && (
                <p className="mt-3 text-xs text-ink-3">
                  {r.finance.untracked} bill{r.finance.untracked === 1 ? "" : "s"} not on your Renewals list yet.{" "}
                  <Link href="/renewals" className="text-brand">
                    Track
                  </Link>
                </p>
              )}
            </section>
          )}

          {!r.finance && r.bills.length > 0 && (
            <section className="card card-pad">
              <CardHeader
                title="Bills & renewals"
                icon="clock"
                action={
                  <Link href="/renewals" className="btn btn-ghost btn-sm">
                    All
                  </Link>
                }
              />
              <ul className="space-y-1.5">
                {r.bills.map((b) => (
                  <li key={b.title} className="flex justify-between gap-3 text-sm">
                    <span className="font-medium">{b.title}</span>
                    <span className={b.when.includes("overdue") ? "text-xs font-semibold text-bad" : "text-xs text-ink-3"}>{b.when}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {r.matches?.scorecard && (
        <section className="card card-pad">
          <CardHeader
            title="Friday scorecard"
            icon="jobs"
            hint="Your job search this week"
            action={
              <Link href="/applications" className="btn btn-ghost btn-sm">
                Pipeline
              </Link>
            }
          />
          <ScorecardTiles s={r.matches.scorecard} />
        </section>
      )}

    </div>
  );
}

type Fit = NonNullable<BriefReport["matches"]>["fullTime"][number];

/** One of the brief's two Good fits lists. `state` is absent in an archived brief, which shows no thumbs. */
function FitsSection({ title, hint, empty, matches, at, state, links }: { title: string; hint: string; empty: string; matches: Fit[]; at: string; state?: Record<string, { rating: number; status: string }>; links: boolean }) {
  return (
    <section className="card card-pad">
      <CardHeader
        title={title}
        icon="jobs"
        hint={hint}
        action={
          links ? (
            <span className="flex flex-wrap justify-end gap-2">
              <Link href={MORE_JOBS_HREF} className="btn btn-ghost btn-sm">
                Find more
              </Link>
              <Link href={APPROVALS_HREF} className="btn btn-ghost btn-sm">
                Apply queues
              </Link>
            </span>
          ) : undefined
        }
      />
      {matches.length === 0 ? (
        <p className="text-sm text-ink-3">{empty}</p>
      ) : (
        <ul className="grid gap-x-8 lg:grid-cols-2">
          {matches.map((m) => (
            <li key={m.id} className="border-t border-line py-2.5">
              <a href={m.url} target="_blank" rel={m.source === "Remote OK" ? "noopener" : "noopener noreferrer"} className="text-sm font-semibold hover:text-brand">
                {m.title}
              </a>
              <p className="text-xs text-ink-2">
                {m.company} · {m.payText} · {m.source}
                {m.postedAt ? ` · ${ago(m.postedAt, at)}` : ""}
              </p>
              {m.location && <p className="text-xs text-ink-3">{m.location}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Pill color="var(--c-career)">{m.role}</Pill>
                {m.tier && <Pill color="var(--c-grey)">{TIER_LABEL[m.tier]}</Pill>}
                {m.target === "reaches" && <Pill color="var(--c-green)">Reaches your target</Pill>}
                {m.referral && <Pill color="var(--c-green)">You know {m.referral}</Pill>}
                {state && <MatchButtons id={m.id} rating={state[m.id]?.rating ?? 0} queued={state[m.id]?.status === "pursuing"} />}
                {state && <FitButton id={m.id} />}
              </div>
              {state && <ResumeLink role={m.role} from="brief" />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
