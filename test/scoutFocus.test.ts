import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boardCheck, closedBy, levelFromYears, seniorByYears, topFive } from "@/lib/domain/scoutFocus";
import { ENTRY_LEVEL_QUERIES } from "@/lib/integrations/jobFeeds";
import type { Approval, JobMatch } from "@/lib/domain/types";

// Step 1 of the agent plan (23 Nov 2026): the Scout focuses on jobs Tyler can win.

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const TODAY = "2026-11-23";
const match = (id: string, over: Partial<JobMatch> = {}): JobMatch => ({ id, key: id, title: "Software Engineer", company: "Acme", url: `https://example.com/${id}`, source: "Greenhouse", location: "Remote", role: "Software Engineer 1", payText: "", postedAt: "2026-11-10T00:00:00Z", score: 50, shownOn: "2026-11-15", shownSlot: "morning", rating: 1, status: "pursuing", createdAt: "2026-11-15T00:00:00Z", ...over });
const kit = (id: string, matchId: string | null, over: Partial<Approval> = {}): Approval => ({ id, kind: "application", title: `Job ${id}`, detail: "", url: `https://example.com/${id}`, matchId, status: "pending", decidedAt: null, createdAt: "2026-11-20T00:00:00Z", ...over });

describe("The level a posting reads as", () => {
  it("is its title's, or the years it asks for when the title states none", () => {
    expect(levelFromYears("Junior Software Engineer", "Requires 6+ years")).toBe("early");
    expect(levelFromYears("Software Engineer", "1-2 years of experience with TypeScript")).toBe("early");
    expect(levelFromYears("Software Engineer", "3+ years of experience")).toBe("mid");
    expect(levelFromYears("Software Engineer", "Requires 7+ years of experience")).toBe("upper");
    expect(levelFromYears("Software Engineer", "")).toBeNull();
  });

  it("a plain title asking for 5+ years is left out of your matches, like a senior title", () => {
    expect(seniorByYears("Backend Engineer", "5+ years building APIs")).toBe(true);
    expect(seniorByYears("Software Engineer I", "5+ years")).toBe(false);
    // Matching now uses the one level rule (lib/domain/levelPolicy.ts): 3+ years is out too.
    expect(read("lib/domain/careerAgent.ts")).toContain("aboveLevel(r.title, r.text");
  });

  it("the feeds also search for entry-level titles", () => {
    expect(ENTRY_LEVEL_QUERIES).toContain("junior software engineer");
    expect(read("lib/integrations/jobFeeds.ts")).toContain("...HIMALAYAS_FAMILY_QUERIES, ...ENTRY_LEVEL_QUERIES]");
  });
});

describe("Still open?", () => {
  it("checks Greenhouse and Lever job pages through their public APIs, and nothing else", () => {
    expect(boardCheck("https://job-boards.greenhouse.io/acme/jobs/4012345")).toEqual({ board: "greenhouse", api: "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345" });
    expect(boardCheck("https://boards.greenhouse.io/acme/jobs/4012345?gh_src=x")?.board).toBe("greenhouse");
    expect(boardCheck("https://jobs.lever.co/acme/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0")).toEqual({ board: "lever", api: "https://api.lever.co/v0/postings/acme/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0" });
    expect(boardCheck("https://www.linkedin.com/jobs/view/123")).toBeNull();
    expect(boardCheck("not a url")).toBeNull();
  });

  it("only a 404 or 410 closes a job; a timeout or a 500 is not proof", () => {
    expect([404, 410, 500, 429, null].map(closedBy)).toEqual([true, true, false, false, false]);
    expect(read("lib/agents/sync.ts")).toContain('"Clear queued jobs whose posting is closed"');
  });
});

describe("Apply to these 5 today", () => {
  it("puts Perfect fits first, then entry level and fresh postings, and leaves senior roles out", () => {
    const matches = [
      match("plain", { score: 60 }),
      match("junior", { title: "Junior Software Engineer", score: 40 }),
      match("fresh", { score: 40, postedAt: "2026-11-22T00:00:00Z" }),
      match("senior", { title: "Senior Software Engineer", score: 90 }),
      match("perfect", { score: 10 }),
      match("old", { score: 55, postedAt: "2026-10-20T00:00:00Z" }),
    ];
    const kits = [...matches.map((m) => kit(m.id, m.id)), kit("done", "plain", { status: "approved" })];
    const picks = topFive(kits, matches, TODAY, new Set(["perfect"]));
    // Perfect 10+100; junior 40+20; plain 60; fresh 40+15; old 55-15. Senior (90) is above your level: never listed.
    expect(picks.map((p) => p.kitId)).toEqual(["perfect", "junior", "plain", "fresh", "old"]);
    expect(picks).toHaveLength(5);
    expect(picks.find((p) => p.kitId === "perfect")!.why).toContain("you marked it a Perfect fit");
    expect(picks.find((p) => p.kitId === "junior")!.why).toContain("entry level");
    expect(picks.find((p) => p.kitId === "fresh")!.why).toContain("posted 1 day ago");
    expect(picks.some((p) => p.kitId === "senior")).toBe(false);
    expect(picks.some((p) => p.kitId === "done")).toBe(false);
  });

  it("is on the Apply page", () => {
    expect(read("app/(app)/(career)/career/page.tsx")).toContain("<TopFive picks={picks} waiting={waiting.length} />");
  });
});
