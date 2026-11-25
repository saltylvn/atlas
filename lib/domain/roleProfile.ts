// Target Roles: the Career tab's page for your top four roles, so you can see what you are
// aiming for. Pure: no I/O.
//
// Each role's card has two kinds of content, kept apart:
//   facts     computed by rules from the Analyst's outlook and your own records: demand, pay,
//             the skills asked for, which of them you can show, the gaps, the projects that
//             would close them. Refreshed with every market report.
//   profile   written once a week by the Career Mentor's model (Gemini): what the role does, its
//             tempo, a project idea and the gap to close first. It is given only the facts,
//             and what it writes is checked against them before it is kept (acceptProfile).
// The roles are your target roles (at most seven), in the order you set on Target Roles.

import { mondayOf, weekdayIndex } from "./dates";
import { numbersGrounded } from "./market";
import { outlookFact, type AskedSkill, type RoleOutlook } from "./roleOutlook";
import { extractSkills, projectForSkill, type PortfolioProject } from "./skills";
import { MAX_ROLES } from "./targetRoles";
import type { LocalDate } from "./types";

/** How many roles the page shows: all of them, since you target at most seven. */
export const TOP_ROLES = MAX_ROLES;
/** Gaps listed on a card, and how many of them get a project to build. */
export const CARD_GAPS = 4;
export const CARD_PROJECTS = 2;
/** Profiles are kept this long, so a card can say when its text last changed. */
export const PROFILE_KEEP_DAYS = 60;

export const topRoles = (roles: readonly string[]): string[] => roles.slice(0, TOP_ROLES);
/** The Monday a profile belongs to. One profile per role per week. */
export const profileWeek = (day: LocalDate): LocalDate => mondayOf(day);
/** Profiles are written on Mondays, with the weekly resume update. */
export const isProfileDay = (day: LocalDate): boolean => weekdayIndex(day) === 0;

export interface RoleGap {
  skill: string;
  /** Share of the role's postings that ask for it, 0 to 1. */
  share: number;
  /** Also on your Growth page's gap list (asked for across your matches, not marked as yours). */
  onGrowthList: boolean;
}

export interface RoleCard {
  role: string;
  /** 1 = your first priority. */
  rank: number;
  /** The Analyst's numbers for the role, or null when it has not measured it yet. */
  outlook: RoleOutlook | null;
  /** What the role's postings ask for most, most asked first. */
  asks: AskedSkill[];
  /** Asked for, and shown by none of your projects or resumes: most asked first. */
  gaps: RoleGap[];
  /** A project to build for each of the top gaps. */
  projects: PortfolioProject[];
  /** Projects of yours that already back the role. */
  backedBy: string[];
}

/** One role's card, from the Analyst's outlook and the Growth page's gap list. */
export function roleCard(role: string, rank: number, outlook: readonly RoleOutlook[] | undefined, growthGaps: readonly string[]): RoleCard {
  const o = outlook?.find((x) => x.role === role) ?? null;
  const onGrowth = new Set(growthGaps.map((g) => g.toLowerCase()));
  const asks = [...(o?.asked ?? [])].sort((a, b) => b.share - a.share);
  const gaps = asks.filter((a) => !a.shown).slice(0, CARD_GAPS).map((a) => ({ skill: a.skill, share: a.share, onGrowthList: onGrowth.has(a.skill.toLowerCase()) }));
  return { role, rank, outlook: o, asks, gaps, projects: gaps.slice(0, CARD_PROJECTS).map((g) => projectForSkill(g.skill)), backedBy: o?.projects ?? [] };
}

