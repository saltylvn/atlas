import { describe, expect, it } from "vitest";
import { boardUrl, normalize, recruiteeHost } from "@/lib/integrations/jobBoards";
import { himalayasUrl, parseHimalayas, parseRemotive, REMOTE_BOARDS } from "@/lib/integrations/jobFeeds";
import { assertAllowed } from "@/lib/security/safeFetch";
import { JOB_SOURCES } from "@/lib/domain/jobSources";
import { suggestedUtah, UTAH_SEED } from "@/lib/domain/utahSeed";
import { JOB_BOARD_INFO, JOB_BOARDS } from "@/lib/domain/types";

// Shapes copied from each API's real response on 22 Nov 2026, with made-up jobs.

describe("Himalayas", () => {
  const data = {
    jobs: [
      {
        title: "Solutions Engineer",
        companyName: "Acme",
        applicationLink: "https://himalayas.app/companies/acme/jobs/solutions-engineer",
        guid: "https://himalayas.app/companies/acme/jobs/solutions-engineer",
        employmentType: "Full Time",
        excerpt: "Help customers <b>ship</b>.",
        minSalary: 95000,
        maxSalary: "120000",
        currency: "USD",
        salaryPeriod: "annual",
        locationRestrictions: ["United States"],
        pubDate: "1795379213",
      },
      { title: "Marketing Lead", companyName: "Peso Co", applicationLink: "https://himalayas.app/x", currency: "PHP", salaryPeriod: "annual", minSalary: "45000", locationRestrictions: [] },
      { title: "No link", companyName: "Bad", applicationLink: "javascript:alert(1)" },
    ],
  };

  it("keeps U.S. dollar yearly pay, credits Himalayas, and links to the listing", () => {
    const [job, peso, ...rest] = parseHimalayas(data);
    expect(job).toMatchObject({ source: "Himalayas", title: "Solutions Engineer", company: "Acme", location: "United States", salaryMin: 95000, salaryMax: 120000 });
    expect(job!.url).toBe("https://himalayas.app/companies/acme/jobs/solutions-engineer");
    expect(job!.postedAt).toBe(new Date(1795379213 * 1000).toISOString());
    expect(job!.text).not.toContain("<b>");
    expect(peso).toMatchObject({ location: "Worldwide", salaryMin: undefined });
    expect(rest).toEqual([]);
  });

  it("searches U.S. full-time jobs, newest first, and survives a bad payload", () => {
    expect(himalayasUrl("Solutions Engineer")).toBe("https://himalayas.app/jobs/api/search?q=Solutions%20Engineer&country=US&employment_type=Full%20Time&sort=recent");
    expect(parseHimalayas({ nope: true })).toEqual([]);
  });
});

describe("Remotive", () => {
  it("credits Remotive, keeps the job type in the text, and reads its UTC dates", () => {
    const jobs = parseRemotive({
      "0-legal-notice": "…",
      jobs: [
        { id: 2091177, url: "https://remotive.com/remote-jobs/software-dev/engineer-1", title: "Software Engineer", company_name: "Acme", job_type: "full_time", candidate_required_location: "USA", publication_date: "2026-11-19T14:58:42", description: "<p>Build</p>" },
        { id: 2, url: "https://remotive.com/remote-jobs/x", title: "Reviewer", company_name: "B", job_type: "part_time" },
      ],
    });
    expect(jobs[0]).toMatchObject({ key: "remotive:2091177", source: "Remotive", location: "USA", postedAt: "2026-11-19T14:58:42.000Z" });
    expect(jobs[0]!.text.startsWith("full time")).toBe(true);
    expect(jobs[1]!.text).toContain("part time");
  });

  it("is a remote board, like Himalayas, and both are listed as sources", () => {
    expect(REMOTE_BOARDS.has("Remotive") && REMOTE_BOARDS.has("Himalayas")).toBe(true);
    expect(JOB_SOURCES.map((s) => s.name)).toEqual(expect.arrayContaining(["Himalayas", "Remotive"]));
  });
});

