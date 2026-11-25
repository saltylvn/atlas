// The News Agent (build step 3). Pure: the runner (lib/agents/news.ts) fetches the
// allowlisted feeds and passes the headlines in, so the scheduled run, Run Now, Today's
// live preview and the tests all use this same code.
//
// Three areas, 3 stories each (9 per brief; 1 each on Saturday):
//   tech      AI and Claude/Anthropic first, then software and the internet
//   politics  big-picture U.S. politics
//   world     major world news
//
// "Big picture" and "major" are measured, not guessed: the same story reported by
// several outlets ranks higher. Politics and world keep a center/conservative balance,
// show a center outlet's headline when one covers the story, and name the others that
// covered it. The 2:00 PM Brief skips anything the morning showed, including the same
// story from a different outlet. Rules only, no model call.

import type { StandardReport } from "./chiefOfStaff";
import type { BriefSlot, Lean, NewsItem, NewsTopic } from "./types";

export const NEWS_AREAS = ["tech", "politics", "world"] as const;
export type NewsArea = (typeof NEWS_AREAS)[number];
export const AREA_LABEL: Record<NewsArea, string> = { tech: "Tech", politics: "U.S. politics", world: "World" };
/** The same, mid-sentence. */
const AREA_INLINE: Record<NewsArea, string> = { tech: "tech", politics: "U.S. politics", world: "world" };

export const areaOf = (topic: NewsTopic): NewsArea => (topic === "ai" ? "tech" : topic);

export interface BriefStory {
  topic: NewsTopic;
  title: string;
  url: string;
  source: string;
  /** Added in build step 3; briefs saved before then do not have these. */
  area?: NewsArea;
  /** Other outlets that ran the same story. */
  alsoIn?: string[];
}

export interface ShownStories {
  urls: ReadonlySet<string>;
  titles: readonly string[];
}

export interface NewsAgentInput {
  slot: BriefSlot;
  now: Date;
  items: NewsItem[];
  failedFeeds: string[];
  /** Feeds asked for, so "every feed failed" can be told apart from a quiet news day. */
  feedCount: number;
  lean: Readonly<Record<string, Lean>>;
  /** What the morning brief already showed (the 2:00 PM Brief shows only new stories). */
  shown: ShownStories;
}

export interface NewsAgentResult {
  stories: BriefStory[];
  report: StandardReport;
  /** True when every feed failed: the run is logged as failed. */
  allFailed: boolean;
}

// ---------------------------------------------------------------------------
// Grouping the same story across outlets

const STOP = new Set(
  "the a an and or but for nor of on in at to from by with as is are was were be been being it its this that these those after before over under into about amid says said say new will would could can may might than then there their they them he she his her who what when where why how not no yes more most up out off just also first last us u.s".split(
    " ",
  ),
);

/** Significant words of a headline, for matching the same story across outlets. */
/**
 * Different words outlets use for the same thing, folded to one before comparing (QA review of
 * 22 Nov 2026: "Fed holds interest rates steady" and "Federal Reserve leaves rates unchanged" were
 * counted as two stories all week).
 */
const ALIASES: readonly [RegExp, string][] = [
  [/\bfederal reserve\b/gi, "Fed"],
  [/\b(holds?|keeps?|leaves?|maintains?)\s+(interest\s+)?rates?\s+(steady|unchanged|on hold|flat)\b/gi, "rates unchanged"],
  [/\b(holds?|keeps?|leaves?)\s+(interest\s+)?rates?\b/gi, "rates"],
  [/\bexecutive order\b/gi, "order"],
];
/** Two-letter acronyms worth keeping as key words ("AI safety"); other two-letter words are dropped. */
const ACRONYMS = new Set(["AI", "EU", "UK", "UN", "US", "EV", "VR", "AR"]);

