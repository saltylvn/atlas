// Every job source behind the market report, in one list, so you can see what the Analyst
// is working from. The Scout reads these; the Analyst only reads what the Scout recorded.
// Pure: the counts come from the Scout's postings (market_postings).

export interface JobSource {
  /** The source name as postings record it (company boards are grouped). */
  name: string;
  what: string;
  /** The public page for the source, for reference. */
  url: string;
  kind: "feed" | "api" | "watchlist";
  /** Read only once its key is set (in Vercel). Until then it is "not set up", not "not answering". */
  keyed?: true;
}

export const JOB_SOURCES: readonly JobSource[] = [
  { name: "Remote OK", what: "Remote jobs, public JSON API. Pay is often stated.", url: "https://remoteok.com", kind: "api" },
  { name: "We Work Remotely", what: "Remote jobs, four engineering categories (programming, full-stack, back-end, DevOps), RSS.", url: "https://weworkremotely.com", kind: "feed" },
  { name: "Jobicy", what: "Remote jobs open to the USA, software development, public JSON API. Read every six hours.", url: "https://jobicy.com", kind: "api" },
  { name: "HN Who's Hiring", what: "The monthly Hacker News \"Who is hiring?\" thread, through the public Algolia API.", url: "https://news.ycombinator.com/submitted?id=whoishiring", kind: "api" },
  { name: "Himalayas", what: "Remote jobs, U.S. full-time, one search per target role, public JSON API. Read every six hours.", url: "https://himalayas.app", kind: "api" },
  { name: "Remotive", what: "Remote jobs in software development, DevOps and AI, public JSON API. Listings arrive 24 hours late. Read every six hours.", url: "https://remotive.com", kind: "api" },
  { name: "Adzuna", what: "A large U.S. job aggregator, four searches a day at the first sync (free key, personal research). Source: Adzuna, credited wherever its data appears.", url: "https://www.adzuna.com", kind: "api", keyed: true },
  { name: "Company boards", what: "Your watchlist below: each company's own careers board on Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, BambooHR or ApplicantPro.", url: "", kind: "watchlist" },
  { name: "Utah companies", what: "Utah tech companies' own careers boards (Qualtrics, Pattern, Filevine and others; lib/domain/utahSeed.ts), read for the market only: their jobs never show as your matches. One you watch is read once, as a company board.", url: "", kind: "watchlist" },
];

/** How a posting from the Utah list is labeled, so the market can count that source apart. */
export const UTAH_LIST_TAG = " · Utah list";

/** Boards Atlas does not read, and why. Jobs from them come in through "Save a job" or their confirmation email. */
export const NOT_READ: readonly { name: string; why: string }[] = [
  { name: "LinkedIn", why: "No public feed, and its terms forbid automated reading." },
  { name: "Indeed", why: "No public feed, and its terms forbid automated reading." },
  { name: "Glassdoor", why: "No public feed, and its terms forbid automated reading." },
  { name: "Wellfound, Dice and others", why: "No public feed Atlas may read. Their saved searches are linked on the Pipeline page." },
];

/** Which listed source a recorded posting came from ("Acme careers" is a company board). */
export const sourceGroup = (recorded: string): string =>
  JOB_SOURCES.some((s) => s.name === recorded) ? recorded : recorded.endsWith(UTAH_LIST_TAG) ? "Utah companies" : / careers$/.test(recorded) ? "Company boards" : recorded;

export interface SourceCount {
  name: string;
  /** Postings recorded in the window, and how many were for your own roles. */
  postings: number;
  yours: number;
  /** The last day a posting from it was seen, or null. */
  lastSeen: string | null;
}

/** Postings per source over the window, every listed source included even at zero. */
export function sourceCounts(postings: readonly { source: string; role: string; lastSeen: string }[], yourRoles: readonly string[], since: string): SourceCount[] {
  const mine = new Set(yourRoles);
  const by = new Map<string, SourceCount>(JOB_SOURCES.map((s) => [s.name, { name: s.name, postings: 0, yours: 0, lastSeen: null }]));
  for (const p of postings) {
    if (p.lastSeen < since) continue;
    const g = sourceGroup(p.source);
    const row = by.get(g) ?? { name: g, postings: 0, yours: 0, lastSeen: null };
    row.postings++;
    if (mine.has(p.role)) row.yours++;
    if (!row.lastSeen || p.lastSeen > row.lastSeen) row.lastSeen = p.lastSeen;
    by.set(g, row);
  }
  return [...by.values()];
}
