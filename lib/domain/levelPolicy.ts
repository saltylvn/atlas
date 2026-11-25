// The level Tyler applies at, in one place (his call, 24 Nov 2026): early-career to mid-level
// roles (junior, associate, level I or II) asking for 1 to 3 years of experience. Senior roles
// are ignored, and so is any posting asking for 4 or more years. It came from his own funnel: most rejections were a screen
// saying no within days, on level and keywords.
//
// Every agent reads this file, so they cannot disagree:
//   Scout / Applications  which postings become matches (lib/domain/careerAgent.ts `candidates`)
//   Apply Queue           which queued jobs are flagged and kept out of "apply to these 5"
//   Career Mentor         the goal its model is given, and an observation when the queue breaks the rule
//   Pitch                 says so before tailoring a job above the level
//   Claude (MCP)          the rule and each queued job's verdict
// Pure: text in, a verdict out.

import { isSenior, titleLevel, tooSeniorTitle } from "./careerAgent";
import { yearsAsked } from "./requirements";
import type { Settings } from "./types";

/** The most years of experience a posting may ask for. Raise it in Settings as you gain experience. */
export const MAX_YEARS_DEFAULT = 3;

/**
 * What Tyler brings besides engineering (his words, 24 Nov 2026). Every agent that writes for him
 * may use it as an angle; none may present it as engineering experience. Settings can reword it.
 */
export const BACKGROUND_DEFAULT = "About 10 years of professional experience in business administration, client-facing work and stakeholder interaction, alongside 1 to 3 years of hands-on engineering.";

export const backgroundOf = (s: Pick<Settings, "careerBackground">): string => (s.careerBackground ?? "").trim().slice(0, 400) || BACKGROUND_DEFAULT;

/** How an agent may use it: as a strength for roles that value it, and never as engineering years. */
export const backgroundRule = (background: string): string =>
  `Their wider background: ${background} Use it as a strength where the role values it (working with customers, stakeholders, operations or the business). Never count it as years of engineering experience.`;

export const maxYearsOf = (s: Pick<Settings, "careerMaxYears">): number => {
  const n = s.careerMaxYears;
  return typeof n === "number" && n >= 0 && n <= 15 ? Math.floor(n) : MAX_YEARS_DEFAULT;
};

export type LevelFit =
  /** Junior, associate, entry level, level I or II, or it asks for no more years than your limit. */
  | "target"
  /** Nothing says: no level in the title and no years stated. Kept, with a note to check. */
  | "check"
  /** Senior, staff, lead, level III+, or it asks for more years than your limit. Ignored. */
  | "above";

export interface LevelVerdict {
  fit: LevelFit;
  /** The years of experience it asks for, when it says. */
  years: number | null;
  /** Why, in a few words, for a card or a model. */
  why: string;
}

/**
 * Where a posting sits against your level. `text` is whatever is known of the posting: its
 * description, or an apply kit's lines ("Asks for: 3+ years of experience").
 * Years win over the title: a "Junior Engineer" asking for 5 years is above; a plain title
 * asking for 3 is on target. A title alone decides only when no years are stated.
 */
export function levelVerdict(title: string, text: string, maxYears: number = MAX_YEARS_DEFAULT): LevelVerdict {
  const years = text ? yearsAsked(text) : null;
  if (isSenior(title) || tooSeniorTitle(title)) return { fit: "above", years, why: "a senior, staff, lead or manager title" };
  const level = titleLevel(title);
  if (level === "upper") return { fit: "above", years, why: "a level III or higher title" };
  if (years !== null && years > maxYears) return { fit: "above", years, why: `asks for ${years}+ years of experience (your limit is ${maxYears})` };
  if (years !== null) return { fit: "target", years, why: `asks for ${years} year${years === 1 ? "" : "s"} of experience` };
  if (level === "early") return { fit: "target", years, why: "a junior, associate or entry-level title" };
  if (level === "mid") return { fit: "target", years, why: "a level II (mid-level) title" };
  return { fit: "check", years, why: `no level in the title and no years stated: check it asks for ${maxYears} or fewer` };
}

/** True when a posting is above your level and should be ignored. */
export const aboveLevel = (title: string, text: string, maxYears: number = MAX_YEARS_DEFAULT): boolean => levelVerdict(title, text, maxYears).fit === "above";

/** The rule as one sentence: what a reader, a prompt or Claude is told. */
export const levelRule = (maxYears: number = MAX_YEARS_DEFAULT): string =>
  `Level: early-career to mid-level technical and engineering roles (junior, associate, level I or II) that ask for 1 to ${maxYears} years of experience. Ignore senior, staff, lead and manager roles, and any posting asking for ${maxYears + 1} or more years.`;

/** The second lever from the funnel: what a tailoring agent is told about wording. */
export const KEYWORD_RULE = "Use the posting's own words for each skill and requirement the person really has (the screen matches keywords). Never add a keyword for something they have not done.";

export const FIT_LABEL: Record<LevelFit, string> = { target: "Your level", check: "Check the years", above: "Above your level" };
