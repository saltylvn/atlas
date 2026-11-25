import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { explainNotion, httpsLink, masterResumeFromNotion, notionRolesPatch, rolesFromNotion, visibleItems, type NotionDiagnosis } from "@/lib/domain/notionRoles";

const TOKEN = "ntn_test_token_that_is_long_enough_0001";
beforeAll(() => {
  // Read once by lib/env.ts; set before anything loads it.
  process.env.NOTION_TOKEN = TOKEN;
});
afterEach(() => vi.unstubAllGlobals());

const rich = (s: string) => [{ type: "text", plain_text: s }];
const row = (role: string, priority: number | null, over: { share?: string | null; files?: unknown[]; url?: string; in_trash?: boolean } = {}) => ({
  object: "page",
  url: over.url ?? `https://www.notion.so/${role.replace(/\W+/g, "-")}`,
  in_trash: over.in_trash ?? false,
  properties: {
    Role: { id: "title", type: "title", title: rich(role) },
    Priority: { id: "p", type: "number", number: priority },
    "Share link": { id: "s", type: "url", url: over.share ?? null },
    "Resume file": { id: "f", type: "files", files: over.files ?? [] },
    Notes: { id: "n", type: "rich_text", rich_text: rich("ignored") },
  },
});

// The Resumes database as it stands in Atlas HQ, in Notion's own (unsorted) order.
const RESULTS = [
  row("Software Engineer", 7),
  row("Solutions Engineer", 3, { files: [{ name: "se.pdf", type: "file", file: { url: "https://files.notion.so/signed?x=1", expiry_time: "2026-11-13T22:00:00Z" } }] }),
  row("Forward Deployed Engineer (FDE)", 1, { share: "https://drive.google.com/file/d/abc/view" }),
  row("AI Workflow Engineer", 2),
  row("GTM Engineer", 5),
  row("AI + Automation Engineer", 4, { share: "http://insecure.example/resume" }),
  row("AI Engineer", 6),
  row("Old role", 1, { in_trash: true }),
  row("", 9),
];

