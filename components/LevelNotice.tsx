import { ClearAboveLevel } from "@/components/client/ClearAboveLevel";
import { CardHeader, Pill } from "@/components/ui";
import { levelRule } from "@/lib/domain/levelPolicy";
import type { QueuedLevel } from "@/lib/domain/scoutFocus";

// Your level rule on the Apply page (lib/domain/levelPolicy.ts): what every agent works to, and the
// queued jobs that break it. Atlas never clears them on its own; one press does.

export function LevelNotice({ levels, maxYears }: { levels: QueuedLevel[]; maxYears: number }) {
  const above = levels.filter((l) => l.verdict.fit === "above");
  const check = levels.filter((l) => l.verdict.fit === "check").length;
  return (
    <section className="card card-pad" aria-labelledby="level-rule">
      <CardHeader title="Your level" icon="shield" hint="One rule every bot and agent works to: the Scout's matches, Apply to these 5, the Career Mentor, the Tailor, the Researcher and Claude. Each night, jobs above it are cleared from Good fits and the Apply Queue on their own. Change the years limit in Settings." />
      <h2 id="level-rule" className="sr-only">
        Your level
      </h2>
      <p className="text-sm text-ink-2">{levelRule(maxYears)}</p>
      {above.length > 0 ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm">
            <Pill color="var(--c-warn)">{`${above.length} above your level`}</Pill> in your Apply Queue. {above.length === 1 ? "It is" : "They are"} left out of Apply to these 5.
          </p>
          <ul className="space-y-1 text-sm">
            {above.slice(0, 8).map((l) => (
              <li key={l.kitId} className="break-words">
                <span className="font-medium">{l.title}</span>
                <span className="block text-xs text-ink-3">{l.verdict.why}</span>
              </li>
            ))}
          </ul>
          {above.length > 8 && <p className="text-xs text-ink-3">And {above.length - 8} more.</p>}
          <ClearAboveLevel count={above.length} />
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-3">Nothing in your queue is above your level.{check > 0 ? ` ${check} job${check === 1 ? " does" : "s do"} not say: check the years asked before applying.` : ""}</p>
      )}
    </section>
  );
}
