import { KIND_COLOR } from "@/lib/domain/registry";
import { HOODS, PART_LABEL, type HoodId, type Part } from "@/lib/domain/provenance";
import { Pill } from "./ui";

/** One part of Atlas, labeled by kind: workflows and bots in their registry hue, the rest grey. */
export function PartRow({ part }: { part: Part }) {
  const kind = PART_LABEL[part.kind];
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1.5">
      {part.kind === "workflow" || part.kind === "bot" ? (
        <Pill color={KIND_COLOR[part.kind]}>
          <span title={kind.definition}>{kind.label}</span>
        </Pill>
      ) : (
        <span className="chip" title={kind.definition}>
          {kind.label}
        </span>
      )}
      <span className="font-medium text-ink">{part.name}</span>
      <span className="text-ink-2">{part.what}</span>
      <code className="font-mono text-[11px] text-ink-3">{part.file}</code>
    </li>
  );
}

/**
 * A closed "Under the hood" note at the foot of a card: how the figure is calculated, its sample,
 * and every part of Atlas behind it, each labeled. Plain HTML details, so it works without script.
 */
export function UnderTheHood({ id, facts = [] }: { id: HoodId; facts?: [string, string][] }) {
  const hood = HOODS[id];
  return (
    <details className="group mt-3 border-t border-line pt-1 text-xs">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 font-medium text-ink-3 hover:text-ink [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">
          ›
        </span>
        Under the hood
      </summary>
      <div className="space-y-2 pb-1">
        <p className="text-ink-2">{hood.method}</p>
        {facts.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            {facts.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-[11px] uppercase tracking-wide text-ink-3">{k}</dt>
                <dd className="text-ink-2">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <ol aria-label="Parts of Atlas behind this figure" className="divide-y divide-line">
          {hood.parts.map((p) => (
            <PartRow key={`${p.kind}:${p.name}`} part={p} />
          ))}
        </ol>
      </div>
    </details>
  );
}