describe("Notion: reading the Resumes database", () => {
  it("orders roles by Priority, drops notes in brackets, trashed and blank rows", () => {
    const roles = rolesFromNotion(RESULTS);
    expect(roles.map((r) => r.name)).toEqual(["Forward Deployed Engineer", "AI Workflow Engineer", "Solutions Engineer", "AI + Automation Engineer", "GTM Engineer", "AI Engineer", "Software Engineer"]);
    expect(roles[0]).toMatchObject({ priority: 1, shareLink: "https://drive.google.com/file/d/abc/view", hasFile: false });
    expect(roles[2]).toMatchObject({ hasFile: true, shareLink: "" });
    expect(rolesFromNotion({ nope: true })).toEqual([]);
    expect(rolesFromNotion([null, 5, { properties: null }])).toEqual([]);
  });

  it("treats the Master Resume row as a resume, never a role", () => {
    const sheet = [row("Master Resume", 1, { share: "https://drive.google.com/master" }), row("AI Engineer", 2), row("AI + Automation Engineer", 3), row("GTM Engineer", 8)];
    expect(rolesFromNotion(sheet).map((r) => r.name)).toEqual(["AI Engineer", "AI + Automation Engineer", "GTM Engineer"]);
    expect(notionRolesPatch(rolesFromNotion(sheet), {})?.roles).toBe(3);
    // Its link is kept as the master resume: the Share link, or the row's page when a file is attached.
    expect(masterResumeFromNotion(sheet)).toBe("https://drive.google.com/master");
    expect(masterResumeFromNotion([row("Master Resume", 1, { files: [{ name: "master.pdf" }], url: "https://www.notion.so/master-row" })])).toBe("https://www.notion.so/master-row");
    expect(masterResumeFromNotion([row("AI Engineer", 2)])).toBe("");
    // A real role that merely contains the word is kept.
    expect(rolesFromNotion([row("Scrum Master", 1)]).map((r) => r.name)).toEqual(["Scrum Master"]);
  });

  it("keeps only plain https links", () => {
    expect(httpsLink("https://drive.google.com/x")).toBe("https://drive.google.com/x");
    expect(httpsLink("http://drive.google.com/x")).toBe("");
    expect(httpsLink("javascript:alert(1)")).toBe("");
    expect(httpsLink("https://user:pw@evil.example/")).toBe("");
    expect(httpsLink(null)).toBe("");
    expect(rolesFromNotion(RESULTS).find((r) => r.name === "AI + Automation Engineer")?.shareLink).toBe("");
  });

  it("puts rows without a Priority last and caps the list", () => {
    expect(rolesFromNotion([row("B", null), row("A", 2), row("C", null)]).map((r) => r.name)).toEqual(["A", "B", "C"]);
    expect(rolesFromNotion(Array.from({ length: 30 }, (_, i) => row(`Role ${i}`, i)))).toHaveLength(12);
    expect(rolesFromNotion([row("AI Engineer", 1), row("ai engineer", 2)])).toHaveLength(1);
  });

  it("turns rows into Settings: Notion's resumes and your pasted links, never the role order", () => {
    const patch = notionRolesPatch(rolesFromNotion(RESULTS), { careerResumes: { "GTM Engineer": "https://drive.google.com/mine", "Solutions Engineer": "https://old.example/se" } })!;
    // Atlas owns which roles you target and their order: a sync carries no role list.
    expect(patch).not.toHaveProperty("careerRoles");
    expect(patch.roles).toBe(7);
    expect(patch.careerResumes).toEqual({
      "Forward Deployed Engineer": "https://drive.google.com/file/d/abc/view",
      // An attached file links to the row's page: Notion's file URLs expire within the hour.
      "Solutions Engineer": "https://www.notion.so/Solutions-Engineer",
      // A row with neither links its own page, where Atlas mirrors the resume's text.
      "AI Workflow Engineer": "https://www.notion.so/AI-Workflow-Engineer",
      "AI Engineer": "https://www.notion.so/AI-Engineer",
      "Software Engineer": "https://www.notion.so/Software-Engineer",
      "AI Automation Engineer": "https://www.notion.so/AI-Automation-Engineer",
      "GTM Engineer": "https://drive.google.com/mine",
    });
    expect(patch).toMatchObject({ resumes: 6, changed: true });
    expect(notionRolesPatch(rolesFromNotion(RESULTS), patch)?.changed).toBe(false);
    expect(notionRolesPatch([], {})).toBeNull();
  });

  it("files a resume under the role its row's old name folded into; a row named for the role wins", () => {
    const share = (s: string) => ({ share: `https://drive.google.com/${s}` });
    const folded = notionRolesPatch(rolesFromNotion([row("AI + Automation Engineer", 1, share("auto")), row("GTM Engineer", 2, share("gtm"))]), {})!;
    expect(folded.careerResumes).toEqual({ "AI Automation Engineer": "https://drive.google.com/auto" });
    const exact = notionRolesPatch(rolesFromNotion([row("GTM Engineer", 1, share("gtm")), row("AI Automation Engineer", 5, share("own"))]), {})!;
    expect(exact.careerResumes).toEqual({ "AI Automation Engineer": "https://drive.google.com/own" });
  });

  it("reads Notion's \"Engineering\" row names as the roles, links each row's page, and keeps a link you pasted", () => {
    const sheet = [row("AI Automation Engineering", 2), row("AI Forward Deployed Engineering", 7), row(" AI Project Manager", 8)];
    const patch = notionRolesPatch(rolesFromNotion(sheet), { careerResumes: { "AI Project Manager": "https://drive.google.com/pm", "AI Automation Engineer": "https://app.notion.com/p/old-page" } })!;
    expect(patch.careerResumes).toEqual({
      // An old Notion page link is replaced by the row's page.
      "AI Automation Engineer": "https://www.notion.so/AI-Automation-Engineering",
      "AI Forward Deployed Engineer": "https://www.notion.so/AI-Forward-Deployed-Engineering",
      "AI Project Manager": "https://drive.google.com/pm",
    });
    expect(masterResumeFromNotion([row("Master Resume", 1, { url: "https://www.notion.so/master" })])).toBe("https://www.notion.so/master");
  });
});

