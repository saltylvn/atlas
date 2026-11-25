import { CardHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { TopPick } from "@/lib/domain/scoutFocus";

// Step 1 (23 Nov 2026): the five queued jobs to apply to today, chosen by rules from your
// Apply Queue (lib/domain/scoutFocus.ts), each with why it made the list.

export function TopFive({ picks, waiting }: { picks: TopPick[]; waiting: number }) {
  if (picks.length === 0) return null;
  return (
    <section className="card card-brand card-pad" aria-labelledby="top-five">
      <CardHeader
        title="Apply to these 5 today"
        icon="sparkle"
        hint={`Picked from the ${waiting} job${waiting === 1 ? "" : "s"} in your Apply Queue: Perfect fits first, then entry-level roles, fresh postings and the best fit scores. Jobs above your level (a senior title, or more years asked than your limit) are left out.`}
      />
      <h2 id="top-five" className="sr-only">
        Apply to these five today
      </h2>
      <ol className="space-y-2">
        {picks.map((p, i) => (
          <li key={p.kitId} className="flex items-start gap-3 rounded-lg border border-line bg-surface p-3">
            <span className="w-5 shrink-0 text-right text-sm font-medium text-ink-3 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium break-words">{p.title}</span>
              {p.why.length > 0 && <span className="block text-xs text-ink-2 break-words">{p.why.join(" · ")}</span>}
            </span>
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm min-h-11 shrink-0">
                <Icon name="external" size={14} /> Open
              </a>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-2 text-xs text-ink-3">When you have applied, press I submitted it on the job in your Apply Queue below.</p>
    </section>
  );
}
