// "Under the hood": for each figure on the Market page, the parts of Atlas that make it, from the
// workflow that runs to the table it is read from, each labeled by what kind of part it is and the
// file it lives in (owner's request, 23 Nov 2026: see the build behind every number).
//
// Pure data. Keep it in step with the code: test/provenance.test.ts checks every file named here exists.

export type PartKind = "workflow" | "bot" | "reader" | "rules" | "table" | "math" | "public-data" | "ai";

export const PART_LABEL: Record<PartKind, { label: string; definition: string }> = {
  workflow: { label: "Workflow", definition: "A fixed sequence on a schedule: code decides every step." },
  bot: { label: "Bot", definition: "Does one job when a workflow or you start it. Rules only here: no AI model." },
  reader: { label: "Reader", definition: "An adapter that reads one outside source and turns it into Atlas's shape." },
  rules: { label: "Rules", definition: "Plain code that labels or checks data. No AI." },
  table: { label: "Table", definition: "Where the data is stored (Supabase Postgres; only you can read your rows)." },
  math: { label: "Math", definition: "The calculation that turns stored rows into the figure on screen." },
  "public-data": { label: "Public data", definition: "Official statistics read from a public API." },
  ai: { label: "AI model", definition: "A language model, called through Atlas's one AI adapter, within the daily AI limit. Its output is shown, never acted on." },
};

export interface Part {
  kind: PartKind;
  name: string;
  what: string;
  file: string;
}

export interface Hood {
  /** How the figure is calculated, in a sentence or two. */
  method: string;
  parts: Part[];
}

const SYNC: Part = { kind: "workflow", name: "2-hour sync", what: "Runs the Scout Monday to Saturday, 6 AM to 4 PM", file: "lib/domain/registry.ts" };
const SCOUT: Part = { kind: "bot", name: "Scout", what: "Reads every job source, keeps the tech jobs and records them", file: "lib/agents/scout.ts" };
const FEEDS: Part = { kind: "reader", name: "Job feed readers", what: "Remote OK, We Work Remotely, Jobicy, HN Who's Hiring, Himalayas, Remotive, Adzuna", file: "lib/integrations/jobFeeds.ts" };
const BOARDS: Part = { kind: "reader", name: "Company board readers", what: "Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, BambooHR, ApplicantPro: your watchlist and the Utah list", file: "lib/integrations/jobBoards.ts" };
const FETCH: Part = { kind: "rules", name: "safeFetch", what: "Every outside read goes through an allowlist of hosts, with size and time limits", file: "lib/security/safeFetch.ts" };
const CLASSIFY: Part = { kind: "rules", name: "Classifier", what: "Labels each job: role family, level, region, work mode, yearly pay; merges the same job from two sources", file: "lib/domain/techMarket.ts" };
const PLACES: Part = { kind: "rules", name: "Place reader", what: "48 Utah cities with coordinates, and U.S. states by name and code", file: "lib/domain/places.ts" };
const POSTINGS: Part = { kind: "table", name: "tech_postings", what: "One row per job, kept 60 days after it was last seen", file: "supabase/migrations/20261122160000_tech_market.sql" };
const DAILY: Part = { kind: "table", name: "market_daily", what: "One row per day, role family, level and region; kept for good", file: "supabase/migrations/20261122160000_tech_market.sql" };
const SNAPSHOT: Part = { kind: "math", name: "marketSnapshot()", what: "Keeps this tab's jobs seen in the last 7 days; caps each company at 25 in shares and medians", file: "lib/domain/marketSnapshot.ts" };

/** The whole path every market figure shares, from the schedule to the table. */
export const PIPELINE: readonly Part[] = [SYNC, SCOUT, FEEDS, BOARDS, FETCH, CLASSIFY, POSTINGS, DAILY];

