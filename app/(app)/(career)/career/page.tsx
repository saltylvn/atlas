import Link from "next/link";
import { careerPrefs } from "@/lib/agents/career";
import { getContext } from "@/lib/context";
import { addDays } from "@/lib/domain/dates";
import { CAREER } from "@/components/navItems";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, Pill } from "@/components/ui";
import { FitButton, MatchButtons } from "@/components/client/CareerActions";
import { SaveJobForm } from "@/components/client/CareerDesk";
import { dailyPlan } from "@/lib/agents/mentor";
import { ApprovalQueue } from "@/components/ApprovalQueue";
import { todaysPicks } from "@/lib/domain/applyPlan";

export const metadata = { title: "Career" };

/**
 * The Career tab, the job hunt start to finish, in the order you work it: what is waiting
 * on you (the Approval Queue), today's picks to add to it, then the pages behind them:
 * target roles, applications and the watchlist.
 */
export default async function CareerHubPage() {
  const ctx = await getContext();
  const { store, settings, today } = ctx;
  const [apps, approvals, watches, matches] = await Promise.all([
    store.applications.list().catch(() => []),
    store.approvals.list().catch(() => []),
    store.watches.list().catch(() => []),
    store.jobMatches.since(addDays(today, -3)).catch(() => []),
  ]);
  const tracks = todaysPicks(matches, apps, today, dailyPlan(settings));
  const roles = careerPrefs(settings).roles;
  const open = apps.filter((a) => ["applied", "replied", "interview", "offer"].includes(a.status)).length;
  const pending = approvals.filter((a) => a.status === "pending").length;
  const resumes = Object.keys(settings.careerResumes ?? {}).length;

  const about: Record<string, { what: string; now: string }> = {
    "/roles": { what: "The roles you're going for, in priority order, with each role's resume.", now: `${roles.length} roles · ${resumes} with a resume` },
    "/applications": { what: "Every application and where it stands, logged from your email.", now: `${open} open · ${pending} waiting in the queue above` },
    "/jobs": { what: "What to do next, your pipeline, and the company boards Atlas watches.", now: `${watches.length} boards watched · ${matches.filter((m) => m.shownOn >= addDays(today, -1)).length} new matches since yesterday` },
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Career" sub="Your job hunt, start to finish: decide, apply, track." />

      {/* What is waiting on you comes first. */}
      <ApprovalQueue ctx={ctx} />

      <section className="card card-brand card-pad">
        <CardHeader title="Apply today" icon="send" hint="The Applications Agent's picks, in two tracks. 👍 sends a job to the Approval Queue above as an apply kit: listing, resume and your answers. You submit. 👎 means fewer like it." />
        <div className="grid gap-5 lg:grid-cols-2">
          {tracks.map((t) => (
            <div key={t.type}>
              <div className="flex flex-wrap items-center gap-2">
                <p className="h-display font-semibold">{t.label}</p>
                <Pill color={t.sent >= t.plan ? "var(--c-green)" : "var(--c-grey)"}>
                  {t.sent} of {t.plan} sent today
                </Pill>
              </div>
              {t.picks.length === 0 ? (
                <Empty>{t.sent >= t.plan ? "Plan met. Stop here for today." : "No new matches for this track right now. Save one below, or wait for the next brief."}</Empty>
              ) : (
                <ul className="mt-1 divide-y divide-line">
                  {t.picks.map((m) => (
                    <li key={m.id} className="py-2.5">
                      <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:text-brand break-words">
                        {m.title}
                      </a>
                      <p className="text-xs text-ink-2 break-words">
                        {m.company} · {m.payText} · {m.source}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Pill color="var(--c-purple)">{m.role}</Pill>
                        <MatchButtons id={m.id} rating={m.rating} queued={m.status === "pursuing"} />
                        <FitButton id={m.id} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card card-pad">
        <CardHeader title="Save a job" icon="plus" hint="For LinkedIn, Indeed, Glassdoor and Upwork, which have no public feed. Paste the link and the description; Atlas never opens the link." />
        <SaveJobForm />
      </section>

      <ul className="grid gap-4 sm:grid-cols-3">
        {CAREER.map((j) => (
          <li key={j.href}>
            <Link href={j.href} className="card card-pad flex h-full items-start gap-3 hover:bg-surface-2">
              <Icon name={j.icon} size={20} className="mt-0.5 text-brand" />
              <span className="min-w-0 flex-1">
                <span className="h-display block font-semibold">{j.label}</span>
                <span className="mt-0.5 block text-sm text-ink-2">{about[j.href]!.what}</span>
                <span className="mt-2 block text-xs font-medium text-ink-3">{about[j.href]!.now}</span>
              </span>
              <Icon name="arrow" size={15} className="mt-1 text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-3">
        Skills, gaps and the Mentor&apos;s daily reviews are in{" "}
        <Link href="/growth" className="text-brand">
          Growth
        </Link>
        .
      </p>
    </div>
  );
}
