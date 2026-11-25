import { describe, expect, it, vi } from "vitest";
import { findBoards } from "@/lib/agents/boardFinder";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { boardsInHtml, candidateSlugs, domainOf, pickCareersPage } from "@/lib/domain/boardFinder";
import { localDate } from "@/lib/domain/dates";
import { pipelineView } from "@/lib/domain/pipelineView";
import { adzunaUrl, parseAdzuna } from "@/lib/integrations/jobFeeds";
import { assertAllowed } from "@/lib/security/safeFetch";
import type { Raw } from "@/lib/integrations/jobBoards";
import type { Context } from "@/lib/context";

describe("Board finder: the free guesses", () => {
  it("reads a domain from whatever you type", () => {
    expect(domainOf("https://www.lucid.co/careers")).toBe("lucid.co");
    expect(domainOf("weave.com")).toBe("weave.com");
    expect(domainOf("not a site")).toBeNull();
  });

  it("guesses board names from the company and its domain, most likely first", () => {
    expect(candidateSlugs("Lucid Software", "lucid.co")).toEqual(["lucidsoftware", "lucid", "lucid-software"]);
    expect(candidateSlugs("Podium", "podium.com")).toEqual(["podium"]);
    expect(candidateSlugs("AT&T Inc.", null)).toEqual(["atandtinc", "atandt", "at", "at-and-t", "at-and-t-inc"]);
  });
});

describe("Board finder: a careers page's HTML", () => {
  it("finds boards linked, embedded or loaded, most mentioned first", () => {
    const html = `<a href="https://boards.greenhouse.io/acme/jobs/1">x</a><a href="https://boards.greenhouse.io/acme/jobs/2">y</a>
      <iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>
      <script src="https://jobs.ashbyhq.com/acme-labs/embed"></script><a href="https://acme.recruitee.com/o/x">z</a>`;
    expect(boardsInHtml(html).map((b) => `${b.board}:${b.slug}`)).toEqual(["greenhouse:acme", "ashby:acme-labs", "recruitee:acme"]);
  });

  it("ignores path words that are not board names", () => expect(boardsInHtml(`<a href="https://boards.greenhouse.io/embed">`)).toEqual([]));

  it("picks the careers page from a site's map", () => {
    expect(pickCareersPage(["https://acme.io/blog/careers-tips", "https://acme.io/about", "https://acme.io/careers", "https://other.com/careers"], "acme.io")).toBe("https://acme.io/careers");
    expect(pickCareersPage(["https://acme.io/about"], "acme.io")).toBeNull();
  });
});

const job = (location: string): Raw => ({ id: location, title: "Engineer", url: "https://x.com", location, updatedAt: null });
const ctxFor = async () => {
  const store = createMemoryStore(seedState(new Date()));
  const settings = await store.settings.get();
  return { store, ctx: { mode: "demo", userId: "", store, settings, now: new Date(), today: localDate(new Date(), "America/Denver"), time: "12:00" } as unknown as Context };
};

