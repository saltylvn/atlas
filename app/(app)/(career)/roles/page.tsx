import Link from "next/link";
import { careerPrefs } from "@/lib/agents/career";
import { notionIsStale, syncNotion } from "@/lib/connections/notion";
import { getContext } from "@/lib/context";
import { CAREER_DIRECTION, marketNamesFor } from "@/lib/domain/careerDirection";
import { roleTitles } from "@/lib/domain/similarTitles";
import { ResumeLinkForm } from "@/components/client/CareerActions";
import { ResumeSyncButton } from "@/components/client/CareerDesk";
import { RoleOutlookCard } from "@/components/RoleOutlookCard";
import { notionConfigured } from "@/lib/integrations/notion";
import { RESUME_SYNC_TASK, resumeSyncReady } from "@/lib/agents/resumeSync";
import { figmaConfigured } from "@/lib/integrations/figma";
import { localTime, shortDate, localDate } from "@/lib/domain/dates";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, Pill, timeAgo } from "@/components/ui";

export const metadata = { title: "Target roles" };

const COLORS = ["var(--c-purple)", "var(--c-blue)", "var(--c-teal)", "var(--c-green)", "var(--c-orange)", "var(--c-pink)"];

/** Your career direction (Fable, Nov 2026): the market roles and skills to lead with. */
function CareerDirection({ roles }: { roles: string[] }) {
  const d = CAREER_DIRECTION;
  return (
    <section id="direction" className="card card-pad">
      <CardHeader
        title="Career direction"
        icon="bulb"
        hint={`From ${d.from}, ${d.on}. The market's view, for reference. Your own priority order comes from Notion.`}
        action={
          <a href={d.notion} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            Reflect in Notion <Icon name="external" size={14} />
          </a>
        }
      />
      <p className="mb-4 border-l-2 border-line pl-3 text-sm text-ink-2">{d.edge}</p>
      <div className="mb-4 rounded-lg border border-line p-3 text-sm">
        <p className="eyebrow mb-1">How to present yourself, {d.positioning.on}</p>
        <p className="mb-2 text-ink-2">{d.positioning.why}</p>
        <ul className="list-disc space-y-1 pl-5 text-ink-2">
          {d.positioning.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="eyebrow mb-2">Top 5 roles to target</p>
          <ol className="space-y-3 text-sm">
            {d.roles.map((r) => (
              <li key={r.title}>
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-semibold">
                    {r.rank}. {r.title}
                  </span>
                  {r.mapsTo ? (
                    <Pill color="var(--c-green)">Your #{roles.indexOf(r.mapsTo) + 1 || "?"}: {r.mapsTo}</Pill>
                  ) : (
                    <Pill color="var(--c-grey)">Not a target role</Pill>
                  )}
                </div>
                <p className="text-xs text-ink-3">Also: {r.alsoCalled.join(", ")}</p>
                <p className="mt-1 text-ink-2">{r.why}</p>
                <p className="mt-1 text-ink-2">
                  <span className="font-medium text-ink">Do: </span>
                  {r.tip}
                </p>
                <p className="mt-0.5 text-xs text-ink-3">
                  {r.sources.map((src, i) => (
                    <span key={src.url}>
                      {i > 0 && " · "}
                      <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-brand">
                        {src.label}
                      </a>
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <p className="eyebrow mb-2">Top 5 skills to showcase</p>
          <ol className="space-y-3 text-sm">
            {d.skills.map((k) => (
              <li key={k.name}>
                <span className="font-semibold">
                  {k.rank}. {k.name}
                </span>
                <p className="mt-1 text-ink-2">{k.how}</p>
                {k.tracks && (
                  <p className="mt-0.5 text-xs text-ink-3">
                    Growth tracks &ldquo;{k.tracks}&rdquo; in your matched jobs.{" "}
                    <Link href="/growth" className="text-brand">
                      Growth
                    </Link>
                  </p>
                )}
              </li>
            ))}
          </ol>
          <p className="eyebrow mb-2 mt-5">Drop</p>
          {d.drop.map((x) => (
            <p key={x.what} className="text-sm text-ink-2">
              <span className="font-medium text-bad">{x.what}.</span> {x.why}{" "}
              <a href={x.source.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand">
                {x.source.label}
              </a>
            </p>
          ))}
          <p className="mt-4 text-xs text-ink-3">{d.caveat}</p>
        </div>
      </div>
    </section>
  );
}

/**
 * Your target roles, in priority order, each with the similar job titles the Career
 * Agent has found across its job searches. Edit the roles in Settings.
 */
export default async function TargetRolesPage() {
  const ctx = await getContext();
  const { store, now } = ctx;
  // Notion decides the order and supplies resumes. Refresh the copy when it is older than
  // ten minutes, so a change you just made in Notion shows here. Never blocks the page.
  const synced = ctx.mode === "live" && notionIsStale(ctx.settings, now) ? await syncNotion(store, ctx.settings, now).catch(() => null) : null;
  const settings = synced?.settings ?? ctx.settings;
  const notion = settings.notion;
  const roles = careerPrefs(settings).roles;
  const [matches, apps, runs, proposals, market] = await Promise.all([
    store.jobMatches.since("2000-01-01").catch(() => []),
    store.applications.list().catch(() => []),
    store.agentRuns.recent(120).catch(() => []),
    store.roleProposals.recent(6).catch(() => []),
    store.market.latestReport().catch(() => null),
  ]);
  // The last finished resume sync, for the card below.
  const lastSync = runs.find((r) => r.task === RESUME_SYNC_TASK && (r.status === "succeeded" || r.status === "failed"));
  const syncReady = ctx.mode === "live" && resumeSyncReady();
  const groups = roleTitles(roles, matches, apps);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Target roles"
        sub={`The ${roles.length} roles the Applications Agent hunts for, in your priority order${notion?.ok ? " from Notion" : ""}, with similar titles found across ${matches.length} matched postings.`}
        action={
          <Link href="/settings#career" className="btn btn-ghost btn-sm">
            Edit roles
          </Link>
        }
      />

      {notion && (
        <p className={`card px-4 py-3 text-sm ${notion.ok ? "text-ink-2" : "text-bad"}`}>
          {notion.ok ? (
            <>
              Role order and resumes come from the <b>Resumes</b> database in Notion ({notion.roles} roles, {notion.resumes} resume{notion.resumes === 1 ? "" : "s"}{notion.master ? " including the master" : ""}). Change them there and this page follows.{" "}
            </>
          ) : (
            <>Notion could not be read, so this is the last good copy. {notion.message} </>
          )}
          <Link href="/connectors" className="text-brand">
            Connectors
          </Link>
        </p>
      )}

      <RoleOutlookCard
        proposal={proposals.find((p) => p.status === "new") ?? null}
        last={proposals.find((p) => p.status !== "new") ?? null}
        outlook={market?.report.outlook ?? []}
        evidence={market?.report.evidence ?? null}
        reportDate={market?.report.outlook ? market.forDate : null}
        current={roles.map((r) => r.name)}
        writesToNotion={ctx.mode === "live" && notionConfigured()}
      />

      {settings.careerMasterResume && (
        <section className="card card-pad flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="h-display font-semibold">Master resume</p>
            <p className="text-sm text-ink-2">The copy your role resumes are tailored from, and the one for LinkedIn. Not a role: the Applications Agent does not hunt for it.</p>
          </div>
          <a href={settings.careerMasterResume} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
            Open <Icon name="external" size={14} />
          </a>
        </section>
      )}

      <section id="resume-sync" className="card card-pad scroll-mt-20">
        <CardHeader
          title="Resume text from Figma"
          icon="refresh"
          hint="Every evening about 6 PM, Monday to Saturday, the Applications Agent compares each resume's Figma frame (the link in the row's Notes) with the text on that row's Notion page. A resume that changed in Figma is mirrored into Notion and into Ask Atlas."
          action={syncReady ? <ResumeSyncButton /> : undefined}
        />
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          <li>Atlas writes one block on each resume page and nothing else in Notion. Text you edit there by hand is never overwritten.</li>
          <li>Figma is only read. The PDF attached to a row is not touched: export it again after you change a resume.</li>
          <li>Your contact details are left out of the mirrored text.</li>
        </ul>
        {syncReady ? (
          <p className={`mt-3 text-sm break-words ${lastSync?.status === "failed" ? "text-bad" : "text-ink-2"}`}>
            {lastSync ? (
              <>
                <span className="font-medium text-ink">
                  Last run {shortDate(localDate(new Date(lastSync.at), settings.timezone))} at {localTime(new Date(lastSync.at), settings.timezone)}:
                </span>{" "}
                {lastSync.detail}
              </>
            ) : (
              "It has not run yet. Press Sync now, or wait for this evening."
            )}
          </p>
        ) : (
          <p className="mt-3 text-sm text-ink-2">
            {ctx.mode !== "live" ? (
              "This runs in the live app only: demo mode has no Figma or Notion connection."
            ) : (
              <>
                <span className="font-medium text-ink">Not set up yet.</span>{" "}
                {figmaConfigured()
                  ? "Notion is not connected: add NOTION_TOKEN in Vercel."
                  : "In Figma, create a personal access token with the single scope File content: read, add it in Vercel as FIGMA_TOKEN (Sensitive, Production) and redeploy. In Notion, give the Atlas connection Insert content and Update content."}
              </>
            )}
          </p>
        )}
      </section>

      <CareerDirection roles={roles.map((r) => r.name)} />

      <div className="grid gap-5 lg:grid-cols-2">
        {groups.map((g, i) => (
          <section key={g.role.name} className="card card-pad">
            <CardHeader
              title={`${i + 1}. ${g.role.name}`}
              icon="jobs"
              hint={`${g.matches} matched posting${g.matches === 1 ? "" : "s"} · ${g.applications} application${g.applications === 1 ? "" : "s"}`}
            />

            {marketNamesFor(g.role.name).length > 0 && (
              <p className="mb-3 text-xs text-ink-2">
                <span className="font-semibold text-ink">The market also calls it: </span>
                {marketNamesFor(g.role.name).join(", ")}.{" "}
                <a href="#direction" className="text-brand">
                  Career direction
                </a>
              </p>
            )}
            <p className="eyebrow mb-1.5">Resume</p>
            <ResumeLinkForm role={g.role.name} url={settings.careerResumes?.[g.role.name] ?? ""} />
            <p className="mb-3 mt-1 text-xs text-ink-3">
              {notion?.ok
                ? "Filled from Notion when the role's row has a Share link or an attached file. Otherwise paste a link here."
                : "A Google Drive link (Share › Copy link; keep access Restricted). Atlas only stores the link."}
            </p>

            <p className="eyebrow mb-1.5">Similar job titles found in your searches</p>
            {g.similar.length === 0 ? (
              <Empty>None yet. Titles appear here as the Applications Agent finds matches for this role.</Empty>
            ) : (
              <ul className="space-y-1">
                {g.similar.map((t) => (
                  <li key={t.title} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="font-medium">{t.title}</span>
                    <span className="shrink-0 text-xs text-ink-3">
                      {t.count}× · {timeAgo(t.lastSeen, now)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="eyebrow mb-1.5 mt-4">Titles Atlas searches for</p>
            <div className="flex flex-wrap gap-1.5">
              {g.searchedFor.map((t) => (
                <Pill key={t} color={COLORS[i % COLORS.length]!}>
                  {t}
                </Pill>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="text-sm text-ink-3">
        Your answer bank moved to{" "}
        <Link href="/applications#answers" className="text-brand hover:underline">
          Applications
        </Link>
        .
      </p>
    </div>
  );
}
