import { loadCareerSnapshot } from "@/lib/career";
import { getContext } from "@/lib/context";
import { AGENTS, aiUse, minutesByAgent, totalMinutes } from "@/lib/domain/agents";
import { INFRA, jobsOf, KINDS, LOOP_AGENTS, TOOL_REACH, TRIGGER, WORKFLOWS, AI_USE } from "@/lib/domain/registry";
import { KindGuide } from "@/components/KindGuide";
import { KindPill, Tags } from "@/components/KindBadges";
import { KindSummary } from "@/components/KindSummary";
import { minutesLabel } from "@/lib/domain/planner";
import { PLAYBOOK } from "@/lib/domain/playbook";
import { localDate, shortDate } from "@/lib/domain/dates";
import { recommendations, weeklyReview } from "@/lib/domain/review";
import { WeeklyReviewCard } from "@/components/WeeklyReview";
import { Avatar, CardHeader, Meter, PageHeader, Pill, timeAgo } from "@/components/ui";
import { inYourLists } from "@/lib/domain/people";

export const metadata = { title: "Your team" };

export default async function TeamPage() {
  const ctx = await getContext();
  const { store, now, today, settings } = ctx;
  const [ledger14, tasks, contacts, snapshot] = await Promise.all([
    store.ledger.since(new Date(now.getTime() - 14 * 86_400_000).toISOString()),
    store.tasks.list(),
    store.contacts.list().then((all) => all.filter(inYourLists)),
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
        title="Your team"
        sub="Every workflow, bot and agent in Atlas, what kind it is, and each job it runs. They draft, plan and recommend; nothing irreversible happens without your approval."
      />
      <KindGuide />

      <WeeklyReviewCard review={review} recs={recs} label={`${shortDate(review.timeSaved.daily[0]!.day).slice(5)} – ${shortDate(today).slice(5)}`} />

      <KindSummary />

      <section aria-labelledby="workflows" className="space-y-3">
        <h2 id="workflows" className="h-display text-lg font-medium">
          {KINDS.workflow.plural} <span className="text-sm text-ink-3">· {WORKFLOWS.length}</span>
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {WORKFLOWS.map((w) => (
            <article key={w.id} className="card card-pad flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <h3 className="h-display font-medium">{w.name}</h3>
                <KindPill kind="workflow" />
              </div>
              <Tags ai={w.ai} reach={w.reach} trigger={w.trigger} />
              <p className="text-xs text-ink-3">
                Pattern: {w.pattern} · Run by {w.runBy}
              </p>
              <p className="text-xs text-ink-2">{w.when}</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-ink-2">
                {w.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </section>

      <h2 className="h-display text-lg font-medium">
        {KINDS.bot.plural} and the orchestrator <span className="text-sm text-ink-3">· {AGENTS.length}</span>
      </h2>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {AGENTS.map((a) => {
          const last = [...ledger].reverse().find((e) => e.agent === a.id);
          return (
            <article key={a.id} className="card card-pad flex flex-col">
              <div className="flex items-center gap-3">
                <Avatar initials={a.initials} color={a.color} size={44} />
                <div className="min-w-0 flex-1">
                  {a.desk === "career" && <p className="eyebrow">Career desk</p>}
                  <h3 className="h-display font-semibold">{a.name}</h3>
                  <p className="text-xs font-semibold" style={{ color: a.color }}>
                    {a.role}
                  </p>
                </div>
                <Pill color={a.status === "live" ? "var(--c-green)" : a.status === "next" ? "var(--c-indigo)" : "var(--c-grey)"}>
                  {a.status === "live" ? "Live" : a.status === "next" ? "Next" : `Step ${a.buildStep}`}
                </Pill>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <KindPill kind={a.kind} />
                <Tags ai={aiUse(a)} reach={a.reach} trigger={a.trigger} />
              </div>
              <p className="mt-1.5 text-xs text-ink-3">Pattern: {a.pattern}</p>
              <p className="mt-3 text-sm text-ink-2">{a.owns}</p>
              {jobsOf(a.id).length > 0 && (
                <div className="mt-3">
                  <p className="eyebrow">Jobs</p>
                  <ul className="mt-1 divide-y divide-line text-xs">
                    {jobsOf(a.id).map((j) => (
                      <li key={j.name} className="flex items-baseline justify-between gap-3 py-1.5">
                        <span className="text-ink-2">
                          {j.ai === "ai-assisted" ? "✦ " : ""}
                          {j.name}
                        </span>
                        <span className="max-w-[50%] text-right text-ink-3" title={`${AI_USE[j.ai].label} · ${TRIGGER[j.trigger].label}`}>
                          {j.when}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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

      <section aria-labelledby="ai-agents" className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h2 id="ai-agents" className="h-display text-lg font-medium">
            AI agents <span className="text-sm text-ink-3">· {LOOP_AGENTS.length}</span>
          </h2>
          <KindPill kind="agent" />
        </div>
        <p className="text-sm text-ink-2">
          {KINDS.agent.definition} Each one works toward a goal, recovers when a step fails, and finishes only after a rules review and a separate judge. Every tool is read-only: none writes, sends or deletes. Everything else in Atlas keeps its steps in code.
        </p>
        <ul className="grid gap-4 lg:grid-cols-2">
          {LOOP_AGENTS.map((a) => (
            <li key={a.id} className="card card-pad text-sm">
              <div className="flex items-center gap-3">
                <Avatar initials={a.initials} color={a.color} size={36} />
                <p className="min-w-0 font-medium">
                  {a.name} <span className="font-normal text-ink-3">· {a.role}</span>
                </p>
              </div>
              <p className="mt-2 break-words text-ink-2">{a.owns}</p>
              <p className="eyebrow mt-3">Tools it can call · {a.tools.length}</p>
              <ul className="mt-1 divide-y divide-line text-xs">
                {a.tools.map((t) => (
                  <li key={t.name} className="py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <code className="min-w-0 break-all font-mono text-ink">{t.name}</code>
                      <span className="chip shrink-0" title={TOOL_REACH[t.reach].hint}>
                        {TOOL_REACH[t.reach].label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-ink-2">{t.does}</p>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 space-y-1 text-xs text-ink-3">
                <div>
                  <dt className="inline font-medium text-ink-2">Limits: </dt>
                  <dd className="inline">{a.limits}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-ink-2">Starts: </dt>
                  <dd className="inline">{a.when}</dd>
                </div>
                <div>
                  <dt className="inline font-medium text-ink-2">Never: </dt>
                  <dd className="inline">{a.never}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card-connector card-pad" aria-labelledby="claude-connector">
        <h2 id="claude-connector" className="h-display font-medium">
          Claude connector (MCP)
        </h2>
        <p className="mt-2 text-sm text-ink-2">
          Claude reads Atlas through a read-only MCP server at /api/mcp: 10 tools over your weekly plan, Apply Queue, applications, funnel, market, proof project and interview prep, by text or voice. You approve each app once, with your second factor, and can turn it off or revoke it in Settings. It cannot apply, send or change anything.
        </p>
      </section>

      <section className="card card-pad" aria-labelledby="infra">
        <h2 id="infra" className="h-display font-medium">
          Infrastructure <span className="text-sm text-ink-3">· {INFRA.length}</span>
        </h2>
        <p className="mt-1 text-xs text-ink-3">Automations that keep Atlas running. They do none of its work.</p>
        <ul className="mt-2 divide-y divide-line text-sm">
          {INFRA.map((j) => (
            <li key={j.name} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {j.name} <span className="text-xs text-ink-3">· {j.pattern}, {j.runBy}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-3">
                {j.when} <KindPill kind={j.kind} />
              </span>
            </li>
          ))}
        </ul>
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
