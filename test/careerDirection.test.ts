import { describe, expect, it } from "vitest";
import { candidates, roleFor, tasteFrom, type RawJob } from "@/lib/domain/careerAgent";
import { CAREER_DIRECTION, isDemoOnly, marketNamesFor } from "@/lib/domain/careerDirection";
import { extractSkills, linkedinTuneup, PROJECT_SKILLS, skillDemand } from "@/lib/domain/skills";
import { TARGET_ROLES } from "@/lib/domain/targetRoles";
import { REMOTE_BOARDS } from "@/lib/integrations/jobFeeds";

const roles = [...TARGET_ROLES];
const now = new Date("2026-11-16T15:00:00Z");
const job = (title: string, text: string, over: Partial<RawJob> = {}): RawJob => ({
  key: title + text.length,
  source: "Remote OK",
  title,
  company: `Co ${title}`,
  url: "https://x.test/1",
  location: "",
  text,
  postedAt: new Date(now.getTime() - 5 * 3_600_000).toISOString(),
  ...over,
});

describe("Career direction", () => {
  it("maps every market role onto one of your roles", () => {
    expect(CAREER_DIRECTION.roles.map((r) => r.title)).toEqual(["Forward Deployed Engineer", "AI Agent Engineer", "AI Solutions Engineer", "AI Automation Engineer", "GTM Engineer"]);
    const names = roles.map((x) => x.name);
    for (const r of CAREER_DIRECTION.roles) expect(names).toContain(r.mapsTo);
    expect(marketNamesFor("Forward Deployed Engineer")).toEqual(["Agent Deployment Engineer", "Applied AI Engineer"]);
    expect(marketNamesFor("AI Workflow Engineer")).toEqual(["AI Agent Engineer", "Agentic AI Engineer"]);
    expect(marketNamesFor("Solutions Engineer")).toEqual(["AI Solutions Engineer"]);
    expect(marketNamesFor("Software Engineer")).toEqual([]);
  });

  it("matches the market titles to your roles", () => {
    const r = (t: string) => roleFor(t, roles)?.name ?? null;
    expect(r("Agent Deployment Engineer")).toBe("Forward Deployed Engineer");
    expect(r("Agentic AI Engineer")).toBe("AI Workflow Engineer");
    expect(r("Internal AI Engineer")).toBe("AI + Automation Engineer");
    expect(r("AI Solutions Engineer")).toBe("Solutions Engineer");
    expect(r("GTM Engineer")).toBe("GTM Engineer");
    expect(r("Go-to-Market Engineer")).toBe("GTM Engineer");
    expect(r("GTM Automation Engineer")).toBe("GTM Engineer");
    expect(r("Senior RevOps Engineer")).toBe("GTM Engineer");
  });

  it("spots demo-only pre-sales postings and ranks them lower", () => {
    const demo = "Run product demos to prospects, support account executives through the sales cycle, carry a quota.";
    const build = "Implement and deploy AI agents for customers, build integrations with their APIs, ship to production in Python.";
    expect(isDemoOnly("Solutions Engineer", demo)).toBe(true);
    expect(isDemoOnly("Sales Engineer", "Help close deals.")).toBe(true);
    expect(isDemoOnly("AI Solutions Engineer", build)).toBe(false);
    expect(isDemoOnly("Solutions Engineer", `${demo} ${build}`)).toBe(false);
    const ranked = candidates([job("Solutions Engineer", demo), job("AI Solutions Engineer", build)], { roles, minSalary: 120_000, minRate: 45 }, tasteFrom([]), now, REMOTE_BOARDS);
    expect(ranked.map((c) => c.title)).toEqual(["AI Solutions Engineer", "Solutions Engineer"]);
    expect(ranked[0]!.score - ranked[1]!.score).toBeGreaterThanOrEqual(15);
  });

  it("tracks the skills to showcase, with a portfolio plan for each", () => {
    expect(extractSkills("Build multi-agent systems with MCP servers; own evals and tracing with Langfuse")).toEqual(expect.arrayContaining(["Multi-agent orchestration", "MCP", "Evals & observability"]));
    expect(extractSkills("Our MCP integration")).toContain("MCP");
    for (const s of CAREER_DIRECTION.skills) if (s.tracks) expect(PROJECT_SKILLS).toContain(s.tracks);
  });

  it("keeps prompt engineering out of the LinkedIn tune-up", () => {
    const demand = skillDemand([{ role: "Solutions Engineer", skills: ["Prompt engineering", "MCP", "Evals & observability"] }], roles, ["Prompt engineering", "MCP"]);
    const t = linkedinTuneup(roles, demand, []);
    expect(t.addSkills).toEqual(["MCP"]);
    expect(t.headline).not.toContain("Prompt engineering");
    expect(t.learn).toEqual(["Evals & observability"]);
    expect(t.aboutTips.join(" ")).toContain("Drop");
  });
});
