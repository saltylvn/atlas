import type { Evidence } from "@/lib/domain/engEvidence";
import { JUDGE_LABEL_NAME, type TypeCheck } from "@/lib/domain/typeCheck";
import { pct } from "./MarketCharts";
import { CheckTypesButton } from "./client/CheckTypes";
import { TableView } from "./MarketCharts";
import { UnderTheHood } from "./UnderTheHood";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Denver" });

/** "Why these five": the 30-day numbers that back the five engineering types, ranked. */
export function WhyTheseFive({ ev, where }: { ev: Evidence; where: string }) {
  const max = Math.max(1, ...ev.types.map((t) => t.jobs));
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-sm font-medium">Why these five</h3>
      <p className="mt-1 text-xs text-ink-2">
        Over the last {ev.days} days, the five types cover <span className="font-medium text-ink">{pct(ev.coverage)}</span> of the {ev.tech.toLocaleString()} tech jobs {where}; product and program roles are the other {ev.product.toLocaleString()}.
        {ev.spread !== null && ev.spread >= 1.5 && ` The biggest type has ${ev.spread.toFixed(1)} times the jobs of the smallest.`}
      </p>
      <ol className="mt-3 space-y-3">
        {ev.types.map((t, i) => {
          const trend = t.newBefore === 0 ? null : (t.newRecent - t.newBefore) / t.newBefore;
          return (
            <li key={t.type} className="text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium">
                  <span className="mr-1.5 font-mono text-xs text-ink-3">{i + 1}</span>
                  {t.label}
                </p>
                <p className="tabular-nums text-ink-2">
                  <span className="font-medium text-ink">{t.jobs.toLocaleString()}</span> jobs · {pct(t.share)} of tech jobs
                </p>
              </div>
              <div className="mt-1 h-1.5 w-full rounded-full bg-surface-2" aria-hidden>
                <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(1, Math.round((t.jobs / max) * 100))}%` }} />
              </div>
              <p className="mt-1 text-ink-2">
                {t.companies.toLocaleString()} companies · {t.sources} {t.sources === 1 ? "source" : "sources"} · new in the last 14 days: {t.newRecent.toLocaleString()}
                {trend === null ? "" : ` (${trend >= 0 ? "+" : ""}${Math.round(trend * 100)}% vs the 14 before)`}
              </p>
              {t.specialties.length > 0 && <p className="mt-0.5 text-ink-3">Most common inside: {t.specialties.map((s) => `${s.name} ${pct(s.share)}`).join(" · ")}</p>}
            </li>
          );
        })}
      </ol>
      <TableView
        caption={`The five engineering types, last ${ev.days} days`}
        head={["Type", "Jobs", "Share of tech", "Companies", "Sources", "New, last 14 days", "New, 14 before", "Top specialties"]}
        rows={ev.types.map((t) => [t.label, t.jobs, pct(t.share), t.companies, t.sources, t.newRecent, t.newBefore, t.specialties.map((s) => `${s.name} ${pct(s.share)}`).join(", ")])}
      />
      <UnderTheHood id="eng-evidence" facts={[["Window", `Jobs seen in the last ${ev.days} days (${where})`]]} />
    </div>
  );
}

/** The AI label check: how often an AI model, reading titles on its own, agrees with the rules. */
export function TypeCheckPanel({ check, aiReady }: { check: TypeCheck | undefined; aiReady: boolean }) {
  const rate = check && check.judged ? check.agree / check.judged : null;
  return (
    <div className="mt-5 border-t border-line pt-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">AI check of the labels</h3>
          <p className="mt-1 text-xs text-ink-2">Rules label every job. Once a day, an AI model reads 40 of this week&apos;s titles on its own and labels them too. It never changes a label: where it differs, the rules may need fixing.</p>
        </div>
        {aiReady ? <CheckTypesButton /> : <p className="text-xs text-ink-3">AI is not set up (no model key), so the check does not run.</p>}
      </div>
      {check ? (
        <>
          <p className="mt-3 text-sm">
            {check.model} agreed with the rules on <span className="font-medium">{check.agree}</span> of {check.judged} jobs
            {rate !== null && <span className="font-medium"> ({pct(rate)})</span>}
            <span className="text-xs text-ink-3"> · {when(check.at)} · whole market sample</span>
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label="Agreement by the rules' label">
            {check.byType.map((b) => (
              <li key={b.type} className="chip tabular-nums">
                {JUDGE_LABEL_NAME[b.type]}: {b.agree}/{b.n}
              </li>
            ))}
          </ul>
          {check.disagreements.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="flex min-h-11 cursor-pointer items-center font-medium text-ink-2">Where they differ ({check.judged - check.agree})</summary>
              <table className="w-full text-left">
                <caption className="sr-only">Jobs the AI labeled differently from the rules</caption>
                <thead>
                  <tr className="border-b border-line text-ink-3">
                    <th scope="col" className="py-1.5 pr-2 font-medium">Job</th>
                    <th scope="col" className="py-1.5 pr-2 font-medium">Rules said</th>
                    <th scope="col" className="py-1.5 font-medium">AI said</th>
                  </tr>
                </thead>
                <tbody>
                  {check.disagreements.map((d, i) => (
                    <tr key={i} className="border-b border-line last:border-0 align-top">
                      <td className="py-1.5 pr-2">
                        {d.title} <span className="text-ink-3">· {d.company}</span>
                      </td>
                      <td className="py-1.5 pr-2">{JUDGE_LABEL_NAME[d.rules]}</td>
                      <td className="py-1.5">{JUDGE_LABEL_NAME[d.ai]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      ) : aiReady ? (
        <p className="mt-3 text-xs text-ink-3">No check yet. It runs in the evening run each day, or press Check now.</p>
      ) : null}
      <UnderTheHood id="type-check" facts={check ? [["Last check", `${when(check.at)}, ${check.sample} jobs sampled, ${check.judged} labeled`]] : []} />
    </div>
  );
}
