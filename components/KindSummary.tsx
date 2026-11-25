import Link from "next/link";
import { AGENTS } from "@/lib/domain/agents";
import { INFRA, KIND_COLOR, KINDS, LOOP_AGENTS, WORKFLOWS, type Kind } from "@/lib/domain/registry";

/** What Atlas is made of, counted by kind, with the one-line definition of each. Links to the full inventory. */
export function KindSummary() {
  const count: Record<Kind, number> = {
    workflow: WORKFLOWS.length,
    bot: AGENTS.filter((a) => a.kind === "bot").length,
    agent: LOOP_AGENTS.length,
  };
  return (
    <section className="card card-pad" aria-labelledby="kind-summary">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="kind-summary" className="h-display font-medium">
          What Atlas is made of
        </h2>
        <Link href="/team#kinds" className="text-sm font-medium text-ink-2 underline underline-offset-4 hover:text-ink">
          Full inventory
        </Link>
      </div>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {(Object.keys(KINDS) as Kind[]).map((k) => (
          <div key={k} className="rounded-lg border border-line p-3">
            <dt className="flex items-baseline gap-2">
              <span className="h-display text-2xl font-medium" style={{ color: `color-mix(in oklab, ${KIND_COLOR[k]} 48%, var(--ink))` }}>
                {count[k]}
              </span>
              <span className="text-sm font-medium">{count[k] === 1 ? KINDS[k].label : KINDS[k].plural}</span>
            </dt>
            <dd className="mt-1 text-xs text-ink-3">{KINDS[k].definition}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-ink-3">
        The Chief of Staff orchestrates the scheduled workflows. The agents ({LOOP_AGENTS.map((a) => a.name).join(" and ")}) run under the Applications bot. Claude reads Atlas through a read-only MCP connector. Plus {INFRA.length} infrastructure jobs (CI, deploys, keep-alive) that keep Atlas running.
      </p>
    </section>
  );
}
