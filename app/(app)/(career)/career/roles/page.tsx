import Link from "next/link";
import { careerPrefs } from "@/lib/agents/career";
import { getContext } from "@/lib/context";
import { RoleOrder } from "@/components/client/RoleOrder";
import { UpdateProfilesButton } from "@/components/client/RoleProfiles";
import { CardHeader, PageHeader, Pill } from "@/components/ui";
import { addDays, shortDate } from "@/lib/domain/dates";
import { latestProfiles, roleCards, TOP_ROLES, topSkillsAcross, type RoleCard, type RoleProfile, type TopSkills } from "@/lib/domain/roleProfile";
import { MARKET_WINDOW_DAYS } from "@/lib/domain/market";
import { skillDemand, skillGaps } from "@/lib/domain/skills";
import { latestDescriptions, type RoleDescription } from "@/lib/domain/roleDescription";
import { similarTitlesFor, type FamilyTitle } from "@/lib/domain/similarTitles";
import { AVERAGE_DAYS, averageSkills, type RoleSkillAverage } from "@/lib/domain/skillStats";
import { BUILT_IN_ROLES, MAIN_ROLES, MAX_ROLES } from "@/lib/domain/targetRoles";
import { ROLE_FIT, topFit, topThreeAverage } from "@/lib/domain/roleFit";

export const metadata = { title: "Target Roles" };
// "Update now" runs the Career Mentor from this page's server action: up to four model calls.
export const maxDuration = 300;

const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number) => `$${Math.round(n / 1000)}k`;
const TREND = { up: "rising", down: "falling", flat: "steady" } as const;

/**
 * Target Roles, the third of Career's four tabs: the roles you are aiming at now, so the hunt
 * has a clear target. Atlas owns the list (at most seven) and its order, set here; Notion keeps
 * only each role's resume. Each card has the Analyst's numbers (refreshed with every market report), the gaps
 * the Growth page also tracks, projects that would close them, and the Career Mentor's weekly
 * profile of the role, worded by Gemini from those numbers. The only thing here that changes
 * anything is your own Save on the role order; nothing sends or applies.
 */
export default async function TargetRolesPage() {
  const { store, settings, today } = await getContext();
  const roles = careerPrefs(settings).roles;
  const have = settings.careerSkills ?? [];
  const [market, profiles, matches, postings, logged, descriptions] = await Promise.all([
    store.market.latestReport().catch(() => null),
    store.roleProfiles.recent(40).catch(() => []),
    // The same 60 days of matches the Growth page ranks your gaps from.
    store.jobMatches.since(addDays(today, -60)).catch(() => []),
    // The Scout's postings from job boards, for the top skills.
    store.market.since(addDays(today, -MARKET_WINDOW_DAYS)).catch(() => []),
    // The Analyst's daily skill counts per role, for the averages on each card.
    store.roleSkills.since(addDays(today, -AVERAGE_DAYS)).catch(() => []),
    // What each role is about, written monthly from postings and a web search.
    store.roleDescriptions.recent(40).catch(() => []),
  ]);
  const about = latestDescriptions(descriptions);
  const top = topSkillsAcross({
    boards: postings,
    searches: matches.filter((m) => m.shownOn >= addDays(today, -MARKET_WINDOW_DAYS)),
    roles: roles.map((r) => r.name),
    have,
    days: MARKET_WINDOW_DAYS,
  });
  const growthGaps = skillGaps(skillDemand(matches.filter((m) => (m.skills ?? []).length > 0), roles, have)).map((g) => g.skill);
  const cards = roleCards(roles.map((r) => r.name), market?.report.outlook, growthGaps);
  const written = latestProfiles(profiles);
  const choices = BUILT_IN_ROLES.map((r) => r.name);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Target Roles"
        sub={`Your ${cards.length} target roles, in your order: what each one is, what it asks for, and what to close to land it.`}
      />

      <section className="card card-pad" aria-label="Where this comes from">
        <ul className="space-y-1 text-sm text-ink-2">
          <li>
            <span className="font-medium text-ink">Your roles:</span> set and ordered below; the Applications bot hunts in this order. Notion keeps the resume for each one.{" "}
            <Link href="/roles" className="font-medium text-brand hover:underline">
              Roles and resumes
            </Link>
          </li>
          <li>
            <span className="font-medium text-ink">Numbers:</span> {market ? `the Analyst's market report of ${shortDate(market.forDate)}.` : "the Analyst has not written a market report yet."}
          </li>
          <li>
            <span className="font-medium text-ink">What each role is:</span> a description written once a month by the Career Mentor with Gemini, from the postings and a web search (Firecrawl), with its sources; and a weekly read of the work, written every Monday evening from those numbers.
          </li>
        </ul>
        <div className="mt-3">
          <UpdateProfilesButton />
        </div>
      </section>

      <section className="card card-pad" aria-label="Your target roles">
        <CardHeader title="Your order" icon="jobs" hint="First is the role you want most" />
        <RoleOrder roles={roles.map((r) => r.name)} choices={choices} max={MAX_ROLES} suggested={MAIN_ROLES} />
      </section>

      <RoleFitCard />

      <TopSkillsCard top={top} />

      {cards.length === 0 && <p className="rounded-lg border border-line p-3 text-sm text-ink-2">No target roles are set yet. Add one above.</p>}

      {cards.map((card) => (
        <RoleSection key={card.role} card={card} profile={written.get(card.role)?.current ?? null} averaged={averageSkills(logged, card.role, { today, have })} about={about.get(card.role) ?? null} similar={similarTitlesFor(roles.find((r) => r.name === card.role) ?? { name: card.role, titles: [] }, [...postings, ...matches])} />
      ))}

      <p className="text-xs text-ink-3">
        Gaps come from the same list as{" "}
        <Link href="/growth#gaps" className="font-medium text-brand hover:underline">
          Growth
        </Link>
        . A milestone role, the one to grow toward after this hunt, will have its place here later.
      </p>
    </div>
  );
}

