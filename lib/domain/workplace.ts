// Where a job is done, and how that fits where you live. Pure.
//
// Tyler lives in Salt Lake City, UT. A posting is kept when it is one of these, and the brief
// shows them in this order (set by him on 18 Nov 2026):
//   1. local-flex    a posting that names Utah (a city, or the state) and is remote or
//                    hybrid; hybrid only inside the commute
//   2. remote        remote and open to the U.S., from a company anywhere else
//   3. local-onsite  in the office, inside the commute
// Everything else is left out: hybrid or on-site work beyond a 45-minute drive, and
// remote work that is closed to the U.S.
//
// A match stores its place as a label ("Hybrid · Lehi, UT · ~25 min"). Reading a label
// back gives the same answer, so the brief can group stored matches with no new column.

import { SEARCH_DEFAULTS } from "./searchProfile";

export type Arrangement = "remote" | "hybrid" | "onsite" | "unstated";
export type PlaceTier = "local-flex" | "remote" | "local-onsite";

/** The order the brief shows matches in. */
export const TIER_ORDER: readonly PlaceTier[] = ["local-flex", "remote", "local-onsite"];

export const TIER_LABEL: Record<PlaceTier, string> = {
  "local-flex": "Utah, remote or hybrid",
  remote: "Remote, anywhere in the U.S.",
  "local-onsite": `In the office, within ${SEARCH_DEFAULTS.maxCommuteMin} minutes of Salt Lake City`,
};

/** A short name for a count: "2 Utah remote or hybrid, 8 remote, 1 on-site nearby". */
export const TIER_SHORT: Record<PlaceTier, string> = { "local-flex": "Utah remote or hybrid", remote: "remote", "local-onsite": "on-site nearby" };

export interface Workplace {
  tier: PlaceTier;
  arrangement: Arrangement;
  /** The Utah city the posting names, or null. */
  city: string | null;
  /** Estimated one-way drive from Salt Lake City in minutes. Null for remote work, or when no city is named. */
  commuteMin: number | null;
  /** How a match shows its place. Reads back to this same workplace. */
  label: string;
}

// ---------------------------------------------------------------------------
// The commute

interface UtahCity {
  name: string;
  /** One-way drive from Salt Lake City in minutes. */
  min: number;
  /** How the name is matched, when the name alone is not enough. */
  re?: string;
  /** A town of this name exists in another state too: it counts only when Utah is named. */
  shared?: boolean;
}

/**
 * One-way drive from Salt Lake City, UT, in minutes, outside rush hour. These are estimates,
 * not measurements: correct any that are off. A city over the limit still counts as a
 * Utah company for remote work.
 */
