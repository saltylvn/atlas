import { CopyButton } from "@/components/client/CareerActions";
import { CardHeader, Empty, Pill } from "@/components/ui";
import { daysBetween, shortDate } from "@/lib/domain/dates";
import type { ProofPlan } from "@/lib/domain/gapPlan";

// Step 3: the Career Mentor closes your gaps one at a time (lib/domain/gapPlan.ts). The Analyst
// assigns the gap your top role's junior postings ask for most that nothing of yours shows yet,
// and closes it when a GitHub repo pushed since then shows the skill. You build; Atlas checks.

export function ProofCard({ plan, today }: { plan: ProofPlan; today: string }) {
  const p = plan.current;
  return (
    <section id="proof" className="card card-pad scroll-mt-20">
      <CardHeader
        title="Your proof project"
        icon="wand"
        hint="One gap at a time: the skill your top role's junior and unstated-level postings ask for most that no GitHub project or resume of yours shows. It closes on its own when a repo you push after it was assigned shows the skill, and the next one is assigned the day after."
      />
      {!p ? (
        <Empty>{plan.done.length ? "Nothing open: the next gap is assigned at the Analyst's next daily run." : "None yet. The Analyst assigns one at its daily run, once your top role has at least 5 postings that name skills and one of them is a skill nothing of yours shows."}</Empty>
      ) : (
        <div className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{p.skill}</span>
            <Pill color="var(--c-warn)">{`${Math.round(p.share * 100)}% ask for it`}</Pill>
            <span className="min-w-0 break-words text-xs text-ink-3">{`of ${p.role} postings that name skills · assigned ${shortDate(p.assignedOn)} · ${daysBetween(p.assignedOn, today)} days open`}</span>
          </p>
          <p className="whitespace-pre-wrap break-words text-ink-2">{p.brief}</p>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={p.brief} label="Copy the brief" />
            <span className="text-xs text-ink-3">{p.writer === "model" ? "Brief drafted by AI; the skill and the share come from postings." : "Rules' brief: AI was not available."}</span>
          </div>
        </div>
      )}
      {plan.done.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {plan.done.map((d) => (
            <li key={`${d.skill}-${d.closedOn}`} className="break-words">
              <Pill color="var(--c-green)">Closed</Pill> <span className="font-medium">{d.skill}</span>
              <span className="text-xs text-ink-3">{` · ${d.repo} · ${d.closedOn ? shortDate(d.closedOn) : ""}`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
