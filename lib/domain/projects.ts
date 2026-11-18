// Which projects and ideas the brief should bring up today. Active work with a next
// step comes first; anything whose review date has arrived comes back for a look, so
// a parked idea resurfaces instead of being forgotten.

import type { LocalDate, Project, ProjectStatus } from "./types";

export interface ProjectNudge {
  project: Project;
  reason: string;
}

const RANK: Record<ProjectStatus, number> = { active: 0, exploring: 1, idea: 2, parked: 3, done: 4 };

export function projectsToSurface(projects: Project[], today: LocalDate, limit = 3): ProjectNudge[] {
  const due = projects
    .filter((p) => p.status !== "done" && p.reviewOn !== null && p.reviewOn <= today)
    .sort((a, b) => (a.reviewOn ?? "").localeCompare(b.reviewOn ?? ""))
    .map((p) => ({ project: p, reason: p.status === "parked" ? "Parked: time to decide, revive or drop" : "Review date reached" }));
  const active = projects
    .filter((p) => (p.status === "active" || p.status === "exploring") && p.nextStep !== "" && !due.some((d) => d.project.id === p.id))
    .sort((a, b) => RANK[a.status] - RANK[b.status] || a.createdAt.localeCompare(b.createdAt))
    .map((p) => ({ project: p, reason: `Next step: ${p.nextStep}` }));
  return [...active, ...due].slice(0, limit);
}

export function byStatus(projects: Project[]): Record<ProjectStatus, Project[]> {
  const out: Record<ProjectStatus, Project[]> = { active: [], exploring: [], idea: [], parked: [], done: [] };
  for (const p of projects) out[p.status].push(p);
  return out;
}
