import Link from "next/link";
import { APPROVALS_HREF } from "@/components/ApprovalQueue";
import { Icon } from "@/components/Icon";
import { CardHeader, Pill } from "@/components/ui";
import type { ReadyJob } from "@/lib/domain/companyResearch";

// "Ready for you" on Today (24 Nov 2026): what the night shift prepared while you slept
// (lib/agents/nightShift.ts). Today's top picks, most prepared first, and the one to start with.
// Counts and titles only; the research and the tailoring are on each job in the Apply Queue.

export function ReadyCard({ jobs }: { jobs: ReadyJob[] }) {
  if (jobs.length === 0) return null;
  const prepared = jobs.filter((j) => j.researched || j.pitch);
  const first = jobs[0]!;
  return (
    <section className="card card-pad border-l-4" style={{ borderLeftColor: "var(--c-career)" }} aria-labelledby="ready-card">
      <CardHeader
        title="Ready for you"
        icon="sparkle"
        hint="Each night, around 10 to 11 PM, the Researcher and Tailor agents prepare today's top picks with whatever AI calls the day has left. Nothing is sent: you review and apply."
        action={
          <Link href={APPROVALS_HREF} className="btn btn-ghost btn-sm min-h-11">
            Open the Apply Queue <Icon name="arrow" size={14} />
          </Link>
        }
      />
      <h2 id="ready-card" className="sr-only">
        Ready for you
      </h2>
      <p className="text-sm">
        <span className="font-medium">Start with {first.title}.</span>{" "}
        <span className="text-ink-2">{prepared.length === 0 ? "Nothing is prepared yet: the night shift runs tonight, or press Research this company and Tailor this job on a job." : `${prepared.length} of your ${jobs.length} picks ${prepared.length === 1 ? "is" : "are"} prepared.`}</span>
      </p>
      <ol className="mt-3 space-y-2">
        {jobs.map((j, i) => (
          <li key={j.kitId} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-5 shrink-0 text-right text-xs text-ink-3 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 break-words font-medium">{j.title}</span>
            <Pill color={j.researched ? "var(--c-green)" : "var(--c-grey)"}>{j.researched ? "Researched" : "Not researched"}</Pill>
            <Pill color={j.pitch ? "var(--c-green)" : "var(--c-grey)"}>{j.pitch ? `Tailored · ${j.pitch.proven} of ${j.pitch.of} proven` : "Not tailored"}</Pill>
          </li>
        ))}
      </ol>
    </section>
  );
}
