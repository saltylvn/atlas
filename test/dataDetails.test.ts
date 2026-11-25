import { describe, expect, it } from "vitest";
import { firstRunToday } from "@/lib/agents/scout";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { parseBls, summarize } from "@/lib/domain/benchmarks";
import { localDate } from "@/lib/domain/dates";
import { mergeTech, observeTech, type TechPosting } from "@/lib/domain/techMarket";
import { boardUrl, detailUrl, normalize, plainText } from "@/lib/integrations/jobBoards";
import { HN_SEARCH, pickHiringThread } from "@/lib/integrations/jobFeeds";
import type { Context } from "@/lib/context";

// Shapes copied from each board's real response on 22 Nov 2026, with made-up jobs.

describe("Job-board details: skills and pay from the description, never the text itself", () => {
  it("reads Greenhouse's escaped HTML for skills and pay", () => {
    const [j] = normalize("greenhouse", {
      jobs: [{ id: 1, title: "Software Engineer", absolute_url: "https://x.com/1", content: "&lt;p&gt;We use Python and AWS.&lt;/p&gt;&lt;p&gt;Pay: $140,000 - $180,000 per year&lt;/p&gt;" }],
    });
    expect(j).toMatchObject({ payMin: 140000, payMax: 180000 });
    expect(j!.skills).toEqual(expect.arrayContaining(["Python", "AWS"]));
    expect(JSON.stringify(j)).not.toContain("We use");
  });

  it("reads Lever's pay range (yearly or hourly) and its work mode and job type", () => {
    const [a, b] = normalize("lever", [
      { id: "a", text: "Data Engineer", hostedUrl: "https://x.com/a", categories: { location: "Lehi, UT", commitment: "Full-time" }, workplaceType: "hybrid", salaryRange: { min: 120000, max: 150000, currency: "USD", interval: "per-year-salary" }, descriptionPlain: "SQL and dbt" },
      { id: "b", text: "IT Support", hostedUrl: "https://x.com/b", categories: { commitment: "Part-time" }, salaryRange: { min: 25, max: 30, currency: "USD", interval: "per-hour-wage" } },
    ]);
    expect(a).toMatchObject({ payMin: 120000, payMax: 150000, hint: "hybrid Full-time" });
    expect(a!.skills).toContain("SQL");
    expect(b).toMatchObject({ payMin: 52000, payMax: 62400, hint: "Part-time" });
  });

  it("reads Ashby's salary component and ignores equity", () => {
    const [j] = normalize("ashby", {
      jobs: [
        {
          id: "x",
          title: "Solutions Engineer",
          jobUrl: "https://x.com/x",
          workplaceType: "Remote",
          employmentType: "FullTime",
          descriptionPlain: "Customer demos and APIs",
          compensation: { summaryComponents: [{ compensationType: "EquityCashValue", interval: "1 YEAR", currencyCode: "USD", minValue: null, maxValue: null }, { compensationType: "Salary", interval: "1 YEAR", currencyCode: "USD", minValue: 240000, maxValue: 320000 }] },
        },
      ],
    });
    expect(j).toMatchObject({ payMin: 240000, payMax: 320000, hint: "Remote FullTime" });
  });

  it("asks Greenhouse for descriptions only on the daily read, and Ashby for pay every time", () => {
    expect(detailUrl({ board: "greenhouse", slug: "vercel" }, true)).toBe("https://boards-api.greenhouse.io/v1/boards/vercel/jobs?content=true");
    expect(detailUrl({ board: "greenhouse", slug: "vercel" }, false)).toBe("https://boards-api.greenhouse.io/v1/boards/vercel/jobs");
    expect(boardUrl({ board: "ashby", slug: "linear" })).toContain("includeCompensation=true");
  });

  it("decodes HTML to plain text", () => expect(plainText("&lt;p&gt;Tom &amp;amp; Co&lt;/p&gt;&lt;br/&gt;hi")).toBe("Tom &amp; Co hi"));

  it("carries a board's skills and pay into the market record", () => {
    const { rows } = observeTech([{ key: "g:1", source: "Acme careers", title: "Data Engineer", company: "Acme", url: "https://x.com/1", location: "Remote, US", text: "Full-time", postedAt: null, salaryMin: 130000, salaryMax: 150000, skills: ["dbt", "SQL"] }], new Set(), "2026-11-23");
    expect(rows[0]).toMatchObject({ payMin: 130000, skills: ["dbt", "SQL"] });
  });

  it("keeps the morning's pay and skills when a later read has titles only", () => {
    const stored = { firstSeen: "2026-11-20", sources: ["Acme careers"], payMin: 130000, payMax: 150000, skills: ["SQL"] } as TechPosting;
    const later = { firstSeen: "2026-11-23", lastSeen: "2026-11-23", sources: ["Acme careers"], payMin: null, payMax: null, skills: [] as string[] } as TechPosting;
    expect(mergeTech(stored, later)).toMatchObject({ payMin: 130000, skills: ["SQL"], lastSeen: "2026-11-23" });
  });

  it("reads details on the first Scout run of the day only", async () => {
    const store = createMemoryStore(seedState(new Date()));
    // The demo store stamps each run with the real time, so "today" is the real date here.
    const ctx = { store, today: localDate(new Date(), "America/Denver"), settings: { timezone: "America/Denver" } } as unknown as Pick<Context, "store" | "today" | "settings">;
    expect(await firstRunToday(ctx)).toBe(true);
    await store.agentRuns.append({ runId: "r", agent: "scout", task: "Record the job market", status: "succeeded", trigger: "schedule", detail: "", model: "", inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(await firstRunToday(ctx)).toBe(false);
  });
});

describe("Hacker News: the real thread, not a joke repost", () => {
  it("searches the whoishiring account and picks its newest hiring thread", () => {
    expect(HN_SEARCH).toContain("author_whoishiring");
    const hits = [
      { objectID: "1", title: "Ask HN: Who wants to be hired? (November 2026)" },
      { objectID: "2", title: "Ask HN: Who is hiring? (November 2026)" },
      { objectID: "3", title: "Ask HN: Who is hiring? (October 2026)" },
    ];
    expect(pickHiringThread(hits, "Ask HN: Who is hiring?")).toBe("2");
    expect(pickHiringThread([], "Ask HN: Who is hiring?")).toBeNull();
  });
});

describe("Official pay by occupation (BLS OEWS)", () => {
  it("reads a yearly value and compares it with the year before", () => {
    const { points } = parseBls({
      status: "REQUEST_SUCCEEDED",
      Results: {
        series: [
          {
            seriesID: "OEUN000000000000041903113",
            data: [
              { year: "2025", period: "A01", value: "124900", footnotes: [{}] },
              { year: "2024", period: "A01", value: "120000", footnotes: [{}] },
            ],
          },
        ],
      },
    });
    expect(points).toEqual([
      { seriesId: "OEUN000000000000041903113", period: "2025-01-01", value: 124900, preliminary: false },
      { seriesId: "OEUN000000000000041903113", period: "2024-01-01", value: 120000, preliminary: false },
    ]);
    const s = summarize(points).find((x) => x.series.id === "OEUN000000000000041903113")!;
    expect(s.series.frequency).toBe("yearly");
    expect(s.vsPrevious).toBe(4.1);
  });
});