type Reply = { status?: number; body: unknown };
function notionAnswers(replies: Record<string, Reply>) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const key = Object.keys(replies).find((k) => u.endsWith(k));
    const r = key ? replies[key]! : { status: 404, body: { object: "error", code: "object_not_found" } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  });
  return calls;
}

const DS = "417a12ce-4491-81d9-be5d-000be913b325";
const HAPPY = {
  "/users/me": { body: { object: "user", type: "bot", bot: { workspace_name: "Tyler's Notion" } } },
  "/search": { body: { results: [{ object: "data_source", id: "00000000-0000-0000-0000-000000000000", title: rich("Old Resumes copy") }, { object: "data_source", id: DS, title: rich("Resumes") }] } },
  [`/data_sources/${DS}/query`]: { body: { object: "list", results: RESULTS, has_more: false } },
};

describe("Notion: syncing", () => {
  const NOW = new Date("2026-11-13T21:00:00Z");

  it("reads Notion read-only and copies the resumes into Settings, leaving your roles alone", async () => {
    const { syncNotion } = await import("@/lib/connections/notion");
    const calls = notionAnswers(HAPPY);
    const state = seedState(NOW);
    const store = createMemoryStore(state);
    const before = (await store.settings.get()).careerRoles;
    const res = (await syncNotion(store, await store.settings.get(), NOW))!;
    expect(res.sync).toEqual({ at: NOW.toISOString(), ok: true, workspace: "Tyler's Notion", roles: 7, resumes: 6, master: false, message: "" });
    expect(res.changed).toBe(true);
    const saved = await store.settings.get();
    expect(saved.careerRoles).toEqual(before);
    expect(saved.careerResumes?.["Forward Deployed Engineer"]).toBe("https://drive.google.com/file/d/abc/view");
    expect(saved.notion?.ok).toBe(true);

    // Only api.notion.com, only reads (search and query are POSTs that change nothing), token as a bearer header.
    expect(calls.every((c) => c.url.startsWith("https://api.notion.com/v1/"))).toBe(true);
    expect(calls.map((c) => c.url.replace("https://api.notion.com/v1", "")).sort()).toEqual([`/data_sources/${DS}/query`, "/search", "/users/me"]);
    for (const c of calls) {
      expect((c.init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
      expect((c.init.headers as Record<string, string>)["notion-version"]).toBe("2025-09-03");
      expect(c.init.cache).toBe("no-store");
      expect(c.url).not.toContain(TOKEN);
    }
  });

  it("explains a bad token or an unshared database, and leaves Settings as they were", async () => {
    const { syncNotion } = await import("@/lib/connections/notion");
    const store = createMemoryStore(seedState(NOW));
    await store.settings.update({ careerRoles: ["AI Engineer"], careerResumes: { "AI Engineer": "https://drive.google.com/keep" } });

    notionAnswers({ "/users/me": { status: 401, body: { object: "error", code: "unauthorized", message: `API token is invalid. ${TOKEN}` } } });
    const bad = (await syncNotion(store, await store.settings.get(), NOW))!;
    expect(bad.sync.ok).toBe(false);
    expect(bad.sync.message).toContain("rejected the token");
    // Nothing Notion said, and never the token, is echoed.
    expect(JSON.stringify(bad.sync)).not.toContain(TOKEN);

    notionAnswers({ ...HAPPY, "/search": { body: { results: [] } } });
    const hidden = (await syncNotion(store, await store.settings.get(), NOW))!;
    expect(hidden.sync.message).toContain("Connections");

    notionAnswers({ ...HAPPY, [`/data_sources/${DS}/query`]: { status: 429, body: { object: "error", code: "rate_limited" } } });
    expect((await syncNotion(store, await store.settings.get(), NOW))!.sync.message).toContain("rate-limiting");

    notionAnswers({ ...HAPPY, [`/data_sources/${DS}/query`]: { body: { results: [] } } });
    expect((await syncNotion(store, await store.settings.get(), NOW))!.sync.message).toContain("no rows");

    const after = await store.settings.get();
    expect(after.careerRoles).toEqual(["AI Engineer"]);
    expect(after.careerResumes).toEqual({ "AI Engineer": "https://drive.google.com/keep" });
  });

  it("reads the remembered database directly, without Notion's (slow) search", async () => {
    const { syncNotion } = await import("@/lib/connections/notion");
    const store = createMemoryStore(seedState(NOW));
    // Search finds nothing yet (it lags behind sharing and restoring by minutes).
    const calls = notionAnswers({ ...HAPPY, "/search": { body: { results: [] } } });
    await store.settings.update({ notionResumesId: DS });
    const res = (await syncNotion(store, await store.settings.get(), NOW))!;
    expect(res.sync).toMatchObject({ ok: true, roles: 7 });
    expect(calls.some((c) => c.url.endsWith("/search"))).toBe(false);

    // The first successful search-based sync remembers the id.
    const fresh = createMemoryStore(seedState(NOW));
    notionAnswers(HAPPY);
    await syncNotion(fresh, await fresh.settings.get(), NOW);
    expect((await fresh.settings.get()).notionResumesId).toBe(DS);

    // A remembered id that no longer exists falls back to search.
    const moved = createMemoryStore(seedState(NOW));
    await moved.settings.update({ notionResumesId: "11111111-1111-1111-1111-111111111111" });
    notionAnswers(HAPPY);
    expect((await syncNotion(moved, await moved.settings.get(), NOW))!.sync.ok).toBe(true);
    expect((await moved.settings.get()).notionResumesId).toBe(DS);
  });

  it("counts the Master Resume as a resume and keeps its link, without making it a role", async () => {
    const { syncNotion } = await import("@/lib/connections/notion");
    const store = createMemoryStore(seedState(NOW));
    const file = [{ name: "resume.pdf", type: "file", file: { url: "https://files.notion.so/x", expiry_time: "2026-11-14T02:00:00Z" } }];
    const sheet = [row("Master Resume", 1, { files: file, url: "https://www.notion.so/master" }), row("AI Engineer", 2, { files: file }), row("GTM Engineer", 8, { files: file })];
    notionAnswers({ ...HAPPY, [`/data_sources/${DS}/query`]: { body: { results: sheet } } });
    await store.settings.update({ notionResumesId: DS });
    const res = (await syncNotion(store, await store.settings.get(), NOW))!;
    expect(res.sync).toMatchObject({ ok: true, roles: 2, resumes: 3, master: true });
    const saved = await store.settings.get();
    expect(saved.careerMasterResume).toBe("https://www.notion.so/master");
    expect(Object.keys(saved.careerResumes ?? {})).toEqual(["AI Engineer", "AI Automation Engineer"]);
  });

  it("still syncs when Notion won't say which workspace it is (no user information)", async () => {
    const { syncNotion } = await import("@/lib/connections/notion");
    const store = createMemoryStore(seedState(NOW));
    notionAnswers({ ...HAPPY, "/users/me": { status: 403, body: { object: "error", code: "restricted_resource" } } });
    const res = (await syncNotion(store, await store.settings.get(), NOW))!;
    expect(res.sync).toMatchObject({ ok: true, workspace: "", roles: 7, resumes: 6 });
    expect((await store.settings.get()).careerResumes?.["Forward Deployed Engineer"]).toBe("https://drive.google.com/file/d/abc/view");
  });

  it("says exactly why Notion refused, and what to do", async () => {
    const { syncNotion } = await import("@/lib/connections/notion");
    const store = createMemoryStore(seedState(NOW));
    await store.settings.update({ notionResumesId: DS });
    const refused = { status: 404, body: { object: "error", code: "object_not_found" } };
    const page = (title: string, parent = "workspace") => ({ object: "page", parent: { type: parent }, properties: { title: { id: "title", type: "title", title: rich(title) } } });
    const run = async (replies: Parameters<typeof notionAnswers>[0]) => {
      notionAnswers(replies);
      return (await syncNotion(store, await store.settings.get(), NOW))!.sync;
    };

    // The connection is shared with nothing.
    const nothing = await run({ ...HAPPY, [`/data_sources/${DS}/query`]: refused, "/search": { body: { results: [] } } });
    expect(nothing.ok).toBe(false);
    expect(nothing.message).toContain("cannot see any page yet");
    expect(nothing.message).toContain("different connection or workspace");
    // It names the connection the token belongs to (from /users/me).
    expect(nothing.message).toContain("The token in Vercel belongs to");

    const { identityLine } = await import("@/lib/integrations/notion");
    expect(identityLine({ name: "Atlas", workspace: "Tyler's Notion", kind: "internal" })).toBe("The token in Vercel belongs to “Atlas” in the workspace “Tyler's Notion”. If that is not the connection you shared Atlas HQ with, copy the secret from the right one.");
    expect(identityLine({ name: "My token", workspace: "", kind: "personal" })).toContain("personal token");
    expect(identityLine(null)).toContain("could not ask Notion");

    // It can see pages, but the Resumes database is not shared with it.
    const some = await run({ ...HAPPY, [`/data_sources/${DS}/query`]: refused, "/search": { body: { results: [page("Forward Deployed Engineer", "data_source_id"), page("Atlas HQ"), page("Architecture")] } } });
    expect(some.message).toContain("can see 3 items (Atlas HQ, Architecture, Forward Deployed Engineer), but not the Resumes database");
    expect(some.message).toContain("open the Resumes database itself");
    expect(some.sees).toEqual(["Atlas HQ", "Architecture", "Forward Deployed Engineer"]);

    // It can see Resumes but is not allowed to read rows: the Read content capability is off.
    const noRead = await run({ ...HAPPY, [`/data_sources/${DS}/query`]: { status: 403, body: { object: "error", code: "restricted_resource" } } });
    expect(noRead.message).toContain("including Resumes, but may not read its rows");
    expect(noRead.message).toContain("tick Read content");

    // Search itself is forbidden.
    const noSearch = await run({ ...HAPPY, [`/data_sources/${DS}/query`]: refused, "/search": { status: 403, body: { object: "error", code: "restricted_resource" } } });
    expect(noSearch.message).toContain("not allowed to read content");

    // A malformed request is Atlas's bug, and says so.
    const bug = await run({ ...HAPPY, [`/data_sources/${DS}/query`]: { status: 400, body: { object: "error", code: "validation_error" } } });
    expect(bug.message).toContain("bug in Atlas");

    // Nothing was overwritten by any of these.
    expect((await store.settings.get()).careerRoles ?? []).toEqual([]);
  });

  it("reads what a connection can see from a search reply, as clipped plain text", () => {
    const seen = visibleItems([
      { object: "page", parent: { type: "data_source_id" }, properties: { Role: { type: "title", title: rich("A row") } } },
      { object: "data_source", title: rich("Resumes") },
      { object: "page", parent: { type: "page_id" }, properties: { title: { type: "title", title: rich(`Long ${"x".repeat(80)}`) } } },
      { object: "page", properties: {} },
      null,
    ]);
    expect(seen.total).toBe(4);
    expect(seen.hasResumes).toBe(true);
    expect(seen.sees[0]).toBe("Resumes");
    expect(seen.sees.every((t) => t.length <= 40)).toBe(true);
    expect(seen.sees).toContain("(untitled)");
    expect(visibleItems("nope")).toEqual({ sees: [], total: 0, hasResumes: false });

    const base: NotionDiagnosis = { search: "ok", sees: ["Resumes"], total: 1, hasResumes: true, direct: "error" };
    expect(explainNotion(base)).toContain("reading its rows failed");
    expect(explainNotion({ ...base, search: "error", total: 0, sees: [], hasResumes: false })).toContain("could not check");
  });

  it("knows when the copy is stale", async () => {
    const { notionIsStale } = await import("@/lib/connections/notion");
    const sync = { ok: true, workspace: "", roles: 7, resumes: 0, message: "" };
    expect(notionIsStale({}, NOW)).toBe(true);
    expect(notionIsStale({ notion: { ...sync, at: "2026-11-13T20:55:00Z" } }, NOW)).toBe(false);
    expect(notionIsStale({ notion: { ...sync, at: "2026-11-13T20:40:00Z" } }, NOW)).toBe(true);
  });
});