/** The cards for your top roles, in your order. */
export function roleCards(roles: readonly string[], outlook: readonly RoleOutlook[] | undefined, growthGaps: readonly string[]): RoleCard[] {
  return topRoles(roles).map((role, i) => roleCard(role, i + 1, outlook, growthGaps));
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * What the model is given about a role, and what a profile's numbers are checked against:
 * one sentence each. A role the Analyst has not measured has no facts, and gets no profile.
 */
export function roleFacts(card: RoleCard): string[] {
  const o = card.outlook;
  if (!o || o.thin) return [];
  return [
    outlookFact(o),
    card.asks.length ? `Skills its postings ask for, with the share that ask: ${card.asks.map((a) => `${a.skill} ${pct(a.share)}`).join(", ")}.` : "",
    card.gaps.length ? `Asked for and shown by none of their projects or resumes: ${card.gaps.map((g) => g.skill).join(", ")}.` : "They can show every skill its postings ask for most.",
    card.backedBy.length ? `Their projects that back this role: ${card.backedBy.join(", ")}.` : "No project of theirs backs this role yet.",
  ].filter(Boolean);
}

/** What the model writes for one role. */
export interface RoleProfileText {
  /** What someone in the role does, day to day. */
  does: string;
  /** The pace and feel of the work: who you work with, how fast, how it is judged. */
  tempo: string;
  /** One project worth building for this role. */
  project: string;
  /** The gap to close first, one of the card's gaps, or "" when there is none. */
  closeSkill: string;
  closeWhy: string;
}

export interface RoleProfile extends RoleProfileText {
  id: string;
  role: string;
  /** The Monday of the week it was written for. */
  forWeek: LocalDate;
  /** How many postings the facts rested on. */
  postings: number;
  /** The facts it was written from, as shown under it. */
  facts: string[];
  writer: "model";
  createdAt: string;
}

export type NewRoleProfile = Omit<RoleProfile, "id" | "createdAt">;

const MARKUP = /[<>`*#_~]|https?:\/\/|www\./i;
const tidy = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Checks what the model wrote against the facts it was given. Kept only when:
 *   - it is plain text, with no link or markup;
 *   - every number in it is one of the facts' numbers (it may not add a statistic);
 *   - the gap to close first is one of the role's gaps, or none when there are none;
 *   - the project and the reason name no skill the role's postings do not ask for.
 * "What it does" and "tempo" are the model's own read of the role and are labeled so; they
 * may name general skills, but still no number. Anything else: nothing is kept, and the card
 * shows the facts alone.
 */
export function acceptProfile(out: RoleProfileText, card: RoleCard): RoleProfileText | null {
  const facts = roleFacts(card);
  if (facts.length === 0) return null;
  const text: RoleProfileText = { does: tidy(out.does), tempo: tidy(out.tempo), project: tidy(out.project), closeSkill: tidy(out.closeSkill), closeWhy: tidy(out.closeWhy) };
  const prose = [text.does, text.tempo, text.project, text.closeWhy];
  if (prose.some((p) => MARKUP.test(p))) return null;
  if (text.does.length < 40 || text.tempo.length < 30 || text.project.length < 30) return null;
  if (!numbersGrounded(prose, facts)) return null;
  const gap = card.gaps.find((g) => g.skill.toLowerCase() === text.closeSkill.toLowerCase());
  if (card.gaps.length > 0 ? !gap || text.closeWhy.length < 10 : text.closeSkill !== "") return null;
  const asked = new Set(card.asks.map((a) => a.skill.toLowerCase()));
  if (extractSkills(`${text.project} ${text.closeWhy}`).some((s) => !asked.has(s.toLowerCase()))) return null;
  return { ...text, closeSkill: gap?.skill ?? "", closeWhy: gap ? text.closeWhy : "" };
}

/** Each role's newest profile, and the one before it, so a card can say when the text changed. */
export function latestProfiles(rows: readonly RoleProfile[]): Map<string, { current: RoleProfile; previous: RoleProfile | null }> {
  const out = new Map<string, { current: RoleProfile; previous: RoleProfile | null }>();
  for (const r of [...rows].sort((a, b) => b.forWeek.localeCompare(a.forWeek) || b.createdAt.localeCompare(a.createdAt))) {
    const have = out.get(r.role);
    if (!have) out.set(r.role, { current: r, previous: null });
    else if (!have.previous && r.forWeek < have.current.forWeek) have.previous = r;
  }
  return out;
}

/** Which of the top roles still need this week's profile. */
export function profilesDue(roles: readonly string[], rows: readonly RoleProfile[], today: LocalDate): string[] {
  const week = profileWeek(today);
  return topRoles(roles).filter((role) => !rows.some((r) => r.role === role && r.forWeek === week));
}

/** What "Update now" says back: how many were written, and why any are still waiting, each reason once. */
export function profilesMessage(out: { written: readonly string[]; kept: readonly string[]; waiting: readonly { role: string; why: string }[] }): string {
  const total = out.written.length + out.kept.length + out.waiting.length;
  const head = `${out.written.length} of ${total} role profile${total === 1 ? "" : "s"} written.`;
  if (out.waiting.length === 0) return head;
  const byWhy = new Map<string, string[]>();
  for (const w of out.waiting) byWhy.set(w.why, [...(byWhy.get(w.why) ?? []), w.role]);
  const reasons = [...byWhy].map(([why, roles]) => `${roles.length === total ? "all of them" : roles.join(", ")}: ${why.replace(/\.$/, "")}`);
  return `${head} Still waiting, ${reasons.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// The skills your target roles ask for most, across job boards and job searches

/** How many skills the list shows. */
export const TOP_SKILLS = 10;

export interface TopSkill {
  skill: string;
  /** Postings that ask for it, and their share of all postings counted. */
  postings: number;
  share: number;
  /** Your target roles whose postings ask for it, most first. */
  roles: string[];
  /** You marked it as yours in Growth. */
  have: boolean;
}

export interface TopSkills {
  skills: TopSkill[];
  /** Postings counted: the Scout's from job boards, plus job searches' matches it had not seen. */
  postings: number;
  fromBoards: number;
  fromSearches: number;
  days: number;
}

type Posted = { role: string; skills?: string[] | null; url: string };

/**
 * The skills asked for most by postings for your top roles in the last `days`: every posting
 * the Scout recorded from job boards, plus job-search matches it had not recorded (counted once
 * by address). Each posting counts a skill once.
 */
export function topSkillsAcross(input: { boards: readonly Posted[]; searches: readonly Posted[]; roles: readonly string[]; have: readonly string[]; days: number }): TopSkills {
  const wanted = new Set(topRoles(input.roles));
  const norm = (u: string) => u.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  const boards = input.boards.filter((p) => wanted.has(p.role));
  const seen = new Set(boards.map((p) => norm(p.url)));
  const searches = input.searches.filter((p) => wanted.has(p.role) && !seen.has(norm(p.url)));
  const all = [...boards, ...searches];
  const tally = new Map<string, { n: number; roles: Map<string, number> }>();
  for (const p of all) {
    for (const s of new Set(p.skills ?? [])) {
      const t = tally.get(s) ?? { n: 0, roles: new Map<string, number>() };
      t.n++;
      t.roles.set(p.role, (t.roles.get(p.role) ?? 0) + 1);
      tally.set(s, t);
    }
  }
  const mine = new Set(input.have.map((h) => h.toLowerCase()));
  const skills = [...tally.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, TOP_SKILLS)
    .map(([skill, t]) => ({ skill, postings: t.n, share: all.length ? t.n / all.length : 0, roles: [...t.roles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([r]) => r), have: mine.has(skill.toLowerCase()) }));
  return { skills, postings: all.length, fromBoards: boards.length, fromSearches: searches.length, days: input.days };
}
