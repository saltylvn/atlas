import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENTS } from "@/lib/domain/agents";
import { parseJobicy, REMOTE_BOARDS } from "@/lib/integrations/jobFeeds";
import type { MarketPosting } from "@/lib/domain/market";
import { dependencyNames, describeRepo, isShown, portfolioFrom, skillEvidence, type RawRepo } from "@/lib/domain/portfolio";
import {
  acceptJudgment,
  draftProposal,
  ORDER_MARGIN,
  ORDER_MIN_POSTINGS,
  outlookFact,
  outlookToStore,
  roleOutlook,
  withoutPrivate,
  worthProposing,
  type RoleOutlook,
  type RoleProposal,
} from "@/lib/domain/roleOutlook";
import { CANDIDATE_ROLES, candidatesBeyond, rolesFrom, TARGET_ROLES } from "@/lib/domain/targetRoles";

const TODAY = "2026-11-16";

// ---------------------------------------------------------------------------
// GitHub projects as evidence

const raw = (over: Partial<RawRepo> = {}): RawRepo => ({
  fullName: "sam/orbit",
  name: "orbit",
  description: "A supervisor agent that routes work to specialist agents.",
  url: "https://github.com/sam/orbit",
  isPrivate: false,
  fork: false,
  archived: false,
  pushedAt: "2026-11-10T12:00:00Z",
  topics: ["ai-agents", "nextjs", "row-level-security"],
  languages: { TypeScript: 9000, PLpgSQL: 700, CSS: 200, Shell: 10 },
  readme: "# Orbit\nA multi-agent assistant with an eval suite and a RAG search over your own records.",
  manifests: [{ path: "package.json", text: JSON.stringify({ dependencies: { next: "16.0.0", react: "19.0.0", "@supabase/supabase-js": "2", zod: "4" }, devDependencies: { vitest: "5", typescript: "5" } }) }],
  rootPaths: ["package.json", ".github", "supabase", "README.md", "vercel.json"],
  ...over,
});

describe("dependency files", () => {
  it("reads package names from package.json, requirements.txt and pyproject.toml", () => {
    expect(dependencyNames("package.json", JSON.stringify({ dependencies: { Next: "1" }, devDependencies: { vitest: "1" } }))).toEqual(["next", "vitest"]);
    expect(dependencyNames("requirements.txt", "fastapi>=0.110\n# a comment\npydantic[email]==2.7 ; python_version > '3.9'\n\nslack-sdk\n-r other.txt")).toEqual(["fastapi", "pydantic", "slack-sdk"]);
    expect(dependencyNames("pyproject.toml", '[project]\ndependencies = ["fastapi>=0.110", "google-genai", \'httpx[http2]~=0.27\']')).toEqual(expect.arrayContaining(["fastapi", "google-genai", "httpx"]));
    expect(dependencyNames("package.json", "{ not json")).toEqual([]);
    expect(dependencyNames("Cargo.toml", "serde = 1")).toEqual([]);
  });
});

describe("a repository as a portfolio entry", () => {
  const repo = describeRepo(raw(), TODAY);

  it("names the stack from dependencies and layout, and drops tooling languages", () => {
    expect(repo.stack).toEqual(expect.arrayContaining(["Next.js", "React", "Supabase", "Zod", "Automated tests", "GitHub Actions", "Vercel"]));
    expect(repo.languages).toEqual(["TypeScript", "PLpgSQL"]);
    expect(repo.checkedOn).toBe(TODAY);
  });

  it("lists the skills it demonstrates in the market report's own words", () => {
    expect(repo.skills).toEqual(expect.arrayContaining(["TypeScript", "Next.js", "React", "SQL", "AI agents", "RAG", "CI/CD", "Multi-agent orchestration"]));
  });

  it("keeps only a github.com link, and clips long text", () => {
    expect(describeRepo(raw({ url: "https://evil.example/x" }), TODAY).url).toBe("");
    expect(describeRepo(raw({ description: "x".repeat(900) }), TODAY).description).toHaveLength(300);
  });

  it("leaves out forks, archived repositories and the profile repository", () => {
    const rows = portfolioFrom([raw(), raw({ name: "a-fork", fullName: "sam/a-fork", fork: true }), raw({ name: "old", fullName: "sam/old", archived: true }), raw({ name: "sam", fullName: "sam/sam" }), raw({ name: "empty", fullName: "sam/empty", languages: {}, topics: [], readme: "", description: "", manifests: [], rootPaths: [] })], "sam", TODAY);
    expect(rows.map((r) => r.name)).toEqual(["orbit"]);
  });
});

