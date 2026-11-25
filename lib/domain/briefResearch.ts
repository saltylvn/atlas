// The apply brief's research (PR 3 of the MacBook-only plan, 23 Nov 2026): the company's recent
// news, its own pages, who to reach, and an angle for your application. Pure: the worker
// (lib/agents/briefResearch.ts) fetches; these rules choose, check and shape.
//
// Public sources only. Atlas never reads LinkedIn: it builds a people-search link you open
// yourself. Headlines, page titles and snippets are untrusted text: they are shown as data
// and passed to the model as data, never as instructions. The model's angle is display-only,
// and an item is kept only when it cites the facts it rests on and every number it writes is
// in those facts (the rules' angle stands otherwise).

import { z } from "zod";
import type { ApplyBrief } from "./applyBrief";
import { numbersIn } from "./careerMap";
import { NEVER_READ } from "./postingFacts";
import { daysBetween } from "./dates";
import type { LocalDate } from "./types";

/** Briefs researched a day at most: one Firecrawl search each (owner's cap, 23 Nov 2026). */
export const BRIEF_DAILY = 10;
/** Kits researched in one sync run. */
export const BRIEF_PER_RUN = 3;
/** Headlines this recent, at most this many. */
export const NEWS_DAYS = 30;
export const NEWS_MAX = 5;
/** Links to the company's own pages kept. */
export const PAGES_MAX = 3;

export interface BriefNews {
  title: string;
  source: string;
  url: string;
  /** YYYY-MM-DD, or "" when the feed gives none. */
  date: string;
}

export interface BriefPage {
  title: string;
  url: string;
}

export interface AngleItem {
  text: string;
  /** Ids of the facts it rests on ("f3", "n1"). */
  cites: string[];
}

export interface BriefAngle {
  writer: "model" | "rules";
  whyThem: AngleItem[];
  yourAngle: AngleItem[];
  questions: AngleItem[];
  /** Items the check dropped. */
  dropped: number;
}

export interface BriefResearch {
  company: string;
  news: BriefNews[];
  pages: BriefPage[];
  /** A LinkedIn people search you open yourself; Atlas never fetches it. */
  peopleSearch: string;
  team: string;
  reportsTo: string;
  angle: BriefAngle;
  /** The facts the angle cites, by id, so each citation can be shown. */
  facts: { id: string; text: string }[];
  /** What was not done, in plain words. */
  notes: string[];
  /** What the company does, from what the Researcher read (lib/agents/companyResearch.ts). Each line cites its facts. */
  about?: AngleItem[];
  /** "agent" when the Researcher wrote it; absent for the one-search version. */
  by?: "agent";
}

