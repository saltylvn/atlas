import { describe, expect, it } from "vitest";
import { applicationsCsv, approvalFor, companyFromMail, roleFromSubject, trackFromEmail, type JobMail } from "@/lib/domain/applications";
import { careerSnapshot, parseNext, roundOf } from "@/lib/domain/careerSnapshot";
import { jobKind } from "@/lib/domain/emailAgent";
import { candidates, displayTitle, isFullTime, isSenior, notFullTimeCount, parsePay, payFits, payLabel, pick, roleFor, savedSearches, seniorCount, tasteFrom, titleLevel, whereFits, wrongLevel, type RawJob } from "@/lib/domain/careerAgent";
import { BUILT_IN_ROLES, MAIN_ROLES, optionNames, canonicalRole, candidatesBeyond, MAX_ROLES, moveRole, roleNames, rolesFrom, TARGET_ROLES } from "@/lib/domain/targetRoles";
import type { Application, CalendarEvent } from "@/lib/domain/types";
import { fixMojibake, parseHnThread, parseRemoteOk, parseWwr, REMOTE_BOARDS } from "@/lib/integrations/jobFeeds";

const roles = [...TARGET_ROLES];
const now = new Date("2026-11-16T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const prefs = { roles, minSalary: 120_000 };
let seq = 0;
const job = (title: string, over: Partial<RawJob> = {}): RawJob => {
  seq++;
  return { key: `k${seq}`, source: "Remote OK", title, company: `Co${seq}`, url: `https://x.test/${seq}`, location: "", text: "", postedAt: hoursAgo(5), ...over };
};

describe("Applications bot: your five roles", () => {
  it("has the five roles in your order (set in Atlas)", () => {
    expect(TARGET_ROLES.map((r) => r.name)).toEqual(["Solutions Engineer", "AI Engineer", "Forward Deployed Engineer", "Software Engineer", "AI Automation Engineer"]);
    expect(TARGET_ROLES).toHaveLength(5);
    expect(MAX_ROLES).toBe(7);
  });

  it("folds every other title into one of the five", () => {
    const r = (t: string) => roleFor(t, roles)?.name ?? null;
    expect(r("Implementation Engineer")).toBe("Solutions Engineer");
    expect(r("Customer Success Engineer")).toBe("Solutions Engineer");
    expect(r("Generative AI Developer")).toBe("AI Engineer");
    expect(r("AI Consultant")).toBe("AI Engineer");
    expect(r("Customer Engineer")).toBe("Forward Deployed Engineer");
    expect(r("Field Engineer, AI")).toBe("Forward Deployed Engineer");
    expect(r("Embedded Software Engineer")).toBe("Software Engineer");
    expect(r("Engineer - Embedded")).toBe("Software Engineer");
    expect(r("Developer Advocate")).toBe("Software Engineer");
    expect(r("GTM Engineer")).toBe("AI Automation Engineer");
    expect(r("AI Workflow Engineer")).toBe("AI Automation Engineer");
    expect(r("n8n Developer")).toBe("AI Automation Engineer");
  });

  it("maps old role names onto today's, and caps your list at seven", () => {
    expect(canonicalRole("AI + Automation Engineer")).toBe("AI Automation Engineer");
    expect(canonicalRole("AI Workflow Engineer (uses AI Engineer)")).toBe("AI Workflow Engineer");
    expect(canonicalRole("gtm engineer")).toBe("AI Automation Engineer");
    expect(canonicalRole("Robotics Engineer")).toBe("Robotics Engineer");
    expect(roleNames(["GTM Engineer", "AI + Automation Engineer", "Solutions Engineer"])).toEqual(["AI Automation Engineer", "Solutions Engineer"]);
    expect(roleNames(["A Role", "B Role", "C Role", "D Role", "E Role", "F Role", "G Role", "H Role"])).toHaveLength(7);
    expect(moveRole(["A", "B", "C"], "C", -1)).toEqual(["A", "C", "B"]);
    expect(moveRole(["A", "B"], "A", -1)).toEqual(["A", "B"]);
  });

  it("counts Integration Engineer as Solutions Engineer, and leaves AI Integration Engineer with AI Engineer", () => {
    const r = (t: string) => roleFor(t, roles)?.name ?? null;
    expect(r("Integration Engineer")).toBe("Solutions Engineer");
    expect(r("Integrations Engineer II")).toBe("Solutions Engineer");
    expect(r("API Integration Engineer")).toBe("Solutions Engineer");
    expect(r("AI Solutions Engineer")).toBe("Solutions Engineer");
    // The longer phrase wins, whatever the order of the roles.
    expect(r("AI Integration Engineer")).toBe("AI Engineer");
  });

  it("maps titles to roles, specific roles before the generic Software Engineer", () => {
    const r = (t: string) => roleFor(t, roles)?.name ?? null;
    expect(r("Applied AI Engineer")).toBe("AI Engineer");
    expect(r("AI Automation Engineer")).toBe("AI Automation Engineer");
    expect(r("Workflow Automation Engineer")).toBe("AI Automation Engineer");
    expect(r("Forward-Deployed Product Engineer")).toBe("Forward Deployed Engineer");
    expect(r("Forward Deployed Software Engineer")).toBe("Forward Deployed Engineer");
    expect(r("Senior Solutions Architect")).toBe("Solutions Engineer");
    expect(r("Full Stack Engineer (TypeScript)")).toBe("Software Engineer");
  });

  it("skips roles above mid level and ones that are not a fit", () => {
    for (const t of ["Staff Software Engineer", "Principal AI Engineer", "Engineering Manager", "Head of Solutions Engineering", "QA Automation Engineer", "Software Engineer Intern", "AI Engineer Lead"]) {
      expect(roleFor(t, roles)).toBeNull();
    }
  });

  it("reads your roles from Settings, including FDE and roles that are not built in", () => {
    expect(rolesFrom(["FDE", "AI Engineer"]).map((r) => r.name)).toEqual(["Forward Deployed Engineer", "AI Engineer"]);
    expect(rolesFrom(["Robotics Engineer"])[0]).toEqual({ name: "Robotics Engineer", titles: ["robotics engineer"] });
    // A candidate role you add to your list brings its own title phrases.
    expect(rolesFrom(["Data Engineer"])[0]!.titles).toContain("analytics engineer");
    expect(rolesFrom([])).toHaveLength(5);
  });

  it("offers only your seven roles on Target Roles, in your order", () => {
    expect(BUILT_IN_ROLES.map((r) => r.name)).toEqual(["Software Engineer 1", "AI Automation Engineer", "AI Workflow Engineer", "Agentic Software Engineer", "AI Solutions Engineer", "AI Forward Deployed Engineer", "AI Project Manager"]);
    expect(canonicalRole("AI Automation Engineering")).toBe("AI Automation Engineer");
    expect(canonicalRole("AI Forward Deployed Engineering")).toBe("AI Forward Deployed Engineer");
    expect(canonicalRole("Data Engineering")).toBe("Data Engineer");
    expect(MAIN_ROLES).toEqual(BUILT_IN_ROLES.map((r) => r.name));
    for (const n of MAIN_ROLES) expect(canonicalRole(n.toLowerCase())).toBe(n);
    expect(canonicalRole("Agentic Engineer")).toBe("Agentic Software Engineer");
    expect(roleNames(MAIN_ROLES)).toEqual([...MAIN_ROLES]);
    // Options are not candidates: the Scout watches them only when they are on your list.
    expect(candidatesBeyond([...TARGET_ROLES]).map((r) => r.name)).not.toContain("Agentic Software Engineer");
  });

  it("saves only the seven, mapping an older role onto the one it folded into", () => {
    expect(optionNames(["Solutions Engineer", "AI Engineer", "Forward Deployed Engineer", "Software Engineer", "AI Automation Engineer"])).toEqual(["AI Solutions Engineer", "Software Engineer 1", "AI Forward Deployed Engineer", "AI Automation Engineer"]);
    expect(optionNames(["Data Engineer", "Robotics Engineer"])).toEqual([]);
    expect(optionNames(["agentic engineer", "AI Workflow Engineer", "AI Workflow Engineer"])).toEqual(["Agentic Software Engineer", "AI Workflow Engineer"]);
  });

  it("folds every title you hunt for into one of your seven", () => {
    const mine = rolesFrom(MAIN_ROLES);
    const r = (t: string) => roleFor(t, mine)?.name ?? null;
    expect(r("Business Automation Engineer")).toBe("AI Automation Engineer");
    expect(r("AI Integration Developer")).toBe("AI Automation Engineer");
    expect(r("GTM Engineer")).toBe("AI Automation Engineer");
    expect(r("AI Workflow Engineer")).toBe("AI Workflow Engineer");
    expect(r("Workflow Automation Engineer")).toBe("AI Workflow Engineer");
    expect(r("Agent Engineer")).toBe("Agentic Software Engineer");
    expect(r("Agentic Software Engineer")).toBe("Agentic Software Engineer");
    expect(r("Applied AI Engineer")).toBe("Software Engineer 1");
    expect(r("LLM Engineer")).toBe("Software Engineer 1");
    expect(r("Developer, AI Solutions")).toBe("AI Solutions Engineer");
    expect(r("Integration Engineer")).toBe("AI Solutions Engineer");
    expect(r("Forward Deployed Engineer")).toBe("AI Forward Deployed Engineer");
    expect(r("Customer Engineer")).toBe("AI Forward Deployed Engineer");
    expect(r("Implementation Engineer")).toBe("AI Solutions Engineer");
  });

  it("Software Engineer 1: any Software Engineer title, except workflow, automation and solutions work (23 Nov 2026)", () => {
    const mine = rolesFrom(MAIN_ROLES);
    const r = (t: string) => roleFor(t, mine)?.name ?? null;
    expect(r("Software Engineer")).toBe("Software Engineer 1");
    expect(r("Software Engineer I")).toBe("Software Engineer 1");
    expect(r("Software Engineer II, Payments")).toBe("Software Engineer 1");
    expect(r("Backend Software Engineer")).toBe("Software Engineer 1");
    expect(r("AI Software Engineer")).toBe("Software Engineer 1");
    // Other roles' own titles still win.
    expect(r("Agentic Software Engineer")).toBe("Agentic Software Engineer");
    expect(r("Forward Deployed Software Engineer")).toBe("AI Forward Deployed Engineer");
    // Excluded words: never this role.
    expect(r("Workflow Software Engineer")).not.toBe("Software Engineer 1");
    expect(r("Software Engineer, Automation")).not.toBe("Software Engineer 1");
    expect(r("Solutions Software Engineer")).not.toBe("Software Engineer 1");
    // Staff and lead titles stay out, as for every role (a senior one is handled by the level rule).
    expect(r("Staff Software Engineer")).toBeNull();
  });

  it("a list saved with the old name, and the renamed Notion row, read as Software Engineer 1", () => {
    expect(rolesFrom(["AI Software Engineer"]).map((x) => x.name)).toEqual(["Software Engineer 1"]);
    expect(rolesFrom(["AI Software Engineering"]).map((x) => x.name)).toEqual(["Software Engineer 1"]);
    expect(optionNames(["AI Software Engineer"])).toEqual(["Software Engineer 1"]);
  });

  it("keeps AI project and program manager titles, and still skips people managers", () => {
    const mine = rolesFrom(MAIN_ROLES);
    const r = (t: string) => roleFor(t, mine)?.name ?? null;
    expect(r("AI Project Manager")).toBe("AI Project Manager");
    expect(r("AI Program Manager")).toBe("AI Project Manager");
    expect(wrongLevel("AI Project Manager")).toBe(false);
    expect(wrongLevel("Senior AI Project Manager")).toBe(true);
    expect(wrongLevel("Engineering Manager")).toBe(true);
    expect(r("Project Manager Lead, AI")).toBeNull();
  });

});

describe("Applications bot: location, pay and type", () => {
  it("keeps remote roles open to the U.S. and Salt Lake County roles", () => {
    expect(whereFits("Remote (US)", false)).toBe("remote");
    expect(whereFits("Hybrid, Salt Lake City, UT", false)).toBe("salt-lake");
    expect(whereFits("Lehi, Utah", false)).toBe("salt-lake");
    expect(whereFits("", true)).toBe("remote");
    expect(whereFits("Anywhere in the World", true)).toBe("remote");
    expect(whereFits("Remote (EEA)", false)).toBeNull();
    expect(whereFits("Remote - Europe only", true)).toBeNull();
    expect(whereFits("San Francisco, CA (onsite)", false)).toBeNull();
    expect(whereFits("REMOTE US/Europe", false)).toBe("remote");
  });

  it("reads posted pay, and never mistakes funding or discounts for pay", () => {
    expect(parsePay("$120k - $150k")).toMatchObject({ min: 120_000, max: 150_000, unit: "year", text: "$120k–$150k" });
    expect(parsePay("Salary Range: $95,000 – $155,000 per year")).toMatchObject({ min: 95_000, max: 155_000, unit: "year" });
    expect(parsePay("$120-150k + equity")).toMatchObject({ min: 120_000, max: 150_000 });
    expect(parsePay("$60/hr")).toMatchObject({ min: 60, max: 60, unit: "hour", text: "$60/hr" });
    expect(parsePay("$50-100 per hour")).toMatchObject({ min: 50, max: 100, unit: "hour" });
    expect(parsePay("We just raised a $1M seed round")).toBeNull();
    expect(parsePay("Get $100 off your first order")).toBeNull();
    expect(parsePay("no pay listed")).toBeNull();
    expect(parsePay("", { min: 140_000, max: 180_000 })).toMatchObject({ text: "$140k–$180k" });
  });

  it("rules out pay posted below your floor, and keeps listings with no pay", () => {
    expect(payFits(parsePay("$80k-$95k"), prefs)).toBe(false);
    expect(payFits(parsePay("$90k-$120k"), prefs)).toBe(true);
    // Pay posted by the hour is compared as a full-time year: $120k is about $57.69 an hour.
    expect(payFits(parsePay("$50/hr"), prefs)).toBe(false);
    expect(payFits(parsePay("$60/hr"), prefs)).toBe(true);
    expect(payFits(null, prefs)).toBe(true);
  });

  it("tells base pay from a figure that includes variable pay", () => {
    // A figure with nothing said about it is left as it is.
    expect(parsePay("$120k - $150k")!.basis).toBeUndefined();
    expect(parsePay("$120k + equity")!.basis).toBeUndefined();
    expect(parsePay("Salary: $120,000 - $150,000 per year. Bonus eligible.")!.basis).toBeUndefined();
    // The posting says the figure is the base, or that variable pay comes on top of it.
    expect(parsePay("Base salary: $95,000 – $110,000 plus commission")).toMatchObject({ min: 95_000, max: 110_000, basis: "base", text: "$95k–$110k base" });
    expect(parsePay("$125k base")).toMatchObject({ max: 125_000, basis: "base" });
    expect(parsePay("$125,000 plus annual bonus")).toMatchObject({ max: 125_000, basis: "base" });
    expect(parsePay("$60/hr + commission")).toMatchObject({ unit: "hour", basis: "base", text: "$60/hr base" });
    // The figure includes variable pay and no base is given.
    expect(parsePay("$140k - $160k OTE")).toMatchObject({ max: 160_000, basis: "variable", text: "$140k–$160k, includes variable pay" });
    expect(parsePay("On-target earnings (OTE) of $150k–$180k")).toMatchObject({ basis: "variable" });
    expect(parsePay("Total compensation: $150k–$190k")).toMatchObject({ basis: "variable" });
    expect(parsePay("$130k including bonus")).toMatchObject({ basis: "variable" });
    // It includes variable pay, and the base is stated too: the base is the figure.
    expect(parsePay("OTE $140k ($95k base)")).toMatchObject({ min: 95_000, max: 95_000, basis: "base", text: "$95k base" });
    expect(parsePay("OTE: $160,000 (base salary of $125,000)")).toMatchObject({ max: 125_000, basis: "base" });
    // The words belong to the figure they sit next to.
    expect(parsePay("$95k base, OTE $140k")).toMatchObject({ max: 95_000, basis: "base" });
    expect(parsePay("Base: $90k–$105k; OTE: $130k–$150k")).toMatchObject({ max: 105_000, basis: "base" });
    expect(parsePay("$120k-$150k, OTE $180k")!.basis).toBeUndefined();
    // "remote" holds the letters of "ote" and is not a pay word.
    expect(parsePay("$120k-$150k remote")!.basis).toBeUndefined();
    // Feed fields carry no words, so no basis.
    expect(parsePay("OTE", { min: 140_000, max: 180_000 })!.basis).toBeUndefined();
    // Every label fits the column it is stored in.
    for (const t of ["$1,000,000 - $2,000,000 OTE", "$100/hr - $200/hr including commission", "Base salary: $195,000 – $210,000"]) expect(parsePay(t)!.text.length).toBeLessThanOrEqual(40);
  });

  it("checks your floor against the base, not the OTE", () => {
    expect(payFits(parsePay("OTE $140k ($95k base)"), prefs)).toBe(false);
    expect(payFits(parsePay("OTE $160k ($125k base)"), prefs)).toBe(true);
    // With no base given, a figure that includes variable pay cannot rule a posting out unless even it is under the floor.
    expect(payFits(parsePay("$140k - $160k OTE"), prefs)).toBe(true);
    expect(payFits(parsePay("$90k - $110k OTE"), prefs)).toBe(false);
  });

  it("reads the level in a title", () => {
    for (const t of ["Software Engineer I", "Software Engineer 1", "Solutions Architect I", "Engineer, Level 1", "Software Engineer L1", "New Grad Software Engineer"]) expect(titleLevel(t)).toBe("early");
    // Junior and associate are the aim (23 Nov 2026): level II is mid, neither up nor down.
    for (const t of ["Solutions Engineer II", "Software Engineer 2", "Integration Engineer (II)", "Engineer, Level 2", "Solutions Engineer L2"]) expect(titleLevel(t)).toBe("mid");
    // Junior and Associate are the level you are looking for.
    for (const t of ["Associate Solutions Engineer", "Junior Software Engineer", "Jr. Integration Engineer", "Entry-Level AI Engineer", "Early Career Software Engineer"]) expect(titleLevel(t)).toBe("early");
    for (const t of ["Integration Specialist", "Solutions Engineering Specialist II"]) expect(titleLevel(t)).toBe("low");
    for (const t of ["Software Engineer III", "Solutions Engineer IV", "Engineer, Level 3"]) expect(titleLevel(t)).toBe("upper");
    for (const t of ["Solutions Engineer", "Senior Solutions Engineer", "AI Engineer", "Engineer 2025 cohort"]) expect(titleLevel(t)).toBeNull();
  });

  it("knows a senior title, which is one of your roles but not a match", () => {
    for (const t of ["Senior Solutions Engineer", "Sr. Software Engineer", "Sr Integration Engineer", "Software Engineer, Senior"]) expect(isSenior(t)).toBe(true);
    for (const t of ["Solutions Engineer", "Solutions Engineer II", "Associate Solutions Engineer", "Seniority Systems Engineer"]) expect(isSenior(t)).toBe(false);
    // Still one of your roles: the Scout records it and an application to it is tracked.
    expect(roleFor("Senior Solutions Engineer", roles)?.name).toBe("Solutions Engineer");
  });

  it("labels pay for a match, and says when an Associate or Specialist title posts none", () => {
    expect(payLabel("Solutions Engineer", null)).toBe("salary not listed");
    expect(payLabel("Associate Solutions Engineer", null)).toBe("salary not listed · Associate title");
    expect(payLabel("Solutions Engineering Specialist", null)).toBe("salary not listed · Specialist title");
    expect(payLabel("Junior Software Engineer", null)).toBe("salary not listed · Junior title");
    expect(payLabel("Associate Solutions Engineer", parsePay("$120k-$140k"))).toBe("$120k–$140k");
    expect(payLabel("Solutions Engineer", parsePay("$140k - $160k OTE"))).toBe("$140k–$160k, includes variable pay");
    expect(payLabel("Associate Solutions Engineer", null).length).toBeLessThanOrEqual(40);
  });

  it("tells contract, freelance and part-time work from a full-time role", () => {
    expect(isFullTime({ title: "AI Engineer (Contract)", text: "" })).toBe(false);
    expect(isFullTime({ title: "AI Engineer", text: "Employment Type: Freelance, $70/hr" })).toBe(false);
    expect(isFullTime({ title: "Automation Developer, part-time", text: "" })).toBe(false);
    expect(isFullTime({ title: "AI Engineer", text: "Employment Type: Full-Time" })).toBe(true);
    expect(isFullTime({ title: "AI Engineer", text: "" })).toBe(true);
    // It says full-time, and only the description mentions a contract: a full-time role.
    expect(isFullTime({ title: "Solutions Engineer", text: "Full-time. You will review each customer contract." })).toBe(true);
    // The title says contract, so it is one, whatever the description says.
    expect(isFullTime({ title: "Solutions Engineer (Contract)", text: "Full-time hours for six months." })).toBe(false);
  });
});

describe("Applications bot: ranking and picking", () => {
  it("drops misfits and ranks fresher postings first", () => {
    const c = candidates(
      [
        job("AI Engineer", { postedAt: hoursAgo(100), company: "Old" }),
        job("AI Engineer", { postedAt: hoursAgo(3), company: "Fresh" }),
        job("Marketing Manager"),
        job("AI Engineer", { text: "$60k-$80k", company: "Low pay" }),
        job("AI Engineer", { source: "HN Who's Hiring", location: "ONSITE | Austin, TX", company: "Onsite" }),
        job("AI Engineer", { postedAt: hoursAgo(24 * 40), company: "Stale" }),
      ],
      prefs,
      tasteFrom([]),
      now,
      REMOTE_BOARDS,
    );
    expect(c.map((x) => x.company)).toEqual(["Fresh", "Old"]);
  });

  it("lets your thumbs steer the ranking", () => {
    const raws = [job("Software Engineer", { company: "Liked Co" }), job("Software Engineer", { company: "Disliked Co" })];
    const base = candidates(raws, prefs, tasteFrom([]), now, REMOTE_BOARDS);
    const steered = candidates(raws, prefs, tasteFrom([{ role: "Software Engineer", company: "Disliked Co", source: "Remote OK", rating: -1 }, { role: "Software Engineer", company: "Liked Co", source: "Remote OK", rating: 1 }]), now, REMOTE_BOARDS);
    expect(steered[0]!.company).toBe("Liked Co");
    expect(steered[0]!.score).toBeGreaterThan(base.find((x) => x.company === "Liked Co")!.score);
  });

  it("leaves contract postings out, and picks up to N, never a match already shown, one per company first", () => {
    const raws = [job("Solutions Engineer", { key: "a", company: "A" }), job("Solutions Engineer", { key: "b", company: "A" }), job("Software Engineer", { key: "c", company: "B" }), job("AI Engineer (Contract)", { key: "g", company: "G" })];
    const c = candidates(raws, prefs, tasteFrom([]), now, REMOTE_BOARDS);
    expect(c.map((x) => x.key)).not.toContain("g");
    expect(notFullTimeCount(raws, roles)).toBe(1);
    expect(pick(c, 2, new Set()).map((x) => x.key)).toEqual(["a", "c"]);
    expect(pick(c, 2, new Set(["a"])).map((x) => x.key)).toEqual(["b", "c"]);
    expect(pick(c, 10, new Set())).toHaveLength(3);
  });

  it("ranks your first role first and the level you are looking for up, and leaves senior titles out", () => {
    const order = (raws: RawJob[]) => candidates(raws, prefs, tasteFrom([]), now, REMOTE_BOARDS).map((x) => x.company);
    // Same age, same place: the role order decides.
    expect(order([job("AI Engineer", { company: "AI" }), job("Software Engineer", { company: "SWE" }), job("Solutions Engineer", { company: "SE" }), job("GTM Engineer", { company: "GTM" })])).toEqual(["SE", "AI", "SWE", "GTM"]);
    // Within one role, the level decides: level I first, then a plain title and level II.
    // A senior or level III title is above your level and not a match at all (lib/domain/levelPolicy.ts).
    expect(order([job("Solutions Engineer III", { company: "Three" }), job("Solutions Engineer", { company: "Plain" }), job("Solutions Engineer II", { company: "Two" }), job("Solutions Engineer I", { company: "One" }), job("Senior Solutions Engineer", { company: "Senior" }), job("Sr. Solutions Engineer", { company: "Sr" })])).toEqual(["One", "Plain", "Two"]);
    // Junior and Associate titles are the level you asked for: above a plain title.
    expect(order([job("Solutions Engineer", { company: "Plain" }), job("Associate Solutions Engineer", { company: "Associate" }), job("Junior Solutions Engineer", { company: "Junior" })])).toEqual(["Associate", "Junior", "Plain"]);
    expect(seniorCount([job("Senior Solutions Engineer"), job("Sr. AI Engineer"), job("Solutions Engineer"), job("Senior AI Engineer (Contract)"), job("Senior Accountant")], roles)).toBe(2);
    // A Specialist title usually pays less: with no base posted it ranks lower. A posted salary speaks for itself.
    const withPay = candidates([job("Integration Engineer Specialist", { company: "Paid", text: "$125k-$140k" }), job("Integration Engineer Specialist", { company: "Unlisted" })], prefs, tasteFrom([]), now, REMOTE_BOARDS);
    expect(withPay.map((x) => x.company)).toEqual(["Paid", "Unlisted"]);
    expect(withPay[0]!.score - withPay[1]!.score).toBe(16);
    // Pay that reaches the figure you are aiming at ranks above pay that only clears your floor.
    const aim = { roles, minSalary: 85_000, targetSalary: 100_000 };
    const byPay = candidates([job("Solutions Engineer", { company: "Under", text: "$85k-$95k" }), job("Solutions Engineer", { company: "Reaches", text: "$90k-$105k" }), job("Solutions Engineer", { company: "Too low", text: "$70k-$80k" }), job("Solutions Engineer", { company: "Unlisted" })], aim, tasteFrom([]), now, REMOTE_BOARDS);
    expect(byPay.map((x) => x.company)).toEqual(["Reaches", "Under", "Unlisted"]);
    expect(byPay[0]!.score - byPay[1]!.score).toBe(4);
    // A figure that includes variable pay counts for less than a base figure.
    const basis = candidates([job("Solutions Engineer", { company: "OTE", text: "$140k - $160k OTE" }), job("Solutions Engineer", { company: "Base", text: "$125k base" })], prefs, tasteFrom([]), now, REMOTE_BOARDS);
    expect(basis.map((x) => x.company)).toEqual(["Base", "OTE"]);
    // An OTE that clears your floor over a base that does not: the posting is out.
    expect(order([job("Solutions Engineer", { company: "Low base", text: "OTE $140k ($95k base)" })])).toEqual([]);
  });

  it("shows just the role segment of a Hacker News title", () => {
    expect(displayTitle("Founding AI Engineer | REMOTE (US) | Full-time | $160K", roles.find((r) => r.name === "AI Engineer")!)).toBe("Founding AI Engineer");
  });

  it("builds https saved searches for sites with no public feed", () => {
    const s = savedSearches(roles);
    expect(s.map((x) => x.site)).toEqual(expect.arrayContaining(["LinkedIn", "Indeed", "Glassdoor"]));
    // Full-time roles only: no freelance marketplaces.
    for (const gone of ["Upwork", "Contra"]) expect(s.map((x) => x.site)).not.toContain(gone);
    for (const x of s) expect(new URL(x.url).protocol).toBe("https:");
    expect(decodeURIComponent(s[0]!.url)).toContain('"Forward Deployed Engineer"');
    // The jobs no public feed carries: hybrid and on-site near home.
    const local = s.filter((x) => /Salt Lake|Salt Lake City/.test(x.site));
    expect(local.map((x) => x.site)).toEqual(["LinkedIn · Salt Lake area", "Indeed · near Salt Lake City"]);
    expect(new URL(local[0]!.url).searchParams.get("location")).toBe("Salt Lake City Metropolitan Area");
    expect(new URL(local[1]!.url).searchParams.get("l")).toBe("Salt Lake City, UT");
  });
});

describe("Job feeds", () => {
  it("reads Remote OK, skipping its legal notice row and repairing garbled text", () => {
    const jobs = parseRemoteOk([
      { legal: "API Terms of Service" },
      { id: 7, date: "2026-11-16T10:00:00+00:00", company: "Acme", position: "Senior Software Engineer â\u0080\u0094 Platform", location: "", salary_min: 150000, salary_max: 190000, url: "https://remoteok.com/remote-jobs/7", tags: ["full time"] },
      { id: 8, position: "No link" },
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ key: "remoteok:7", title: "Senior Software Engineer — Platform", salaryMin: 150000 });
    expect(fixMojibake("plain text")).toBe("plain text");
  });

  it("reads We Work Remotely RSS as company and title", () => {
    const xml = `<rss><channel><item><title>Acme: AI Engineer</title><region>Anywhere in the World</region><description>&lt;p&gt;Employment Type: Contract&lt;/p&gt;</description><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate><link>https://weworkremotely.com/remote-jobs/acme-ai</link></item></channel></rss>`;
    expect(parseWwr(xml)[0]).toMatchObject({ company: "Acme", title: "AI Engineer", location: "Anywhere in the World", source: "We Work Remotely" });
    expect(parseWwr("<not xml")).toEqual([]);
  });

  it("reads the Hacker News hiring thread, one posting per top-level comment", () => {
    const thread = {
      id: 1,
      children: [
        { id: 11, created_at: "2026-11-02T16:00:00Z", text: "Acme | AI Engineer | REMOTE (US) | $150k<p>We build agents." },
        { id: 12, created_at: "2026-11-02T16:00:00Z", text: "SEEKING WORK | Rust dev | Berlin" },
        { id: 14, created_at: "2026-11-02T16:00:00Z", text: null },
      ],
    };
    const jobs = parseHnThread(thread);
    expect(jobs.map((j) => j.company)).toEqual(["Acme", "SEEKING WORK"]);
    expect(jobs[0]).toMatchObject({ company: "Acme", source: "HN Who's Hiring", url: "https://news.ycombinator.com/item?id=11" });
  });
});

describe("Applications and the apply queues", () => {


  it("puts the referral and the resume to use in the approval", () => {
    const { title, detail } = approvalFor({ id: "m", title: "AI Engineer", company: "Acme", url: "https://x", source: "Remote OK", role: "AI Engineer", payText: "$150k", location: "", postedAt: null }, "Dana");
    expect(title).toBe("AI Engineer at Acme");
    expect(detail).toContain("Referral: you know Dana");
    expect(detail).toContain("AI Engineer resume");
  });

  it("exports CSV that a spreadsheet will not run as formulas", () => {
    const app = { company: "=HYPERLINK(\"evil\")", role: "AI, Engineer", type: "full-time", targetRole: "", status: "applied", appliedOn: "2026-11-16", statusAt: "2026-11-16T00:00:00Z", payText: "", source: "", url: "", notes: "" } as unknown as Application;
    const csv = applicationsCsv([app]).split("\r\n")[1]!;
    expect(csv.startsWith(`"'=HYPERLINK(""evil"")"`)).toBe(true);
    expect(csv).toContain('"AI, Engineer"');
  });

});

describe("Logging applications from email", () => {
  const mail = (subject: string, fromName: string, fromEmail: string, kind: JobMail["kind"], at: string, id = subject): JobMail => ({ messageId: id, subject, fromName, fromEmail, kind, receivedAt: at });
  const base = (over: Partial<Application>): Application =>
    ({ id: "a1", company: "Acme", role: "AI Engineer", type: "full-time", targetRole: "", source: "Email", url: "", payText: "", tier: "semi", status: "applied", appliedOn: "2026-11-01", statusAt: "2026-11-01T12:00:00Z", notes: "", origin: "atlas", externalId: "email:x", createdAt: "2026-11-01T12:00:00Z", ...over }) as Application;

  it("reads the company and role from typical confirmation emails", () => {
    expect(companyFromMail({ subject: "Thank you for applying to Acme!", fromName: "Acme Recruiting", fromEmail: "no-reply@greenhouse.io" })).toBe("Acme");
    expect(companyFromMail({ subject: "Your application for AI Engineer at Northwind Labs", fromName: "Workday", fromEmail: "x@myworkday.com" })).toBe("Northwind Labs");
    expect(companyFromMail({ subject: "We received your application", fromName: "Halcyon AI Talent Team", fromEmail: "talent@halcyon.ai" })).toBe("Halcyon AI");
    expect(companyFromMail({ subject: "Application received", fromName: "no-reply", fromEmail: "jobs@bluebird.health" })).toBe("Bluebird");
    expect(roleFromSubject("Your application for AI Engineer at Northwind Labs")).toBe("AI Engineer");
    expect(roleFromSubject("Thank you for applying for the Forward Deployed Engineer role")).toBe("Forward Deployed Engineer");
    expect(roleFromSubject("Thank you for applying to Acme!")).toBe("");
  });

  it("handles the subject shapes that tripped it up", () => {
    // Sender shown as the hiring system's domain; company is in the subject.
    expect(companyFromMail({ subject: "We received your 3-60 Systems application", fromName: "greenhouse-mail.io", fromEmail: "no-reply@us.greenhouse-mail.io" })).toBe("3-60 Systems");
    expect(jobKind({ subject: "We received your 3-60 Systems application", fromEmail: "no-reply@us.greenhouse-mail.io", category: "noise" })).toBe("confirmation");
    // A survey from a hiring system shows you applied; it is not a reply.
    expect(jobKind({ subject: "Demographic Survey", fromEmail: "no-reply@greenhouse.io", category: "noise" })).toBe("confirmation");
    expect(companyFromMail({ subject: "We Got It: Thanks for applying to Ledgerline!", fromName: "Ledgerline", fromEmail: "x@ledgerline.com" })).toBe("Ledgerline");
    expect(companyFromMail({ subject: "Thanks for Applying to Meridian Field Systems, Inc.!", fromName: "MFS", fromEmail: "x@mfs.com" })).toBe("Meridian Field Systems");
    expect(companyFromMail({ subject: "Application Received", fromName: "greenhouse-mail.io", fromEmail: "no-reply@greenhouse-mail.io" })).toBe("");
    // No role in the email: the board says so instead of repeating the subject.
    const [c] = trackFromEmail([mail("Thank you for applying to Brightcall!", "Brightcall", "x@brightcall.com", "confirmation", "2026-11-11T15:00:00Z", "t")], []).create;
    expect(c).toMatchObject({ company: "Brightcall", role: "Role not listed", notes: "From email: Thank you for applying to Brightcall!" });
  });

  it("logs a confirmation as Applied, once", () => {
    const m = mail("Your application for AI Engineer at Acme", "Acme Recruiting", "no-reply@greenhouse.io", "confirmation", "2026-11-10T15:00:00Z", "m1");
    const first = trackFromEmail([m], [], (t) => roleFor(t, roles)?.name ?? "");
    expect(first.create).toHaveLength(1);
    expect(first.create[0]).toMatchObject({ company: "Acme", role: "AI Engineer", targetRole: "AI Engineer", status: "applied", appliedOn: "2026-11-10", source: "Email", externalId: "email:m1" });
    const stored = [base({ company: "Acme", externalId: "email:m1", statusAt: "2026-11-10T15:00:00Z" })];
    expect(trackFromEmail([m], stored)).toEqual({ create: [], update: [] });
  });

  it("moves applications forward only, and never reopens a rejection", () => {
    const apps = [base({ id: "a1", company: "Acme", status: "applied" }), base({ id: "a2", company: "Beta Co", status: "rejected", externalId: "email:y" })];
    const changes = trackFromEmail(
      [
        mail("Interview availability for AI Engineer", "Acme Recruiting", "talent@acme.com", "interview", "2026-11-12T15:00:00Z", "i1"),
        mail("Update on your application", "Acme", "no-reply@lever.co", "reply", "2026-11-13T15:00:00Z", "r1"),
        mail("Interview with Beta Co", "Beta Co", "hr@betaco.com", "interview", "2026-11-12T15:00:00Z", "b1"),
      ],
      apps,
    );
    expect(changes.update).toEqual([{ id: "a1", company: "Acme", from: "applied", status: "interview", stage: "interview", statusAt: "2026-11-12T15:00:00Z" }]);
    expect(changes.create).toEqual([]);
  });

  it("logs an interview invite from a company with no confirmation, but never recruiter outreach", () => {
    const changes = trackFromEmail(
      [
        mail("Interview invitation: Solutions Engineer at Cobalt Systems", "Cobalt Systems", "people@cobalt.io", "interview", "2026-11-12T15:00:00Z", "c1"),
        mail("Exciting Solutions Architect opportunity", "Jane at TalentCo", "jane@talentco.com", "recruiter", "2026-11-12T15:00:00Z", "t1"),
      ],
      [],
    );
    expect(changes.create.map((c) => [c.company, c.status])).toEqual([["Cobalt Systems", "interview"]]);
  });

  it("applies a rejection to an open application", () => {
    const changes = trackFromEmail([mail("Update on your application at Acme", "Acme", "no-reply@greenhouse.io", "rejection", "2026-11-14T15:00:00Z", "x1")], [base({ status: "replied" })]);
    expect(changes.update[0]).toMatchObject({ status: "rejected" });
  });
});

describe("Career snapshot (Atlas's own tracker)", () => {
  const app = (over: Partial<Application>): Application =>
    ({ id: "a1", company: "Northwind Labs", role: "Solutions Engineer", type: "full-time", targetRole: "", source: "Email", url: "https://x.test/j", payText: "", tier: "semi", status: "interview", appliedOn: "2026-11-01", statusAt: "2026-11-10T12:00:00Z", notes: "Next: Prep demo (by 2026-11-18)", origin: "atlas", externalId: "", createdAt: "2026-11-01T12:00:00Z", ...over }) as Application;
  const ev = (title: string, start = "2026-11-18T17:00:00Z", over: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: title, title, start, end: "2026-11-18T18:00:00Z", allDay: false, location: "", source: "calendar", ...over });

  it("turns calendar interviews into tracked interviews linked to the application", () => {
    const snap = careerSnapshot([app({})], [ev("Northwind Labs - Round 2", undefined, { location: "https://meet.test/n" }), ev("Team standup"), ev("Interview with Zeta Corp")], now)!;
    expect(snap.interviews.map((i) => [i.company, i.round, i.applicationId])).toEqual([
      ["Northwind Labs", "Interview 2", "a1"],
      ["Zeta Corp", "Interview", ""],
    ]);
    expect(snap.interviews[0]!.meetingLink).toBe("https://meet.test/n");
    expect(snap.applications[0]).toMatchObject({ stage: "Interview 2", nextAction: "Prep demo", nextActionDue: "2026-11-18", postingUrl: "https://x.test/j" });
  });

  it("maps board statuses to stages and is empty with nothing to track", () => {
    const snap = careerSnapshot([app({ status: "applied" }), app({ id: "a2", status: "replied" }), app({ id: "a3", status: "saved" })], [], now)!;
    expect(snap.applications.map((a) => a.stage)).toEqual(["Applied", "Reply", "Draft"]);
    expect(careerSnapshot([], [ev("Team standup")], now)).toBeNull();
    expect(roundOf("Final round: Acme")).toBe("Final round");
    expect(parseNext("no next step here")).toEqual({ nextAction: "", nextActionDue: "" });
  });
});

