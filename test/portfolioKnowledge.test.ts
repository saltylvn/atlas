import { describe, expect, it } from "vitest";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { toDocuments } from "@/lib/domain/knowledge";
import { cleanReadme, describeRepo, projectName, readmeTitle, type PortfolioRepo, type RawRepo } from "@/lib/domain/portfolio";
import { queryTerms } from "@/lib/domain/retrieval";
import { indexKnowledge } from "@/lib/knowledge/indexer";
import { projectsFor, README_NOTE } from "@/lib/mcp/tools";

const TZ = "America/Denver";
const NOW = new Date("2026-11-24T16:00:00Z");

const README = [
  '<p align="center"><img src="logo.png" alt="logo"></p>',
  "# DEVELOP",
  "[![CI](https://github.com/x/y/actions/badge.svg)](https://github.com/x/y/actions) ![shot](docs/shot.png)",
  "",
  "A **wellness tracker** that turns check-ins into a weekly plan. See [the docs](https://example.com/docs).",
  "<!-- a hidden note -->",
  "## Stack",
  "- Next.js and `Supabase` with row-level security",
  "1. Gemini for the weekly summary",
  "```bash",
  "npm run dev # secret-looking line",
  "```",
  "| a | b |",
  "|---|---|",
  "---",
  "> Built in three weeks.",
].join("\n");

const repo = (over: Partial<PortfolioRepo> = {}): PortfolioRepo => ({
  id: "r1",
  repo: "saltylvn/wellness-tracker",
  name: "wellness-tracker",
  description: "Daily check-ins to a weekly plan",
  url: "https://github.com/saltylvn/wellness-tracker",
  isPrivate: false,
  languages: ["TypeScript"],
  topics: ["health"],
  stack: ["Next.js", "Supabase"],
  skills: ["TypeScript", "SQL"],
  title: "DEVELOP",
  readme: cleanReadme(README),
  pushedAt: "2026-11-20T18:00:00Z",
  checkedOn: "2026-11-24",
  createdAt: "2026-11-17T00:00:00Z",
  ...over,
});

describe("A README, kept as the project's own words", () => {
  it("keeps headings and prose, one item per line; drops badges, images, HTML, code, tables and rules", () => {
    expect(cleanReadme(README)).toBe(
      ["DEVELOP", "A wellness tracker that turns check-ins into a weekly plan. See the docs.", "Stack", "Next.js and Supabase with row-level security", "Gemini for the weekly summary", "Built in three weeks."].join("\n"),
    );
  });

  it("is capped, cutting between lines", () => {
    const long = cleanReadme(Array.from({ length: 200 }, (_, i) => `Line ${i} ${"x".repeat(40)}.`).join("\n"));
    expect(long.length).toBeLessThanOrEqual(4000);
    expect(long.endsWith(".")).toBe(true);
  });

  it("an unclosed code block hides the rest instead of leaking code", () => {
    expect(cleanReadme("Intro.\n```\nconst key = 1;")).toBe("Intro.");
  });

  it("takes the title from the top heading, unless it only repeats the repository name", () => {
    expect(readmeTitle(README, "wellness-tracker")).toBe("DEVELOP");
    expect(readmeTitle("# Wellness Tracker\ntext", "wellness-tracker")).toBe("");
    expect(readmeTitle("```\n# not a heading\n```\n## Sub\ntext", "x")).toBe("");
    expect(readmeTitle('<h1 align="center">Handoff <b>Triage</b> 🚑</h1>', "triage")).toBe("Handoff Triage");
    expect(projectName({ title: "DEVELOP", name: "wellness-tracker" })).toBe("DEVELOP (wellness-tracker)");
    expect(projectName({ title: "", name: "atlas" })).toBe("atlas");
  });

  it("the Scout records both", () => {
    const raw: RawRepo = { fullName: "saltylvn/wellness-tracker", name: "wellness-tracker", description: "", url: "https://github.com/saltylvn/wellness-tracker", isPrivate: false, fork: false, archived: false, pushedAt: null, topics: [], languages: { TypeScript: 10 }, readme: README, manifests: [], rootPaths: [] };
    expect(describeRepo(raw, "2026-11-24")).toMatchObject({ title: "DEVELOP", readme: cleanReadme(README) });
  });
});

describe("GitHub projects as project passages", () => {
  it("indexes each public project with its stack, skills and README, findable by its own name", () => {
    const docs = toDocuments({ portfolio: [repo(), repo({ id: "r2", repo: "saltylvn/client-x", name: "client-x", title: "", isPrivate: true, readme: "Client secret work." })] }, TZ);
    expect(docs).toHaveLength(1);
    const [d] = docs;
    expect(d).toMatchObject({ source: "project", sourceId: "repo:saltylvn/wellness-tracker", title: "Project: DEVELOP (wellness-tracker) on GitHub", href: "/growth" });
    expect(d!.text).toContain("Built with: Next.js, Supabase.");
    expect(d!.text).toContain("Skills shown: TypeScript, SQL.");
    expect(d!.text).toContain("Last worked on 2026-11-20.");
    expect(d!.text).toContain("Gemini for the weekly summary.");
    expect(d!.text).not.toMatch(/https?:|www\./);
  });

  it("search finds a project by its README title, and a failed read never deletes its passages", async () => {
    const store = createMemoryStore(seedState(NOW));
    await store.portfolio.replace([repo()]);
    await indexKnowledge(store, TZ, NOW);
    const find = async () => (await store.knowledge.search({ terms: queryTerms("DEVELOP weekly summary"), embedding: null, limit: 12, sources: ["project"] })).lexical.map((h) => h.sourceId);
    expect(await find()).toContain("repo:saltylvn/wellness-tracker");

    const failing = { ...store, portfolio: { ...store.portfolio, list: () => Promise.reject(new Error("down")) } };
    expect(await indexKnowledge(failing, TZ, NOW)).toMatchObject({ removed: 0 });
    expect(await find()).toContain("repo:saltylvn/wellness-tracker");

    await store.portfolio.replace([]);
    expect((await indexKnowledge(store, TZ, NOW)).removed).toBeGreaterThanOrEqual(1);
    expect(await find()).not.toContain("repo:saltylvn/wellness-tracker");
  });
});

describe("my_projects (MCP)", () => {
  const rows = [repo(), repo({ id: "r2", repo: "saltylvn/atlas", name: "atlas", title: "", readme: "" }), repo({ id: "r3", repo: "saltylvn/client-x", name: "client-x", title: "", isPrivate: true })];

  it("lists public projects only, without READMEs", () => {
    const out = projectsFor(rows) as { projects: { name: string }[] };
    expect(out.projects.map((p) => p.name)).toEqual(["DEVELOP (wellness-tracker)", "atlas"]);
    expect(JSON.stringify(out)).not.toContain("weekly summary");
  });

  it("returns one project in full, by README title, repository name or owner/name; never a private one", () => {
    for (const q of ["develop", "wellness-tracker", "saltylvn/wellness-tracker", "Wellness"]) expect(projectsFor(rows, q), q).toMatchObject({ name: "DEVELOP (wellness-tracker)", readme: expect.stringContaining("Gemini"), note: README_NOTE });
    expect(projectsFor(rows, "atlas")).toMatchObject({ readme: "(no README)" });
    expect(projectsFor(rows, "client-x")).toMatchObject({ error: expect.any(String), projects: ["DEVELOP (wellness-tracker)", "atlas"] });
  });

  it("says plainly when there is nothing yet", () => {
    expect(projectsFor([])).toMatch(/No GitHub projects/);
  });
});
