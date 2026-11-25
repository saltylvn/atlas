// Places a job posting names: its Utah city and the U.S. states it lists. Read by the Scout when
// it records a posting (techMarket.ts) and drawn by the job maps (jobMap.ts). Pure, no imports.

// ---- Utah: cities with their coordinates (city centers, WGS84) ----

export interface UtahCity {
  name: string;
  lat: number;
  lon: number;
  /** Other ways a posting writes it. */
  also?: string[];
}

// Longer names first, so "South Salt Lake" is not read as "Salt Lake".
export const UTAH_CITIES: readonly UtahCity[] = [
  { name: "South Salt Lake", lat: 40.7188, lon: -111.8883 },
  { name: "North Salt Lake", lat: 40.8486, lon: -111.9069 },
  { name: "West Valley City", lat: 40.6916, lon: -112.0011, also: ["West Valley"] },
  { name: "Cottonwood Heights", lat: 40.6197, lon: -111.8102 },
  { name: "Saratoga Springs", lat: 40.3491, lon: -111.9044 },
  { name: "Pleasant Grove", lat: 40.3641, lon: -111.7385 },
  { name: "American Fork", lat: 40.3769, lon: -111.7958 },
  { name: "Eagle Mountain", lat: 40.3141, lon: -112.0069 },
  { name: "South Jordan", lat: 40.5622, lon: -111.9297 },
  { name: "West Jordan", lat: 40.6097, lon: -111.9391 },
  { name: "Spanish Fork", lat: 40.1149, lon: -111.6549 },
  { name: "Cedar Hills", lat: 40.4141, lon: -111.7585 },
  { name: "Cedar City", lat: 37.6775, lon: -113.0619 },
  { name: "St. George", lat: 37.0965, lon: -113.5684, also: ["St George", "Saint George"] },
  { name: "Heber City", lat: 40.507, lon: -111.4132, also: ["Heber"] },
  { name: "Park City", lat: 40.6461, lon: -111.498 },
  { name: "Salt Lake City", lat: 40.7608, lon: -111.891, also: ["Salt Lake", "SLC"] },
  { name: "Taylorsville", lat: 40.6677, lon: -111.9388 },
  { name: "Springville", lat: 40.1652, lon: -111.6107 },
  { name: "Clearfield", lat: 41.1108, lon: -112.0261 },
  { name: "Farmington", lat: 40.9805, lon: -111.8874 },
  { name: "Bluffdale", lat: 40.4897, lon: -111.9388 },
  { name: "Bountiful", lat: 40.8894, lon: -111.8808 },
  { name: "Riverton", lat: 40.5219, lon: -111.9391 },
  { name: "Highland", lat: 40.4269, lon: -111.7952 },
  { name: "Holladay", lat: 40.6688, lon: -111.8247 },
  { name: "Millcreek", lat: 40.6869, lon: -111.8755 },
  { name: "Kaysville", lat: 41.0352, lon: -111.9386 },
  { name: "Vineyard", lat: 40.2972, lon: -111.7469 },
  { name: "Mapleton", lat: 40.1302, lon: -111.5785 },
  { name: "Midvale", lat: 40.6111, lon: -111.8999 },
  { name: "Lindon", lat: 40.3433, lon: -111.7208 },
  { name: "Draper", lat: 40.5247, lon: -111.8638 },
  { name: "Murray", lat: 40.6669, lon: -111.8879 },
  { name: "Layton", lat: 41.0602, lon: -111.9711 },
  { name: "Alpine", lat: 40.4533, lon: -111.7779 },
  { name: "Tooele", lat: 40.5308, lon: -112.2983 },
  { name: "Payson", lat: 40.0444, lon: -111.7321 },
  { name: "Vernal", lat: 40.4555, lon: -109.5287 },
  { name: "Sandy", lat: 40.5649, lon: -111.8389 },
  { name: "Provo", lat: 40.2338, lon: -111.6585 },
  { name: "Ogden", lat: 41.223, lon: -111.9738 },
  { name: "Logan", lat: 41.737, lon: -111.8338 },
  { name: "Price", lat: 39.5994, lon: -110.8107 },
  { name: "Moab", lat: 38.5733, lon: -109.5498 },
  { name: "Lehi", lat: 40.3916, lon: -111.8508 },
  { name: "Orem", lat: 40.2969, lon: -111.6946 },
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CITY_RES = UTAH_CITIES.map((c) => ({ c, re: new RegExp(`\\b(?:${[c.name, ...(c.also ?? [])].map(esc).join("|")})\\b`, "i") }));

/** The Utah city a location names, or null. */
export function utahCityOf(location: string): string | null {
  return CITY_RES.find(({ re }) => re.test(location))?.c.name ?? null;
}

// ---- states a location names ----

const STATE_NAMES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};
export const STATE_CODES: ReadonlySet<string> = new Set(Object.values(STATE_NAMES));
// Longer names first ("West Virginia" before "Virginia").
const NAME_RES = Object.entries(STATE_NAMES)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([name, code]) => ({ code, re: new RegExp(`\\b${esc(name)}\\b`, "gi") }));
// Two capital letters standing alone: "Austin, TX", "Remote (CA, NY)". "IN", "OR", "ME" and others
// are also words, so a code counts only next to a comma, a slash, parentheses or the line's end.
const CODE_RE = /(?:^|[,(/|;]\s*|\s-\s)([A-Z]{2})(?=\s*(?:$|[,)/|;]|\s-\s|\s\d{5}))/g;

/** Every U.S. state a location names, by code, in the order written (at most 12). */
export function statesOf(location: string): string[] {
  let rest = location;
  const found: string[] = [];
  // "Washington, DC" is the district, not the state.
  if (/\bWashington,?\s*D\.?C\.?\b/i.test(rest)) {
    found.push("DC");
    rest = rest.replace(/\bWashington,?\s*D\.?C\.?\b/gi, " ");
  }
  // Each name is removed once found, so "Virginia" is not read again inside "West Virginia".
  for (const { code, re } of NAME_RES) {
    if (rest.search(re) === -1) continue;
    found.push(code);
    rest = rest.replace(re, " ");
  }
  for (const m of rest.matchAll(CODE_RE)) if (STATE_CODES.has(m[1]!)) found.push(m[1]!);
  return [...new Set(found)].slice(0, 12);
}
