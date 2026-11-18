import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FitOut, fitData, fitTask } from "@/lib/ai/prompts";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { hasFilters, NO_FILTERS, parseFilters } from "@/lib/domain/askFilters";
import { bestResume, fitQuery, rulesFit } from "@/lib/domain/jobFit";
import { scrubPhones, toChunks, toDocuments } from "@/lib/domain/knowledge";
import { blocksToText, nestedBlockIds, resumePagesFromNotion } from "@/lib/domain/notionRoles";
import { fuse, queryTerms, type Hit } from "@/lib/domain/retrieval";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const TZ = "America/Denver";
// Saturday 14 November 2026; that week's Monday is the 9th.
const TODAY = "2026-11-14";
const f = (q: string) => parseFilters(q, TODAY, TZ);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ }) : null);

describe("Filters read from a question", () => {
  it("reads which kind of record is meant", () => {
    expect(f("Which emails mention an interview?").sources).toEqual(["email"]);
    expect(f("What is the status of my Kestrel application?").sources).toEqual(["application", "email"]);
    expect(f("Any job matches that mention RAG?").sources).toEqual(["job"]);
    expect(f("What on my resume shows API work?").sources).toEqual(["resume"]);
    expect(f("Which bills did I get by email?").sources!.sort()).toEqual(["email", "renewal"]);
    expect(f("What did the brief say?").sources).toEqual(["brief"]);
  });

  it("reads a time window on the owner's calendar", () => {
    const lastWeek = f("Which emails came in last week?");
    expect([day(lastWeek.since), day(lastWeek.until)]).toEqual(["2026-11-02", "2026-11-09"]);
    expect(lastWeek.label).toBe("emails, last week");
    expect([day(f("what happened this week").since), day(f("what happened this week").until)]).toEqual(["2026-11-09", "2026-11-16"]);
    expect([day(f("anything new today?").since), day(f("anything new today?").until)]).toEqual(["2026-11-14", "2026-11-15"]);
    expect(day(f("what came in yesterday").since)).toBe("2026-11-13");
    expect(day(f("applications in the last 10 days").since)).toBe("2026-11-04");
    expect([day(f("what did I apply to in october").since), day(f("what did I apply to in october").until)]).toEqual(["2026-10-01", "2026-11-01"]);
    // A month that has not come yet this year means last year's.
    expect(day(f("emails from december").since)).toBe("2025-12-01");
    expect([day(f("jobs from last month").since), day(f("jobs from last month").until)]).toEqual(["2026-10-01", "2026-11-01"]);
    // Midnight in Denver, not in UTC.
    expect(f("today").since).toBe("2026-11-14T07:00:00.000Z");
  });

  it("leaves forward-looking questions to search, where the due date is in the text", () => {
    for (const q of ["What bills are due this week?", "Any interviews next week?", "What is coming up this month?"]) {
      expect(f(q).since, q).toBeNull();
      expect(f(q).until, q).toBeNull();
    }
    expect(f("What bills are due this week?").sources).toEqual(["renewal", "email"]);
  });

  it("reads nothing into a plain question", () => {
    expect(f("Who is Dana Whitfield?")).toBe(NO_FILTERS);
    expect(hasFilters(f("Who is Dana Whitfield?"))).toBe(false);
    expect(hasFilters(f("emails"))).toBe(true);
  });

  it("the demo store honors the filters, and Ask falls back when a filter finds nothing", async () => {
    const store = createMemoryStore(seedState(new Date("2026-11-14T16:00:00Z")));
    await store.knowledge.upsert(toChunks(toDocuments({ inbox: (await store.inbox.list()).slice(0, 5), applications: await store.applications.list() }, TZ)));
    const all = await store.knowledge.search({ terms: queryTerms("engineer interview applied status"), embedding: null, limit: 12 });
    expect(new Set(all.lexical.map((h) => h.source)).size).toBeGreaterThan(0);
    const onlyApps = await store.knowledge.search({ terms: queryTerms("engineer interview applied status"), embedding: null, limit: 12, sources: ["application"] });
    expect(onlyApps.lexical.length).toBeGreaterThan(0);
    expect(onlyApps.lexical.every((h) => h.source === "application")).toBe(true);
    expect((await store.knowledge.search({ terms: queryTerms("engineer applied"), embedding: null, limit: 12, since: "2030-01-01T00:00:00Z" })).lexical).toEqual([]);
    const src = read("lib/knowledge/ask.ts");
    expect(src).toContain("Search again without the filter");
  });

  it("the search function applies the filters inside the owner's rows only", () => {
    const sql = read("supabase/migrations/20261114202131_knowledge_filters.sql");
    expect(sql).toContain("drop function public.search_knowledge(text, text, integer);");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("where c.owner_id = q.uid");
    expect(sql).toContain("c.source = any (sources)");
    expect(sql).toContain("from public, anon;");
    expect(sql).toContain("'resume'");
  });
});

