// A refused token on a machine endpoint, as the audit trail records it. Pure: no I/O.
//
// A machine endpoint is a route that authenticates with a bearer token instead of a
// session: the scheduler's routes, Siri capture and the keep-alive. A missing or wrong
// token answers 401; lib/security/refusedToken.ts writes a throttled record of it, and the
// QA Agent counts the week's records (lib/domain/qa.ts).
//
// What a record holds: the route, from the fixed list below (never read from the request),
// and how many requests were refused, split by whether they carried a credential at all.
// What it never holds: the token, any part, hash or length of it, a request header, the
// query string or body, or anything about the caller (no address, no user agent).

/** Every route that authenticates with a bearer token. test/secondLayer.test.ts checks it against app/api. */
export const MACHINE_ROUTES = ["/api/capture", "/api/keepalive", "/api/cron/morning", "/api/cron/afternoon", "/api/cron/evening", "/api/cron/qa", "/api/cron/sync"] as const;
export type MachineRoute = (typeof MACHINE_ROUTES)[number];

/** The audit action of a refused-token record. Its outcome is always "denied". */
export const TOKEN_REFUSED = "token.refused";

/** missing: the request carried no credential. wrong: it carried one, and it did not match. */
export type RefusalKind = "missing" | "wrong";

/** How many requests a record stands for, by kind. */
export interface RefusalTally {
  missing: number;
  wrong: number;
}

/**
 * Whether a refused request carried a credential at all. It looks only at whether the
 * Authorization header is there: the value is never read further, kept or returned.
 */
export function refusalKind(header: string | null | undefined): RefusalKind {
  return header && header.trim() ? "wrong" : "missing";
}

const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 999_999_999) : 0);

/**
 * The record's detail, built from the route and counts only: "37 refused at /api/cron/sync:
 * 3 no token, 34 wrong token". The route is also the record's target; it is repeated here
 * because the audit trail on Settings shows the detail.
 */
export function refusedDetail(route: MachineRoute, tally: RefusalTally): string {
  const missing = count(tally.missing);
  const wrong = count(tally.wrong);
  return `${missing + wrong} refused at ${route}: ${missing} no token, ${wrong} wrong token`;
}

const DETAIL = /^\d{1,10} refused at \/[a-z/-]{1,80}: (\d{1,9}) no token, (\d{1,9}) wrong token$/;

/** Reads a record's detail back. Null when it is not in the shape refusedDetail writes. */
export function readRefused(detail: string): RefusalTally | null {
  const m = DETAIL.exec(detail);
  return m ? { missing: Number(m[1]), wrong: Number(m[2]) } : null;
}

/** A refused-token record as the review reads it: when, which route, the counts. */
export interface RefusedRecord {
  at: string;
  target: string;
  detail: string;
}

export interface RefusedSummary {
  records: number;
  /** Requests refused. A record counts for what it says, and for at least one. */
  refused: number;
  missing: number;
  wrong: number;
  /** Per route, most refused first. A target that is not on the list is grouped as "another route". */
  routes: { route: string; refused: number }[];
  /** When the earliest and the latest record were written (ISO), or null with no records. */
  first: string | null;
  last: string | null;
}

/**
 * Adds up refused-token records. Every row is read as data: a detail that does not parse
 * still counts as one refused request, because the record itself says one was refused.
 */
export function refusedSummary(rows: readonly RefusedRecord[]): RefusedSummary {
  const byRoute = new Map<string, number>();
  let refused = 0;
  let missing = 0;
  let wrong = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const r of rows) {
    const tally = readRefused(r.detail);
    const n = Math.max(1, (tally?.missing ?? 0) + (tally?.wrong ?? 0));
    refused += n;
    missing += tally?.missing ?? 0;
    wrong += tally?.wrong ?? 0;
    const route = (MACHINE_ROUTES as readonly string[]).includes(r.target) ? r.target : "another route";
    byRoute.set(route, (byRoute.get(route) ?? 0) + n);
    // Compared as instants: the database and the demo store write the same moment differently.
    const at = Date.parse(r.at);
    if (Number.isNaN(at)) continue;
    if (first === null || at < Date.parse(first)) first = r.at;
    if (last === null || at > Date.parse(last)) last = r.at;
  }
  const routes = [...byRoute.entries()].map(([route, n]) => ({ route, refused: n })).sort((a, b) => b.refused - a.refused || a.route.localeCompare(b.route));
  return { records: rows.length, refused, missing, wrong, routes, first, last };
}