/** Google News's RSS search for one company's last month (news.google.com is on the allowlist). */
export function companyNewsUrl(company: string): string {
  const q = `"${company.replace(/["\n\r]/g, " ").trim().slice(0, 80)}" when:${NEWS_DAYS}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

const compact = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|technologies|technology|group)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, "");

/** Google News titles end in " - Publisher": the publisher is the source, the rest the headline. */
export function newsFrom(items: readonly { title: string; url: string; source: string; publishedAt: string | null }[], company: string, today: LocalDate): BriefNews[] {
  const who = compact(company);
  const out: BriefNews[] = [];
  const seen = new Set<string>();
  for (const i of items) {
    const cut = i.title.lastIndexOf(" - ");
    const headline = (cut > 0 ? i.title.slice(0, cut) : i.title).replace(/\s+/g, " ").trim().slice(0, 200);
    const source = (cut > 0 ? i.title.slice(cut + 3) : i.source).trim().slice(0, 60);
    const date = i.publishedAt ? i.publishedAt.slice(0, 10) : "";
    if (headline.length < 8 || seen.has(headline.toLowerCase())) continue;
    // A stock quote page is not news about the company.
    if (/stock price|quote (&|and) history|share price today|stock quote/i.test(headline)) continue;
    // The company must be named in the headline: a search hit on a word inside it is not news about it.
    if (who.length >= 3 && !compact(headline).includes(who)) continue;
    if (date && daysBetween(date, today) > NEWS_DAYS) continue;
    seen.add(headline.toLowerCase());
    out.push({ title: headline, source, url: i.url, date });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date)).slice(0, NEWS_MAX);
}

/** Sites that list people or jobs about a company rather than the company itself: never its own pages. */
const NOT_THE_COMPANY = [...NEVER_READ, "linkedin.com", "crunchbase.com", "zoominfo.com", "rocketreach.co", "theorg.com", "builtin.com", "wikipedia.org", "bloomberg.com", "pitchbook.com", "greenhouse.io", "lever.co", "ashbyhq.com", "workable.com", "youtube.com", "x.com", "twitter.com", "facebook.com", "instagram.com", "reddit.com"];

/** The company's own pages among search results: the host must carry its name, and not be a site about companies. */
export function companyPages(results: readonly { title: string; url: string }[], company: string): BriefPage[] {
  const who = compact(company);
  if (who.length < 3) return [];
  const out: BriefPage[] = [];
  for (const r of results) {
    let host = "";
    try {
      const u = new URL(r.url);
      if (u.protocol !== "https:") continue;
      host = u.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    if (NOT_THE_COMPANY.some((d) => host === d || host.endsWith(`.${d}`))) continue;
    if (!compact(host.split(".").slice(0, -1).join("")).includes(who)) continue;
    out.push({ title: r.title.replace(/\s+/g, " ").trim().slice(0, 120) || host, url: r.url.slice(0, 500) });
    if (out.length >= PAGES_MAX) break;
  }
  return out;
}

/** A LinkedIn people search for who leads this kind of work there. You open it; Atlas never fetches it. */
export function peopleSearchUrl(company: string, family: string | null): string {
  const who = family && /software|data|ai|devops|security/i.test(family) ? "engineering manager" : "hiring manager";
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${company} ${who}`.slice(0, 120))}`;
}

/** The facts the angle may use, each with an id the angle cites. Headlines are titles only. */
export function angleFacts(brief: ApplyBrief, extra: { team: string; reportsTo: string; news: readonly BriefNews[] }): { id: string; text: string }[] {
  const r = brief.role;
  const c = brief.company;
  const facts = [
    `Level: ${r.level}${r.family ? `, ${r.family}` : ""}`,
    r.have.length ? `Skills it names that you have: ${r.have.join(", ")}` : "",
    r.missing.length ? `Skills it names that are not on your list: ${r.missing.join(", ")}` : "",
    r.years ? `It asks for ${r.years} of experience` : "",
    r.pay.marketMedian && r.pay.vsMarket ? `Its pay is ${r.pay.vsMarket} the market median for this level` : "",
    `${c.name} has ${c.openNow} open tech role${c.openNow === 1 ? "" : "s"} seen this week`,
    c.trend === "growing" || c.trend === "slowing" || c.trend === "steady" ? `${c.name} is ${c.trend === "steady" ? "hiring at a steady pace" : c.trend === "growing" ? "hiring more lately" : "hiring less lately"}` : "",
    c.hiring.length ? `${c.name} hires most: ${c.hiring.map((h) => h.label).join(", ")}` : "",
    extra.team ? `The posting names the team: ${extra.team}` : "",
    extra.reportsTo ? `The role reports to the ${extra.reportsTo}` : "",
    brief.contact ? `You know ${brief.contact} there` : "",
  ].filter(Boolean);
  return [...facts.map((text, i) => ({ id: `f${i + 1}`, text })), ...extra.news.map((n, i) => ({ id: `n${i + 1}`, text: `Headline${n.date ? ` (${n.date})` : ""}: ${n.title}` }))];
}

const Item = z.object({ text: z.string().min(8).max(400), cites: z.array(z.string().max(6)).max(4) });
export const AngleOut = z.object({ whyThem: z.array(Item).max(4), yourAngle: z.array(Item).max(4), questions: z.array(Item).max(4) });
export type AngleOut = z.infer<typeof AngleOut>;

const LINK_OR_MARKUP = /https?:\/\/|www\.|[<>*_`#[\]]/i;

/**
 * The critique step, by rules: an item passes when it cites at least one fact that exists,
 * every number it writes is in the facts it cites, and it carries no link or markup. Failing
 * items are dropped; when a whole part is empty, the rules' version of that part stands.
 */
