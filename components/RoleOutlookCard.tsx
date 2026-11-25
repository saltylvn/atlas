import { ReviewRolesButton, RoleProposalButtons } from "@/components/client/CareerDesk";
import { Icon } from "@/components/Icon";
import { CardHeader, Pill } from "@/components/ui";
import { shortDate } from "@/lib/domain/dates";
import { FOCUS, type RoleOutlook, type RoleProposal } from "@/lib/domain/roleOutlook";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const money = (n: number) => `$${Math.round(n / 1000)}k`;

/**
 * The Career Mentor on your target roles: its open proposal (with the reasons, the facts behind
 * them and the approve button), and the Analyst's outlook for every role. Everything is
 * plain text: role names and reasons are never rendered as markup.
 */
export function RoleOutlookCard({
  proposal,
  last,
  outlook,
  evidence,
  reportDate,
  current,
}: {
  /** The proposal waiting on you, if any. */
  proposal: RoleProposal | null;
  /** The most recent decided proposal, for the "last reviewed" line. */
  last: RoleProposal | null;
  outlook: RoleOutlook[];
  evidence: { projects: number; skillsShown: number } | null;
  reportDate: string | null;
  current: string[];
}) {
  const focus = proposal ? proposal.focus : current.slice(0, FOCUS);
  const targets = outlook.filter((o) => o.target);
  const candidates = outlook.filter((o) => !o.target && !o.thin).slice(0, 3);
  const writes = proposal
    ? `your role order in Atlas: ${proposal.proposed.join(", ")}. Notion is not changed.`
    : "";
  return (
    <section id="mentor-roles" className="card card-pad scroll-mt-20 border-l-4" style={{ borderLeftColor: "var(--c-ai)" }}>
      <CardHeader
        title="The Career Mentor on your roles"
        icon="sparkle"
        hint="Each morning the Career Mentor checks whether your role order still matches what you can show (your GitHub projects and resumes) and what the market asks for. It proposes; nothing changes until you approve."
        // Remounted when a proposal opens or is decided, so its last message never outlives what it described.
        action={<ReviewRolesButton key={`${proposal ? "open" : "none"}:${last?.id ?? ""}:${last?.status ?? ""}`} />}
      />

      <div className="mb-4">
        <p className="eyebrow mb-1.5">{proposal ? "Target these three now (proposed)" : "Your three to target now"}</p>
        <div className="flex flex-wrap gap-1.5">
          {focus.map((r, i) => (
            <Pill key={r} color="var(--c-ai)">
              {i + 1}. {r}
            </Pill>
          ))}
        </div>
      </div>

      {proposal ? (
        <div className="rounded-lg border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
            <span>Proposed {shortDate(proposal.forDate)}</span>
            <span>{proposal.writer === "model" ? "Judged by the AI model from the facts below" : "Ranked by rules"}</span>
          </div>
          <p className="h-display mt-1.5 font-semibold break-words">{proposal.headline}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <p className="eyebrow mb-1">Today</p>
              <ol className="list-decimal space-y-0.5 pl-5 text-sm text-ink-2">
                {proposal.base.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ol>
            </div>
            <div>
              <p className="eyebrow mb-1">Proposed</p>
              <ol className="list-decimal space-y-0.5 pl-5 text-sm">
                {proposal.proposed.map((r) => {
                  const isNew = proposal.added.includes(r);
                  const up = !isNew && proposal.proposed.filter((x) => proposal.base.includes(x)).indexOf(r) < proposal.base.indexOf(r);
                  return (
                    <li key={r} className={up || isNew ? "font-semibold" : "text-ink-2"}>
                      {r}
                      {isNew && <span className="ml-1.5 text-xs font-medium text-[var(--c-ai-ink)]">new</span>}
                      {up && <span className="ml-1.5 text-xs font-medium text-[var(--c-green)]">moved up</span>}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
          {proposal.reasons.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {proposal.reasons.map((x) => (
                <li key={x.role} className="break-words">
                  <span className="font-semibold">{x.role}: </span>
                  <span className="text-ink-2">{x.why}</span>
                </li>
              ))}
            </ul>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-ink-3">What this rests on</summary>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-ink-2">
              {proposal.facts.map((f) => (
                <li key={f} className="break-words">
                  {f}
                </li>
              ))}
            </ul>
          </details>
          <div className="mt-3">
            <RoleProposalButtons id={proposal.id} writes={writes} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink-2">
          {last
            ? last.status === "approved"
              ? `You approved a new order on ${shortDate(last.forDate)}. The Career Mentor leaves it alone for a week.`
              : last.status === "dismissed"
                ? `You dismissed the last proposal (${shortDate(last.forDate)}). The same order is not raised again for three weeks.`
                : last.status === "declined"
                  ? `Reviewed ${shortDate(last.forDate)}: the Career Mentor judged that your order should stay as it is.`
                  : `The last proposal (${shortDate(last.forDate)}) was set aside: your order changed, or you asked for a fresh review.`
            : "No change is proposed. The Career Mentor only speaks up when a role clearly leads on what you can show."}
        </p>
      )}

      <div className="mt-5">
        <p className="eyebrow mb-1.5">
          How each role looks{reportDate ? `, as of ${shortDate(reportDate)}` : ""}
          {evidence ? ` · measured against ${evidence.projects} GitHub project${evidence.projects === 1 ? "" : "s"} and your resumes (${evidence.skillsShown} skills shown)` : ""}
        </p>
        {targets.length === 0 ? (
          <p className="text-sm text-ink-3">No outlook yet. The Analyst computes it with the next market report, or press Ask the Career Mentor now.</p>
        ) : (
          <ul className="divide-y divide-line">
            {[...targets, ...candidates].map((o) => (
              <li key={o.role} className="py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <span className="font-medium">
                    {o.role}
                    {!o.target && <span className="ml-1.5 text-xs font-normal text-ink-3">not on your list</span>}
                  </span>
                  {o.thin ? (
                    <span className="text-xs text-ink-3">{o.postings} postings, too few to judge</span>
                  ) : (
                    <span className="text-sm">
                      <span className="font-semibold">{pct(o.qualified)}</span> <span className="text-ink-3">shown</span>
                    </span>
                  )}
                </div>
                {!o.thin && (
                  <>
                    <p className="mt-0.5 text-xs text-ink-2 break-words">
                      {o.postings} postings in 30 days, {o.thisWeek} new this week{o.trend === "flat" ? "" : ` (${o.trend})`} · {pct(o.reachable)} remote or Salt Lake
                      {o.payMedian !== null ? ` · median posted pay ${money(o.payMedian)}` : ""}
                      {o.applied ? ` · you applied to ${o.applied}, ${o.responses} answered` : ""}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {o.asked.slice(0, 6).map((a) => (
                        <span key={a.skill} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[0.7rem]" style={a.shown ? { color: "var(--c-green)" } : { color: "var(--ink-3)" }}>
                          {a.shown && <Icon name="check" size={11} />}
                          {a.skill} {pct(a.share)}
                        </span>
                      ))}
                    </p>
                    {o.projects.length > 0 && <p className="mt-1 text-xs text-ink-3 break-words">Projects that back it: {o.projects.join(", ")}</p>}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-ink-3">
          A ticked skill with nothing behind it does not count here: a skill is shown when a GitHub project or a resume backs it. The percentage after each skill is how many of that role&apos;s postings ask for it.
        </p>
      </div>
    </section>
  );
}
