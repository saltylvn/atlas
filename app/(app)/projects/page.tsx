import { getContext } from "@/lib/context";
import { shortDate } from "@/lib/domain/dates";
import { byStatus, projectsToSurface } from "@/lib/domain/projects";
import type { ProjectStatus } from "@/lib/domain/types";
import { DeleteProject, ProjectForm, ProjectStatusSelect } from "@/components/client/ProjectForm";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, Pill } from "@/components/ui";

export const metadata = { title: "Projects" };

const SECTIONS: { key: ProjectStatus; title: string; hint: string; color: string }[] = [
  { key: "active", title: "Active", hint: "In motion. Each should have a next step.", color: "var(--c-green)" },
  { key: "exploring", title: "Exploring", hint: "Worth a little time to decide", color: "var(--c-blue)" },
  { key: "idea", title: "Ideas", hint: "Captured, not committed", color: "var(--c-purple)" },
  { key: "parked", title: "Parked", hint: "On hold until their review date", color: "var(--c-grey)" },
];

export default async function ProjectsPage() {
  const { store, today } = await getContext();
  const projects = await store.projects.list();
  const groups = byStatus(projects);
  const nudges = projectsToSurface(projects, today);

  return (
    <div className="space-y-5">
      <PageHeader title="Projects" sub="Side projects, ideas and things to learn, kept in mind without cluttering the week." />
      <ProjectForm />

      {nudges.length > 0 && (
        <section className="card card-brand card-pad">
          <CardHeader title="In today's brief" icon="bulb" />
          <ul className="space-y-1.5">
            {nudges.map((n) => (
              <li key={n.project.id} className="text-sm">
                <span className="font-semibold">{n.project.title}</span> <span className="text-ink-2">· {n.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {SECTIONS.map((s) => (
          <section key={s.key} className="card card-pad group-bar" style={{ ["--group" as string]: s.color }}>
            <CardHeader title={`${s.title} (${groups[s.key].length})`} hint={s.hint} />
            {groups[s.key].length === 0 ? (
              <Empty>None yet.</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {groups[s.key].map((p) => (
                  <li key={p.id} className="flex items-start gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {p.link ? (
                          <a href={p.link} target="_blank" rel="noopener noreferrer" className="hover:text-brand">
                            {p.title} <Icon name="external" size={12} className="inline" />
                          </a>
                        ) : (
                          p.title
                        )}
                      </p>
                      {p.nextStep && <p className="text-sm text-ink-2">Next: {p.nextStep}</p>}
                      {p.why && <p className="text-xs text-ink-3">{p.why}</p>}
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Pill color="var(--c-indigo)">{p.kind.replace("-", " ")}</Pill>
                        {p.reviewOn && <Pill color={p.reviewOn <= today ? "var(--c-orange)" : "var(--c-grey)"}>Review {shortDate(p.reviewOn)}</Pill>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <ProjectStatusSelect id={p.id} status={p.status} />
                      <DeleteProject id={p.id} title={p.title} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      {groups.done.length > 0 && <p className="text-center text-xs text-ink-3">{groups.done.length} finished project{groups.done.length === 1 ? "" : "s"} archived.</p>}
    </div>
  );
}
