import { describe, expect, it } from "vitest";
import { keywords, names, newsAgentReport, sameStory, shownIn, type NewsAgentInput } from "@/lib/domain/newsAgent";
import type { NewsItem } from "@/lib/domain/types";
import { FEEDS, LEAN, stripPublisher } from "@/lib/integrations/news";
import { ALLOWED_HOSTS } from "@/lib/security/safeFetch";

const now = new Date("2026-11-16T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
let seq = 0;
const item = (topic: NewsItem["topic"], source: string, title: string, ageH = 1): NewsItem => {
  seq++;
  return { id: `n${seq}`, topic, source, title, url: `https://x.test/${seq}`, publishedAt: hoursAgo(ageH) };
};
const run = (items: NewsItem[], over: Partial<NewsAgentInput> = {}) =>
  newsAgentReport({ slot: "morning", now, items, failedFeeds: [], feedCount: FEEDS.length, lean: LEAN, shown: { urls: new Set(), titles: [] }, ...over });
const area = (r: ReturnType<typeof run>, a: string) => r.stories.filter((s) => s.area === a);

describe("News bot: the same story across outlets", () => {
  it("matches differently worded headlines about one story, and not unrelated ones", () => {
    const a = keywords("Senate passes stopgap funding bill to avert shutdown");
    expect(sameStory(a, keywords("Senate approves stopgap bill, averting government shutdown"))).toBe(true);
    expect(sameStory(a, keywords("Fed holds interest rates steady as inflation cools"))).toBe(false);
  });

  it("ranks stories several outlets cover first, shows a center outlet's headline, and names the others", () => {
    const r = run([
      item("politics", "Fox News", "Senate approves stopgap bill, averting government shutdown", 3),
      item("politics", "Reuters", "Senate passes stopgap funding bill to avert shutdown", 4),
      item("politics", "The Hill", "Stopgap funding bill clears Senate, shutdown averted", 2),
      item("politics", "Washington Examiner", "Governor signs state budget into law", 0.5),
    ]);
    const top = area(r, "politics")[0]!;
    expect(top).toMatchObject({ source: "Reuters", title: "Senate passes stopgap funding bill to avert shutdown" });
    expect(top.alsoIn?.sort()).toEqual(["Fox News", "The Hill"]);
    expect(area(r, "politics")).toHaveLength(2);
  });
});

describe("News bot: balance and variety", () => {
  it("keeps politics to at most two of three from one side when the other side has stories", () => {
    const r = run([
      item("politics", "Reuters", "Alpha budget talks resume tuesday"),
      item("politics", "AP", "Bravo tariff ruling appealed court"),
      item("politics", "The Hill", "Charlie primary results certified state"),
      item("politics", "Reuters", "Delta caucus elects whip leader"),
      item("politics", "Fox News", "Echo border funding package unveiled", 8),
    ]);
    const picked = area(r, "politics");
    expect(picked).toHaveLength(3);
    expect(picked.filter((s) => LEAN[s.source] === "conservative")).toHaveLength(1);
  });

  it("prefers distinct outlets, but still fills every slot when few outlets report", () => {
    const verge = ["Phone maker unveils foldable lineup", "Browser update blocks tracking cookies", "Console sales slump holiday quarter"].map((t, n) => item("tech", "The Verge", t, n + 1));
    const r1 = run([...verge, item("tech", "Ars Technica", "Kernel patch lands mainline release", 5)]);
    expect(area(r1, "tech").map((s) => s.source)).toContain("Ars Technica");
    expect(area(run(verge), "tech")).toHaveLength(3);
  });

  it("puts Claude and Anthropic first in tech, then other AI, and gives Anthropic's own posts a few days", () => {
    const r = run([
      item("tech", "Ars Technica", "New laptop chips benchmarked thoroughly", 1),
      item("ai", "Anthropic", "Introducing Claude features developers asked", 60),
      item("ai", "TechCrunch", "Startup raises funding agentic coding tools", 2),
      item("tech", "The Verge", "Streaming service raises subscription prices", 1),
    ]);
    expect(area(r, "tech").map((s) => s.source)).toEqual(["Anthropic", "TechCrunch", "Ars Technica"]);
  });

  it("never shows one story in two areas", () => {
    const r = run([
      item("tech", "TechCrunch", "Jensen Huang resigns as Nvidia chief executive", 1),
      item("politics", "AP", "What we know after Jensen Huang resigns as Nvidia CEO", 2),
      item("politics", "Reuters", "Senate passes stopgap funding bill to avert shutdown", 3),
    ]);
    expect(area(r, "tech").map((s) => s.source)).toEqual(["TechCrunch"]);
    expect(area(r, "politics").map((s) => s.source)).toEqual(["Reuters"]);
    // Worded differently enough to miss the same-story match, but naming the same person.
    const r2 = run([
      item("tech", "TechCrunch", "The unfolding Jensen Huang scandal: a timeline", 1),
      item("politics", "AP", "What we know after Jensen Huang resigns as Nvidia CEO", 2),
      item("politics", "Fox News", "Supreme Court hears tariff challenge arguments", 3),
    ]);
    expect(area(r2, "politics").map((s) => s.source)).toEqual(["Fox News"]);
  });

  it("finds multi-word names, ignoring common places and institutions", () => {
    // A headline's first word may not be part of the name, so the rest counts too.
    expect([...names("Chris Van Hollen challenges Schumer at the White House")]).toEqual(["chris van hollen", "van hollen"]);
    expect([...names("What Sam Altman told senators")]).toContain("sam altman");
  });

  it("drops stories older than a day and a half", () => {
    const r = run([item("world", "Reuters", "Summit ends without agreement leaders", 50), item("world", "AP", "Earthquake strikes coastal region overnight", 3)]);
    expect(area(r, "world").map((s) => s.source)).toEqual(["AP"]);
  });
});

describe("News bot: brief rhythm and failures", () => {
  const day = [
    item("politics", "Reuters", "Senate passes stopgap funding bill to avert shutdown"),
    item("politics", "AP", "Supreme Court hears tariff challenge arguments"),
    item("world", "Reuters", "Ceasefire talks resume in Cairo mediators"),
  ];

  it("shows only new stories at 2:00 PM, even when another outlet reruns a morning story", () => {
    const morning = run(day);
    const later = [...day, item("politics", "Fox News", "Senate approves stopgap bill, averting government shutdown"), item("politics", "The Hill", "House panel subpoenas agency records")];
    const afternoon = run(later, { slot: "afternoon", shown: shownIn([{ news: morning.stories }]) });
    expect(afternoon.stories.map((s) => s.source)).toEqual(["The Hill"]);
    expect(afternoon.report.headline).toContain("new since the morning");
    expect(afternoon.report.details.join(" ")).toContain("World: 0 of 3 new since the morning");
  });

  it("keeps Saturday to one story per area", () => {
    const r = run([...day, item("tech", "The Verge", "Phone maker unveils foldable lineup")], { slot: "saturday" });
    expect(r.stories.map((s) => s.area)).toEqual(["tech", "politics", "world"]);
  });

  it("names failed feeds, and flags a run where every feed failed", () => {
    const some = run(day, { failedFeeds: ["Fox News (world)"] });
    expect(some.allFailed).toBe(false);
    expect(some.report.errors).toEqual(["1 news feed failed: Fox News (world)"]);
    const none = run([], { failedFeeds: FEEDS.map((f) => f.source), feedCount: FEEDS.length });
    expect(none.allFailed).toBe(true);
    expect(none.report.errors[0]).toContain("Every news feed failed");
  });

  it("reads what earlier briefs showed, including briefs saved before step 3", () => {
    const shown = shownIn([{ news: [{ topic: "ai", title: "Old headline", url: "https://x.test/old", source: "TechCrunch" }] }, null, { news: "bad" }]);
    expect([...shown.urls]).toEqual(["https://x.test/old"]);
    expect(shown.titles).toEqual(["Old headline"]);
  });
});

describe("News feeds", () => {
  it("fetches only https feeds on the allowlist, from the plan's sources", () => {
    for (const f of FEEDS) {
      const u = new URL(f.url);
      expect(u.protocol).toBe("https:");
      expect(ALLOWED_HOSTS.has(u.hostname)).toBe(true);
    }
    const sources = new Set(FEEDS.map((f) => f.source));
    for (const s of ["Anthropic", "TechCrunch", "The Verge", "Ars Technica", "Reuters", "AP", "The Hill", "Wall Street Journal", "Fox News", "Washington Examiner", "The Dispatch"]) {
      expect(sources.has(s)).toBe(true);
    }
    expect(new Set(FEEDS.map((f) => f.topic))).toEqual(new Set(["ai", "tech", "politics", "world"]));
  });

  it("strips Google News's publisher suffix", () => {
    expect(stripPublisher("Germany's Merz asks for 'no surprises' from talks - Reuters")).toBe("Germany's Merz asks for 'no surprises' from talks");
    expect(stripPublisher("Founders’ letter - Anthropic")).toBe("Founders’ letter");
    expect(stripPublisher("Rate cut debate - live updates - AP News")).toBe("Rate cut debate - live updates");
    expect(stripPublisher("- Anthropic")).toBe("");
    expect(stripPublisher("No suffix here")).toBe("No suffix here");
  });
});
