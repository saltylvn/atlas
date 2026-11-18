import "server-only";
import { FEED_TIMEOUT_MS, safeFetchText } from "@/lib/security/safeFetch";
import type { Lean, NewsItem, NewsTopic } from "@/lib/domain/types";
import { dedupeAndSort, parseFeed } from "./rss";

// The allowlist of feeds: the sources named in the Atlas plan. Adding a feed means
// adding its host to lib/security/safeFetch.ts too, on purpose: two places to change,
// one review.
//
// Reuters, AP and Anthropic publish no RSS feed, so their headlines come from Google
// News searches limited to their own site. Google appends " - Publisher" to each title;
// that suffix is stripped.

export interface Feed {
  topic: NewsTopic;
  source: string;
  url: string;
  /** Political lean as the plan groups its sources, used to keep politics and world news balanced. */
  lean: Lean;
  googleNews?: true;
}

const gn = (query: string) => `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

export const FEEDS: readonly Feed[] = [
  // Tech, AI first: Anthropic news, TechCrunch, The Verge, Ars Technica
  { topic: "ai", source: "Anthropic", url: gn("site:anthropic.com when:7d"), lean: "none", googleNews: true },
  { topic: "ai", source: "TechCrunch", url: "https://techcrunch.com/category/artificial-intelligence/feed/", lean: "none" },
  { topic: "ai", source: "The Verge", url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", lean: "none" },
  { topic: "tech", source: "TechCrunch", url: "https://techcrunch.com/feed/", lean: "none" },
  { topic: "tech", source: "The Verge", url: "https://www.theverge.com/rss/index.xml", lean: "none" },
  { topic: "tech", source: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", lean: "none" },
  // Big-picture U.S. politics. Center: Reuters, AP, The Hill. Conservative: Fox News, Washington Examiner, The Dispatch
  { topic: "politics", source: "Reuters", url: gn("site:reuters.com/world/us when:1d"), lean: "center", googleNews: true },
  { topic: "politics", source: "AP", url: gn("site:apnews.com politics when:1d"), lean: "center", googleNews: true },
  { topic: "politics", source: "The Hill", url: "https://thehill.com/homenews/feed/", lean: "center" },
  { topic: "politics", source: "Fox News", url: "https://moxie.foxnews.com/google-publisher/politics.xml", lean: "conservative" },
  { topic: "politics", source: "Washington Examiner", url: "https://www.washingtonexaminer.com/section/news/politics/feed/", lean: "conservative" },
  { topic: "politics", source: "The Dispatch", url: "https://thedispatch.com/feed/", lean: "conservative" },
  // Major world news. Center: Reuters, AP, The Hill. Conservative: Wall Street Journal, Fox News
  { topic: "world", source: "Reuters", url: gn("site:reuters.com/world -site:reuters.com/world/us when:1d"), lean: "center", googleNews: true },
  { topic: "world", source: "AP", url: gn("site:apnews.com world news when:1d"), lean: "center", googleNews: true },
  { topic: "world", source: "The Hill", url: "https://thehill.com/policy/international/feed/", lean: "center" },
  { topic: "world", source: "Wall Street Journal", url: "https://feeds.a.dj.com/rss/RSSWorldNews.xml", lean: "conservative" },
  { topic: "world", source: "Fox News", url: "https://moxie.foxnews.com/google-publisher/world.xml", lean: "conservative" },
];

/** Each source's lean, for the News Agent's balance rule. */
export const LEAN: Readonly<Record<string, Lean>> = Object.fromEntries(FEEDS.map((f) => [f.source, f.lean]));

export interface NewsResult {
  items: NewsItem[];
  /** Feeds that failed, named "Source (topic)" so two feeds from one outlet stay distinct. */
  failed: string[];
}

/** Google News titles end in " - Publisher"; drop that last segment. An item with no title left is dropped. */
export function stripPublisher(title: string): string {
  const t = title.trim();
  if (/^[-–—]\s/.test(t)) return "";
  const cut = t.lastIndexOf(" - ");
  return cut > 0 ? t.slice(0, cut).trim() : t;
}

export async function getNews(topics: readonly NewsTopic[]): Promise<NewsResult> {
  const feeds = FEEDS.filter((f) => topics.includes(f.topic));
  const results = await Promise.allSettled(
    feeds.map(async (f) => {
      const items = parseFeed(await safeFetchText(f.url, { revalidate: 1800, maxBytes: 3_000_000, timeoutMs: FEED_TIMEOUT_MS.news }), f.topic, f.source);
      return f.googleNews ? items.map((i) => ({ ...i, title: stripPublisher(i.title) })).filter((i) => i.title.length >= 8) : items;
    }),
  );
  const items: NewsItem[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else failed.push(`${feeds[i]!.source} (${feeds[i]!.topic})`);
  });
  return { items: dedupeAndSort(items), failed };
}
