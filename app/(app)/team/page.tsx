import { loadCareerSnapshot } from "@/lib/career";
import { getContext } from "@/lib/context";
import { AGENTS, minutesByAgent, totalMinutes } from "@/lib/domain/agents";
import { minutesLabel } from "@/lib/domain/planner";
import { PLAYBOOK } from "@/lib/domain/playbook";
import { localDate, shortDate } from "@/lib/domain/dates";
import { recommendations, weeklyReview } from "@/lib/domain/review";
import { WeeklyReviewCard } from "@/components/WeeklyReview";
import { Avatar, CardHeader, Meter, PageHeader, Pill, timeAgo } from "@/components/ui";

export const metadata = { title: "Your team" };

export default async function TeamPage() {
  const ctx = await getContext();
  const { store, now, today, settings } = ctx;
  const [ledger14, tasks, contacts, snapshot] = await Promise.all([
    store.ledger.since(new Date(now.getTime() - 14 * 86_400_000).toISOString()),
    store.tasks.list(),
    store.contacts.list(),
    loadCareerSnapshot(ctx),
  ]);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();
  const ledger = ledger14.filter((e) => e.at >= weekAgo);
  const review = weeklyReview({ today, toLocal: (iso) => localDate(new Date(iso), settings.timezone), ledger: ledger14, tasks, contacts, snapshot });
  const recs = recommendations(review);
  const byAgent = minutesByAgent(ledger);
  const total = totalMinutes(ledger);
  const max = Math.max(1, ...Object.values(byAgent));
  const live = PLAYBOOK.filter((p) => p.status === "live");
  const next = PLAYBOOK.filter((p) => p.status === "next").sort((a, b) => b.minutesPerWeek - a.minutesPerWeek);
  const potential = live.reduce((n, p) => n + p.minutesPerWeek, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Your optimization team"
        sub="A Chief of Staff and five specialists. They draft, plan and recommend; nothing irreversible happens without your approval."
      />

      <WeeklyReviewCard review={review} recs={recs} label={`${shortDate(review.timeSaved.daily[0]!.day).slice(5)} – ${shortDate(today).slice(5)}`} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map((a) => {
          const last = [...ledger].reverse().find((e) => e.agent === a.id);
          return (
            <article key={a.id} className="card card-pad flex flex-col">
              <div className="flex items-center gap-3">
                <Avatar initials={a.initials} color={a.color} size={44} />
                <div className="min-w-0 flex-1">
                  {a.desk === "career" && <p className="eyebrow">Career desk</p>}
                  <h2 className="h-display font-semibold">{a.name}</h2>
                  <p className="text-xs font-semibold" style={{ color: a.color }}>
                    {a.role}
                  </p>
                </div>
                <Pill color={a.status === "live" ? "var(--c-green)" : a.status === "next" ? "var(--c-blue)" : "var(--c-grey)"}>
                  {a.status === "live" ? "Live" : a.status === "next" ? "Next" : `Step ${a.buildStep}`}
                </Pill>
              </div>
              <p className="mt-3 text-sm text-ink-2">{a.owns}</p>
              <p className="mt-2 text-xs text-ink-3">
                <span className="font-semibold text-ink-2">Never:</span> {a.never}
              </p>
              <div className="mt-auto pt-4">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="text-ink-3">{last ? `Last: ${last.activity}, ${timeAgo(last.at, now)}` : "No activity this week"}</span>
                  <span className="font-semibold">{minutesLabel(byAgent[a.id])}</span>
                </div>
                <Meter value={byAgent[a.id]} max={max} color={a.color} />
              </div>
            </article>
          );
        })}
      </section>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <section className="card card-brand card-pad">
          <p className="eyebrow">Saved in the last 7 days</p>
          <p className="h-display mt-2 text-5xl font-medium text-brand">{minutesLabel(total)}</p>
          <p className="mt-3 text-sm text-ink-2">
            Using every live play each week is worth about <b>{minutesLabel(potential)}</b>, roughly {Math.round(potential / 60)} hours back.
          </p>
        </section>

        <section className="card card-pad">
          <CardHeader title="Live plays" hint="Built into Atlas today." />
          <ul className="grid gap-3 md:grid-cols-2">
            {live.map((p) => (
              <li key={p.title} className="rounded-xl border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{p.title}</p>
                  <Pill color="var(--c-green)">~{minutesLabel(p.minutesPerWeek)}/wk</Pill>
                </div>
                <p className="mt-1 text-xs text-ink-2">{p.why}</p>
                <p className="mt-1.5 text-[0.7rem] font-semibold text-ink-3">{p.where}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card card-pad">
        <CardHeader title="Next plays" hint="The roadmap, biggest time savings first." />
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {next.map((p) => (
            <li key={p.title} className="rounded-xl bg-surface-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{p.title}</p>
                <Pill color="var(--c-grey)">~{minutesLabel(p.minutesPerWeek)}</Pill>
              </div>
              <p className="mt-1 text-xs text-ink-2">{p.why}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
