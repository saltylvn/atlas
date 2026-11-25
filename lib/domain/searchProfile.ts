// What Tyler is looking for, in one place (set by him on 18 Nov 2026). Every Career desk
// agent works from this file, so they cannot drift apart:
//   Applications Agent  the matching rules and the order of the brief's matches
//   Career Mentor              the goal its model is given, for insights and for the role order
//   Chief of Staff      the order job matches are shown in
// The pay figures are defaults: Settings holds your own floor and target. The place rules
// (which cities are inside the commute) live in workplace.ts. Pure.

import { BACKGROUND_DEFAULT, backgroundOf, backgroundRule, levelRule, maxYearsOf } from "./levelPolicy";
import type { Settings } from "./types";

export const SEARCH_DEFAULTS = {
  /** Posted pay that tops out under this rules a posting out. */
  salaryFloor: 100_000,
  /** The base pay you are aiming at. A posting that reaches it ranks higher. */
  salaryTarget: 120_000,
  home: "Salt Lake City, UT",
  /** The longest one-way drive you will make for hybrid or on-site work, in minutes. */
  maxCommuteMin: 45,
} as const;

export interface PayPrefs {
  /** Posted pay below this rules a posting out. 0 means no floor. */
  minSalary: number;
  /** What you are aiming at. Never below the floor. 0 means no target. */
  targetSalary: number;
  /** The most years of experience a posting may ask for (lib/domain/levelPolicy.ts). */
  maxYears: number;
  /** What you bring besides engineering, for an agent's angle. */
  background?: string;
}

/** Your floor and target from Settings, or the defaults above when Settings holds none. */
export function payPrefs(s: Pick<Settings, "careerMinSalary" | "careerTargetSalary" | "careerMaxYears" | "careerBackground">): PayPrefs {
  const minSalary = s.careerMinSalary ?? SEARCH_DEFAULTS.salaryFloor;
  const target = s.careerTargetSalary ?? SEARCH_DEFAULTS.salaryTarget;
  // A target under the floor would mean nothing.
  return { minSalary, targetSalary: target > 0 ? Math.max(minSalary, target) : 0, maxYears: maxYearsOf(s), background: backgroundOf(s) };
}

export const thousands = (n: number) => `$${Math.round(n / 1000)}k`;

/** The search, one plain sentence per rule: for a reader, or for a model that words or judges. */
export function searchCriteria(p: Omit<PayPrefs, "maxYears"> & { maxYears?: number }): string[] {
  const pay =
    p.targetSalary > 0
      ? `Pay: aiming at ${thousands(p.targetSalary)} base a year${p.minSalary > 0 && p.minSalary < p.targetSalary ? `, and open to roles from ${thousands(p.minSalary)} up to negotiate toward it` : ""}.`
      : p.minSalary > 0
        ? `Pay: at least ${thousands(p.minSalary)} base a year.`
        : "";
  return [
    levelRule(p.maxYears),
    backgroundRule(p.background ?? BACKGROUND_DEFAULT),
    pay,
    `Place, in order of preference: fully remote, then hybrid, then on-site. Home is ${SEARCH_DEFAULTS.home}; hybrid or on-site work has to be within a ${SEARCH_DEFAULTS.maxCommuteMin}-minute drive.`,
    "Team: a collaborative engineering team, internal or customer-facing.",
  ].filter(Boolean);
}

/** The goal a model is given when it judges the job hunt. */
export const searchGoal = (p: Omit<PayPrefs, "maxYears"> & { maxYears?: number }): string => `A full-time engineering role, soon. ${searchCriteria(p).join(" ")}`;
