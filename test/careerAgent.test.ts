import { describe, expect, it } from "vitest";
import { applicationsCsv, approvalFor, companyFromMail, roleFromSubject, trackFromEmail, type JobMail } from "@/lib/domain/applications";
import { careerSnapshot, parseNext, roundOf } from "@/lib/domain/careerSnapshot";
import { jobKind } from "@/lib/domain/emailAgent";
import { candidates, displayTitle, jobType, parsePay, payFits, pick, roleFor, savedSearches, tasteFrom, whereFits, type RawJob } from "@/lib/domain/careerAgent";
import { rolesFrom, TARGET_ROLES } from "@/lib/domain/targetRoles";
import type { Application, CalendarEvent } from "@/lib/domain/types";
import { fixMojibake, parseHnThread, parseRemoteOk, parseWwr, REMOTE_BOARDS } from "@/lib/integrations/jobFeeds";

const roles = [...TARGET_ROLES];
const now = new Date("2026-11-16T15:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
const prefs = { roles, minSalary: 120_000, minRate: 50 };
let seq = 0;
const job = (title: string, over: Partial<RawJob> = {}): RawJob => {
  seq++;
  return { key: `k${seq}`, source: "Remote OK", title, company: `Co${seq}`, url: `https://x.test/${seq}`, location: "", text: "", postedAt: hoursAgo(5), ...over };
};

describe("Career Agent: your seven roles", () => {
  it("has the seven roles in your order (set in Notion)", () => {
    expect(TARGET_ROLES.map((r) => r.name)).toEqual(["AI Engineer", "AI + Automation Engineer", "AI Workflow Engineer", "Software Engineer", "Forward Deployed Engineer", "Solutions Engineer", "GTM Engineer"]);
  });

  it("maps titles to roles, specific roles before the generic Software Engineer", () => {
    const r = (t: string) => roleFor(t, roles)?.name ?? null;
    expect(r("Applied AI Engineer")).toBe("AI Engineer");
    expect(r("AI Automation Engineer")).toBe("AI + Automation Engineer");
    expect(r("Workflow Automation Engineer")).toBe("AI Workflow Engineer");
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
    expect(rolesFrom([])).toHaveLength(7);
  });
});

describe("Career Agent: location, pay and type", () => {
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

  it("rules out pay posted below your floors, and keeps listings with no pay", () => {
    expect(payFits(parsePay("$80k-$95k"), "full-time", prefs)).toBe(false);
    expect(payFits(parsePay("$90k-$120k"), "full-time", prefs)).toBe(true);
    expect(payFits(parsePay("$30/hr"), "gig", prefs)).toBe(false);
    expect(payFits(parsePay("$50/hr"), "gig", prefs)).toBe(true);
    expect(payFits(null, "full-time", prefs)).toBe(true);
  });

  it("tells contract work from full-time", () => {
    expect(jobType({ title: "AI Engineer (Contract)", text: "" })).toBe("gig");
    expect(jobType({ title: "AI Engineer", text: "Employment Type: Freelance, $70/hr" })).toBe("gig");
    expect(jobType({ title: "AI Engineer", text: "Employment Type: Full-Time" })).toBe("full-time");
    expect(jobType({ title: "Backend Engineer", text: "", typeHint: "gig" })).toBe("gig");
  });
});

describe("Career Agent: ranking and picking", () => {
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

  it("picks up to N of a type, never a match already shown, one per company first", () => {
    const c = candidates(
      [job("AI Engineer", { key: "a", company: "A" }), job("AI Engineer", { key: "b", company: "A" }), job("Software Engineer", { key: "c", company: "B" }), job("AI Engineer (Contract)", { key: "g", company: "G" })],
      prefs,
      tasteFrom([]),
      now,
      REMOTE_BOARDS,
    );
    expect(pick(c, "full-time", 2, new Set()).map((x) => x.key)).toEqual(["a", "c"]);
    expect(pick(c, "full-time", 2, new Set(["a"])).map((x) => x.key)).toEqual(["b", "c"]);
    expect(pick(c, "gig", 10, new Set()).map((x) => x.key)).toEqual(["g"]);
  });

  it("shows just the role segment of a Hacker News title", () => {
    expect(displayTitle("Founding AI Engineer | REMOTE (US) | Full-time | $160K", TARGET_ROLES[0]!)).toBe("Founding AI Engineer");
  });

  it("builds https saved searches for sites with no public feed", () => {
    const s = savedSearches(roles);
    expect(s.map((x) => x.site)).toEqual(expect.arrayContaining(["LinkedIn", "Indeed", "Glassdoor", "Upwork", "Contra"]));
    for (const x of s) expect(new URL(x.url).protocol).toBe("https:");
    expect(decodeURIComponent(s[0]!.url)).toContain('"Forward Deployed Engineer"');
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

  it("reads Hacker News threads, and only SEEKING FREELANCER posts from the freelancer thread", () => {
    const thread = {
      id: 1,
      children: [
        { id: 11, created_at: "2026-11-02T16:00:00Z", text: "Acme | AI Engineer | REMOTE (US) | $150k<p>We build agents." },
        { id: 12, created_at: "2026-11-02T16:00:00Z", text: "SEEKING WORK | Rust dev | Berlin" },
        { id: 13, created_at: "2026-11-02T16:00:00Z", text: "SEEKING FREELANCER | Beta Co | AI automation build | Remote (US) | $80/hr" },
        { id: 14, created_at: "2026-11-02T16:00:00Z", text: null },
      ],
    };
    expect(parseHnThread(thread, false).map((j) => j.company)).toEqual(["Acme", "SEEKING WORK", "Beta Co"]);
    const gigs = parseHnThread(thread, true);
    expect(gigs).toHaveLength(1);
    expect(gigs[0]).toMatchObject({ company: "Beta Co", typeHint: "gig", url: "https://news.ycombinator.com/item?id=13" });
  });
});

describe("Applications and the Approval Queue", () => {


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
    expect(changes.update).toEqual([{ id: "a1", company: "Acme", from: "applied", status: "interview", statusAt: "2026-11-12T15:00:00Z" }]);
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
