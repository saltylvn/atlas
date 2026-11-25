import { describe, expect, it } from "vitest";
import { candidates, careerAgentReport, isOffStack, parsePay, paysLikeSenior, pick, tasteFrom, targetFromLabel, type RawJob } from "@/lib/domain/careerAgent";
import { payPrefs, searchCriteria, searchGoal, SEARCH_DEFAULTS } from "@/lib/domain/searchProfile";
import { TARGET_ROLES } from "@/lib/domain/targetRoles";
import type { JobMatch } from "@/lib/domain/types";
import { byTier, COMMUTE_FROM_HOME, tierOfStored, TIER_ORDER, whereFits, workplaceOf } from "@/lib/domain/workplace";
import { REMOTE_BOARDS } from "@/lib/integrations/jobFeeds";

// What Tyler is looking for (18 Nov 2026): Utah companies that are remote or hybrid first,
// then remote from anywhere in the U.S., then offices within a 45-minute drive of Salt Lake City.

const place = (location: string, text = "", remoteBoard = false) => workplaceOf(location, text, remoteBoard);

describe("Where a job is worked", () => {
  it("puts a Utah company that is remote or hybrid in the first group", () => {
    expect(place("Lehi, UT (Hybrid)")).toMatchObject({ tier: "local-flex", arrangement: "hybrid", city: "Lehi", commuteMin: 25, label: "Hybrid · Lehi, UT · ~25 min" });
    expect(place("Remote - Salt Lake City, UT")).toMatchObject({ tier: "local-flex", arrangement: "remote", city: "Salt Lake City", commuteMin: null, label: "Remote · Salt Lake City, UT" });
    expect(place("Remote (Utah)")).toMatchObject({ tier: "local-flex", arrangement: "remote", city: null, label: "Remote · Utah" });
    // A remote-only board's posting from a Utah company is remote.
    expect(place("Salt Lake City", "", true)).toMatchObject({ tier: "local-flex", arrangement: "remote" });
    // Offered both ways: hybrid is what it promises everyone.
    expect(place("Remote or Hybrid - Draper, UT")).toMatchObject({ tier: "local-flex", arrangement: "hybrid", commuteMin: 20 });
    // Hybrid in another city, remote from Utah: there is no office to drive to, so it is remote. (A real Hacker News posting.)
    expect(place("Foji | Full Stack Engineer (TypeScript/React/Node) | Atlanta (hybrid) or REMOTE (US: Utah, Central or Eastern time) | Full-time | $110K–$140K + equity")).toMatchObject({ tier: "local-flex", arrangement: "remote", city: null, label: "Remote · Utah" });
    expect(place("Hybrid - Utah")).toMatchObject({ tier: "local-flex", arrangement: "hybrid", label: "Hybrid · Utah · commute not stated" });
  });

  it("puts remote work from anywhere else in the U.S. second", () => {
    expect(place("Remote (US)")).toMatchObject({ tier: "remote", arrangement: "remote", label: "Remote · U.S." });
    expect(place("", "", true)).toMatchObject({ tier: "remote" });
    expect(place("Anywhere in the World", "", true)).toMatchObject({ tier: "remote" });
    expect(place("REMOTE US/Europe")).toMatchObject({ tier: "remote" });
    expect(place("Remote (EEA)")).toBeNull();
    expect(place("Remote - Europe only", "", true)).toBeNull();
  });

  it("puts an office inside the commute last, and says when the arrangement is not stated", () => {
    expect(place("Draper, UT (On-site)")).toMatchObject({ tier: "local-onsite", arrangement: "onsite", commuteMin: 20, label: "On-site · Draper, UT · ~20 min" });
    expect(place("South Jordan, Utah")).toMatchObject({ tier: "local-onsite", arrangement: "unstated", commuteMin: 12, label: "South Jordan, UT · ~12 min · arrangement not stated" });
    expect(place("Utah, United States")).toMatchObject({ tier: "local-onsite", arrangement: "unstated", city: null, commuteMin: null });
    // The longest name wins.
    expect(place("South Salt Lake, UT")).toMatchObject({ city: "South Salt Lake", commuteMin: 32 });
    expect(place("Greater Salt Lake City Area")).toMatchObject({ city: "Salt Lake City", commuteMin: 38 });
  });

  it("reads hybrid from the description only when it is about where you work", () => {
    expect(place("Lehi, UT", "This is a hybrid role: three days a week in the office.")).toMatchObject({ tier: "local-flex", arrangement: "hybrid" });
    expect(place("Lehi, UT", "You will be in the office 3 days a week in our office.")).toMatchObject({ arrangement: "hybrid" });
    expect(place("Lehi, UT", "Experience with hybrid cloud and hybrid search.")).toMatchObject({ tier: "local-onsite", arrangement: "unstated" });
    expect(place("Lehi, UT", "We are a remote-first team.")).toMatchObject({ tier: "local-flex", arrangement: "remote" });
    // The description never lets in a posting from somewhere you could not work.
    expect(place("Austin, TX", "This is a fully remote, hybrid role.")).toBeNull();
  });

  it("leaves out hybrid and on-site work beyond a 45-minute drive, but keeps a Utah company's remote work", () => {
    expect(SEARCH_DEFAULTS.maxCommuteMin).toBe(45);
    for (const far of ["Provo, UT (Hybrid)", "Ogden, UT", "Park City, UT (On-site)", "Logan, UT", "St. George, UT"]) expect(place(far), far).toBeNull();
    expect(place("Remote - Provo, UT")).toMatchObject({ tier: "local-flex", arrangement: "remote", city: "Provo", commuteMin: null });
    expect(place("Remote or Hybrid - Provo, UT")).toMatchObject({ tier: "local-flex", arrangement: "remote" });
    // The edge of the commute.
    expect(place("Orem, UT (Hybrid)")).toMatchObject({ commuteMin: 42 });
    expect(place("Bountiful, UT (Hybrid)")).toBeNull();
  });

  it("does not take a town of the same name in another state for yours", () => {
    for (const other of ["Sandy, OR", "Sandy Springs, GA", "Murray Hill, NJ (Hybrid)", "Highland Park, IL", "Farmington Hills, MI", "Logan Square, Chicago, IL", "Saratoga Springs, NY (On-site)"]) expect(place(other), other).toBeNull();
    expect(place("Remote - Sandy Springs, GA")).toMatchObject({ tier: "remote", city: null });
    expect(place("Sandy, UT")).toMatchObject({ tier: "local-onsite", city: "Sandy" });
    expect(place("Saratoga Springs, Utah (Hybrid)")).toMatchObject({ tier: "local-flex", city: "Saratoga Springs" });
  });

  it("stores a place as a label that reads back to the same place", () => {
    const samples: [string, string, boolean][] = [
      ["Lehi, UT (Hybrid)", "", false],
      ["Remote - Salt Lake City, UT", "", false],
      ["Remote (Utah)", "", false],
      ["Hybrid - Utah", "", false],
      ["Utah, United States", "", false],
      ["Draper, UT (On-site)", "", false],
      ["West Valley City, UT", "", false],
      ["Remote - St. George, UT", "", false],
      ["Remote (US)", "", false],
      ["", "", true],
      ["Lehi, UT", "This is a hybrid role.", false],
    ];
    for (const [location, text, board] of samples) {
      const w = workplaceOf(location, text, board)!;
      expect(w, location).not.toBeNull();
      expect(workplaceOf(w.label, "", false), w.label).toEqual(w);
      expect(tierOfStored(w.label)).toBe(w.tier);
      expect(w.label.length).toBeLessThanOrEqual(200);
    }
    // Every city in the table makes a label that reads back, in or out of the commute.
    for (const c of COMMUTE_FROM_HOME) {
      const w = workplaceOf(`Remote - ${c.name}, UT`, "", false)!;
      expect(w, c.name).toMatchObject({ tier: "local-flex", city: c.name });
      expect(workplaceOf(w.label, "", false), w.label).toEqual(w);
    }
    // A match stored before places were labeled reads as remote.
    expect(tierOfStored("")).toBe("remote");
    expect(tierOfStored("Anywhere")).toBe("remote");
  });

  it("keeps the Scout's coarser reading: remote, or a Utah company you could work for", () => {
    expect(whereFits("Remote (US)", false)).toBe("remote");
    expect(whereFits("Hybrid, Salt Lake City, UT", false)).toBe("salt-lake");
    expect(whereFits("Remote - Provo, UT", false)).toBe("salt-lake");
    expect(whereFits("Provo, UT", false)).toBeNull();
    expect(whereFits("New York, NY", false)).toBeNull();
  });
});