describe("skill evidence", () => {
  const ev = skillEvidence([{ name: "orbit", skills: ["RAG", "TypeScript"], pushedAt: "2026-11-10T00:00:00Z" }, { name: "relay", skills: ["RAG", "Python"], pushedAt: "2026-11-12T00:00:00Z" }], ["Python", "SQL"], ["AWS", "RAG"]);

  it("says where each skill shows up, most recent project first", () => {
    expect(ev.get("rag")).toEqual({ skill: "RAG", projects: ["relay", "orbit"], resume: false, ticked: true });
    expect(ev.get("sql")).toMatchObject({ projects: [], resume: true, ticked: false });
  });

  it("counts a skill as shown only when a project or a resume backs it", () => {
    expect(isShown(ev.get("rag"))).toBe(true);
    expect(isShown(ev.get("sql"))).toBe(true);
    expect(isShown(ev.get("aws"))).toBe(false);
    expect(isShown(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The outlook and the proposal

let n = 0;
const posting = (role: string, skills: string[], over: Partial<MarketPosting> = {}): MarketPosting => {
  n++;
  return { id: `p${n}`, key: `k${n}`, title: role, company: `Co${n}`, source: "Jobicy", url: `https://x.example/${n}`, location: "Remote", role, place: "remote", payMin: 130_000, payMax: 150_000, payUnit: "year", skills, postedAt: null, firstSeen: "2026-11-12", lastSeen: "2026-11-15", createdAt: "2026-11-12T00:00:00Z", ...over };
};
const many = (count: number, role: string, skills: string[], over: Partial<MarketPosting> = {}) => Array.from({ length: count }, () => posting(role, skills, over));
const roles = (names: string[]) => rolesFrom(names);
const evidence = skillEvidence([{ name: "orbit", skills: ["AI agents", "TypeScript", "RAG"], pushedAt: "2026-11-10T00:00:00Z" }, { name: "relay", skills: ["Python", "Workflow automation", "AI agents"], pushedAt: "2026-11-01T00:00:00Z" }], ["SQL"], ["Kubernetes"]);

describe("candidate roles", () => {
  it("are roles next to yours, never ones you already target", () => {
    expect(CANDIDATE_ROLES.map((r) => r.name)).not.toEqual(expect.arrayContaining(TARGET_ROLES.map((r) => r.name)));
    expect(candidatesBeyond(roles(["AI Engineer", "Data Engineer"])).map((r) => r.name)).not.toContain("Data Engineer");
    expect(candidatesBeyond([...TARGET_ROLES])).toHaveLength(CANDIDATE_ROLES.length);
  });
});

describe("roleOutlook", () => {
  const postings = [
    ...many(6, "AI Engineer", ["Kubernetes", "Python"]),
    ...many(8, "AI Automation Engineer", ["AI agents", "Workflow automation"]),
    ...many(2, "Forward Deployed Engineer", ["Salesforce"]),
    ...many(6, "Data Engineer", ["TypeScript", "AI agents"], { payMin: 90_000, payMax: 100_000 }),
  ];
  const out = roleOutlook(postings, roles(["AI Engineer", "AI Automation Engineer", "Forward Deployed Engineer"]), candidatesBeyond(roles(["AI Engineer", "AI Automation Engineer", "Forward Deployed Engineer"])), evidence, [], TODAY);
  const of = (role: string) => out.find((o) => o.role === role)!;

  it("measures what you can show, weighted by how often each skill is asked", () => {
    // Kubernetes is only ticked: it does not count. Python is in a project.
    expect(of("AI Engineer").qualified).toBe(0.5);
    expect(of("AI Engineer").asked.find((a) => a.skill === "Kubernetes")).toMatchObject({ shown: false, share: 1 });
    expect(of("AI Automation Engineer").qualified).toBe(1);
    expect(of("AI Automation Engineer").projects).toEqual(["relay"]);
  });

  it("marks a role with too few postings as thin and gives it no score", () => {
    expect(of("Forward Deployed Engineer")).toMatchObject({ thin: true, score: 0, postings: 2 });
    expect(outlookFact(of("Forward Deployed Engineer"))).toBe("Forward Deployed Engineer: 2 postings in the last 30 days, too few to judge.");
  });

  it("lists your roles in your order, then candidates by score, and scores qualification highest", () => {
    expect(out.slice(0, 3).map((o) => o.role)).toEqual(["AI Engineer", "AI Automation Engineer", "Forward Deployed Engineer"]);
    expect(out[3]).toMatchObject({ role: "Data Engineer", target: false });
    expect(of("AI Automation Engineer").score).toBeGreaterThan(of("AI Engineer").score + ORDER_MARGIN);
    // Pay under your floor costs a little; it does not decide.
    expect(of("Data Engineer").payMedian).toBe(95_000);
  });

  it("ignores postings older than the window and nudges the score by your own results", () => {
    const old = roleOutlook(many(6, "AI Engineer", ["Python"], { lastSeen: "2026-09-01", firstSeen: "2026-09-01" }), roles(["AI Engineer", "Forward Deployed Engineer"]), [], evidence, [], TODAY);
    expect(old[0]).toMatchObject({ postings: 0, thin: true });
    const apps = (status: "applied" | "interview") => Array.from({ length: 5 }, () => ({ targetRole: "AI Engineer", status, appliedOn: "2026-11-01" }));
    const base = roleOutlook(postings, roles(["AI Engineer", "AI Automation Engineer"]), [], evidence, [], TODAY)[0]!.score;
    expect(roleOutlook(postings, roles(["AI Engineer", "AI Automation Engineer"]), [], evidence, apps("applied"), TODAY)[0]!.score).toBeLessThan(base);
    expect(roleOutlook(postings, roles(["AI Engineer", "AI Automation Engineer"]), [], evidence, apps("interview"), TODAY)[0]!.score).toBeGreaterThan(base);
  });

  it("is stored without the thin candidates, and shown to a model without private project names", () => {
    expect(outlookToStore(out).map((o) => o.role)).toEqual(["AI Engineer", "AI Automation Engineer", "Forward Deployed Engineer", "Data Engineer"]);
    const masked = withoutPrivate(out, new Set(["relay"]));
    expect(JSON.stringify(masked)).not.toContain("relay");
    expect(masked.find((o) => o.role === "AI Automation Engineer")!.projects).toEqual(["a private project"]);
  });
});

const o = (role: string, score: number, over: Partial<RoleOutlook> = {}): RoleOutlook => ({ role, target: true, postings: 10, thisWeek: 3, lastWeek: 3, trend: "flat", reachable: 1, payMedian: 140_000, asked: [{ skill: "Python", share: 0.8, shown: true, projects: ["orbit"] }], qualified: score / 100, projects: ["orbit"], applied: 0, responses: 0, thin: false, score, ...over });

describe("draftProposal", () => {
  it("moves a role up only when it leads by the margin", () => {
    expect(draftProposal([o("A", 50), o("B", 50 + ORDER_MARGIN - 1), o("C", 40)])!.order).toEqual(["A", "B", "C"]);
    const d = draftProposal([o("A", 50), o("B", 50 + ORDER_MARGIN), o("C", 80)])!;
    expect(d.order).toEqual(["C", "B", "A"]);
    expect(d.focus).toEqual(["C", "B", "A"]);
    expect(d.headline).toContain("Lead with C");
    expect(d.reasons.find((r) => r.role === "C")!.why).toMatch(/^Moved up: you can show 80%/);
  });

  it("leaves a role with too little data exactly where you put it", () => {
    const d = draftProposal([o("A", 30), o("Thin", 0, { thin: true, postings: 1 }), o("B", 70), o("C", 50)])!;
    expect(d.order).toEqual(["B", "Thin", "C", "A"]);
    // Enough postings to show numbers for, but not enough to move a role on.
    const few = draftProposal([o("A", 30), o("Few", 95, { postings: ORDER_MIN_POSTINGS - 1 }), o("B", 70), o("C", 50)])!;
    expect(few.order).toEqual(["B", "Few", "C", "A"]);
    expect(few.reasons.find((r) => r.role === "Few")!.why).toMatch(/too few to move a role on/);
    expect(draftProposal([o("A", 30, { postings: 4 }), o("B", 90, { postings: 4 })])).toBeNull();
  });

  it("adds at most one candidate, only when it is well shown and would sit in your top three", () => {
    const strong = o("New", 90, { target: false, qualified: 0.9 });
    const d = draftProposal([o("A", 70), o("B", 60), o("C", 50), o("D", 40), strong, o("Also", 88, { target: false, qualified: 0.9 })])!;
    expect(d.added).toEqual(["New"]);
    expect(d.order).toEqual(["New", "A", "B", "C", "D"]);
    expect(d.mayAdd).toEqual(["New", "Also"]);
    // Not shown well enough, too few postings, or not clearly ahead of your third: not added.
    for (const weak of [o("New", 90, { target: false, qualified: 0.5 }), o("New", 90, { target: false, postings: 4 }), o("New", 52, { target: false, qualified: 0.9 })]) {
      expect(draftProposal([o("A", 70), o("B", 60), o("C", 50), weak])!.added).toEqual([]);
    }
  });

  it("says nothing when there is too little to go on", () => {
    expect(draftProposal([o("A", 50)])).toBeNull();
    expect(draftProposal([o("A", 50), o("B", 0, { thin: true })])).toBeNull();
    expect(draftProposal([])).toBeNull();
  });
});

describe("a model's judgment, checked", () => {
  const draft = draftProposal([o("A", 50), o("B", 70), o("C", 40), o("New", 90, { target: false, qualified: 0.9 })])!;
  const ok = { order: ["B", "A", "C"], headline: "Lead with B", reasons: [{ role: "B", why: "You can show 70% of what its 10 postings ask for." }] };

  it("is accepted when it keeps every role, explains each move and adds no number", () => {
    const a = acceptJudgment(draft, ok)!;
    expect(a.order).toEqual(["B", "A", "C"]);
    expect(a.focus).toEqual(["B", "A", "C"]);
    expect(a.added).toEqual([]);
    expect(acceptJudgment(draft, { ...ok, order: ["New", "B", "A", "C"], reasons: [...ok.reasons, { role: "New", why: "You can show 90% of what it asks for." }] })!.added).toEqual(["New"]);
  });

  it("is dropped when it removes a role, repeats one, or adds a role it was not offered", () => {
    expect(acceptJudgment(draft, { ...ok, order: ["B", "A"] })).toBeNull();
    expect(acceptJudgment(draft, { ...ok, order: ["B", "A", "C", "B"] })).toBeNull();
    expect(acceptJudgment(draft, { ...ok, order: ["B", "A", "C", "Astronaut"] })).toBeNull();
  });

  it("is dropped when a move has no reason, or a number is not in the facts", () => {
    expect(acceptJudgment(draft, { ...ok, reasons: [] })).toBeNull();
    expect(acceptJudgment(draft, { ...ok, reasons: [{ role: "B", why: "You can show 99% of what it asks for." }] })).toBeNull();
    expect(acceptJudgment(draft, { ...ok, headline: "Lead with B: 500 new postings" })).toBeNull();
  });
});

describe("worthProposing", () => {
  const draft = { base: ["A", "B"], order: ["B", "A"] };
  const prior = (status: RoleProposal["status"], forDate: string, proposed = ["B", "A"]) => [{ status, forDate, proposed }];

  it("needs a real change and nothing already waiting", () => {
    expect(worthProposing(draft, [], TODAY)).toBe(true);
    expect(worthProposing({ base: ["A", "B"], order: ["A", "B"] }, [], TODAY)).toBe(false);
    expect(worthProposing(draft, prior("new", "2026-11-01"), TODAY)).toBe(false);
  });

  it("rests after your decision, and after the Career Mentor's own", () => {
    expect(worthProposing(draft, prior("approved", "2026-11-12"), TODAY)).toBe(false);
    expect(worthProposing(draft, prior("approved", "2026-11-08"), TODAY)).toBe(true);
    expect(worthProposing(draft, prior("dismissed", "2026-11-01"), TODAY)).toBe(false);
    expect(worthProposing(draft, prior("dismissed", "2026-10-20"), TODAY)).toBe(true);
    // A different order than the one you dismissed may be raised.
    expect(worthProposing(draft, prior("dismissed", "2026-11-10", ["A", "B", "C"]), TODAY)).toBe(true);
    expect(worthProposing(draft, prior("declined", "2026-11-12"), TODAY)).toBe(false);
    expect(worthProposing(draft, prior("declined", "2026-11-05"), TODAY)).toBe(true);
    expect(worthProposing(draft, prior("stale", "2026-11-15"), TODAY)).toBe(true);
  });
});

describe("who may do what", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("only reads GitHub", () => {
    const src = read("lib/integrations/github.ts");
    expect(src).not.toMatch(/method:|"POST"|"PATCH"|"PUT"|"DELETE"/);
    expect(src).toContain("api.github.com");
  });

  it("lets the Career Mentor propose, never write your roles", () => {
    const src = read("lib/agents/mentorRoles.ts");
    expect(src).not.toMatch(/integrations\/notion|settings\.update|writeRolePriority|createRoleRow/);
    expect(src).toContain('takeAiCallWithin(ctx.store, ctx.settings, "mentor:roles", wait)');
    expect(src).toContain("acceptJudgment(");
    expect(src).toContain("withoutPrivate(");
  });

  it("writes an approved order from one place: your decision", () => {
    const action = read("app/actions/roles.ts");
    expect(action).toContain("const approved = optionNames(proposal.proposed);");
    expect(action).toContain("store.settings.update({ careerRoles: approved })");
    expect(action).toContain('proposal.status !== "new"');
    // Atlas owns the order: approving a proposal never writes to Notion.
    expect(action).not.toMatch(/integrations\/notion/);
    for (const f of ["lib/agents/mentor.ts", "lib/agents/mentorRoles.ts", "lib/agents/analyst.ts", "lib/agents/scout.ts", "lib/agents/portfolio.ts", "lib/agents/cron.ts", "lib/agents/sync.ts"]) expect(read(f)).not.toMatch(/careerRoles/);
  });

  it("says on the roster which agents use an AI model", () => {
    const uses = AGENTS.filter((a) => a.ai).map((a) => a.id).sort();
    expect(uses).toEqual(["analyst", "apply", "career", "chief-of-staff", "mentor"]);
    // The Scout reads GitHub and the job feeds by rules: nothing of yours goes to a model there.
    expect(read("lib/agents/scout.ts") + read("lib/agents/portfolio.ts")).not.toMatch(/@\/lib\/ai\//);
  });
});

describe("Jobicy postings", () => {
  const feed = {
    jobs: [
      { id: 162720, url: "https://jobicy.com/jobs/162720-forward-deployed-engineer", jobTitle: "Forward Deployed Engineer (AI &amp; Business)", companyName: "Acme", jobType: ["Full-Time"], jobGeo: "USA", jobDescription: "<p>Build <b>agent</b> workflows in Python.</p>", pubDate: "2026-11-16T15:38:59+00:00", salaryMin: 152000, salaryMax: 182000, salaryCurrency: "USD", salaryPeriod: "yearly" },
      { id: "2", url: "https://jobicy.com/jobs/2-contractor", jobTitle: "Automation Engineer", companyName: "Beta", jobType: "Contract", jobGeo: "Canada,  USA", jobExcerpt: "n8n and Zapier", salaryMin: 60, salaryMax: 80, salaryCurrency: "USD", salaryPeriod: "hourly" },
      { id: 3, url: "javascript:alert(1)", jobTitle: "Bad link" },
      { id: 4, jobTitle: "No link" },
    ],
  };

  it("keeps the listing link and source, plain text only, and yearly US pay", () => {
    const jobs = parseJobicy(feed);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ key: "jobicy:162720", source: "Jobicy", company: "Acme", url: "https://jobicy.com/jobs/162720-forward-deployed-engineer", location: "USA", salaryMin: 152000, salaryMax: 182000, postedAt: "2026-11-16T15:38:59.000Z" });
    expect(jobs[0]!.text).not.toMatch(/[<>]/);
    expect(jobs[0]!.text).toContain("Full-Time");
    // Hourly pay is left to the text: it must not be read as a yearly salary.
    expect(jobs[1]).toMatchObject({ key: "jobicy:2", salaryMin: undefined, salaryMax: undefined });
    expect(REMOTE_BOARDS.has("Jobicy")).toBe(true);
  });

  it("returns nothing for a reply it does not recognize", () => {
    expect(parseJobicy({ success: false })).toEqual([]);
    expect(parseJobicy("<html>")).toEqual([]);
  });
});

describe("the job sources list", () => {
  it("lists every source the Scout reads, grouping company boards, with zero rows kept", async () => {
    const { JOB_SOURCES, sourceCounts, sourceGroup } = await import("@/lib/domain/jobSources");
    const { REMOTE_BOARDS } = await import("@/lib/integrations/jobFeeds");
    // Every remote board the Scout treats specially is on the list you see.
    for (const b of REMOTE_BOARDS) expect(JOB_SOURCES.map((s) => s.name)).toContain(b);
    expect(sourceGroup("Acme careers")).toBe("Company boards");
    const rows = sourceCounts(
      [
        { source: "Jobicy", role: "AI Engineer", lastSeen: "2026-11-15" },
        { source: "Jobicy", role: "Developer Advocate", lastSeen: "2026-11-14" },
        { source: "Acme careers", role: "AI Engineer", lastSeen: "2026-11-10" },
        { source: "Remote OK", role: "AI Engineer", lastSeen: "2026-09-01" },
      ],
      ["AI Engineer"],
      "2026-10-17",
    );
    expect(rows.find((r) => r.name === "Jobicy")).toEqual({ name: "Jobicy", postings: 2, yours: 1, lastSeen: "2026-11-15" });
    expect(rows.find((r) => r.name === "Company boards")).toMatchObject({ postings: 1, yours: 1 });
    expect(rows.find((r) => r.name === "Remote OK")).toMatchObject({ postings: 0, lastSeen: null });
    expect(rows).toHaveLength(JOB_SOURCES.length);
  });
});

describe("showing where the AI model judges", () => {
  const read = (p: string) => readFileSync(p, "utf8");
  it("marks exactly the agents that call the model, on the map and in Mission Control", () => {
    const map = read("components/client/LiveMap.tsx");
    expect(map).toContain("p.ai && ai");
    const card = read("components/AiJudgmentCard.tsx");
    expect(card).toContain("AGENTS.filter((a) => a.ai");
    // The roster's "ai" field is the one source both read.
    for (const a of AGENTS) expect(Boolean(a.ai)).toBe(["chief-of-staff", "analyst", "career", "mentor", "apply"].includes(a.id));
  });
});