/** The role fit study from the postings you saved: four kinds of role, best fits, and the gaps in order. */
function RoleFitCard() {
  const STANCE = {
    target: { label: "Target", color: "var(--c-green)" },
    stretch: { label: "Stretch", color: "var(--c-warn)" },
    fallback: { label: "Fallback", color: "var(--c-grey)" },
  } as const;
  return (
    <section className="card card-pad" aria-label="Role fit study">
      <CardHeader title="Role fit study" icon="jobs" hint={`${ROLE_FIT.postings} saved postings, ${shortDate(ROLE_FIT.on)}`} />
      <ol className="space-y-3">
        {ROLE_FIT.groups.map((g) => (
          <li key={g.name} className="text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-ink">
                {g.rank}. {g.name}
              </span>
              <Pill color={STANCE[g.stance].color}>{STANCE[g.stance].label}</Pill>
              <span className="text-xs text-ink-3">best {topFit(g)} · top three average {topThreeAverage(g)}</span>
            </div>
            <p className="text-ink-2">{g.is}</p>
            <p className="text-xs text-ink-3 break-words">
              {[...g.postings].sort((a, b) => b.fit - a.fit).map((p) => `${p.company} ${p.fit}`).join(" · ")}. Lead with {g.leadWith.join(", ")}.
            </p>
          </li>
        ))}
      </ol>
      <h3 className="eyebrow mb-1 mt-4">Gaps to close, in order</h3>
      <ol className="space-y-1 text-sm text-ink-2">
        {ROLE_FIT.gaps.map((g) => (
          <li key={g.gap}>
            <span className="font-medium text-ink">{g.gap}</span> ({g.askedIn} of 10 postings): {g.close}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-3">
        Fit scores are a judgment of requirements met, 0 to 100. The full study, with every posting, is{" "}
        <a href={ROLE_FIT.notion} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
          Ideal Role Mentoring
        </a>{" "}
        in Notion. The Career Mentor reads this summary in every review.
      </p>
    </section>
  );
}

function RoleSection({ card, profile, averaged, similar, about }: { card: RoleCard; profile: RoleProfile | null; averaged: RoleSkillAverage; similar: FamilyTitle[]; about: RoleDescription | null }) {
  const o = card.outlook;
  return (
    <section className="card card-pad" aria-label={card.role}>
      <CardHeader title={`${card.rank}. ${card.role}`} icon="jobs" hint={o ? (o.thin ? `${o.postings} postings in 30 days: too few to judge yet` : `${o.postings} postings in the last 30 days`) : "Not measured yet"} />

      <div className="mb-3">
        <h3 className="eyebrow mb-1">About this role</h3>
        {about ? (
          <>
            <p className="text-sm text-ink break-words">{about.description}</p>
            <p className="mt-1 text-xs text-ink-3 break-words">
              From {about.postings ? `${about.postings} postings and ` : ""}a web search read {shortDate(about.searchedOn)}. Sources:{" "}
              {about.sources.map((src, i) => (
                <span key={src.url}>
                  {i > 0 && ", "}
                  <a href={src.url} target="_blank" rel="noopener noreferrer nofollow" className="text-brand hover:underline" title={src.title}>
                    {src.host}
                  </a>
                </span>
              ))}
              .
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-2">Not written yet. The Career Mentor writes it on the first Monday of each month, or when you press Update now.</p>
        )}
      </div>

      {similar.length > 0 && (
        <div className="mb-3">
          <h3 className="eyebrow mb-1">Also called</h3>
          <ul className="flex flex-wrap gap-2" aria-label={`Other titles for ${card.role}`}>
            {similar.map((t) => (
              <li key={t.title} className="chip text-xs">
                {t.title}
                <span className="text-ink-3"> · {t.from === "postings" ? `${t.count} posting${t.count === 1 ? "" : "s"}` : "searched for"}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {o && !o.thin && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Pill color="var(--c-slate)">Demand {TREND[o.trend]}</Pill>
          {o.payMedian !== null && <Pill color="var(--c-slate)">Median pay {money(o.payMedian)}</Pill>}
          <Pill color={o.qualified >= 0.6 ? "var(--c-green)" : "var(--c-warn)"}>You can show {pct(o.qualified)}</Pill>
          <Pill color="var(--c-grey)">{pct(o.reachable)} remote or Salt Lake</Pill>
          {o.applied > 0 && (
            <Pill color="var(--c-career)">
              {o.applied} applied, {o.responses} answered
            </Pill>
          )}
        </div>
      )}

      {profile ? (
        <div className="space-y-3">
          <div>
            <h3 className="eyebrow mb-1">What it does</h3>
            <p className="text-sm text-ink break-words">{profile.does}</p>
          </div>
          <div>
            <h3 className="eyebrow mb-1">Tempo and vibe</h3>
            <p className="text-sm text-ink break-words">{profile.tempo}</p>
          </div>
          <p className="text-xs text-ink-3">
            Gemini&apos;s read of the role, written for the week of {shortDate(profile.forWeek)}
            {profile.postings ? ` from ${profile.postings} postings` : ""}. Tempo is a judgment, not a measurement.
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-3 text-sm text-ink-2" role="note">
          The Career Mentor has not described this role yet. It writes on Monday evening; the numbers below are current.
        </p>
      )}

      {card.asks.length > 0 && (
        <div className="mt-4">
          <h3 className="eyebrow mb-1">Skills it asks for</h3>
          <ul className="flex flex-wrap gap-2">
            {card.asks.map((a) => (
              <li key={a.skill}>
                <Pill color={a.shown ? "var(--c-green)" : "var(--c-warn)"}>
                  {a.skill} · {pct(a.share)} {a.shown ? "· shown" : "· gap"}
                </Pill>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-3">The share is how many of the role&apos;s postings ask for it. &quot;Shown&quot; means a project or resume of yours shows it.</p>
        </div>
      )}

      <AveragedSkills a={averaged} />

      <div className="mt-4">
        <h3 className="eyebrow mb-1">Gaps to close</h3>
        {card.gaps.length === 0 ? (
          <p className="text-sm text-ink-2">{o && !o.thin ? "None: you can show every skill its postings ask for most." : "Not known until the Analyst has measured this role."}</p>
        ) : (
          <>
            <ul className="space-y-1 text-sm">
              {card.gaps.map((g) => (
                <li key={g.skill} className="break-words">
                  <span className="font-medium">{g.skill}</span>
                  <span className="text-ink-2"> · asked in {pct(g.share)} of postings</span>
                  {g.onGrowthList && <span className="text-ink-3"> · also on your Growth gap list</span>}
                </li>
              ))}
            </ul>
            {profile?.closeSkill && (
              <p className="mt-2 rounded-lg border border-line bg-surface-2 p-3 text-sm break-words">
                <span className="font-medium">Close first: {profile.closeSkill}.</span> {profile.closeWhy}
              </p>
            )}
          </>
        )}
      </div>

      <div className="mt-4">
        <h3 className="eyebrow mb-1">Projects to work on</h3>
        {profile && <p className="mb-2 text-sm break-words">{profile.project}</p>}
        {card.projects.length > 0 ? (
          <ul className="space-y-2">
            {card.projects.map((p) => (
              <li key={p.skill} className="rounded-lg border border-line p-3">
                <p className="text-sm font-medium break-words">{p.title}</p>
                <p className="text-xs text-ink-2 break-words">
                  Closes {p.skill}. {p.pitch}
                </p>
                <details className="mt-1">
                  <summary className="min-h-[44px] cursor-pointer content-center text-xs font-medium text-ink-2">Steps</summary>
                  <ol className="list-decimal space-y-0.5 pl-5 text-xs text-ink-2">
                    {p.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          !profile && <p className="text-sm text-ink-2">Projects appear here once the role has gaps to close or the Career Mentor has written its profile.</p>
        )}
        {card.backedBy.length > 0 && <p className="mt-2 text-xs text-ink-3 break-words">Already backing this role: {card.backedBy.join(", ")}.</p>}
      </div>
    </section>
  );
}

/** The ten skills your top roles ask for most, across job boards and job searches. */
function TopSkillsCard({ top }: { top: TopSkills }) {
  const gaps = top.skills.filter((s) => !s.have).length;
  return (
    <section className="card card-pad" aria-label="Top 10 skills">
      <CardHeader
        title="Top 10 skills these roles ask for"
        icon="sparkle"
        hint={
          top.postings
            ? `From ${top.postings} postings for your ${TOP_ROLES} target roles in the last ${top.days} days: ${top.fromBoards} from job boards the Scout reads, ${top.fromSearches} more from job searches. ${gaps} of the 10 you have not marked as yours.`
            : "No postings for these roles in the last 30 days yet. The Scout reads the job boards every two hours."
        }
      />
      {top.skills.length > 0 && (
        <ol className="space-y-2">
          {top.skills.map((s, i) => (
            <li key={s.skill} className="grid grid-cols-[1.5rem_1fr] items-start gap-2">
              <span className="pt-0.5 text-right text-xs text-ink-3">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{s.skill}</span>
                  <Pill color={s.have ? "var(--c-green)" : "var(--c-warn)"}>{s.have ? "You have it" : "Gap"}</Pill>
                  <span className="text-xs text-ink-3">
                    {pct(s.share)} of postings ({s.postings})
                  </span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-surface-2" aria-hidden="true">
                  <div className="h-1.5 rounded-full" style={{ width: `${Math.max(4, Math.round(s.share * 100))}%`, background: s.have ? "var(--c-green)" : "var(--c-warn)" }} />
                </div>
                <p className="mt-0.5 text-xs text-ink-3 break-words">Asked most by {s.roles.slice(0, 3).join(", ")}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-3 text-xs text-ink-3">
        &ldquo;You have it&rdquo; means you marked it as yours on{" "}
        <Link href="/growth#skills" className="font-medium text-brand hover:underline">
          Growth
        </Link>
        . Each posting counts a skill once.
      </p>
    </section>
  );
}

/** The role's most asked skills, averaged over the Analyst's daily counts. */
function AveragedSkills({ a }: { a: RoleSkillAverage }) {
  return (
    <div className="mt-4">
      <h3 className="eyebrow mb-1">Most asked, averaged</h3>
      {a.days === 0 ? (
        <p className="text-sm text-ink-2">No daily counts with enough postings yet. The Analyst logs one with each market report.</p>
      ) : (
        <>
          <ol className="space-y-1 text-sm">
            {a.skills.map((k, i) => (
              <li key={k.skill} className="flex items-baseline gap-2 break-words">
                <span className="w-5 font-mono text-xs text-ink-3">{i + 1}</span>
                <span className="font-medium">{k.skill}</span>
                <span className="text-ink-2">{pct(k.share)}</span>
                {k.have && <span className="text-xs text-ink-3">yours</span>}
              </li>
            ))}
          </ol>
          <p className="mt-1 text-xs text-ink-3">
            Share of postings asking for it, averaged over {a.days} daily count{a.days === 1 ? "" : "s"}
            {a.from && a.to && a.from !== a.to ? ` (${shortDate(a.from)} to ${shortDate(a.to)})` : ""}, about {a.postings} postings each.
          </p>
        </>
      )}
    </div>
  );
}
