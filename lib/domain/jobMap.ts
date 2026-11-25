// Where the jobs are: two maps on the Market page (owner's design, 22 Nov 2026).
//   Utah        a pin at each Utah city a local job (on-site or hybrid) names; a job that names
//               no city is listed, not pinned.
//   Remote USA  a tile map of the states: a remote job limited to certain states ("Remote: CA,
//               NY") gets a pin in each; one open anywhere in the U.S. is counted and listed apart.
// Pure: postings in, pins out. Places come from what each posting says, never guessed.

import { STATE_CODES, UTAH_CITIES } from "./places";
import { ACTIVE_DAYS, type TechPosting } from "./techMarket";

export { statesOf, utahCityOf, UTAH_CITIES } from "./places";
import { addDays } from "./dates";
import type { LocalDate } from "./types";

// ---- the two maps ----

export interface MapJob {
  title: string;
  company: string;
  url: string;
  family: TechPosting["family"];
}

export interface CityPin {
  city: string;
  lat: number;
  lon: number;
  jobs: MapJob[];
}

export interface JobMaps {
  utah: { pins: CityPin[]; noCity: MapJob[]; total: number };
  remote: { byState: Record<string, MapJob[]>; anywhere: MapJob[]; total: number };
}

const asJob = (p: TechPosting): MapJob => ({ title: p.title, company: p.company, url: p.url, family: p.family });

/** Active postings (seen in the last 7 days) placed on the two maps. */
export function jobMaps(postings: readonly TechPosting[], day: LocalDate): JobMaps {
  const from = addDays(day, -(ACTIVE_DAYS - 1));
  const active = postings.filter((p) => p.lastSeen >= from && p.firstSeen <= day);
  const pins = new Map<string, CityPin>();
  const noCity: MapJob[] = [];
  const byState: Record<string, MapJob[]> = {};
  const anywhere: MapJob[] = [];
  let utahTotal = 0;
  let remoteTotal = 0;
  for (const p of active) {
    // Remote U.S. only: a job open worldwide is on the International tab, not on the U.S. map.
    if (p.mode === "remote" && p.region !== "global") {
      remoteTotal++;
      const states = (p.states ?? []).filter((s) => STATE_CODES.has(s));
      // Limited to a few states: a pin in each. Open everywhere (or naming most of the map): anywhere.
      if (states.length > 0 && states.length <= 10) for (const s of states) (byState[s] ??= []).push(asJob(p));
      else anywhere.push(asJob(p));
      continue;
    }
    if (p.region !== "utah") continue;
    utahTotal++;
    const city = p.city ? UTAH_CITIES.find((c) => c.name === p.city) : null;
    if (!city) {
      noCity.push(asJob(p));
      continue;
    }
    const pin = pins.get(city.name) ?? { city: city.name, lat: city.lat, lon: city.lon, jobs: [] };
    pin.jobs.push(asJob(p));
    pins.set(city.name, pin);
  }
  return {
    utah: { pins: [...pins.values()].sort((a, b) => b.jobs.length - a.jobs.length), noCity, total: utahTotal },
    remote: { byState, anywhere, total: remoteTotal },
  };
}

// ---- drawing ----

/** Utah's border: 42°N from 114.05°W to 111.05°W, down to 41°N, east to 109.05°W, down to 37°N. */
export const UTAH_OUTLINE: readonly [number, number][] = [
  [-114.05, 42.0],
  [-111.05, 42.0],
  [-111.05, 41.0],
  [-109.05, 41.0],
  [-109.05, 37.0],
  [-114.05, 37.0],
];

export interface Bounds {
  west: number;
  east: number;
  south: number;
  north: number;
}
export const ALL_UTAH: Bounds = { west: -114.25, east: -108.85, south: 36.8, north: 42.2 };
/** Payson to Bountiful, Tooele to Park City: where most Utah tech jobs are (Ogden is in All of Utah). */
export const WASATCH_FRONT: Bounds = { west: -112.35, east: -111.35, south: 39.98, north: 40.92 };

/** Longitude and latitude to x and y in a box `width` wide, keeping distances true at Utah's latitude. */
export function project(b: Bounds, width: number): { height: number; at: (lon: number, lat: number) => [number, number] } {
  const k = Math.cos((((b.north + b.south) / 2) * Math.PI) / 180);
  const scale = width / ((b.east - b.west) * k);
  return { height: (b.north - b.south) * scale, at: (lon, lat) => [(lon - b.west) * k * scale, (b.north - lat) * scale] };
}

/** The tile map: each state one square, placed roughly where it sits. [column, row]. */
export const STATE_TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [11, 0], VT: [10, 1], NH: [11, 1],
  WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], WI: [6, 2], MI: [8, 2], NY: [10, 2], MA: [11, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IL: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3], RI: [11, 3],
  CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5], DC: [8, 5],
  OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
  HI: [0, 7], TX: [3, 7], FL: [8, 7],
};
