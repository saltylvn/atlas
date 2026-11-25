import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_PROFILES_TASK, runRoleProfiles } from "@/lib/agents/roleProfiles";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { RoleOutlook } from "@/lib/domain/roleOutlook";
import { acceptProfile, isProfileDay, latestProfiles, profilesDue, profilesMessage, profileWeek, roleCard, roleCards, roleFacts, TOP_ROLES, topRoles, type RoleProfile, type RoleProfileText } from "@/lib/domain/roleProfile";
import { CAREER } from "@/components/navItems";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const NOW = new Date("2026-11-23T18:00:00Z"); // a Monday
const TODAY = "2026-11-23";

const outlook = (role: string, over: Partial<RoleOutlook> = {}): RoleOutlook => ({
  role,
  target: true,
  postings: 42,
  thisWeek: 9,
  lastWeek: 6,
  trend: "up",
  reachable: 0.8,
  payMedian: 120_000,
  asked: [
    { skill: "Python", share: 0.7, shown: true, projects: ["atlas"] },
    { skill: "RAG", share: 0.5, shown: false, projects: [] },
    { skill: "APIs & integrations", share: 0.9, shown: true, projects: ["atlas"] },
    { skill: "Kubernetes", share: 0.3, shown: false, projects: [] },
  ],
  qualified: 0.62,
  projects: ["atlas"],
  applied: 4,
  responses: 1,
  thin: false,
  score: 70,
  ...over,
});

const good: RoleProfileText = {
  does: "You connect a customer's systems to the product: you learn what they need, build the integration, and stay with them until it runs in production.",
  tempo: "Customer-paced, with several accounts moving at once and results judged by what goes live.",
  project: "Build a small RAG service behind an API and write up how a customer would connect it to their own data.",
  closeSkill: "rag",
  closeWhy: "RAG is asked for in 50% of the postings and nothing you have built shows it yet.",
};

describe("Target Roles: which roles, and when", () => {
  it("shows all of your roles, at most seven, in your order", () => {
    expect(TOP_ROLES).toBe(7);
    expect(topRoles(["A", "B", "C", "D", "E", "F", "G", "H"])).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(topRoles(["A"])).toEqual(["A"]);
  });

  it("writes on Mondays, one profile per role per week", () => {
    expect(isProfileDay("2026-11-23")).toBe(true);
    expect(isProfileDay("2026-11-24")).toBe(false);
    expect(profileWeek("2026-11-26")).toBe("2026-11-23");
  });

  it("sits between the Career Map and Setup in the Career tabs", () => {
    expect(CAREER.map((j) => j.label)).toEqual(["Pipeline", "Tracker", "Market", "Career Map", "Target Roles", "Resume Optimization", "Setup"]);
    // The older settings page keeps its address under a name that does not clash.
    expect(read("app/(app)/(career)/roles/page.tsx")).toContain('title="Roles and resumes"');
  });
});