export const COMMUTE_FROM_HOME: readonly UtahCity[] = [
  { name: "Riverton", min: 10, shared: true },
  { name: "Bluffdale", min: 12 },
  { name: "South Jordan", min: 12 },
  { name: "West Jordan", min: 18 },
  { name: "Draper", min: 20, shared: true },
  { name: "Kearns", min: 22, shared: true },
  { name: "Sandy", min: 25, shared: true },
  { name: "Midvale", min: 25, shared: true },
  { name: "Taylorsville", min: 25, shared: true },
  { name: "Lehi", min: 25, re: "lehi|silicon slopes|thanksgiving point" },
  { name: "Saratoga Springs", min: 25, shared: true },
  { name: "West Valley City", min: 28, re: "west valley(?: city)?" },
  { name: "Murray", min: 28, shared: true },
  { name: "Eagle Mountain", min: 30 },
  { name: "American Fork", min: 30 },
  { name: "Magna", min: 30, shared: true },
  { name: "Cottonwood Heights", min: 30 },
  { name: "South Salt Lake", min: 32 },
  { name: "Highland", min: 32, shared: true },
  { name: "Holladay", min: 33, shared: true },
  { name: "Millcreek", min: 33, shared: true },
  { name: "Alpine", min: 35, shared: true },
  { name: "Pleasant Grove", min: 35, shared: true },
  { name: "Salt Lake City", min: 38, re: "salt lake(?: city| county)?|slc" },
  { name: "Lindon", min: 38, shared: true },
  { name: "Vineyard", min: 40, shared: true },
  { name: "Orem", min: 42 },
  { name: "North Salt Lake", min: 43 },
  // Utah, beyond the commute.
  { name: "Bountiful", min: 48, shared: true },
  { name: "Provo", min: 50 },
  { name: "Tooele", min: 50 },
  { name: "Farmington", min: 50, shared: true },
  { name: "Kaysville", min: 52 },
  { name: "Park City", min: 55, shared: true },
  { name: "Layton", min: 55, shared: true },
  { name: "Springville", min: 55, shared: true },
  { name: "Spanish Fork", min: 58 },
  { name: "Ogden", min: 65, shared: true },
  { name: "Logan", min: 110, shared: true },
  { name: "St. George", min: 260, re: "st\\.? george|saint george", shared: true },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CITY_RES = COMMUTE_FROM_HOME.map((c) => ({ city: c, re: new RegExp(`\\b(?:${c.re ?? escape(c.name.toLowerCase())})\\b`, "i") }));
const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX VT VA WA WV WI WY DC".split(" "));
const namesUtah = (l: string) => /\bUtah\b/i.test(l) || /\bUT\b/.test(l);

/** The Utah city a location names (the longest name wins: "South Salt Lake" over "Salt Lake"), or `utah` alone when it only says Utah. */
function utahPlace(location: string): { city: UtahCity | null } | null {
  let best: { city: UtahCity; length: number } | null = null;
  for (const { city, re } of CITY_RES) {
    const m = re.exec(location);
    if (!m) continue;
    // What follows the name decides whose town it is: "Sandy, UT" is ours, "Sandy, OR" and "Sandy Springs" are not.
    const rest = location.slice(m.index + m[0].length);
    const utah = /^\s*,?\s*(ut|utah)\b/i.test(rest);
    const state = (/^\s*,\s*([A-Z]{2})\b/.exec(rest) ?? [])[1];
    if (!utah && state && US_STATES.has(state)) continue;
    if (!utah && city.shared && !namesUtah(location)) continue;
    if (!best || m[0].length > best.length) best = { city, length: m[0].length };
  }
  if (best) return { city: best.city };
  return namesUtah(location) ? { city: null } : null;
}

// ---------------------------------------------------------------------------
// Remote, hybrid or in the office

const REMOTE = /\b(remote|anywhere|distributed|work from home|wfh|telecommute)\b/i;
const HYBRID = /\bhybrid\b/i;
const ONSITE = /\b(on[- ]?site|in[- ]office|in[- ]person|office[- ]based)\b/i;
const US_OK = /\b(us|usa|u\.s\.|united states|americas|north america|worldwide|global|anywhere)\b/i;
const NOT_US = /\b(europe|european|eu|eea|emea|dach|nordics|uk|united kingdom|germany|france|spain|netherlands|poland|india|latam|latin america|apac|asia|australia|canada|brazil|mexico|philippines|africa|cet|gmt\+)\b/i;

// A description says "hybrid" about clouds and search too, so only the phrases that are about where you work count.
const TEXT_HYBRID = /\bhybrid (role|position|work|working|schedule|setup|arrangement|workplace)\b|\bhybrid[- ]remote\b|\b(\d|one|two|three|four) days? (a|per|each) week (in|at|on)[- ]?(the |our )?(office|site)\b|\bin[- ]office (\d|one|two|three|four) days\b/i;
const TEXT_REMOTE = /\b(fully|100%|completely) remote\b|\bremote[- ]first\b|\bwork from anywhere\b/i;

/**
 * How a Utah posting is worked. When it offers hybrid and remote from a Utah city, hybrid
 * is what it promises everyone. Hybrid needs an office to drive to: when the posting names
 * the state but no Utah city and also offers remote work ("Atlanta (hybrid) or REMOTE (US:
 * Utah, Central or Eastern time)"), the office is somewhere else and the job is remote.
 */
function utahArrangement(location: string, text: string, remoteBoard: boolean, hasCity: boolean): Arrangement {
  const remote = REMOTE.test(location) || remoteBoard;
  if (HYBRID.test(location) && (hasCity || !remote)) return "hybrid";
  if (remote) return "remote";
  if (ONSITE.test(location)) return "onsite";
  if (TEXT_HYBRID.test(text)) return "hybrid";
  if (TEXT_REMOTE.test(text)) return "remote";
  return ONSITE.test(text) ? "onsite" : "unstated";
}

const drive = (min: number | null) => (min === null ? "commute not stated" : `~${min} min`);

function label(arrangement: Arrangement, city: UtahCity | null): string {
  const where = city ? `${city.name}, UT` : "Utah";
  if (arrangement === "remote") return `Remote · ${where}`;
  if (arrangement === "hybrid") return `Hybrid · ${where} · ${drive(city?.min ?? null)}`;
  if (arrangement === "onsite") return `On-site · ${where} · ${drive(city?.min ?? null)}`;
  return `${where} · ${drive(city?.min ?? null)} · arrangement not stated`;
}

const REMOTE_US: Workplace = { tier: "remote", arrangement: "remote", city: null, commuteMin: null, label: "Remote · U.S." };

/**
 * Where a posting is worked, or null when you could not take it. `location` is the
 * posting's location field (or a stored match's label); `text` is its description, read
 * only to tell hybrid from on-site at a Utah company. Remote-only boards (Remote OK, We
 * Work Remotely) often leave the location blank or say "Anywhere": that counts as remote.
 */
export function workplaceOf(location: string, text: string, remoteBoard: boolean): Workplace | null {
  const l = location.trim();
  const utah = utahPlace(l);
  if (utah) {
    const min = utah.city?.min ?? null;
    const tooFar = min !== null && min > SEARCH_DEFAULTS.maxCommuteMin;
    let arrangement = utahArrangement(l, text, remoteBoard, utah.city !== null);
    // "Remote or hybrid" from a city too far to drive to is still a remote job.
    if (tooFar && arrangement !== "remote" && (REMOTE.test(l) || remoteBoard)) arrangement = "remote";
    if (arrangement === "remote") return { tier: "local-flex", arrangement, city: utah.city?.name ?? null, commuteMin: null, label: label(arrangement, utah.city) };
    // You would drive to this one. Too far is out; a posting that names no city is kept, and says so.
    if (tooFar) return null;
    return { tier: arrangement === "hybrid" ? "local-flex" : "local-onsite", arrangement, city: utah.city?.name ?? null, commuteMin: min, label: label(arrangement, utah.city) };
  }
  if (remoteBoard && (l === "" || US_OK.test(l))) return REMOTE_US;
  if (REMOTE.test(l) || remoteBoard) return NOT_US.test(l) && !US_OK.test(l) ? null : REMOTE_US;
  return null;
}

/** The tier of a stored match, read from its place label. A match stored before labels existed was remote or local; remote is the safe reading. */
export const tierOfStored = (location: string): PlaceTier => workplaceOf(location, "", false)?.tier ?? "remote";

export type Where = "remote" | "salt-lake" | null;

/**
 * The Scout's coarser reading: a place you could work is "remote" (from anywhere in the
 * U.S.) or "salt-lake" (a Utah company you could work for: remote, or inside the commute).
 */
export function whereFits(location: string, remoteBoard: boolean): Where {
  const w = workplaceOf(location, "", remoteBoard);
  return !w ? null : w.tier === "remote" ? "remote" : "salt-lake";
}

/** Matches in the brief's order, one group per tier that has any. */
export function byTier<T extends { tier?: PlaceTier }>(matches: readonly T[]): { tier: PlaceTier; matches: T[] }[] {
  return TIER_ORDER.map((tier) => ({ tier, matches: matches.filter((m) => (m.tier ?? "remote") === tier) })).filter((g) => g.matches.length > 0);
}

/** The place patterns above, for the market-wide reading in techMarket.ts. */
export const PLACE_PATTERNS = { REMOTE, HYBRID, ONSITE, US_OK, NOT_US, US_STATES, namesUtah, CITY_RES } as const;
