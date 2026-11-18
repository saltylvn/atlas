import { QA_AREA_LABEL, type QaSeverity, type StoredQaReport } from "@/lib/domain/qa";
import { shortDate } from "@/lib/domain/dates";
import { LAYOUT_BRIEF, LAYOUT_SINCE, MAIN_TABS } from "@/lib/domain/layout";
import { RunNowButton } from "@/components/client/MissionControls";
import { CardHeader, Empty, Pill, timeAgo } from "@/components/ui";

const SEVERITY: Record<QaSeverity, { label: string; color: string }> = {
  high: { label: "High", color: "var(--c-red)" },
  medium: { label: "Medium", color: "var(--c-orange)" },
  low: { label: "Low", color: "var(--c-grey)" },
};

/**
 * The QA Agent's weekly review of Atlas itself, on Mission Control: what needs attention,
 * ranked, each with the facts it rests on and a suggested fix; what got fixed since last
 * week; and every check that ran. It recommends; it changes nothing.
 */
export function QaCard({ latest, now }: { latest: StoredQaReport | null; now: Date }) {
  const r = latest?.report ?? null;
  return (
    <section id="qa" className="card card-pad scroll-mt-20">
      <CardHeader
        title="QA review"
        icon="shield"
        hint="The QA Agent reviews Atlas itself every Sunday evening: runs, briefs, the AI model, eval scores, connections, your queues and whether each main tab was used. By rules, never the AI model. It recommends; it changes nothing."
        action={<RunNowButton agent="qa" />}
      />
      {!r ? (
        <Empty>No review yet. The first runs on Sunday evening, or press Run now to review the last seven days.</Empty>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-semibold">{r.headline}</span>{" "}
            <span className="text-ink-3">
              {shortDate(r.from)} to {shortDate(r.to)} · reviewed {timeAgo(latest!.createdAt, now)}
            </span>
          </p>
          <p className="mt-1 text-xs text-ink-3">
            {r.stats.runs} runs ({r.stats.failed} failed, {r.stats.stalled} stopped mid-run) · {r.stats.briefsSaved} of {r.stats.briefsExpected} briefs saved · the AI model answered {r.stats.aiAnswered} of{" "}
            {r.stats.aiAnswered + r.stats.aiFellBack} times
          </p>

          {r.findings.length > 0 && (
            <ul className="mt-4 space-y-3">
              {r.findings.map((f) => (
                <li key={f.key} className="rounded-lg border border-line bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill color={SEVERITY[f.severity].color}>{SEVERITY[f.severity].label}</Pill>
                    <span className="text-xs text-ink-3">{QA_AREA_LABEL[f.area]}</span>
                    <span className="text-xs text-ink-3">{f.weeks > 1 ? `Open for ${f.weeks} reviews` : "New this week"}</span>
                  </div>
                  <p className="h-display mt-2 font-semibold break-words">{f.title}</p>
                  <p className="mt-1 text-sm break-words">
                    {/* A layout finding's fix is a list of options, and says so itself. */}
                    {f.area !== "layout" && <span className="font-semibold">Suggested fix: </span>}
                    {f.fix}
                  </p>
                  {f.evidence.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-ink-3">What this rests on</summary>
                      <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-ink-2">
                        {f.evidence.map((e) => (
                          <li key={e} className="break-words">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}

          {r.resolved.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-semibold" style={{ color: "var(--c-green)" }}>
                Fixed since the last review ({r.resolved.length})
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-2">
                {r.resolved.map((t) => (
                  <li key={t} className="break-words">
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-medium text-ink-2">
              Every check it ran ({r.checks.filter((c) => c.ok).length} of {r.checks.length} passed)
            </summary>
            <ul className="mt-2 space-y-1 text-sm">
              {r.checks.map((c) => (
                <li key={c.name} className="flex flex-wrap items-baseline gap-x-2">
                  <span style={{ color: c.ok ? "var(--c-green)" : "var(--c-orange)" }}>{c.ok ? "✓" : "✗"}</span>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-xs text-ink-3 break-words">{c.note}</span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}

      <details className="mt-4 border-t border-line pt-3">
        <summary className="cursor-pointer text-sm font-medium text-ink-2">Kept in mind: your layout, set {shortDate(LAYOUT_SINCE)}</summary>
        <p className="mt-2 text-sm text-ink-2">{LAYOUT_BRIEF}</p>
        <ul className="mt-2 space-y-1 text-sm">
          {MAIN_TABS.map((t) => (
            <li key={t.id} className="break-words">
              <span className="font-medium">{t.label}</span> <span className="text-ink-2">· {t.job}</span> <span className="text-xs text-ink-3">{t.holds}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-ink-3">Each review counts a week of use per tab. A tab with something waiting that went untouched comes back with options to look into.</p>
      </details>
    </section>
  );
}
