import { XMLParser } from "fast-xml-parser";
import type { NewsItem, NewsTopic } from "@/lib/domain/types";

// Parses RSS 2.0 and Atom into plain headlines. Feed content is untrusted:
// only title, link and date are kept, titles are stripped of markup, and links
// must be http(s). Nothing from a feed is ever rendered as HTML.

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  processEntities: true,
  htmlEntities: true,
  // Defend against entity-expansion tricks.
  allowBooleanAttributes: false,
});

const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && "#text" in v) return String((v as Record<string, unknown>)["#text"]);
  return "";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Plain text only. The result is rendered by React as text, never as HTML. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 31 && code < 0x10ffff ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function safeLink(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function parseFeed(xml: string, topic: NewsTopic, source: string, limit = 15): NewsItem[] {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  const items: NewsItem[] = [];
  const rss = doc.rss as { channel?: { item?: unknown } } | undefined;
  const feed = doc.feed as { entry?: unknown } | undefined;

  for (const raw of arr(rss?.channel?.item as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const title = cleanTitle(text(raw.title));
    const url = safeLink(text(raw.link) || text(raw.guid));
    if (!title || !url) continue;
    items.push({ id: url, topic, title, url, source, publishedAt: toIso(text(raw.pubDate) || text(raw["dc:date"])) });
  }
  for (const raw of arr(feed?.entry as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
    const title = cleanTitle(text(raw.title));
    const links = arr(raw.link as Record<string, string> | Record<string, string>[] | undefined);
    const alt = links.find((l) => !l["@rel"] || l["@rel"] === "alternate") ?? links[0];
    const url = safeLink(alt?.["@href"] ?? "");
    if (!title || !url) continue;
    items.push({ id: url, topic, title, url, source, publishedAt: toIso(text(raw.published) || text(raw.updated)) });
  }
  return items.slice(0, limit);
}

function toIso(s: string): string | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/** Newest first, one copy of each story (same link or same normalized title). */
export function dedupeAndSort(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
  return [...items]
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .filter((i) => {
      const k1 = i.url;
      const k2 = key(i.title);
      if (seen.has(k1) || seen.has(k2)) return false;
      seen.add(k1);
      seen.add(k2);
      return true;
    });
}

/** Round-robin across sources (each already newest first), so one prolific feed can't bury the rest. */
export function interleaveBySource(items: NewsItem[]): NewsItem[] {
  const queues = new Map<string, NewsItem[]>();
  for (const i of items) queues.set(i.source, [...(queues.get(i.source) ?? []), i]);
  const out: NewsItem[] = [];
  while (out.length < items.length) {
    for (const q of queues.values()) {
      const next = q.shift();
      if (next) out.push(next);
    }
  }
  return out;
}
