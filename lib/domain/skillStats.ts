// The skills each target role asks for, logged once a day so they can be averaged over
// time. Pure.
//
//   snapshot   written by the Analyst with every daily market report: for each of your
//              roles, how many postings in the last 30 days (job boards the Scout reads,
//              plus job-search matches it had not recorded, counted once by address) and
//              how many of them ask for each skill. One row per role per day.
//   average    the share of a role's postings that ask for a skill, averaged across the
//              daily snapshots kept. A skill missing from a day counts as 0 that day, so a
//              skill that spikes once does not outrank one asked for every week. Postings
//              themselves are pruned after 120 days; the snapshots keep the history.
//
// Skills are the names extractSkills finds in a posting (lib/domain/skills.ts). Postings do
// not reliably mark "required" against "nice to have", so a skill counts as asked either way.

import { addDays } from "./dates";
import { canonicalRole } from "./targetRoles";
import type { LocalDate } from "./types";

/** Skills kept per role per day: enough for a top 10 with room to move. */
export const SNAPSHOT_SKILLS = 30;
/** A day with fewer postings than this for a role is too thin to count in its average. */
export const SNAPSHOT_MIN_POSTINGS = 3;
/** How far back the average looks by default. */
export const AVERAGE_DAYS = 56;
/** Snapshots are kept this long (prune). */
export const SNAPSHOT_KEEP_DAYS = 730;

export interface SkillCount {
  skill: string;
  /** Postings that ask for it. */
  asked: number;
}

export interface RoleSkillStat {
  id: string;
  forDate: LocalDate;
  role: string;
  /** Postings for the role in the window that day. */
  postings: number;
  /** Most asked first, at most SNAPSHOT_SKILLS. */
  skills: SkillCount[];
  /** Days the window covered. */
  windowDays: number;
  createdAt: string;
}
export type NewRoleSkillStat = Omit<RoleSkillStat, "id" | "createdAt">;

type Posted = { role: string; url: string; skills?: string[] | null };

/** Today's snapshot: one row per role on your list, even a role with no postings yet. */
export function skillSnapshot(input: { boards: readonly Posted[]; searches: readonly Posted[]; roles: readonly string[]; day: LocalDate; windowDays: number }): NewRoleSkillStat[] {
  const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  const seen = new Set<string>();
  const all: Posted[] = [];
  for (const p of [...input.boards, ...input.searches]) {
    const k = norm(p.url);
    if (seen.has(k)) continue;
    seen.add(k);
    all.push({ ...p, role: canonicalRole(p.role) });
  }
  return input.roles.map((role) => {
    const rows = all.filter((p) => p.role === role);
    const tally = new Map<string, number>();
    for (const p of rows) for (const s of new Set(p.skills ?? [])) tally.set(s, (tally.get(s) ?? 0) + 1);
    const skills = [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, SNAPSHOT_SKILLS)
      .map(([skill, asked]) => ({ skill, asked }));
    return { forDate: input.day, role, postings: rows.length, skills, windowDays: input.windowDays };
  });
}

export interface AveragedSkill {
  skill: string;
  /** Mean share of the role's postings that ask for it, 0 to 1. */
  share: number;
  /** True when it is one of your skills. */
  have: boolean;
}

export interface RoleSkillAverage {
  role: string;
  /** Daily snapshots the average is over. */
  days: number;
  /** First and last day averaged. */
  from: LocalDate | null;
  to: LocalDate | null;
  /** Mean postings per snapshot. */
  postings: number;
  skills: AveragedSkill[];
}

/** A role's most asked skills, averaged over its snapshots since `days` ago. */
export function averageSkills(stats: readonly Pick<RoleSkillStat, "forDate" | "role" | "postings" | "skills">[], role: string, opts: { today: LocalDate; days?: number; top?: number; have?: readonly string[] }): RoleSkillAverage {
  const since = addDays(opts.today, -(opts.days ?? AVERAGE_DAYS));
  // One snapshot per day: the newest row wins if a day was written twice.
  const byDay = new Map<string, (typeof stats)[number]>();
  for (const s of stats) if (canonicalRole(s.role) === role && s.forDate >= since && s.postings >= SNAPSHOT_MIN_POSTINGS) byDay.set(s.forDate, s);
  const days = [...byDay.values()].sort((a, b) => a.forDate.localeCompare(b.forDate));
  const mine = new Set((opts.have ?? []).map((h) => h.toLowerCase()));
  const sum = new Map<string, number>();
  for (const d of days) for (const k of d.skills) sum.set(k.skill, (sum.get(k.skill) ?? 0) + k.asked / d.postings);
  const skills = [...sum.entries()]
    .map(([skill, total]) => ({ skill, share: total / days.length, have: mine.has(skill.toLowerCase()) }))
    .sort((a, b) => b.share - a.share || a.skill.localeCompare(b.skill))
    .slice(0, opts.top ?? 10);
  return {
    role,
    days: days.length,
    from: days[0]?.forDate ?? null,
    to: days.at(-1)?.forDate ?? null,
    postings: days.length ? Math.round(days.reduce((n, d) => n + d.postings, 0) / days.length) : 0,
    skills,
  };
}
