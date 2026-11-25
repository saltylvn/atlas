import Link from "next/link";
import { careerPrefs } from "@/lib/agents/career";
import { getContext } from "@/lib/context";
import { addDays } from "@/lib/domain/dates";
import { linkedinTuneup, SKILLS, skillDemand, skillGaps } from "@/lib/domain/skills";
import { CopyButton, SkillPicker } from "@/components/client/CareerActions";
import { AskAgentButton, InsightButtons, ProfileTextForm, RefreshMentorButton, ScanGithubButton } from "@/components/client/CareerDesk";
import { githubConfigured, githubHasToken } from "@/lib/integrations/github";
import { Icon } from "@/components/Icon";
import { dailyMentoring, MENTOR_SLOT_LABEL, MENTOR_SLOT_TIME, type MentorInsight } from "@/lib/domain/mentor";
import { shortDate } from "@/lib/domain/dates";
import { CardHeader, Empty, PageHeader, Pill } from "@/components/ui";
import { ProofCard } from "@/components/ProofCard";
import { WeeklyPlanCard } from "@/components/WeeklyPlanCard";
import { weeklyPlanOf } from "@/lib/domain/weeklyPlan";
import { proofPlan } from "@/lib/domain/gapPlan";

export const metadata = { title: "Growth" };

const GROUP_ORDER = ["AI", "Automation", "Languages", "Frameworks", "Cloud", "Data", "Practice"] as const;

const JUMPS = [
  ["#mentor", "Daily mentoring"],
  ["#projects", "Projects"],
  ["#market", "Market"],
  ["#gaps", "Skill gaps"],
  ["#linkedin", "LinkedIn"],
  ["#skills", "Your skills"],
] as const;

/** "14:00" as "2:00 PM". */
const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

/** One Career Mentor insight: open ones carry their evidence and the Done / Not useful buttons; answered ones say how. */
function InsightCard({ insight: i, updated }: { insight: MentorInsight; updated: boolean }) {
  const open = i.status === "new";
  return (
    <li className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        {!open && <Pill color={i.status === "done" ? "var(--c-green)" : "var(--c-grey)"}>{i.status === "done" ? "Action taken" : "Not useful"}</Pill>}
        {updated && <Pill color="var(--c-indigo)">Updated</Pill>}
        <span className="text-xs text-ink-3">{shortDate(i.forDate)}</span>
        <span className="text-xs text-ink-3">{i.writer === "model" ? "Judged by the AI model from the facts below" : "Ranked by rules"}</span>
      </div>
      {/* Plain text only. */}
      <p className={`h-display mt-2 font-semibold break-words ${open ? "" : "text-ink-2"}`}>{i.title}</p>
      {open && i.body.replace(/\.$/, "") !== i.title && <p className="mt-1 text-sm text-ink-2 break-words">{i.body}</p>}
      {open && (
        <>
          <p className="mt-2 text-sm break-words">
            <span className="font-semibold">Do today: </span>
            {i.action}
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-ink-3">What this rests on</summary>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-ink-2">
              {i.evidence.map((e) => (
                <li key={e} className="break-words">
                  {e}
                </li>
              ))}
            </ul>
          </details>
          <div className="mt-3">
            <InsightButtons id={i.id} />
          </div>
        </>
      )}
    </li>
  );
}

/**
 * The Growth tab: the Career Mentor's daily mentoring first, then what it rests on: your projects,
 * the market, the skills that keep appearing in your matched jobs, your gaps, and LinkedIn
 * tune-ups for your target roles.
 */