describe("Three more job-board systems", () => {
  it("builds each board's public API address", () => {
    expect(boardUrl({ board: "smartrecruiters", slug: "vivint" })).toBe("https://api.smartrecruiters.com/v1/companies/vivint/postings?limit=100&country=us");
    expect(boardUrl({ board: "workable", slug: "huggingface" })).toBe("https://apply.workable.com/api/v1/widget/accounts/huggingface");
    expect(boardUrl({ board: "recruitee", slug: "bunq" })).toBe("https://bunq.recruitee.com/api/offers/");
  });

  it("reads SmartRecruiters, building the posting link it does not send", () => {
    const [j] = normalize("smartrecruiters", {
      content: [{ id: "744000163101720", name: "Software Engineer", releasedDate: "2026-11-22T20:20:21.518Z", company: { identifier: "Vivint" }, location: { fullLocation: "Provo, UT, United States", remote: false } }],
    });
    expect(j).toEqual({ id: "744000163101720", title: "Software Engineer", url: "https://jobs.smartrecruiters.com/Vivint/744000163101720", location: "Provo, UT, United States", updatedAt: "2026-11-22T20:20:21.518Z" });
  });

  it("reads Workable and marks remote jobs", () => {
    const [j] = normalize("workable", { name: "HF", jobs: [{ shortcode: "81B46579FE", title: "ML Engineer", url: "https://apply.workable.com/j/81B46579FE", city: "Paris", country: "France", telecommuting: true, published_on: "2026-05-29" }] });
    expect(j).toMatchObject({ id: "81B46579FE", location: "Paris, France · Remote", updatedAt: "2026-05-29T00:00:00.000Z" });
  });

  it("reads Recruitee's dates with a UTC suffix", () => {
    const [j] = normalize("recruitee", { offers: [{ id: 2832667, title: "Copywriter", careers_url: "https://careers.bunq.com/o/copywriter-3", location: "Amsterdam, Netherlands", remote: false, published_at: "2026-11-18 16:23:32 UTC" }] });
    expect(j).toMatchObject({ id: "2832667", updatedAt: "2026-11-18T16:23:32.000Z", location: "Amsterdam, Netherlands" });
  });

  it("returns nothing for a payload of the wrong shape", () => {
    for (const b of ["smartrecruiters", "workable", "recruitee"] as const) expect(normalize(b, { html: "<p>moved</p>" })).toEqual([]);
  });

  it("lets only a checked slug become a Recruitee host, and allows the new hosts", () => {
    expect(recruiteeHost("bunq")).toBe("bunq.recruitee.com");
    expect(recruiteeHost("evil.com/x")).toBeNull();
    expect(recruiteeHost("a.b")).toBeNull();
    for (const u of ["https://himalayas.app/jobs/api/search", "https://remotive.com/api/remote-jobs", "https://api.smartrecruiters.com/v1", "https://apply.workable.com/api"]) expect(() => assertAllowed(u)).not.toThrow();
    expect(() => assertAllowed("https://bunq.recruitee.com/api/offers/")).toThrow();
    expect(() => assertAllowed("https://bunq.recruitee.com/api/offers/", ["bunq.recruitee.com"])).not.toThrow();
  });

  it("names every board on screen", () => {
    for (const b of JOB_BOARDS) expect(JOB_BOARD_INFO[b].label.length).toBeGreaterThan(2);
  });
});

describe("Utah suggestions", () => {
  it("are all valid watches, each once", () => {
    const keys = UTAH_SEED.map((s) => `${s.board}:${s.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of UTAH_SEED) {
      expect(JOB_BOARDS).toContain(s.board);
      expect(s.slug).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
    }
  });

  it("leave out the companies you already watch", () => {
    const left = suggestedUtah([{ board: "greenhouse", slug: "qualtrics" }]);
    expect(left.some((s) => s.slug === "qualtrics")).toBe(false);
    expect(left).toHaveLength(UTAH_SEED.length - 1);
  });
});
