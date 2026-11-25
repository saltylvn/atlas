// Utah tech companies with a public job board. Two uses (owner's choice, 23 Nov 2026):
//   - the Scout reads each one every sync for the market record ("Utah companies" on the Data
//     Pipeline page), so the Utah local view rests on more than the companies you watch; those
//     jobs never show as your matches;
//   - the Jobs page suggests them for the watchlist. Nothing here is watched until you press Watch.
//
// Each board was checked on 22 Nov 2026 by reading its public API: it answered, listed open
// jobs, and those jobs were in Utah or remote in the U.S. Two same-name boards that were other
// companies (posting in Texas and Louisiana) were left out. Boards move; a suggestion whose
// board stops answering shows under "Unavailable" once watched, like any other.

import type { JobBoard } from "./types";

export interface SeedCompany {
  company: string;
  board: JobBoard;
  slug: string;
  /** Where it is, in a few words. */
  where: string;
}

export const UTAH_SEED: readonly SeedCompany[] = [
  { company: "Qualtrics", board: "greenhouse", slug: "qualtrics", where: "Provo" },
  { company: "Podium", board: "greenhouse", slug: "podium81", where: "Lehi" },
  { company: "Weave", board: "ashby", slug: "weave", where: "Lehi" },
  { company: "Lucid Software", board: "greenhouse", slug: "lucidsoftware", where: "Salt Lake City" },
  { company: "Instructure", board: "ashby", slug: "instructure", where: "Salt Lake City, hires remote" },
  { company: "Entrata", board: "lever", slug: "entrata", where: "Lehi" },
  { company: "Vivint", board: "smartrecruiters", slug: "vivint", where: "Provo" },
  { company: "Recursion", board: "greenhouse", slug: "recursionpharmaceuticals", where: "Salt Lake City" },
  { company: "Filevine", board: "lever", slug: "filevine", where: "Salt Lake City" },
  { company: "Pattern", board: "lever", slug: "pattern", where: "Lehi" },
  { company: "Route", board: "greenhouse", slug: "route", where: "Lehi" },
  { company: "Neighbor", board: "lever", slug: "neighbor", where: "Lehi" },
  { company: "Awardco", board: "greenhouse", slug: "awardco", where: "Lindon" },
  { company: "Canopy", board: "greenhouse", slug: "canopytax", where: "Draper" },
];

/** The suggestions you are not watching yet. */
export function suggestedUtah(watched: readonly { board: JobBoard; slug: string }[]): SeedCompany[] {
  return UTAH_SEED.filter((s) => !watched.some((w) => w.board === s.board && w.slug === s.slug));
}