describe("Applications bot: a brief's Good fits list (one list since 23 Nov 2026)", () => {
  const board = (n: number) => job("Solutions Engineer", { company: `Board Co ${n}`, url: `https://job-boards.greenhouse.io/board${n}/jobs/${1000 + n}` });
  const site = (n: number) => job("Solutions Engineer", { company: `Feed Co ${n}`, url: `https://jobicy.com/jobs/${n}` });
  const ranked = (jobs: ReturnType<typeof job>[]) => candidates(jobs, prefs, tasteFrom([]), now, REMOTE_BOARDS);

  it("picks from every source alike, never repeats a job, and a second run only tops the list up", () => {
    const cands = ranked([...Array.from({ length: 12 }, (_, n) => site(n)), ...Array.from({ length: 8 }, (_, n) => board(n))]);
    const first = pick(cands, 10, new Set());
    expect(first).toHaveLength(10);
    const second = pick(cands, 10, new Set(first.map((c) => c.key)));
    expect(second.some((c) => first.includes(c))).toBe(false);
    expect(pick(cands, 0, new Set())).toEqual([]);
  });
});

describe("Applications bot: titles above your level", () => {
  it("does not offer a Staff+ or Principal+ title", () => {
    const out = candidates([job("Staff+ Software Engineer, Deployment"), job("Principal+ Software Engineer"), job("Software Engineer")], prefs, tasteFrom([]), now, REMOTE_BOARDS);
    expect(out.map((c) => c.title)).toEqual(["Software Engineer"]);
  });
});

describe("Applications bot: the board scan keeps seats for roles at your level", () => {
  it("knows a title above your level, or not your kind of role, before the scan's cap", async () => {
    const { wrongLevel } = await import("@/lib/domain/careerAgent");
    for (const t of ["Senior Software Engineer, Backend", "Staff Software Engineer", "Staff+ Software Engineer", "Sr. Solutions Engineer", "Engineering Manager", "Software Engineering Intern", "Technical Recruiter"]) expect(wrongLevel(t), t).toBe(true);
    for (const t of ["Software Engineer II, Backend", "Solutions Engineer", "Forward Deployed Engineer", "Software Engineer I (Remote Eligible)"]) expect(wrongLevel(t), t).toBe(false);
  });
});

