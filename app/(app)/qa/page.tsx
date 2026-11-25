import Link from "next/link";
import { getContext } from "@/lib/context";
import { qaAlerts } from "@/lib/domain/qa";
import { Icon } from "@/components/Icon";
import { QaCard } from "@/components/QaCard";
import { PageHeader } from "@/components/ui";

// QA: everything that checks Atlas's own quality, in one red section (owner's layout, 24 Nov
// 2026). The QA bot's weekly review, what needs attention now, and the way to the evals.
// It used to sit on Today and Mission Control; it lives here so the day stays about the day.

export const metadata = { title: "QA review" };

export default async function QaPage() {
  const { store, now, today } = await getContext();
  const reports = await store.qa.recent(1).catch(() => []);
  const alerts = qaAlerts(reports[0]?.report ?? null, today);
  return (
    <div className="space-y-5">
      <PageHeader title="QA review" sub="Every Sunday evening the QA bot reviews the week from the records every bot and agent writes: failed or stopped runs, late briefs, how often the AI answered, eval scores, connections and your queues. It suggests a fix for each finding; it changes nothing itself." />

      {alerts.length > 0 && (
        <section className="card card-pad border-l-4" style={{ borderLeftColor: "var(--c-qa)" }} aria-label="Needs attention">
          <p className="eyebrow flex items-center gap-1.5" style={{ color: "var(--c-qa)" }}>
            <Icon name="alert" size={13} /> {alerts.length === 1 ? "1 thing needs" : `${alerts.length} things need`} attention
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {alerts.map((f) => (
              <li key={f.key} className="break-words">
                {f.title}
              </li>
            ))}
          </ul>
        </section>
      )}

      <QaCard latest={reports[0] ?? null} now={now} />

      <section className="card card-pad flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="h-display font-medium">Evals</h2>
          <p className="text-sm text-ink-2">Each agent&apos;s golden set, run every day and in CI: the cases that must pass for an agent to be trusted.</p>
        </div>
        <Link href="/evals" className="btn btn-ghost btn-sm min-h-11">
          Open Evals <Icon name="arrow" size={14} />
        </Link>
      </section>
    </div>
  );
}