export const HOODS = {
  headline: {
    method: "Jobs: postings seen in the last 7 days. The 7-day change compares today's daily summary with 7 days ago. Median pay: the middle of each posting's pay range, yearly U.S. dollars, each company counted at most 25 times.",
    parts: [SCOUT, CLASSIFY, POSTINGS, DAILY, SNAPSHOT],
  },
  "eng-types": {
    method: "Each job's role family, read from its title, belongs to one of five engineering types; product and program roles are counted apart. Job counts are not capped; pay, remote share and skills count each company at most 25 times.",
    parts: [CLASSIFY, POSTINGS, { kind: "math", name: "engTypeCards()", what: "Groups the role families into the five types and summarizes each", file: "lib/domain/engTypes.ts" }],
  },
  "map-utah": {
    method: "A pin at the Utah city a posting names, sized by the number of jobs. A posting that names no city is listed, never pinned at a guessed place.",
    parts: [PLACES, POSTINGS, { kind: "math", name: "jobMaps()", what: "Groups local jobs by city", file: "lib/domain/jobMap.ts" }],
  },
  "map-remote": {
    method: "A remote job limited to some states counts in each of them; one open across the U.S. counts as anywhere. Jobs open beyond the U.S. are on the International tab.",
    parts: [PLACES, POSTINGS, { kind: "math", name: "jobMaps()", what: "Groups remote jobs by state", file: "lib/domain/jobMap.ts" }],
  },
  "eng-evidence": {
    method: "Jobs seen in the last 30 days in this tab, by engineering type: share of all tech jobs, companies and sources listing them, new jobs in the last 14 days against the 14 before, and the specialties inside each type, read from titles by rules.",
    parts: [CLASSIFY, POSTINGS, { kind: "math", name: "engEvidence()", what: "Counts, growth and specialties per type", file: "lib/domain/engEvidence.ts" }],
  },
  "type-check": {
    method: "A sample of 40 of this week's jobs, an even share of each label, in one model call. The model sees only titles and company names, not the rules' labels. Agreement = jobs where its label equals the rules' label. Display-only: no label changes.",
    parts: [
      { kind: "workflow", name: "Evening run", what: "Runs the check daily; Check now runs it on demand", file: "lib/agents/cron.ts" },
      { kind: "bot", name: "Career Mentor (type check)", what: "Picks the sample, asks the model, compares, saves the result", file: "lib/agents/typeCheck.ts" },
      { kind: "ai", name: "AI adapter", what: "Gemini on the free tier (or Claude when set), gated by the daily AI limit", file: "lib/ai/model.ts" },
      { kind: "rules", name: "Sample and compare", what: "Stable daily sample, answer validated against a schema, agreement counted", file: "lib/domain/typeCheck.ts" },
    ],
  },
  "career-map": {
    method: "Every tech job seen in the last 60 days, by engineering type and specialty (read from the title). The three biggest named specialties in each type are its paths. A rung is the level the title states, or, when it states none, the years of experience asked (0-2 Junior, 3-4 Mid, 5-7 Senior, 8+ Staff); jobs with neither count in the path but on no rung. Pay is the middle of each posting's range, each company counted at most 25 times; years and certifications come from postings with a description. Rebuilt every Monday and kept as that week's snapshot.",
    parts: [
      { kind: "workflow", name: "Evening run", what: "Rebuilds the map on Mondays; Update now rebuilds it on demand", file: "lib/agents/cron.ts" },
      CLASSIFY,
      { kind: "rules", name: "Requirements reader", what: "Years of experience and certifications from a posting's description", file: "lib/domain/requirements.ts" },
      { kind: "rules", name: "Specialty reader", what: "The specialty a title names inside its type", file: "lib/domain/engEvidence.ts" },
      POSTINGS,
      { kind: "math", name: "buildCareerMap()", what: "Paths, rungs, pay ranges, skills new at each rung, what changed since last week", file: "lib/domain/careerMap.ts" },
      { kind: "public-data", name: "BLS OEWS", what: "Official median pay for the closest occupation, U.S. and Utah", file: "lib/domain/benchmarks.ts" },
      { kind: "table", name: "career_maps", what: "One snapshot of the map per week", file: "supabase/migrations/20261123120000_career_map.sql" },
    ],
  },
  "career-steps": {
    method: "For each type, one model call gets the paths' facts (counts, pay, years, skill and certification names; never posting text) and writes 1 to 3 steps per move up. A step with a number that is not in the facts, or a link, is dropped, and the rules' step for that move stands. Labeled by who wrote it.",
    parts: [
      { kind: "bot", name: "Career Mentor (career map)", what: "Builds the facts, asks the model per type, checks the steps, saves the week", file: "lib/agents/careerMap.ts" },
      { kind: "ai", name: "AI adapter", what: "Gemini on the free tier (or Claude when set), within the daily AI limit: five calls a week", file: "lib/ai/model.ts" },
      { kind: "rules", name: "Step check", what: "Every number must be in the facts; no links or markup; rules' steps as the fallback", file: "lib/domain/careerMap.ts" },
    ],
  },
  trends: {
    method: "Active postings per role family per day, from the daily summary the Scout writes after each run.",
    parts: [{ kind: "math", name: "dailySummary()", what: "Counts active, new and gone jobs per day, family, level and region", file: "lib/domain/techMarket.ts" }, DAILY, SNAPSHOT],
  },
  pay: {
    method: "Pay from the board's pay field or the posting's text; hourly pay times 2,080 hours; amounts outside $20k to $1M are ignored. Medians come from postings, never from other medians.",
    parts: [CLASSIFY, POSTINGS, SNAPSHOT],
  },
  levels: {
    method: "The level a title states (intern to manager). Most titles state none, and that is counted as such.",
    parts: [CLASSIFY, POSTINGS, SNAPSHOT],
  },
  modes: {
    method: "Remote, hybrid or on-site as the posting's place or text says; jobs from remote-only boards are remote.",
    parts: [CLASSIFY, POSTINGS, SNAPSHOT],
  },
  skills: {
    method: "Skills matched from a fixed list in each posting's title and description. Shares rest only on postings that came with a description.",
    parts: [{ kind: "rules", name: "Skill reader", what: "Matches a fixed list of skills in text", file: "lib/domain/skills.ts" }, POSTINGS, SNAPSHOT],
  },
  companies: {
    method: "Companies with the most active postings in this tab. Not capped: this is where the big hirers show.",
    parts: [POSTINGS, SNAPSHOT],
  },
  national: {
    method: "Official U.S. figures, read on Mondays: openings, hires and quits (BLS JOLTS), pay by occupation (BLS OEWS), and Indeed's software postings index (FRED).",
    parts: [
      { kind: "workflow", name: "Evening run", what: "Runs the national benchmarks read on Mondays", file: "lib/domain/registry.ts" },
      { kind: "bot", name: "Scout (national benchmarks)", what: "Reads the BLS and FRED series", file: "lib/agents/benchmarks.ts" },
      { kind: "public-data", name: "BLS and FRED", what: "JOLTS, OEWS, and the Indeed postings index", file: "lib/domain/benchmarks.ts" },
      { kind: "table", name: "market_benchmarks", what: "One row per series and period", file: "supabase/migrations/20261122180000_market_benchmarks.sql" },
    ],
  },
} satisfies Record<string, Hood>;

export type HoodId = keyof typeof HOODS;