describe("Target Roles: a role's card", () => {
  it("lists what the role asks for, your gaps, and a project for each top gap", () => {
    const card = roleCard("AI Engineer", 1, [outlook("AI Engineer")], ["rag"]);
    expect(card.asks.map((a) => a.skill)).toEqual(["APIs & integrations", "Python", "RAG", "Kubernetes"]);
    expect(card.gaps).toEqual([
      { skill: "RAG", share: 0.5, onGrowthList: true },
      { skill: "Kubernetes", share: 0.3, onGrowthList: false },
    ]);
    expect(card.projects.map((p) => p.skill)).toEqual(["RAG", "Kubernetes"]);
    expect(card.projects[0]!.steps.length).toBeGreaterThan(1);
    expect(card.backedBy).toEqual(["atlas"]);
  });

  it("has no numbers to show for a role the Analyst has not measured", () => {
    const card = roleCard("GTM Engineer", 3, [outlook("AI Engineer")], []);
    expect(card).toMatchObject({ outlook: null, asks: [], gaps: [], projects: [] });
    expect(roleFacts(card)).toEqual([]);
    expect(roleFacts(roleCard("AI Engineer", 1, [outlook("AI Engineer", { thin: true })], []))).toEqual([]);
  });

  it("gives the model facts with every number it may use", () => {
    const facts = roleFacts(roleCard("AI Engineer", 1, [outlook("AI Engineer")], []));
    expect(facts).toHaveLength(4);
    expect(facts[1]).toBe("Skills its postings ask for, with the share that ask: APIs & integrations 90%, Python 70%, RAG 50%, Kubernetes 30%.");
    expect(facts[2]).toBe("Asked for and shown by none of their projects or resumes: RAG, Kubernetes.");
    expect(roleCards(["A", "B", "C", "D", "E", "F", "G", "H"], [], []).map((c) => c.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe("Target Roles: what Gemini writes is checked against the facts", () => {
  const card = roleCard("AI Engineer", 1, [outlook("AI Engineer")], []);

  it("keeps a profile that rests on the facts, with the gap's own spelling", () => {
    expect(acceptProfile(good, card)).toMatchObject({ closeSkill: "RAG", does: good.does });
  });

  it("drops one that adds a number", () => {
    expect(acceptProfile({ ...good, tempo: "Fast: most people here ship 12 integrations a quarter and are judged on it." }, card)).toBeNull();
    expect(acceptProfile({ ...good, closeWhy: "RAG is asked for in 85% of the postings." }, card)).toBeNull();
  });

  it("drops one that names a gap the role does not have, or a skill it does not ask for", () => {
    expect(acceptProfile({ ...good, closeSkill: "Terraform" }, card)).toBeNull();
    expect(acceptProfile({ ...good, closeSkill: "" }, card)).toBeNull();
    expect(acceptProfile({ ...good, project: "Deploy a small service on AWS Lambda and document how a customer would call it." }, card)).toBeNull();
  });

  it("drops links, markup and text too thin to be useful", () => {
    expect(acceptProfile({ ...good, does: `${good.does} See https://example.com for more.` }, card)).toBeNull();
    expect(acceptProfile({ ...good, tempo: "**Fast** and customer-paced, with results judged by what goes live." }, card)).toBeNull();
    expect(acceptProfile({ ...good, does: "You build things." }, card)).toBeNull();
  });

  it("asks for no gap when the role has none, and writes nothing without facts", () => {
    const covered = roleCard("AI Engineer", 1, [outlook("AI Engineer", { asked: [{ skill: "Python", share: 0.7, shown: true, projects: [] }, { skill: "RAG", share: 0.5, shown: true, projects: [] }] })], []);
    expect(acceptProfile({ ...good, closeSkill: "", closeWhy: "" }, covered)).toMatchObject({ closeSkill: "", closeWhy: "" });
    expect(acceptProfile(good, covered)).toBeNull();
    expect(acceptProfile(good, roleCard("AI Engineer", 1, [], []))).toBeNull();
  });
});

describe("Target Roles: stored profiles", () => {
  const row = (role: string, forWeek: string, createdAt = `${forWeek}T18:00:00Z`): RoleProfile => ({ id: `${role}-${forWeek}`, role, forWeek, ...good, postings: 42, facts: [], writer: "model", createdAt });

  it("shows each role's newest profile and remembers the one before", () => {
    const got = latestProfiles([row("A", "2026-11-09"), row("A", "2026-11-23"), row("A", "2026-11-16"), row("B", "2026-11-16")]);
    expect(got.get("A")!.current.forWeek).toBe("2026-11-23");
    expect(got.get("A")!.previous!.forWeek).toBe("2026-11-16");
    expect(got.get("B")).toMatchObject({ previous: null });
  });

  it("says how many were written and why the rest wait, each reason once", () => {
    expect(profilesMessage({ written: ["A", "B"], kept: ["C"], waiting: [] })).toBe("2 of 3 role profiles written.");
    expect(profilesMessage({ written: [], kept: [], waiting: ["A", "B", "C", "D"].map((role) => ({ role, why: "No AI key is set." })) })).toBe("0 of 4 role profiles written. Still waiting, all of them: No AI key is set.");
    expect(profilesMessage({ written: ["A"], kept: [], waiting: [{ role: "B", why: "Daily AI limit reached." }, { role: "C", why: "too few postings to describe it" }, { role: "D", why: "Daily AI limit reached." }] })).toBe("1 of 4 role profiles written. Still waiting, B, D: Daily AI limit reached; C: too few postings to describe it.");
  });

  it("knows which roles still need this week's profile", () => {
    expect(profilesDue(["A", "B", "C", "D", "E", "F", "G", "H"], [row("A", "2026-11-23"), row("B", "2026-11-16")], "2026-11-25")).toEqual(["B", "C", "D", "E", "F", "G"]);
  });

  it("keeps one profile per role per week: a rewrite replaces it", async () => {
    const store = createMemoryStore(seedState(NOW));
    const before = (await store.roleProfiles.recent(40)).length;
    await store.roleProfiles.save({ role: "Z Role", forWeek: "2026-11-23", ...good, postings: 1, facts: [], writer: "model" });
    await store.roleProfiles.save({ role: "Z Role", forWeek: "2026-11-23", ...good, does: `${good.does} Again.`, postings: 2, facts: [], writer: "model" });
    const mine = (await store.roleProfiles.recent(40)).filter((p) => p.role === "Z Role");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.postings).toBe(2);
    expect(await store.roleProfiles.recent(40)).toHaveLength(before + 1);
  });
});

describe("Target Roles: the Career Mentor's weekly run", () => {
  function demo(): Context {
    const state = seedState(NOW);
    state.roleProfiles = [];
    const store = createMemoryStore(state);
    return { mode: "demo", userId: "demo", store, settings: { ...state.settings, careerRoles: ["AI Engineer", "Solutions Engineer", "Software Engineer", "GTM Engineer", "Forward Deployed Engineer"] }, now: NOW, today: TODAY, time: "18:00" } as Context;
  }
  const report = async (ctx: Context, roles: RoleOutlook[]) => ctx.store.market.saveReport({ forDate: TODAY, report: { total: 100, facts: [], outlook: roles } as never, summary: { headline: "h", points: [], focus: "f", writer: "rules" } as never });
  const writer = (calls: string[], refuse: string[] = []) => async (card: { role: string }) => (calls.push(card.role), refuse.includes(card.role) ? { text: null, usage: null, why: "Daily AI limit reached." } : { text: { ...good, closeSkill: "RAG" }, usage: null, why: "" });

  it("writes one profile for each of your five roles the Analyst has measured", async () => {
    const ctx = demo();
    const roles = (await import("@/lib/agents/career")).careerPrefs(ctx.settings).roles.map((r) => r.name);
    await report(ctx, roles.map((r) => outlook(r)));
    const calls: string[] = [];
    const out = await runRoleProfiles(ctx, { trigger: "schedule", honorPause: false, persist: ctx.store, write: writer(calls) });
    if ("missing" in out) throw new Error(out.why);
    expect(roles).toHaveLength(5);
    expect(calls).toEqual(roles);
    expect(out.written).toEqual(roles);
    const saved = await ctx.store.roleProfiles.recent(40);
    expect(saved.map((p) => p.forWeek)).toEqual(Array(5).fill("2026-11-23"));
    expect(saved[0]).toMatchObject({ postings: 42, writer: "model" });
    expect(saved[0]!.facts).toHaveLength(4);
    // Logged as the Career Mentor's work, with counts only.
    const run = (await ctx.store.agentRuns.recent(10)).find((r) => r.task === ROLE_PROFILES_TASK && r.status === "succeeded")!;
    expect(run).toMatchObject({ agent: "mentor", trigger: "schedule" });
    expect(run.detail).toContain("5 written, 0 kept, 0 waiting");
    expect(run.detail).not.toContain(good.does.slice(0, 20));
  });

  it("does not write a role twice in a week unless you ask, and says what is waiting", async () => {
    const ctx = demo();
    const roles = (await import("@/lib/agents/career")).careerPrefs(ctx.settings).roles.map((r) => r.name);
    await report(ctx, [outlook(roles[0]!), outlook(roles[1]!), outlook(roles[2]!, { thin: true })]);
    const calls: string[] = [];
    const first = await runRoleProfiles(ctx, { trigger: "schedule", honorPause: false, persist: ctx.store, write: writer(calls, [roles[1]!]) });
    if ("missing" in first) throw new Error(first.why);
    expect(first.written).toEqual([roles[0]]);
    expect(first.waiting).toEqual([
      { role: roles[1], why: "Daily AI limit reached." },
      { role: roles[2], why: "too few postings to describe it" },
      { role: roles[3], why: "too few postings to describe it" },
      { role: roles[4], why: "too few postings to describe it" },
    ]);
    // The next run that week writes only what is missing.
    calls.length = 0;
    const second = await runRoleProfiles(ctx, { trigger: "schedule", honorPause: false, persist: ctx.store, write: writer(calls) });
    if ("missing" in second) throw new Error(second.why);
    expect(calls).toEqual([roles[1]]);
    expect(second.kept).toEqual([roles[0]]);
    // "Update now" writes them again.
    calls.length = 0;
    await runRoleProfiles(ctx, { trigger: "owner", honorPause: false, persist: ctx.store, write: writer(calls), rewrite: true });
    expect(calls).toEqual([roles[0], roles[1]]);
    expect((await ctx.store.roleProfiles.recent(40)).length).toBe(2);
  });

  it("waits, and calls no model, when there is no recent market report", async () => {
    const ctx = demo();
    const calls: string[] = [];
    const out = await runRoleProfiles(ctx, { trigger: "schedule", honorPause: false, persist: ctx.store, write: writer(calls) });
    expect(out).toMatchObject({ written: [], headline: "No role outlook yet: the Analyst computes it with the next market report." });
    expect(calls).toEqual([]);
  });

  it("is read-only for you in the database, and kept 60 days", () => {
    const sql = read("supabase/migrations/20261120010000_role_profiles.sql");
    expect(sql).toContain("alter table public.role_profiles enable row level security;");
    expect(sql).toContain("using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))");
    expect(sql).toContain("grant select on public.role_profiles to authenticated;");
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*role_profiles/);
    expect(sql).toContain("delete from public.role_profiles where for_week < current_date - 60;");
  });
});

describe("Target Roles: the ten skills these roles ask for most", () => {
  const post = (role: string, skills: string[], url: string) => ({ role, skills, url });

  it("counts job-board postings and job-search matches for your roles, each posting once", async () => {
    const { topSkillsAcross } = await import("@/lib/domain/roleProfile");
    const out = topSkillsAcross({
      boards: [post("A", ["Python", "RAG", "Python"], "https://x/1"), post("B", ["Python"], "https://x/2"), post("E", ["Rust"], "https://x/3")],
      searches: [post("A", ["RAG", "AWS"], "https://x/1?utm=li"), post("C", ["AWS"], "https://x/4"), post("D", ["SQL"], "https://x/5")],
      roles: ["A", "B", "C", "D", "X", "Y", "Z", "E"],
      have: ["python"],
      days: 30,
    });
    // Role E is eighth: past the seven you target. The search match for x/1 is the same posting as the board's.
    expect(out).toMatchObject({ postings: 4, fromBoards: 2, fromSearches: 2, days: 30 });
    expect(out.skills.map((s) => [s.skill, s.postings, s.have])).toEqual([
      ["Python", 2, true],
      ["AWS", 1, false],
      ["RAG", 1, false],
      ["SQL", 1, false],
    ]);
    expect(out.skills[0]).toMatchObject({ share: 0.5, roles: ["A", "B"] });
  });

  it("shows at most ten, most asked first", async () => {
    const { topSkillsAcross, TOP_SKILLS } = await import("@/lib/domain/roleProfile");
    const many = Array.from({ length: 14 }, (_, i) => post("A", Array.from({ length: i + 1 }, (_, j) => `S${j}`), `https://x/${i}`));
    const out = topSkillsAcross({ boards: many, searches: [], roles: ["A"], have: [], days: 30 });
    expect(TOP_SKILLS).toBe(10);
    expect(out.skills.map((s) => s.skill)).toEqual(["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9"]);
    expect(topSkillsAcross({ boards: [], searches: [], roles: ["A"], have: [], days: 30 })).toMatchObject({ skills: [], postings: 0 });
  });
});
