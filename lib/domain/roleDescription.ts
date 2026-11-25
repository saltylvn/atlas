// What each target role is about, in two or three sentences, refreshed once a month: from the
// Analyst's facts about the role's postings and from a web search (Firecrawl). Pure.
//
//   search    one query per role, built from the role's name alone: nothing about you leaves
//             Atlas. Only result snippets are read (no page is scraped). 2 Firecrawl credits.
//   write     the Career Mentor's model (Gemini) gets the facts and the numbered snippets, fenced as
//             untrusted data, and writes the description, naming the snippets it used.
//   check     acceptDescription: no link or markup, every number found in the facts or the
//             snippets, 1 to 3 real sources. Anything else is dropped and the card says so.
// Display-only: the text is shown on Target Roles and nowhere else.

import { numbersGrounded } from "./market";
import type { LocalDate } from "./types";

/** Results asked of the search: 5 costs 1 credit-unit of Firecrawl's "2 per 10". */
export const SEARCH_RESULTS = 5;
/** Firecrawl credits one role's search costs, counted against the shared monthly budget. */
export const SEARCH_CREDITS = 2;
/** Descriptions are kept this long, so a card can show the last one while a new month waits. */
export const DESCRIPTION_KEEP_DAYS = 400;

export interface DescriptionSource {
  title: string;
  url: string;
  /** The site, shown beside the title. */
  host: string;
}

export interface RoleDescription {
  id: string;
  role: string;
  /** "2026-11" */
  forMonth: string;
  description: string;
  sources: DescriptionSource[];
  /** Postings the facts came from. */
  postings: number;
  /** The day the search ran: the date each source was read. */
  searchedOn: LocalDate;
  createdAt: string;
}
export type NewRoleDescription = Omit<RoleDescription, "id" | "createdAt">;

export const descriptionMonth = (day: LocalDate): string => day.slice(0, 7);

/** The search for a role: its name and what the job involves. Nothing personal. */
export const descriptionQuery = (role: string): string => `what does a ${role.replace(/[^A-Za-z0-9+ -]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)} do job responsibilities`;

/** Roles still without this month's description, in your order. */
export function descriptionsDue(roles: readonly string[], rows: readonly Pick<RoleDescription, "role" | "forMonth">[], month: string): string[] {
  return roles.filter((role) => !rows.some((r) => r.role === role && r.forMonth === month));
}

/** The newest description per role. */
export function latestDescriptions(rows: readonly RoleDescription[]): Map<string, RoleDescription> {
  const out = new Map<string, RoleDescription>();
  for (const r of [...rows].sort((a, b) => b.forMonth.localeCompare(a.forMonth) || b.createdAt.localeCompare(a.createdAt))) if (!out.has(r.role)) out.set(r.role, r);
  return out;
}

const LINK = /https?:\/\/|www\.|\[[^\]]*\]\(|<[a-z/!]|[*#`|]{2,}/i;

/**
 * The model's description, checked. It must be plain sentences (no link, markup or list), 120
 * to 700 characters, with every number found in the facts or the snippets, and it must name 1
 * to 3 of the snippets it was given. Returns the text and its sources, or null.
 */
export function acceptDescription(out: { description: string; sources: number[] }, snippets: readonly { title: string; url: string; snippet: string }[], facts: readonly string[]): Pick<RoleDescription, "description" | "sources"> | null {
  const text = out.description.replace(/\s+/g, " ").trim();
  if (text.length < 120 || text.length > 700 || LINK.test(text)) return null;
  if (!numbersGrounded([text], [...facts, ...snippets.map((s) => s.snippet)])) return null;
  const picked = [...new Set(out.sources)].filter((n) => Number.isInteger(n) && n >= 1 && n <= snippets.length);
  if (picked.length === 0 || picked.length > 3 || picked.length !== new Set(out.sources).size) return null;
  const sources = picked.map((n) => {
    const s = snippets[n - 1]!;
    return { title: s.title, url: s.url, host: new URL(s.url).hostname.replace(/^www\./, "") };
  });
  return { description: text, sources };
}
