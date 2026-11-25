import { describe, expect, it } from "vitest";
import { recordTechMarket } from "@/lib/agents/scout";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { RawJob } from "@/lib/domain/careerAgent";
import { dailySummary, familyOf, fingerprint, mergeTech, modeOf, observeTech, regionOf, seniorityOf, yearlyPay, type TechPosting } from "@/lib/domain/techMarket";

const REMOTE = new Set(["Remote OK", "Himalayas"]);
let n = 0;
const raw = (over: Partial<RawJob> & Pick<RawJob, "title">): RawJob => ({ key: `k${n++}`, source: "Acme careers", company: "Acme", url: `https://acme.com/jobs/${n}`, location: "Lehi, UT", text: "full time", postedAt: null, ...over });

describe("Role families: what kind of tech job a title is", () => {
  it.each([
    ["Software Engineer", "software"],
    ["Senior Backend Developer (Go)", "software"],
    ["Machine Learning Engineer", "ai-ml"],
    ["Data Engineer II", "data"],
    ["Site Reliability Engineer", "devops-cloud"],
    ["Application Security Engineer", "security"],
    ["Solutions Engineer", "solutions"],
    ["Forward Deployed Engineer", "solutions"],
    ["AI Project Manager", "product"],
    ["IT Support Specialist", "it-support"],
  ])("%s is %s", (title, family) => expect(familyOf(title)).toBe(family));

  it.each(["Mechanical Engineer", "Account Executive", "Registered Nurse", "Office Manager"])("%s is not tech", (title) => expect(familyOf(title)).toBeNull());

  // Cases from the live audit of 700 board titles on 22 Nov 2026.
  it.each([
    ["Director of Engineering, Payments", "software"],
    ["Network Operations Engineer", "devops-cloud"],
    ["Front End Developer - Marketing", "software"],
    ["Data Science Internship", "data"],
    ["Director of Product Management, Inventory Management", "product"],
    ["Software Engineer ( AI, Python & AWS )", "software"],
    ["Staff AI Software Engineer", "ai-ml"],
    ["Senior ML - GenAI Engineer, Voice & Speech", "ai-ml"],
    ["Principal Technical Customer Manager - FSI", "solutions"],
    ["Business Systems Analyst- Zuora Administrator", "it-support"],
  ])("audit: %s is %s", (title, family) => expect(familyOf(title)).toBe(family));

  it.each(["Regional Vice President Product Sales (AI)", "AI Customer Success Manager - SMB", "Sales Consultant - AI Software Sales", "Technical Recruiter", "Customer Support Specialist - Tier 1", "Product Marketing Manager"])(
    "audit: %s is not tech",
    (title) => expect(familyOf(title)).toBeNull(),
  );
});

describe("Seniority: the level a title states", () => {
  it.each([
    ["Software Engineering Intern", "intern"],
    ["Junior Developer", "junior"],
    ["Software Engineer I", "junior"],
    ["Data Engineer II", "mid"],
    ["Sr. Software Engineer", "senior"],
    ["Staff Engineer", "staff+"],
    ["Engineering Manager, Platform", "manager"],
    ["Director of Engineering", "manager"],
    ["Senior Manager, Solutions Engineering", "manager"],
    ["Manager, Legal Solutions Engineering", "manager"],
    ["Software Engineer", "unstated"],
  ])("%s is %s", (title, level) => expect(seniorityOf(title)).toBe(level));

  it("does not call a product manager a people manager", () => expect(seniorityOf("Product Manager")).toBe("unstated"));
});

describe("Place, work mode and pay", () => {
  it("reads Utah, the U.S. and abroad", () => {
    expect(regionOf("Lehi, UT", false)).toBe("utah");
    expect(regionOf("Salt Lake City, Utah", false)).toBe("utah");
    expect(regionOf("Austin, TX", false)).toBe("us");
    expect(regionOf("Remote - United States", false)).toBe("us");
    expect(regionOf("Berlin, Germany", false)).toBeNull();
    expect(regionOf("", true)).toBe("us");
    expect(regionOf("", false)).toBe("unstated");
  });

  it("reads remote, hybrid and on-site", () => {
    expect(modeOf("Remote", "", false)).toBe("remote");
    expect(modeOf("Lehi, UT (Hybrid)", "", false)).toBe("hybrid");
    expect(modeOf("Lehi, UT", "", true)).toBe("remote");
    expect(modeOf("Lehi, UT", "", false)).toBe("unstated");
  });

  it("states pay a year, turns hourly into yearly, and throws out what is not believable", () => {
    expect(yearlyPay({ title: "Engineer", text: "", salaryMin: 120000, salaryMax: 150000 })).toEqual({ min: 120000, max: 150000 });
    expect(yearlyPay({ title: "IT Support", text: "Pay: $25 - $30 per hour" })).toEqual({ min: 52000, max: 62400 });
    expect(yearlyPay({ title: "Engineer", text: "", salaryMin: 5000, salaryMax: 6000 })).toBeNull();
    expect(yearlyPay({ title: "Engineer", text: "great team" })).toBeNull();
  });
});