export function checkAngle(out: AngleOut, facts: readonly { id: string; text: string }[], fallback: BriefAngle): BriefAngle {
  const byId = new Map(facts.map((f) => [f.id, f.text]));
  let dropped = 0;
  const keep = (items: readonly AngleOut["whyThem"][number][], max: number): AngleItem[] =>
    items
      .filter((i) => {
        const cites = i.cites.filter((c) => byId.has(c));
        const allowed = new Set(cites.flatMap((c) => numbersIn(byId.get(c)!)));
        const ok = cites.length > 0 && !LINK_OR_MARKUP.test(i.text) && numbersIn(i.text).every((n) => allowed.has(n));
        if (!ok) dropped++;
        return ok;
      })
      .slice(0, max)
      .map((i) => ({ text: i.text.replace(/\s+/g, " ").trim(), cites: [...new Set(i.cites.filter((c) => byId.has(c)))] }));
  const whyThem = keep(out.whyThem, 3);
  const yourAngle = keep(out.yourAngle, 3);
  const questions = keep(out.questions, 3);
  return {
    writer: whyThem.length + yourAngle.length + questions.length ? "model" : "rules",
    whyThem: whyThem.length ? whyThem : fallback.whyThem,
    yourAngle: yourAngle.length ? yourAngle : fallback.yourAngle,
    questions: questions.length ? questions : fallback.questions,
    dropped,
  };
}

/** The angle by rules alone, when no model is asked or none answers. */
export function rulesAngle(brief: ApplyBrief, facts: readonly { id: string; text: string }[], extra: { team: string; reportsTo: string }): BriefAngle {
  const find = (re: RegExp) => facts.find((f) => re.test(f.text))?.id;
  const item = (text: string, re: RegExp): AngleItem[] => {
    const id = find(re);
    return id ? [{ text, cites: [id] }] : [];
  };
  const c = brief.company;
  return {
    writer: "rules",
    whyThem: [...item(`${c.name} has open tech roles now; name the one you are applying to and why it fits.`, /open tech role/), ...item(`Mention what ${c.name} is doing lately, from its latest headline.`, /^Headline/)],
    yourAngle: [...item(`Lead with the skills you have that it names: ${brief.role.have.slice(0, 3).join(", ")}.`, /that you have/), ...item("Say how you are closing the gap on the skills it names that are not on your list.", /not on your list/)],
    questions: [
      ...(extra.team ? item(`What is the ${extra.team} team working on this year?`, /names the team/) : []),
      ...(extra.reportsTo ? item(`How does the ${extra.reportsTo} measure success in this role in the first 90 days?`, /reports to/) : []),
      ...item("What does a strong first six months look like at this level?", /^Level/),
    ],
    dropped: 0,
  };
}

/** The research as stored, read back safely: anything not in this shape is ignored. */
export const StoredResearch = z.object({
  company: z.string(),
  news: z.array(z.object({ title: z.string(), source: z.string(), url: z.string(), date: z.string() })),
  pages: z.array(z.object({ title: z.string(), url: z.string() })),
  peopleSearch: z.string(),
  team: z.string(),
  reportsTo: z.string(),
  angle: z.object({ writer: z.enum(["model", "rules"]), whyThem: z.array(Item), yourAngle: z.array(Item), questions: z.array(Item), dropped: z.number() }),
  facts: z.array(z.object({ id: z.string(), text: z.string() })),
  notes: z.array(z.string()),
  about: z.array(Item).optional(),
  by: z.literal("agent").optional(),
});

export function parseResearch(data: unknown): BriefResearch | null {
  const p = StoredResearch.safeParse(data);
  return p.success ? p.data : null;
}

/** The team and manager lines the posting reader wrote into a kit ("Team: …", "Reports to: …"). */
export function kitPeople(detail: string): { team: string; reportsTo: string } {
  return { team: /^Team: (.{1,40})$/m.exec(detail)?.[1]?.trim() ?? "", reportsTo: /^Reports to: (.{1,60})$/m.exec(detail)?.[1]?.trim() ?? "" };
}

/** Briefs researched today, from the counter in Settings. */
export function researchedToday(usage: { day: string; n: number } | undefined, today: LocalDate): number {
  return usage && usage.day === today ? usage.n : 0;
}
