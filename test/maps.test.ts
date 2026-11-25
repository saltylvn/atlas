import { describe, expect, it } from "vitest";
import { dataMap, REPLAY } from "@/lib/domain/dataMap";
import { ALL_UTAH, jobMaps, project, STATE_TILES, WASATCH_FRONT } from "@/lib/domain/jobMap";
import { statesOf, utahCityOf } from "@/lib/domain/places";
import { pipelineView } from "@/lib/domain/pipelineView";
import { observeTech, type TechPosting } from "@/lib/domain/techMarket";

describe("Places a posting names", () => {
  it.each([
    ["Lehi, UT", "Lehi"],
    ["South Salt Lake, Utah", "South Salt Lake"],
    ["Salt Lake City, UT (Hybrid)", "Salt Lake City"],
    ["SLC", "Salt Lake City"],
    ["St George, Utah", "St. George"],
    ["Remote", null],
  ])("%s is in %s", (loc, city) => expect(utahCityOf(loc)).toBe(city));

  it("reads states by name and code, and does not take words for codes", () => {
    expect(statesOf("Austin, TX")).toEqual(["TX"]);
    expect(statesOf("Remote (CA, NY, WA)")).toEqual(["CA", "NY", "WA"]);
    expect(statesOf("Remote - West Virginia")).toEqual(["WV"]);
    expect(statesOf("Washington, DC")).toEqual(["DC"]);
    expect(statesOf("Work IN the office OR remote")).toEqual([]);
    expect(statesOf("Remote, United States")).toEqual([]);
  });

  it("records a remote job open across the U.S. with no states, even when it lists offices", () => {
    const { rows } = observeTech(
      [
        { key: "a", source: "Acme careers", title: "Software Engineer", company: "Acme", url: "https://x.com/a", location: "San Francisco, CA; New York, NY; Remote - US", text: "full time remote", postedAt: null },
        { key: "b", source: "Beta careers", title: "Data Engineer", company: "Beta", url: "https://x.com/b", location: "Remote (CA, WA)", text: "full time", postedAt: null },
        { key: "c", source: "Gamma careers", title: "Security Engineer", company: "Gamma", url: "https://x.com/c", location: "Lehi, UT", text: "full time", postedAt: null },
      ],
      new Set(),
      "2026-11-23",
    );
    expect(rows.find((r) => r.company === "Acme")).toMatchObject({ mode: "remote", states: [] });
    expect(rows.find((r) => r.company === "Beta")).toMatchObject({ mode: "remote", states: ["CA", "WA"] });
    expect(rows.find((r) => r.company === "Gamma")).toMatchObject({ region: "utah", city: "Lehi", states: ["UT"] });
  });
});

const p = (over: Partial<TechPosting>): TechPosting => ({ fingerprint: Math.random().toString(), title: "Engineer", company: "Acme", family: "software", seniority: "unstated", mode: "onsite", region: "utah", payMin: null, payMax: null, skills: [], sources: ["x"], url: "https://x.com", postedAt: null, firstSeen: "2026-11-20", lastSeen: "2026-11-23", ...over });

describe("The two job maps", () => {
  it("pins local Utah jobs at their city, lists the ones with none, and leaves remote jobs off it", () => {
    const m = jobMaps([p({ city: "Lehi" }), p({ city: "Lehi" }), p({ city: "Provo", mode: "hybrid" }), p({ city: null }), p({ mode: "remote", city: "Lehi" }), p({ region: "us", city: null })], "2026-11-23");
    expect(m.utah.pins.map((x) => [x.city, x.jobs.length])).toEqual([
      ["Lehi", 2],
      ["Provo", 1],
    ]);
    expect(m.utah.noCity).toHaveLength(1);
    expect(m.utah.total).toBe(4);
  });

  it("puts a remote job in each state it is limited to, and one open anywhere apart", () => {
    const m = jobMaps([p({ mode: "remote", region: "us", states: ["CA", "WA"] }), p({ mode: "remote", region: "us", states: [] }), p({ mode: "remote", region: "us", states: ["XX"] })], "2026-11-23");
    expect(Object.keys(m.remote.byState).sort()).toEqual(["CA", "WA"]);
    expect(m.remote.anywhere).toHaveLength(2);
    expect(m.remote.total).toBe(3);
  });

  it("leaves out postings not seen this week", () => expect(jobMaps([p({ city: "Lehi", lastSeen: "2026-11-01" })], "2026-11-23").utah.total).toBe(0));

  it("draws Utah with true proportions, and has a tile for every state and DC", () => {
    const { height, at } = project(ALL_UTAH, 400);
    expect(height).toBeGreaterThan(400);
    const [x, y] = at(-111.891, 40.7608);
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(0);
    expect(WASATCH_FRONT.north).toBeLessThan(ALL_UTAH.north);
    expect(Object.keys(STATE_TILES)).toHaveLength(51);
    expect(new Set(Object.values(STATE_TILES).map((t) => t.join(","))).size).toBe(51);
  });
});

describe("The Data Map", () => {
  const view = pipelineView({
    quality: { day: "2026-11-23", read: 3000, notTech: 1200, notFullTime: 10, outsideUs: 300, tech: 1490, duplicates: 90, recorded: 1400, withPay: 700, withSkills: 900, levelStated: 500, capped: false, sources: [{ source: "Company boards", read: 2500, tech: 1200, withPay: 600 }, { source: "Remote OK", read: 500, tech: 290, withPay: 100 }] },
    size: { postings: 1600, days: 14 },
    today: "2026-11-23",
    yourPostings: 250,
    reportDay: null,
  });

  it("draws every source, the Scout, the stages, the tables and the pages, with flows from the run", () => {
    const m = dataMap({ view, sourcesOff: ["Jobicy"], benchmarks: { points: 120, latest: "2026-09-01", fred: false }, historyDays: 14 });
    const ids = m.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["scout", "filter", "dedupe", "tech_postings", "market_daily", "market_postings", "market_benchmarks", "market", "mission", "src:Company boards", "src:Adzuna"]));
    expect(m.edges.find((e) => e.id === "src:Company boards>scout")!.flow).toBe(2500);
    expect(m.edges.find((e) => e.id === "filter>dedupe")!.flow).toBe(1490);
    expect(m.maxFlow).toBe(3000);
    expect(m.nodes.find((n) => n.id === "src:Jobicy")!.state).toBe("off");
    expect(m.edges.some((e) => e.from === "src:Jobicy")).toBe(false);
    expect(m.nodes.find((n) => n.id === "src:Adzuna")!.state).toBe("idle");
  });

  it("replays the Scout's stages in order, every box one the map has", () => {
    const ids = new Set(dataMap({ view, sourcesOff: [], benchmarks: { points: 0, latest: null, fred: false }, historyDays: 0 }).nodes.map((n) => n.id));
    for (const r of REPLAY) if (r.nodes !== "sources") for (const n of r.nodes) expect(ids.has(n)).toBe(true);
  });
});