describe("Duplicates across sources", () => {
  it("treats the same company, title and region as one job, whatever the board", () => {
    expect(fingerprint("Acme, Inc.", "Software Engineer (Remote)", "us", "a")).toBe(fingerprint("ACME", "Software Engineer", "us", "b"));
    expect(fingerprint("Acme", "Software Engineer", "utah", "a")).not.toBe(fingerprint("Acme", "Software Engineer", "us", "a"));
    expect(fingerprint("", "Software Engineer", "us", "a")).not.toBe(fingerprint("", "Software Engineer", "us", "b"));
  });

  it("merges a job two sources list, keeps both sources, and counts the run's quality", () => {
    const { rows, quality } = observeTech(
      [
        raw({ title: "Software Engineer", source: "Acme careers", location: "Remote, US" }),
        raw({ title: "Software Engineer", source: "Remote OK", company: "Acme Inc", location: "", salaryMin: 130000, salaryMax: 150000 }),
        raw({ title: "Mechanical Engineer" }),
        raw({ title: "Data Engineer", location: "London, UK" }),
        raw({ title: "Contract React Developer", text: "6 month contract" }),
        raw({ title: "Sr Data Engineer", url: "http://insecure.example/x" }),
      ],
      REMOTE,
      "2026-11-22",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ family: "software", region: "us", sources: ["Acme careers", "Remote OK"], payMin: 130000 });
    expect(quality).toMatchObject({ read: 6, notTech: 1, outsideUs: 1, notFullTime: 1, tech: 2, duplicates: 1, recorded: 1, withPay: 1 });
    expect(quality.sources.find((s) => s.source === "Company boards")).toMatchObject({ read: 5, tech: 1 });
  });

  it("stops at the row cap and says so", () => {
    const { rows, quality } = observeTech([raw({ title: "Software Engineer" }), raw({ title: "Data Engineer" })], REMOTE, "2026-11-22", 1);
    expect(rows).toHaveLength(1);
    expect(quality.capped).toBe(true);
  });

  it("keeps the earliest first-seen day and every source when merging with what is stored", () => {
    const stored = { firstSeen: "2026-11-01", sources: ["Remote OK"], payMin: 100000, payMax: 120000 } as TechPosting;
    const today = { firstSeen: "2026-11-22", lastSeen: "2026-11-22", sources: ["Himalayas"], payMin: null, payMax: null } as TechPosting;
    expect(mergeTech(stored, today)).toMatchObject({ firstSeen: "2026-11-01", lastSeen: "2026-11-22", sources: ["Remote OK", "Himalayas"], payMin: 100000 });
  });
});

describe("Daily summary", () => {
  const p = (over: Partial<TechPosting>): TechPosting => ({ fingerprint: `f${n++}`, title: "Software Engineer", company: "Acme", family: "software", seniority: "unstated", mode: "remote", region: "us", payMin: null, payMax: null, skills: [], sources: ["Remote OK"], url: "https://x.com", postedAt: null, firstSeen: "2026-11-01", lastSeen: "2026-11-22", ...over });

  it("counts active, new and gone postings, the remote share and the median pay", () => {
    const rows = dailySummary(
      [
        p({ firstSeen: "2026-11-22", payMin: 100000, payMax: 120000 }),
        p({ lastSeen: "2026-11-16", payMin: 140000, payMax: 160000, mode: "onsite" }),
        p({ lastSeen: "2026-11-15" }),
        p({ lastSeen: "2026-11-10" }),
        p({ family: "data", seniority: "senior", region: "utah" }),
      ],
      "2026-11-22",
    );
    const sw = rows.find((r) => r.family === "software")!;
    expect(sw).toMatchObject({ active: 2, added: 1, gone: 1, remote: 1, withPay: 2, payMedian: 130000 });
    expect(rows.find((r) => r.family === "data")).toMatchObject({ seniority: "senior", region: "utah", active: 1, payMedian: null });
  });
});

describe("Recording the tech market", () => {
  it("records, summarizes and keeps quality, and a second run the same day changes nothing", async () => {
    const store = createMemoryStore(seedState(new Date("2026-11-22T16:00:00Z")));
    const raws = [raw({ title: "Software Engineer", company: "Zed", key: "z1" }), raw({ title: "Data Engineer", company: "Zed", key: "z2", salaryMin: 120000, salaryMax: 140000 })];
    const first = await recordTechMarket(store, raws, "2026-11-22");
    expect(first).toMatchObject({ added: 2, pruned: 0 });
    const summary = (await store.techMarket.daily("2026-11-22")).filter((r) => r.day === "2026-11-22");
    const again = await recordTechMarket(store, raws, "2026-11-22");
    expect(again.added).toBe(0);
    expect((await store.techMarket.daily("2026-11-22")).filter((r) => r.day === "2026-11-22")).toEqual(summary);
    expect(summary.reduce((s, r) => s + r.active, 0)).toBe(2);
    expect((await store.techMarket.quality("2026-11-22"))[0]).toMatchObject({ recorded: 2, withPay: 1 });
  });

  it("removes postings not seen for 60 days", async () => {
    const store = createMemoryStore(seedState(new Date("2026-11-22T16:00:00Z")));
    await recordTechMarket(store, [raw({ title: "Software Engineer", company: "Old" })], "2026-09-01");
    const later = await recordTechMarket(store, [], "2026-11-22");
    expect(later.pruned).toBe(1);
    expect(await store.techMarket.since("2000-01-01")).toEqual([]);
  });
});