/** A headline's first word, when it names who the story is about (capitalized, not a common opener). */
const leadOf = (title: string): string | null => {
  const w = /^\s*([A-Z][A-Za-z0-9&.-]+)/.exec(title)?.[1];
  return w && !LEAD_STOP.has(w.toLowerCase()) ? w.toLowerCase().replace(/[’']s$/, "") : null;
};
const LEAD_STOP = new Set(["the", "a", "an", "how", "why", "what", "when", "who", "new", "breaking", "report", "live", "watch", "opinion", "analysis", "exclusive", "update"]);

export function keywords(title: string): Set<string> {
  let t = title;
  for (const [re, to] of ALIASES) t = t.replace(re, to);
  const acronyms = (t.match(/\b[A-Z]{2}\b/g) ?? []).filter((w) => ACRONYMS.has(w)).map((w) => w.toLowerCase());
  const words = t
    .toLowerCase()
    .replace(/[’']s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  const set = new Set([...words, ...acronyms]);
  // Kept on the set (not a key word): the headline's lead, for the template check in sameStory.
  const lead = leadOf(t);
  if (lead) Object.defineProperty(set, "lead", { value: lead, enumerable: false });
  return set;
}

/**
 * Two headlines describe the same story when they share most of the shorter one's key words.
 * Except a "template" pair: near-identical headlines whose lead names a different subject that the
 * other never mentions ("Microsoft earnings beat expectations on cloud growth" / "Amazon earnings
 * beat ..."): those are two companies' stories, not one.
 */
export function sameStory(a: Set<string>, b: Set<string>): boolean {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const ratio = shared / Math.min(a.size, b.size);
  if (shared < 3 || ratio < 0.5) return false;
  const la = (a as Set<string> & { lead?: string }).lead;
  const lb = (b as Set<string> & { lead?: string }).lead;
  if (ratio >= 0.75 && la && lb && la !== lb && !b.has(la) && !a.has(lb)) return false;
  return true;
}

interface Cluster {
  area: NewsArea;
  items: NewsItem[];
  words: Set<string>;
}

function cluster(items: NewsItem[]): Cluster[] {
  const out: Cluster[] = [];
  for (const item of items) {
    const area = areaOf(item.topic);
    const words = keywords(item.title);
    const hit = words.size >= 3 ? out.find((c) => c.area === area && sameStory(c.words, words)) : undefined;
    if (hit) {
      hit.items.push(item);
      for (const w of words) hit.words.add(w);
    } else out.push({ area, items: [item], words });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ranking

const CLAUDE = /\b(claude|anthropic)\b/i;
const AI = /\b(ai|a\.i\.|artificial intelligence|llms?|openai|chatgpt|gemini|model|models|agents?|agentic|machine learning|nvidia|gpu)\b/i;
const HOUR = 3_600_000;

/** Older stories drop out; Anthropic's own posts get a few days, since they come less often. */
const maxAgeHours = (i: NewsItem) => (i.source === "Anthropic" ? 72 : 36);

function fresh(i: NewsItem, now: Date): boolean {
  if (!i.publishedAt) return true;
  const age = (now.getTime() - Date.parse(i.publishedAt)) / HOUR;
  return age <= maxAgeHours(i) && age > -2;
}

function newestAt(c: Cluster): number {
  return Math.max(...c.items.map((i) => (i.publishedAt ? Date.parse(i.publishedAt) : 0)));
}

/** Cross-outlet coverage first ("big picture"), then recency; in tech, Claude/Anthropic then AI. */
export function score(c: Cluster, now: Date): number {
  const outlets = new Set(c.items.map((i) => i.source)).size;
  const ageH = (now.getTime() - newestAt(c)) / HOUR;
  const recency = ageH < 6 ? 3 : ageH < 12 ? 2 : ageH < 24 ? 1 : 0;
  let s = (outlets - 1) * 3 + recency;
  if (c.area === "tech") {
    const text = c.items.map((i) => i.title).join(" ");
    if (CLAUDE.test(text) || c.items.some((i) => i.source === "Anthropic")) s += 8;
    else if (AI.test(text) || c.items.some((i) => i.topic === "ai")) s += 3;
  }
  return s;
}

const CENTER_ORDER = ["Reuters", "AP", "The Hill"];

/** The headline shown for a story: a center outlet's when one covered it, else the newest. */
function representative(c: Cluster, lean: NewsAgentInput["lean"]): NewsItem {
  const byDate = [...c.items].sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
  if (c.area === "tech") return byDate.find((i) => i.source === "Anthropic") ?? byDate[0]!;
  const center = byDate.filter((i) => lean[i.source] === "center").sort((a, b) => rank(a.source) - rank(b.source));
  return center[0] ?? byDate[0]!;
}
const rank = (source: string) => {
  const i = CENTER_ORDER.indexOf(source);
  return i < 0 ? CENTER_ORDER.length : i;
};

// ---------------------------------------------------------------------------
// Picking

/**
 * Up to `n` stories for one area: highest score first, one story per outlet where
 * possible, and in politics and world no more than two of three from the same lean
 * while the other side has stories. Constraints relax rather than leave a slot empty.
 */
function pickArea(clusters: Cluster[], n: number, input: NewsAgentInput): { story: BriefStory; cluster: Cluster }[] {
  const ranked = [...clusters].sort((a, b) => score(b, input.now) - score(a, input.now) || newestAt(b) - newestAt(a));
  const balanced = (clusters[0]?.area ?? "tech") !== "tech";
  const leanCap = Math.max(1, n - 1);
  const chosen: { c: Cluster; rep: NewsItem }[] = [];

  for (const strict of [2, 1, 0]) {
    for (const c of ranked) {
      if (chosen.length >= n) break;
      if (chosen.some((x) => x.c === c)) continue;
      const rep = representative(c, input.lean);
      const sources = new Set(chosen.map((x) => x.rep.source));
      const repLean = input.lean[rep.source] ?? "none";
      const sameLean = chosen.filter((x) => (input.lean[x.rep.source] ?? "none") === repLean).length;
      const otherSideExists = ranked.some((o) => !chosen.some((x) => x.c === o) && o !== c && (input.lean[representative(o, input.lean).source] ?? "none") !== repLean);
      if (strict >= 1 && sources.has(rep.source)) continue;
      if (strict >= 2 && balanced && sameLean >= leanCap && otherSideExists) continue;
      chosen.push({ c, rep });
    }
  }

  return chosen.map(({ c, rep }) => {
    const others = [...new Set(c.items.map((i) => i.source))].filter((s) => s !== rep.source);
    return { cluster: c, story: { topic: rep.topic, area: c.area, title: rep.title, url: rep.url, source: rep.source, ...(others.length ? { alsoIn: others } : {}) } };
  });
}

const COMMON_NAMES = new Set(["white house", "supreme court", "united states", "new york", "wall street", "silicon valley", "middle east", "european union", "united nations"]);

/** Multi-word proper names in a headline ("Jensen Huang", "Van Hollen"), lowercased. */
export function names(title: string): Set<string> {
  const out = new Set<string>();
  for (const m of title.matchAll(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g)) {
    const n = m[0].toLowerCase();
    if (!COMMON_NAMES.has(n)) out.add(n);
    // A headline's first word is always capitalized, so in "What Sam Altman told..." the
    // name may start at the second word.
    const rest = n.split(/\s+/).slice(1).join(" ");
    if (m.index === 0 && rest.includes(" ") && !COMMON_NAMES.has(rest)) out.add(rest);
  }
  return out;
}

/** Across areas the bar is lower: sharing a person's or company's full name is enough. */
function sameAcrossAreas(a: Cluster, b: Cluster): boolean {
  if (sameStory(a.words, b.words)) return true;
  const an = new Set(a.items.flatMap((i) => [...names(i.title)]));
  return b.items.some((i) => [...names(i.title)].some((n) => an.has(n)));
}

export function newsAgentReport(input: NewsAgentInput): NewsAgentResult {
  const perArea = input.slot === "saturday" ? 1 : 3;
  const shownWords = input.shown.titles.map(keywords);
  const isShown = (c: Cluster) => c.items.some((i) => input.shown.urls.has(i.url)) || shownWords.some((w) => w.size >= 3 && sameStory(w, c.words));

  const clusters = cluster(input.items.filter((i) => fresh(i, input.now))).filter((c) => !isShown(c));
  // One story appears in one area only: a story picked for tech is not repeated under
  // politics because a politics search also caught it.
  const picked: { story: BriefStory; cluster: Cluster }[] = [];
  for (const area of NEWS_AREAS) {
    const open = clusters.filter((c) => c.area === area && !picked.some((p) => sameAcrossAreas(p.cluster, c)));
    picked.push(...pickArea(open, perArea, input));
  }
  const stories = picked.map((p) => p.story);

  const allFailed = input.feedCount > 0 && input.failedFeeds.length >= input.feedCount;
  const errors = input.failedFeeds.length
    ? [allFailed ? "Every news feed failed; no stories this brief." : `${input.failedFeeds.length} news feed${input.failedFeeds.length === 1 ? "" : "s"} failed: ${input.failedFeeds.join(", ")}`]
    : [];
  const counts = NEWS_AREAS.map((a) => ({ a, n: stories.filter((s) => s.area === a).length }));
  const short = counts.filter((x) => x.n < perArea).map((x) => `${AREA_LABEL[x.a]}: ${x.n} of ${perArea}${input.slot === "afternoon" ? " new since the morning" : ""}`);

  return {
    stories,
    allFailed,
    report: {
      agent: "news",
      headline: `${stories.length} ${stories.length === 1 ? "story" : "stories"}${input.slot === "afternoon" ? " new since the morning" : ""}: ${counts.map((x) => `${x.n} ${AREA_INLINE[x.a]}`).join(", ")}.`,
      details: [...stories.map((s) => `${AREA_LABEL[s.area!]} · ${s.title} (${s.source}${s.alsoIn?.length ? `; also ${s.alsoIn.join(", ")}` : ""})`), ...short],
      needsApproval: [],
      errors,
    },
  };
}

/** What a saved brief showed, so the next brief can skip it (works for briefs saved before step 3 too). */
export function shownIn(reports: unknown[]): ShownStories {
  const news = reports.flatMap((r) => {
    const n = (r as { news?: unknown } | null)?.news;
    return Array.isArray(n) ? (n as Partial<BriefStory>[]) : [];
  });
  return {
    urls: new Set(news.map((s) => s.url).filter((u): u is string => typeof u === "string")),
    titles: news.map((s) => s.title).filter((t): t is string => typeof t === "string"),
  };
}
