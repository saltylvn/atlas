import Link from "next/link";
import { Pill } from "@/components/ui";
import { ResearchButton } from "@/components/client/ResearchButton";
import type { ApplyBrief } from "@/lib/domain/applyBrief";
import type { AngleItem, BriefResearch } from "@/lib/domain/briefResearch";

/** One angle item, with the facts it cites shown under it, so you can see what it rests on. */
function Cited({ item, facts }: { item: AngleItem; facts: Map<string, string> }) {
  return (
    <li>
      {item.text}
      <span className="block text-xs text-ink-3">From: {item.cites.map((c) => facts.get(c) ?? c).join(" · ")}</span>
    </li>
  );
}

/** What Atlas found about the company: the team, who to reach, news, its own pages, and the angle. */
function Research({ r, approvalId, at }: { r: BriefResearch; approvalId: string; at: string }) {
  const facts = new Map(r.facts.map((f) => [f.id, f.text]));
  return (
    <>
      <section aria-label="The team and who to reach">
        <h4 className="eyebrow mb-1">The team and who to reach</h4>
        <p className="text-ink-2">
          {r.team ? `Team: ${r.team}` : "The posting names no team."}
          {r.reportsTo ? ` · Reports to the ${r.reportsTo}` : ""}
        </p>
        <p className="mt-1 text-xs">
          <a href={r.peopleSearch} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
            Find who leads this work on LinkedIn
          </a>
          <span className="text-ink-3"> (you open it; Atlas never reads LinkedIn)</span>
        </p>
        {r.pages.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs">
            {r.pages.map((p) => (
              <li key={p.url}>
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline break-words">
                  {p.title}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label={`News about ${r.company}`}>
        <h4 className="eyebrow mb-1">News, last 30 days</h4>
        {r.news.length ? (
          <ul className="space-y-1 text-xs">
            {r.news.map((n) => (
              <li key={n.url}>
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-ink hover:text-brand break-words">
                  {n.title}
                </a>
                <span className="text-ink-3">
                  {" "}
                  · {n.source}
                  {n.date ? `, ${n.date}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-ink-3">No headlines that name {r.company} in the last 30 days.</p>
        )}
      </section>

      {r.about && r.about.length > 0 && (
        <section aria-label="What the company does" className="md:col-span-2">
          <h4 className="eyebrow mb-1 flex flex-wrap items-center gap-2">
            What {r.company} does <Pill color="var(--c-ai)">Researcher</Pill>
          </h4>
          <ul className="list-disc space-y-1 pl-4">
            {r.about.map((i) => (
              <Cited key={i.text} item={i} facts={facts} />
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Your angle" className="md:col-span-2">
        <h4 className="eyebrow mb-1 flex flex-wrap items-center gap-2">
          Your angle <Pill color={r.angle.writer === "model" ? "var(--c-ai)" : "var(--c-grey)"}>{r.angle.writer === "model" ? (r.by === "agent" ? "By the Researcher, every line checked" : "Drafted by Gemini, checked by rules") : "By rules"}</Pill>
        </h4>
        <div className="grid gap-3 md:grid-cols-3">
          {(
            [
              ["Why them", r.angle.whyThem],
              ["Lead with", r.angle.yourAngle],
              ["Ask them", r.angle.questions],
            ] as const
          )
            .filter(([, items]) => items.length > 0)
            .map(([title, items]) => (
              <div key={title}>
                <p className="text-xs font-medium text-ink-2">{title}</p>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {items.map((i) => (
                    <Cited key={i.text} item={i} facts={facts} />
                  ))}
                </ul>
              </div>
            ))}
        </div>
        {r.notes.length > 0 && <p className="mt-2 text-xs text-ink-3">{r.notes.join(" ")}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span>Researched {at}.</span>
          <ResearchButton approvalId={approvalId} again />
        </div>
      </section>
    </>
  );
}

const usd = (n: number) => `$${Math.round(n / 1000)}k`;
const VS: Record<NonNullable<ApplyBrief["role"]["pay"]["vsMarket"]>, { label: string; color: string }> = {
  above: { label: "Above market", color: "var(--c-green)" },
  near: { label: "Near market", color: "var(--c-grey)" },
  below: { label: "Below market", color: "var(--c-warn)" },
};
const TREND: Record<ApplyBrief["company"]["trend"], string> = {
  growing: "Hiring more lately",
  steady: "Hiring at a steady pace",
  slowing: "Hiring less lately",
  "new to Atlas": "Too new in Atlas's data to call a direction",
  "no data": "No other postings in Atlas's data",
};

/** New postings per week as small bars, oldest first, with the numbers in words for screen readers. */
function Weekly({ weekly }: { weekly: number[] }) {
  const max = Math.max(1, ...weekly);
  return (
    <div className="flex h-8 items-end gap-1" role="img" aria-label={`New postings per week, oldest first: ${weekly.join(", ")}`}>
      {weekly.map((n, i) => (
        <span key={i} className="w-3 rounded-t-[3px] bg-brand" style={{ height: `${Math.max(n ? 12 : 4, (n / max) * 100)}%`, opacity: n ? 0.85 : 0.2 }} title={`${n} new`} />
      ))}
    </div>
  );
}

/**
 * The apply brief for one job in the Apply Queue: the role, the company and its hiring, who you
 * know, and the steps. Folded, so the queue stays short; open it when you sit down to apply.
 */
export function ApplyBriefCard({ brief, approvalId, research }: { brief: ApplyBrief; approvalId: string; research?: { data: BriefResearch; researchedAt: string } | null }) {
  const { role, company } = brief;
  return (
    <details className="mt-2 rounded-lg border border-line p-2.5">
      <summary className="cursor-pointer text-sm font-medium">Apply brief: the role, {company.name} and your steps</summary>
      <div className="mt-2 grid gap-4 text-sm md:grid-cols-2">
        <section aria-label="The role">
          <h4 className="eyebrow mb-1">The role</h4>
          <p className="text-ink-2">
            {role.level}
            {role.family ? ` · ${role.family}` : ""}
            {role.years ? ` · asks ${role.years} of experience` : ""}
          </p>
          {role.asks.length > 0 ? (
            <p className="mt-1 text-ink-2">
              Skills it names: you have {role.have.length} of {role.asks.length}
              {role.have.length > 0 && <span className="block text-xs">Lead with: {role.have.join(", ")}</span>}
              {role.missing.length > 0 && <span className="block text-xs">Not on your list: {role.missing.join(", ")}</span>}
            </p>
          ) : (
            <p className="mt-1 text-xs text-ink-3">The posting names no skill Atlas tracks. Read the posting now, above, to fill this in.</p>
          )}
          {role.certs.length > 0 && <p className="mt-1 text-xs text-ink-2">Certifications it names: {role.certs.join(", ")}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-ink-2">
            <span>Pay: {role.pay.posted}</span>
            {role.pay.vsMarket && <Pill color={VS[role.pay.vsMarket].color}>{VS[role.pay.vsMarket].label}</Pill>}
          </div>
          <p className="text-xs text-ink-3">
            {role.pay.marketMedian
              ? `Market median for ${role.level.toLowerCase()} ${role.family?.toLowerCase() ?? "roles"}: ${usd(role.pay.marketMedian)} (${role.pay.marketN} postings with pay, last 60 days).`
              : "Too few postings with pay at this level to show a market median yet."}
          </p>
        </section>

        <section aria-label={`The company: ${company.name}`}>
          <h4 className="eyebrow mb-1">{company.name}</h4>
          <p className="text-ink-2">
            {company.openNow} open tech role{company.openNow === 1 ? "" : "s"} seen this week · {TREND[company.trend]}
          </p>
          <div className="mt-1">
            <Weekly weekly={company.weekly} />
            <p className="text-xs text-ink-3">New postings per week, last 8 weeks ({company.dataDays} {company.dataDays === 1 ? "day" : "days"} of Atlas data so far)</p>
          </div>
          {company.hiring.length > 0 && <p className="mt-1 text-xs text-ink-2">Hires most: {company.hiring.map((h) => `${h.label} (${h.n})`).join(", ")}</p>}
          <p className="text-xs text-ink-2">
            {company.remoteShare !== null ? `${company.remoteShare}% remote` : "Work mode not stated"}
            {company.utah > 0 ? ` · ${company.utah} in Utah` : ""}
            {company.payRange ? ` · pays ${usd(company.payRange.min)} to ${usd(company.payRange.max)} across its postings` : ""}
          </p>
          {brief.contact && <p className="mt-1 text-xs font-medium text-ink">You know {brief.contact} there.</p>}
        </section>

        {research ? (
          <Research r={research.data} approvalId={approvalId} at={research.researchedAt} />
        ) : (
          <section aria-label="Research" className="md:col-span-2">
            <p className="text-xs text-ink-3">News, the company&apos;s own pages, who to reach and your angle appear here after Atlas researches the company (right after your 👍, or at the next sync).</p>
            <div className="mt-1">
              <ResearchButton approvalId={approvalId} again={false} />
            </div>
          </section>
        )}

        <section aria-label="Your steps" className="md:col-span-2">
          <h4 className="eyebrow mb-1">Your steps</h4>
          <ol className="space-y-1">
            {brief.steps.map((s, i) => (
              <li key={s.label} className="flex gap-2">
                <span aria-hidden="true" className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${s.done ? "border-brand text-brand" : "border-line-strong text-ink-3"}`}>
                  {s.done ? "✓" : i + 1}
                </span>
                <span>
                  <span className="font-medium">{s.label}</span>
                  {s.done && <span className="sr-only"> (done)</span>}
                  <span className="block text-xs text-ink-3">{s.how}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-ink-3">
            Answers and fixed answers are on <Link href="/career/setup" className="font-medium text-brand hover:underline">Setup</Link>.
          </p>
        </section>
      </div>
    </details>
  );
}