describe("The brief's matches, in the order you asked for", () => {
  const roles = [...TARGET_ROLES];
  const now = new Date("2026-11-18T15:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  let seq = 0;
  const job = (company: string, over: Partial<RawJob> = {}): RawJob => {
    seq++;
    return { key: `w${seq}`, source: "Acme careers", title: "Solutions Engineer", company, url: `https://x.test/${seq}`, location: "Remote (US)", text: "", postedAt: hoursAgo(5), ...over };
  };
  const prefs = { roles, ...payPrefs({}) };

  it("defaults to a $100k floor and a $120k target, and Settings can change both", () => {
    expect(payPrefs({})).toMatchObject({ minSalary: 100_000, targetSalary: 120_000, maxYears: 3 });
    expect(payPrefs({ careerMinSalary: 90_000, careerTargetSalary: 120_000, careerMaxYears: 2, careerBackground: "Ten years in operations." })).toEqual({ minSalary: 90_000, targetSalary: 120_000, maxYears: 2, background: "Ten years in operations." });
    // Zero means none; a target is never under the floor.
    expect(payPrefs({ careerMinSalary: 0, careerTargetSalary: 0 })).toMatchObject({ minSalary: 0, targetSalary: 0, maxYears: 3 });
    expect(payPrefs({ careerMinSalary: 110_000, careerTargetSalary: 100_000 }).targetSalary).toBe(110_000);
  });

  it("says the search in plain sentences, the same for every agent", () => {
    const text = searchGoal(payPrefs({}));
    for (const part of ["early-career to mid-level", "1 to 3 years of experience", "Ignore senior, staff, lead and manager roles", "4 or more years", "client-facing", "$120k", "$100k", "fully remote, then hybrid, then on-site", "Salt Lake City, UT", "45-minute drive", "collaborative"]) expect(text).toContain(part);
    expect(searchCriteria({ minSalary: 0, targetSalary: 0 }).join(" ")).not.toContain("Pay:");
    expect(searchCriteria({ minSalary: 100_000, targetSalary: 0 }).join(" ")).toContain("at least $100k");
  });

  it("ranks by place in your order when everything else is equal", () => {
    const c = candidates(
      [job("Office", { location: "Draper, UT (On-site)" }), job("Remote US"), job("Utah hybrid", { location: "Lehi, UT (Hybrid)" }), job("Utah remote", { location: "Remote - Lehi, UT" }), job("Too far", { location: "Provo, UT (On-site)" })],
      prefs,
      tasteFrom([]),
      now,
      REMOTE_BOARDS,
    );
    expect(c.map((x) => x.company)).toEqual(["Utah remote", "Utah hybrid", "Remote US", "Office"]);
    expect(c.map((x) => x.place.tier)).toEqual(["local-flex", "local-flex", "remote", "local-onsite"]);
  });

  it("ranks down a senior role under a plain title, and a specialty you do not build in", () => {
    // Pay that starts at 1.5 times your target is a senior band, whatever the title says.
    expect(paysLikeSenior(parsePay("$220k–$245k"), 100_000)).toBe(true);
    expect(paysLikeSenior(parsePay("$150k–$180k"), 100_000)).toBe(true);
    expect(paysLikeSenior(parsePay("$127k–$207k"), 100_000)).toBe(false);
    expect(paysLikeSenior(parsePay("$75/hr"), 100_000)).toBe(true);
    expect(paysLikeSenior(parsePay("$60/hr"), 100_000)).toBe(false);
    // A figure that includes variable pay says nothing about the base; no pay says nothing at all.
    expect(paysLikeSenior(parsePay("$220k - $260k OTE"), 100_000)).toBe(false);
    expect(paysLikeSenior(null, 100_000)).toBe(false);
    for (const t of ["Embedded Software Engineer – Tool Qualification", "Robotics Software Engineer", "Firmware Engineer", "Software Engineer, iOS", "Game Engine Software Engineer"]) expect(isOffStack(t), t).toBe(true);
    for (const t of ["Software Engineer", "Full Stack Engineer (TypeScript/React/Node)", "Software Engineer, AI Agents", "Solutions Engineer, Gaming Vertical"]) expect(isOffStack(t), t).toBe(false);
    const c = candidates(
      [
        job("Senior band", { title: "Solutions Architect", text: "$220k-$245k" }),
        job("Off stack", { title: "Robotics Software Engineer", text: "$100k-$130k" }),
        job("Leadership", { title: "Software Engineer (Technical Leadership)" }),
        job("Fits", { title: "Software Engineer", text: "$95k-$120k" }),
      ],
      prefs,
      tasteFrom([]),
      now,
      REMOTE_BOARDS,
    );
    // Solutions Engineer is the first role, yet its $220k posting falls below a Software Engineer one that fits.
    expect(c.map((x) => x.company)).toEqual(["Fits", "Senior band", "Off stack"]);
  });

  it("keeps seats for Utah postings so fresh remote ones cannot crowd them out", () => {
    const remote = Array.from({ length: 8 }, (_, i) => job(`Remote ${i}`, { postedAt: hoursAgo(2) }));
    const local = [job("Old Utah hybrid", { location: "Lehi, UT (Hybrid)", postedAt: hoursAgo(24 * 9) }), job("Old office", { location: "Sandy, UT", postedAt: hoursAgo(24 * 9) })];
    const c = candidates([...remote, ...local], prefs, tasteFrom([]), now, REMOTE_BOARDS);
    // By score alone the week-old Utah postings come last and miss the cut.
    expect(pick(c, 5, new Set()).every((x) => x.place.tier === "remote")).toBe(true);
    const kept = pick(c, 5, new Set(), 2);
    expect(kept).toHaveLength(5);
    expect(kept.filter((x) => x.place.tier !== "remote").map((x) => x.company)).toEqual(["Old Utah hybrid", "Old office"]);
    // With no Utah postings, every seat goes to the rest.
    expect(pick(candidates(remote, prefs, tasteFrom([]), now, REMOTE_BOARDS), 5, new Set(), 2)).toHaveLength(5);
  });

  it("shows the brief's matches in three groups: Utah remote or hybrid, remote, then offices nearby", () => {
    let n = 0;
    const match = (company: string, location: string, payText: string, score: number): JobMatch => ({ id: `m${++n}`, key: `k${n}`, title: "Solutions Engineer", company, url: "https://x.test/m", source: "Acme careers", location, role: "Solutions Engineer", payText, postedAt: null, score, shownOn: "2026-11-18", shownSlot: "morning", rating: 0, status: "new", createdAt: "" });
    const stored = [
      match("Remote A", "Remote · U.S.", "$95k–$110k", 80),
      match("Office", "On-site · Draper, UT · ~20 min", "salary not listed", 70),
      match("Utah hybrid", "Hybrid · Lehi, UT · ~25 min", "$85k–$95k", 60),
      match("Remote B", "Remote · U.S.", "$140k–$160k, includes variable pay", 50),
      match("Utah remote", "Remote · Salt Lake City, UT", "$100k–$120k", 40),
    ];
    const { section, report } = careerAgentReport({ slot: "morning", fullTime: stored, contacts: [], failedSources: [], sourceCount: 4, pendingApprovals: 0, targetSalary: 100_000 });
    // Your order of groups; best first inside each (the order they came in).
    expect(section.fullTime.map((m) => m.company)).toEqual(["Utah hybrid", "Utah remote", "Remote A", "Remote B", "Office"]);
    expect(section.fullTime.map((m) => m.tier)).toEqual(["local-flex", "local-flex", "remote", "remote", "local-onsite"]);
    expect(byTier(section.fullTime).map((g) => g.tier)).toEqual([...TIER_ORDER]);
    expect(section.fullTime.map((m) => m.target ?? "not said")).toEqual(["below", "reaches", "reaches", "not said", "not said"]);
    expect(report.headline).toBe("5 full-time matches: 2 Utah remote or hybrid, 2 remote, 1 on-site nearby.");
    expect(report.details).toContain("2 of 5 post pay that reaches your $100k target.");
    expect(report.details[0]).toBe("Solutions Engineer: Solutions Engineer at Utah hybrid ($85k–$95k, Hybrid · Lehi, UT · ~25 min, Acme careers)");
    // No matches: the headline says so, with no list of places.
    expect(careerAgentReport({ slot: "afternoon", fullTime: [], contacts: [], failedSources: [], sourceCount: 4, pendingApprovals: 0 }).report.headline).toBe("0 full-time matches new since the morning.");
  });

  it("reads a stored pay label against your target", () => {
    expect(targetFromLabel("$95k–$110k", 100_000)).toBe("reaches");
    expect(targetFromLabel("$85k–$95k", 100_000)).toBe("below");
    expect(targetFromLabel("$52/hr", 100_000)).toBe("reaches");
    expect(targetFromLabel("$140k–$160k, includes variable pay", 100_000)).toBeUndefined();
    expect(targetFromLabel("salary not listed", 100_000)).toBeUndefined();
    expect(targetFromLabel("$120k", 0)).toBeUndefined();
  });
});