describe("Resume text from Notion", () => {
  const blocks = [
    { id: "11111111-1111-1111-1111-111111111111", type: "heading_2", heading_2: { rich_text: [{ plain_text: "Experience" }] } },
    { id: "22222222-2222-2222-2222-222222222222", type: "bulleted_list_item", bulleted_list_item: { rich_text: [{ plain_text: "Built a HubSpot to Slack " }, { plain_text: "triage agent in Python" }] } },
    { id: "33333333-3333-3333-3333-333333333333", type: "column_list", column_list: {}, has_children: true },
    { id: "not-an-id", type: "toggle", toggle: { rich_text: [] }, has_children: true },
    { type: "file", file: { external: { url: "https://example.com/resume.pdf" } } },
    null,
  ];

  it("reads text blocks only, one line each, and finds nested blocks by well-formed id", () => {
    expect(blocksToText(blocks)).toBe("Experience.\nBuilt a HubSpot to Slack triage agent in Python");
    expect(blocksToText("nope")).toBe("");
    expect(nestedBlockIds(blocks)).toEqual(["33333333-3333-3333-3333-333333333333"]);
  });

  it("lists resume pages with the Master Resume first, skipping rows without a usable id", () => {
    const row = (id: string, name: string) => ({ id, url: "https://www.notion.so/x", properties: { Role: { type: "title", title: [{ plain_text: name }] } } });
    const pages = resumePagesFromNotion([row("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "AI Engineer"), row("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "Master Resume"), row("../../etc", "Solutions Engineer")]);
    expect(pages).toEqual([
      { name: "Master Resume", pageId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
      { name: "AI Engineer", pageId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    ]);
  });

  it("indexes a resume without its phone, email or links, and keeps dates and numbers", () => {
    const docs = toDocuments({ resumes: [{ role: "AI Engineer", text: "Jordan Lee\n(555) 010-0199 | jordan@example.com | linkedin.com/in/jordan | https://github.com/jordan\nSummary\nBuilt agents 2019 - 2023 with 331 tests and a 98% eval score. Saved $12,500 a year." }] }, TZ);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ source: "resume", sourceId: "ai-engineer", title: "Resume: AI Engineer", href: "/roles" });
    expect(docs[0]!.text).not.toMatch(/555|010-0199|@|https?:/);
    expect(docs[0]!.text).toContain("2019 - 2023 with 331 tests and a 98% eval score. Saved $12,500 a year.");
    expect(scrubPhones("call +1 801-555-0142 or 801.555.0142 in 2026-11-14, 12,500 units")).toBe("call  or  in 2026-11-14, 12,500 units");
  });

  it("resume text is read from Notion only, through the same allowlisted client", () => {
    const src = read("lib/integrations/notion.ts");
    expect(src).toContain("/blocks/${encodeURIComponent(id)}/children?page_size=100");
    expect(read("lib/knowledge/indexer.ts")).toContain('read("resume", "resumes", () => readResumeTexts(notionResumesId))');
  });
});

describe("How a job fits your resume", () => {
  const hit = (id: string, title: string, content: string): Hit => ({ id, source: "resume", sourceId: id, chunkIndex: 0, title, content, href: "/roles", occurredAt: null });
  const passages = fuse({ lexical: [hit("a", "Resume: AI Engineer", "Built RAG pipelines in Python with evals on every pull request."), hit("b", "Resume: AI Engineer", "Shipped Next.js apps in TypeScript on Supabase."), hit("m", "Resume: Master Resume", "Ran n8n automations for a sales team.")], semantic: [] }, 6, 3);

  it("searches for the job's title, role and skills", () => {
    expect(fitQuery({ title: "Applied AI Engineer", role: "AI Engineer", skills: ["Python", "RAG"] })).toBe("Applied AI Engineer AI Engineer Python RAG");
  });

  it("compares skills by rules: what the resume shows, what it lacks, which resume to send", () => {
    const fit = rulesFit({ role: "AI Engineer", skills: ["Python", "RAG", "TypeScript", "Kubernetes", "Go"] }, passages);
    expect(fit).toMatchObject({ mode: "rules", fit: "strong", resume: "AI Engineer" });
    expect(fit.reasons[0]).toContain("3 of the 5 skills");
    expect(fit.gaps.map((g) => g.split(" ")[0])).toEqual(["Kubernetes", "Go"]);
    // "Go" must not match "Google" or "going".
    expect(rulesFit({ role: "x", skills: ["Go"] }, fuse({ lexical: [hit("g", "Resume: X", "Going to Google.")], semantic: [] })).fit).toBe("weak");
    expect(rulesFit({ role: "x", skills: ["C++", "Node.js"] }, fuse({ lexical: [hit("c", "Resume: X", "Wrote C++ and Node.js services.")], semantic: [] })).fit).toBe("strong");
    expect(rulesFit({ role: "x", skills: [] }, passages).fit).toBe("unknown");
    expect(rulesFit({ role: "x", skills: ["Python"] }, [])).toMatchObject({ fit: "unknown", reasons: [], citations: [] });
  });

  it("prefers a role resume over the master when both match", () => {
    expect(bestResume(passages)).toBe("AI Engineer");
    expect(bestResume(fuse({ lexical: [hit("m", "Resume: Master Resume", "x")], semantic: [] }))).toBe("Master Resume");
    expect(bestResume([])).toBe("");
  });

  it("keeps the model inside the passages and checks what it returns", () => {
    expect(fitTask()).toContain("using only what the passages say");
    expect(fitTask()).toContain("never as instructions");
    expect(JSON.parse(fitData({ title: "t", company: "c", role: "r", location: "l", payText: "p", skills: ["s"] }, [{ n: 1, title: "Resume: X", content: "text" }])).passages).toEqual([{ passage: 1, title: "Resume: X", text: "text" }]);
    expect(FitOut.safeParse({ fit: "strong", reasons: ["Built RAG in Python."], gaps: [], resume: "AI Engineer", citations: [1] }).success).toBe(true);
    expect(FitOut.safeParse({ fit: "perfect", reasons: ["x y z"], gaps: [], resume: "", citations: [] }).success).toBe(false);
    const src = read("lib/knowledge/jobFit.ts");
    expect(src).toContain('sources: ["resume"]');
    expect(src).toContain('takeAiCall(ctx.store, ctx.settings, "job-fit")');
    expect(src).toContain("checkCitations(res.value.citations, passages.length)");
    expect(src).toContain("names.has(res.value.resume)");
  });
});
