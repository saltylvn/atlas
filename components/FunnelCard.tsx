import { CardHeader } from "@/components/ui";
import { diagnose, JUDGE_AFTER_DAYS, LEVEL_LABEL, type Funnel, type Level, type Slice } from "@/lib/domain/outcomes";

// What's working: the funnel of your applications (Step 0 of the agent plan, 23 Nov 2026).
// Rules only, from your own applications; every number on it comes from lib/domain/outcomes.ts.

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

function SliceTable({ title, rows, label = (k: string) => k }: { title: string; rows: Slice[]; label?: (k: string) => string }) {
  if (rows.length === 0) return null;
  return (
    <div className="min-w-0">
      <h3 className="eyebrow mb-1">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-3">
            <th className="py-1 font-normal">&nbsp;</th>
            <th className="py-1 text-right font-normal">Sent</th>
            <th className="py-1 text-right font-normal">Replies</th>
            <th className="py-1 text-right font-normal">Fast no</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 6).map((r) => (
            <tr key={r.key} className="border-t border-line">
              <td className="py-1 pr-2 break-words">{label(r.key)}</td>
              <td className="py-1 text-right tabular-nums">{r.sent}</td>
              <td className="py-1 text-right tabular-nums">
                {r.replied} <span className="text-xs text-ink-3">({pct(r.replied, r.judged)})</span>
              </td>
              <td className="py-1 text-right tabular-nums">{r.fastRejections}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FunnelCard({ f }: { f: Funnel }) {
  const reads = diagnose(f);
  return (
    <section className="card card-pad space-y-4" aria-labelledby="funnel">
      <CardHeader
        title="What's working"
        icon="chart"
        hint={`Your applications, sliced by what they were sent with. An application counts once it has an answer or ${JUDGE_AFTER_DAYS} days have passed. "Fast no" is a rejection within 10 days: a screen saying no.`}
      />
      <h2 id="funnel" className="sr-only">
        What is working in your applications
      </h2>
      <p className="text-sm">
        <span className="font-medium">{f.sent}</span> sent · <span className="font-medium">{f.judged}</span> old enough to judge · <span className="font-medium">{f.replied}</span> replies ({pct(f.replied, f.judged)}) · <span className="font-medium">{f.rejected}</span> rejected · {f.tooNew} too new
      </p>
      {reads.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
          {reads.map((r) => (
            <li key={r} className="break-words">
              {r}
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <SliceTable title="By level in the title" rows={f.by.level} label={(k) => LEVEL_LABEL[k as Level] ?? k} />
        <SliceTable title="By role" rows={f.by.role} label={(k) => (k === "unknown" ? "None of your roles" : k)} />
        <SliceTable title="By posting age when you applied" rows={f.by.age} label={(k) => (k === "unknown" ? "Not known" : k)} />
        <SliceTable title="By resume sent" rows={f.by.resume} label={(k) => (k === "unknown" ? "Not recorded" : k)} />
        <SliceTable title="Tailored" rows={f.by.tailored} label={(k) => (k === "unknown" ? "Not marked" : k)} />
        <SliceTable title="Warm (you knew someone)" rows={f.by.warm} label={(k) => (k === "unknown" ? "Not marked" : k)} />
      </div>
    </section>
  );
}