export default async function GrowthPage() {
  const { store, settings, today, time, mode } = await getContext();
  const repos = await store.portfolio.list().catch(() => []);
  const githubReady = mode === "live" && githubConfigured();
  const roles = careerPrefs(settings).roles;
  const have = settings.careerSkills ?? [];
  const matches = await store.jobMatches.since(addDays(today, -60)).catch(() => []);
  const [insights, market] = await Promise.all([store.mentor.since(addDays(today, -7)).catch(() => []), store.market.latestReport().catch(() => null)]);
  // Daily mentoring: today's three reviews, then what is still open from earlier days.
  const mentoring = dailyMentoring(insights, today, time);
  const carried = insights.filter((i) => i.status === "new" && i.forDate < today).slice(0, 4);
  // A replaced insight was said again with fresher numbers: the newer one stands in for it.
  const earlier = insights.filter((i) => (i.status === "done" || i.status === "dismissed") && i.forDate < today).slice(0, 6);
  // Action Taken clears an insight from the list into this tally (owner's request, 23 Nov 2026).
  const takenToday = insights.filter((i) => i.status === "done" && i.forDate === today);
  const answeredToday = insights.filter((i) => (i.status === "done" || i.status === "dismissed") && i.forDate === today).length;
  const updatedKeys = new Set(insights.filter((i) => i.status === "replaced").map((i) => i.key));
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const withSkills = matches.filter((m) => (m.skills ?? []).length > 0);
  const demand = skillDemand(withSkills, roles, have);
  const gaps = skillGaps(demand);
  const tune = linkedinTuneup(roles, demand, matches);
  const counts = new Map(demand.map((d) => [d.skill, d.count]));
  const groups = GROUP_ORDER.map((g) => ({
    group: g,
    skills: SKILLS.filter((s) => s.group === g)
      .map((s) => ({ name: s.name, count: counts.get(s.name) ?? 0 }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Growth"
        sub={`Your Career Mentor's daily reviews, then what they rest on: skills employers ask for across ${withSkills.length} matched job${withSkills.length === 1 ? "" : "s"} in the last 60 days, for your ${roles.length} target roles.`}
        action={
          <span className="flex flex-wrap gap-2">
            <Link href="/career/map" className="btn btn-ghost btn-sm">
              Career Map
            </Link>
            <Link href="/career/roles" className="btn btn-ghost btn-sm">
              Target Roles
            </Link>
          </span>
        }
      />

      <nav aria-label="On this page" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {JUMPS.map(([href, label]) => (
          <a key={href} href={href} className="chip min-h-[36px] shrink-0 hover:border-brand-border hover:text-brand">
            {label}
          </a>
        ))}
      </nav>

      <section id="mentor" className="card card-brand card-pad scroll-mt-20">
        <CardHeader
          title="Daily mentoring"
          icon="sparkle"
          hint="Your Career Mentor reviews the whole job hunt three times a day: morning priority, midday check, evening review. Refresh and review brings in fresh postings, your latest job emails and a new market report first. It advises; it changes nothing."
        />
        <RefreshMentorButton />
        {answeredToday > 0 && (
          <details className="mt-3 rounded-lg border border-line bg-surface-2 p-3">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
              <span aria-hidden="true" className="text-[var(--c-green)]">
                ✓
              </span>
              {takenToday.length} action{takenToday.length === 1 ? "" : "s"} taken today
              {answeredToday > takenToday.length && <span className="text-xs font-normal text-ink-3">· {answeredToday - takenToday.length} set aside as not useful</span>}
            </summary>
            {takenToday.length > 0 && (
              <ul className="mt-2 space-y-2 text-sm">
                {takenToday.map((i) => (
                  <li key={i.id}>
                    <p className="font-medium break-words">{i.title}</p>
                    {i.ownerNote && <p className="text-xs text-ink-2 break-words">You did: {i.ownerNote}</p>}
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
        <ol className="mt-4 space-y-4">
          {mentoring.map((m) => (
            <li key={m.slot} className="border-l-2 pl-3" style={{ borderColor: m.state === "spoke" ? "var(--c-ai)" : "var(--line)" }}>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{MENTOR_SLOT_LABEL[m.slot]}</span>
                <span className="text-xs text-ink-3">{clock(MENTOR_SLOT_TIME[m.slot])}</span>
                {m.state === "ahead" && <Pill color="var(--c-grey)">Still to come</Pill>}
                {m.state === "quiet" && <span className="text-xs text-ink-3">Nothing to flag</span>}
              </p>
              {m.state === "spoke" && m.insights.every((i) => i.status !== "new") && <p className="mt-1 text-xs text-ink-3">All cleared</p>}
              {m.insights.some((i) => i.status === "new") && (
                <ul className="mt-2 space-y-3">
                  {m.insights
                    .filter((i) => i.status === "new")
                    .map((i) => (
                    <InsightCard key={i.id} insight={i} updated={updatedKeys.has(i.key)} />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
        {insights.length === 0 && <Empty>No insights yet. The Career Mentor speaks at the next brief, or press Refresh and review.</Empty>}
        {carried.length > 0 && (
          <div className="mt-5">
            <p className="eyebrow mb-2">Still open from earlier days</p>
            <ul className="space-y-3">
              {carried.map((i) => (
                <InsightCard key={i.id} insight={i} updated={updatedKeys.has(i.key)} />
              ))}
            </ul>
          </div>
        )}
        {earlier.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-ink-3">Earlier this week ({earlier.length})</summary>
            <ul className="mt-1 space-y-1 text-sm">
              {earlier.map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline gap-2">
                  <Pill color={i.status === "done" ? "var(--c-green)" : "var(--c-grey)"}>{i.status === "done" ? "Action taken" : "Not useful"}</Pill>
                  <span className="min-w-0 flex-1 break-words text-ink-2">
                    {i.title}
                    {i.ownerNote ? <span className="block text-xs text-ink-3">You did: {i.ownerNote}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <WeeklyPlanCard plan={weeklyPlanOf(settings.weeklyPlan)} tasks={await store.tasks.list().catch(() => [])} />

      <ProofCard plan={proofPlan(settings.careerProof)} today={today} />

      <section id="projects" className="card card-pad scroll-mt-20">
        <CardHeader
          title={`Your projects on GitHub${repos.length ? ` (${repos.length})` : ""}`}
          icon="hash"
          hint="Once a day the Scout reads each repository's description, topics, languages, the start of its README and its dependency files, and records what it is built with. The Analyst counts a skill as shown when a project or a resume backs it. No source code is read."
          action={githubReady ? <ScanGithubButton /> : undefined}
        />
        {repos.length === 0 ? (
          <Empty>
            {mode !== "live"
              ? "No projects in the demo yet."
              : githubReady
                ? "No projects read yet. Press Check GitHub now, or wait for the next sync."
                : "Not set up yet. In Vercel, add GITHUB_USER (your GitHub login) and redeploy. To include private repositories, also add GITHUB_TOKEN: a fine-grained token with read-only Contents and Metadata."}
          </Empty>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {repos.map((r) => (
                <li key={r.id} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Only a github.com link the Scout stored is ever linked. */}
                    {r.url ? (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-semibold hover:underline">
                        {r.name} <Icon name="external" size={12} />
                      </a>
                    ) : (
                      <span className="font-semibold">{r.name}</span>
                    )}
                    {r.isPrivate && <Pill color="var(--c-grey)">Private</Pill>}
                    <span className="text-xs text-ink-3">{r.languages.slice(0, 3).join(", ")}</span>
                  </div>
                  {r.description && <p className="mt-0.5 text-sm text-ink-2 break-words">{r.description}</p>}
                  {r.stack.length > 0 && <p className="mt-1 text-xs text-ink-3 break-words">Built with: {r.stack.join(", ")}</p>}
                  {r.skills.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap gap-1">
                      {r.skills.map((sk) => (
                        <span key={sk} className="rounded-full border border-line px-2 py-0.5 text-[0.7rem]" style={{ color: "var(--c-green)" }}>
                          {sk}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-3">
              Last read {shortDate(repos[0]!.checkedOn)}.{githubReady && !githubHasToken() ? " Public repositories only: add GITHUB_TOKEN in Vercel to include private ones." : ""}
            </p>
          </>
        )}
      </section>

      <section id="market" className="card card-pad scroll-mt-20">
        <CardHeader title="The market for your roles" icon="jobs" hint="From the Analyst, once a day, over every posting the Scout recorded in the last 30 days" action={<AskAgentButton agent="analyst" label="Refresh" busy="Analyzing…" />} />
        {!market ? (
          <Empty>No report yet. The Scout records postings at every 2-hour sync, and the Analyst writes the first report before the next morning brief.</Empty>
        ) : (
          <>
            <p className="h-display font-semibold break-words">{market.summary.headline}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-2">
              {market.summary.points.map((x) => (
                <li key={x} className="break-words">
                  {x}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm break-words">
              <span className="font-semibold">Focus: </span>
              {market.summary.focus}
            </p>
            {market.report.total > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="eyebrow text-left">
                      <th scope="col" className="pb-1 pr-3 font-[inherit]">Role</th>
                      <th scope="col" className="pb-1 pr-3 text-right font-[inherit]">Postings</th>
                      <th scope="col" className="pb-1 pr-3 text-right font-[inherit]">This week</th>
                      <th scope="col" className="pb-1 pr-3 text-right font-[inherit]">Median pay</th>
                      <th scope="col" className="pb-1 text-right font-[inherit]">You cover</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {market.report.roles.map((r) => (
                      <tr key={r.role}>
                        <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                          {r.role}
                          {market.report.bestFit?.role === r.role && <span className="ml-2 text-xs text-brand">best fit</span>}
                        </th>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{r.postings}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">
                          {r.thisWeek}
                          {r.trend !== "flat" && <span className="ml-1 text-xs text-ink-3">{r.trend}</span>}
                        </td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{r.payMedian ? `$${Math.round(r.payMedian / 1000)}k` : "–"}</td>
                        <td className="py-1.5 text-right tabular-nums">{r.postings ? pct(r.coverage) : "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-2 text-xs text-ink-3">
              Report for {shortDate(market.forDate)} · {market.report.total} postings from {market.report.sources} sources · {market.summary.writer === "model" ? "worded by the AI model, numbers computed by rules" : "computed and worded by rules"}
            </p>
          </>
        )}
      </section>

      <section id="gaps" className="card card-pad scroll-mt-20">
        <CardHeader title="Your skill gaps" icon="alert" hint="Asked for most often, weighted to your top roles, that you have not marked as yours" />
        {withSkills.length === 0 ? (
          <Empty>Gaps appear after the Applications bot&apos;s next runs, as it notes the skills each matched job asks for.</Empty>
        ) : gaps.length === 0 ? (
          <Empty>No gaps: you have every skill your matches ask for most.</Empty>
        ) : (
          <ol className="space-y-2">
            {gaps.map((g, i) => (
              <li key={g.skill} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span>
                  <span className="mr-1.5 text-ink-3">{i + 1}.</span>
                  <span className="font-semibold">{g.skill}</span>
                  <span className="text-xs text-ink-3"> · {g.roles.slice(0, 2).join(", ")}</span>
                </span>
                <span className="text-xs text-ink-3">
                  in {g.count} job{g.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section id="linkedin" className="card card-pad scroll-mt-20">
        <CardHeader title="LinkedIn tune-up" icon="people" hint="Keep your profile aligned with your target roles, in your priority order" />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="text-sm">
            <p className="eyebrow mb-1">Suggested headline</p>
            <p className="font-medium">{tune.headline}</p>
            <div className="mt-1">
              <CopyButton text={tune.headline} label="Copy headline" />
            </div>
            <p className="eyebrow mb-1 mt-4">Add to your Skills section</p>
            {tune.addSkills.length ? (
              <div className="flex flex-wrap gap-1.5">
                {tune.addSkills.map((s) => (
                  <Pill key={s} color="var(--c-green)">
                    {s}
                  </Pill>
                ))}
              </div>
            ) : (
              <p className="text-xs text-ink-3">Mark the skills you have below, and the ones employers ask for most show here.</p>
            )}
            {tune.learn.length > 0 && <p className="mt-3 text-xs text-ink-3">Worth learning next: {tune.learn.join(", ")}.</p>}
          </div>
          <div className="text-sm">
            <p className="eyebrow mb-1">About section</p>
            <ul className="list-disc space-y-1 pl-5 text-ink-2">
              {tune.aboutTips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="skills" className="card card-pad scroll-mt-20">
        <CardHeader title="Skills you have" icon="check" hint="Tick what you can show. The number is how many matched jobs asked for it." />
        <SkillPicker groups={groups} have={have} />
      </section>
      <section className="card card-pad">
        <CardHeader title="Your LinkedIn text" icon="people" hint="For the Career Mentor's review: whether your first lines say your target role, and whether the skills the market asks for are there" />
        <ProfileTextForm text={settings.linkedinProfile ?? ""} />
      </section>
    </div>
  );
}
