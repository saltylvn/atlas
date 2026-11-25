import { AGENTS } from "@/lib/domain/agents";
import { KIND_COLOR, KINDS, LOOP_AGENTS, WORKFLOWS, type Kind } from "@/lib/domain/registry";

// Workflow, bot or agent: what each is, the one question that separates them (who picks the next
// step?), and what something must do to earn the name. The text comes from lib/domain/registry.ts,
// so every page that names a kind says the same thing.

const ORDER: readonly Kind[] = ["workflow", "bot", "agent"];

export function KindGuide() {
  const count: Record<Kind, number> = { workflow: WORKFLOWS.length, bot: AGENTS.filter((a) => a.kind === "bot").length, agent: LOOP_AGENTS.length };
  return (
    <section id="kinds" className="card card-pad scroll-mt-20" aria-labelledby="kind-guide">
      <h2 id="kind-guide" className="h-display font-medium">
        Workflow, bot or agent
      </h2>
      <p className="mt-1 text-sm text-ink-2">One question decides the name: who picks the next step? Code in a fixed order is a workflow. Code doing one job, with at most one checked question to the AI model, is a bot. The AI model choosing its own tools in a loop, inside limits, is an agent.</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        {ORDER.map((k) => {
          const s = KINDS[k];
          return (
            <article key={k} className="rounded-lg border border-line p-3 text-sm" aria-label={s.label}>
              <h3 className="flex items-baseline gap-2">
                <span className="h-display text-lg font-medium" style={{ color: `color-mix(in oklab, ${KIND_COLOR[k]} 48%, var(--ink))` }}>
                  {s.label}
                </span>
                <span className="text-xs text-ink-3">{count[k]} in Atlas</span>
              </h3>
              <p className="mt-1 text-ink-2">{s.definition}</p>
              <dl className="mt-2 space-y-2">
                <div>
                  <dt className="eyebrow">Who picks the next step</dt>
                  <dd>{s.decides}</dd>
                </div>
                <div>
                  <dt className="eyebrow">AI model</dt>
                  <dd>{s.ai}</dd>
                </div>
                <div>
                  <dt className="eyebrow">It qualifies when</dt>
                  <dd>
                    <ul className="list-disc space-y-0.5 pl-5">
                      {s.qualifies.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">In Atlas</dt>
                  <dd className="text-ink-2">{s.example}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-ink-3">Adding an AI call does not make a bot an agent: a prompt plus one answer is still a bot. A bot becomes an agent only when the model starts choosing its own steps, and then it moves onto the shared agent loop with its limits and reviews.</p>
    </section>
  );
}