describe("Board finder: the whole search", () => {
  it("stops at the free guess when a board answers, and spends no credit", async () => {
    const { ctx } = await ctxFor();
    const map = vi.fn();
    const probe = vi.fn(async (w: { board: string; slug: string }) => (w.board === "ashby" && w.slug === "weave" ? [job("Lehi, UT"), job("Mexico City")] : null));
    const res = await findBoards(ctx, { company: "Weave", website: "getweave.com" }, { probe: probe as never, map: map as never });
    expect(res.found).toEqual([{ board: "ashby", slug: "weave", via: "guess", jobs: 2, us: 1, utah: 1 }]);
    expect(res.credits).toBe(0);
    expect(map).not.toHaveBeenCalled();
  });

  it("falls back to Firecrawl on the website, counts 2 credits, and confirms the board", async () => {
    const { ctx, store } = await ctxFor();
    const probe = vi.fn(async (w: { board: string; slug: string }) => (w.board === "greenhouse" && w.slug === "acmehq" ? [job("Remote, US")] : null));
    const map = vi.fn(async () => ({ ok: true as const, links: ["https://acme.io/careers", "https://acme.io/blog"] }));
    const read = vi.fn(async () => ({ ok: true as const, html: `<iframe src="https://boards.greenhouse.io/embed/job_board?for=acmehq">` }));
    const res = await findBoards(ctx, { company: "Acme", website: "https://acme.io" }, { probe: probe as never, map: map as never, read: read as never });
    expect(read).toHaveBeenCalledWith("https://acme.io/careers");
    expect(res).toMatchObject({ company: "Acme", credits: 2, found: [{ board: "greenhouse", slug: "acmehq", via: "careers page", jobs: 1, us: 1 }] });
    expect((await store.settings.get()).firecrawlUsage?.pages).toBe(2);
  });

  it("does not use Firecrawl when this month's budget is spent", async () => {
    const { ctx } = await ctxFor();
    ctx.settings = { ...ctx.settings, firecrawlUsage: { month: ctx.today.slice(0, 7), pages: 900, day: ctx.today, today: 0 } } as never;
    const map = vi.fn();
    const res = await findBoards(ctx, { company: "Acme", website: "acme.io" }, { probe: (async () => null) as never, map: map as never });
    expect(map).not.toHaveBeenCalled();
    expect(res.notes.join(" ")).toMatch(/budget/);
  });

  it("asks for a website when the free check found nothing", async () => {
    const { ctx } = await ctxFor();
    const res = await findBoards(ctx, { company: "Acme", website: "" }, { probe: (async () => null) as never });
    expect(res.found).toEqual([]);
    expect(res.notes.join(" ")).toMatch(/website/);
  });
});

describe("Adzuna", () => {
  // The shape of Adzuna's documented response, with made-up jobs.
  const data = {
    results: [
      { id: "1", title: "Software Engineer", redirect_url: "https://www.adzuna.com/land/ad/1", company: { display_name: "Acme" }, location: { display_name: "Salt Lake City, Salt Lake County", area: ["US", "Utah", "Salt Lake County"] }, salary_min: 120000, salary_max: 140000, salary_is_predicted: "0", contract_time: "full_time", contract_type: "permanent", created: "2026-11-20T10:00:00Z", description: "Build APIs" },
      { id: "2", title: "Data Engineer", redirect_url: "https://www.adzuna.com/land/ad/2", company: { display_name: "Beta" }, location: { display_name: "US", area: ["US"] }, salary_min: 99000, salary_max: 99000, salary_is_predicted: "1", contract_time: "full_time" },
    ],
  };

  it("keeps posted pay, drops the pay Adzuna estimated, and credits Adzuna as the source", () => {
    const [a, b] = parseAdzuna(data);
    expect(a).toMatchObject({ key: "adzuna:1", source: "Adzuna", company: "Acme", salaryMin: 120000, salaryMax: 140000 });
    expect(a!.location).toContain("Utah, US");
    expect(a!.text.startsWith("full time permanent")).toBe(true);
    expect(b!.salaryMin).toBeUndefined();
    expect(parseAdzuna({ error: "bad key" })).toEqual([]);
  });

  it("searches U.S. jobs from the last week on an allowed host", () => {
    const u = adzunaUrl("data engineer", { id: "abc", key: "secret" });
    expect(u).toContain("/jobs/us/search/1?");
    expect(u).toContain("max_days_old=7");
    expect(() => assertAllowed(u)).not.toThrow();
  });

  it("is not counted as a source that stopped answering when it is not read this run", () => {
    const q = { day: "2026-11-23", read: 100, notTech: 0, notFullTime: 0, outsideUs: 0, tech: 100, duplicates: 0, recorded: 100, withPay: 50, withSkills: 50, levelStated: 50, capped: false, sources: ["Remote OK", "We Work Remotely", "Jobicy", "HN Who's Hiring", "Himalayas", "Remotive", "Company boards", "Utah companies"].map((source) => ({ source, read: 10, tech: 10, withPay: 5 })) };
    const v = pipelineView({ quality: q, size: { postings: 0, days: 0 }, today: "2026-11-23", yourPostings: 0, reportDay: null });
    expect(v.sources.find((s) => s.name === "Adzuna")).toMatchObject({ ok: false, idle: true });
    expect(v.checks.find((c) => c.label === "Sources answering")!.value).toBe(1);
  });
});
