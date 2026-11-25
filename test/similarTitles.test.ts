import { describe, expect, it } from "vitest";
import { approvalFor } from "@/lib/domain/applications";
import { coreTitle, roleTitles, similarTitlesFor, titleCase } from "@/lib/domain/similarTitles";
import { TARGET_ROLES } from "@/lib/domain/targetRoles";

const m = (title: string, role: string, postedAt: string) => ({ title, role, postedAt, createdAt: postedAt });

describe("Similar job titles", () => {
  it("reduces posting titles to the job title itself", () => {
    expect(coreTitle("Senior Software Engineer — Kubernetes Control Plane")).toBe("Senior Software Engineer");
    expect(coreTitle("Solutions Architect - Digital Native Business (DNB)")).toBe("Solutions Architect");
    expect(coreTitle("Full Stack Engineer (TypeScript/React/Node)")).toBe("Full Stack Engineer");
    expect(coreTitle("Software Engineer, new product line")).toBe("Software Engineer");
    expect(coreTitle("forward-deployed product engineer")).toBe("Forward-Deployed Product Engineer");
    expect(titleCase("ai ml engineer")).toBe("AI ML Engineer");
    expect(titleCase("genai engineer")).toBe("GenAI Engineer");
  });

  it("groups real titles under each of your roles, most common first, in your role order", () => {
    const groups = roleTitles(
      [...TARGET_ROLES],
      [
        m("Applied AI Engineer", "AI Engineer", "2026-11-10T00:00:00Z"),
        m("Applied AI Engineer (Remote)", "AI Engineer", "2026-11-12T00:00:00Z"),
        m("Founding AI Engineer | Remote", "AI Engineer", "2026-11-11T00:00:00Z"),
        m("Solutions Architect - Retail", "Solutions Engineer", "2026-11-12T00:00:00Z"),
      ],
      [{ targetRole: "AI Engineer" }, { targetRole: "" }],
    );
    expect(groups.map((g) => g.role.name)).toEqual(TARGET_ROLES.map((r) => r.name));
    const byName = (n: string) => groups.find((g) => g.role.name === n)!;
    const ai = byName("AI Engineer");
    expect(ai.similar).toEqual([
      { title: "Applied AI Engineer", count: 2, lastSeen: "2026-11-12T00:00:00Z" },
      { title: "Founding AI Engineer", count: 1, lastSeen: "2026-11-11T00:00:00Z" },
    ]);
    expect(ai).toMatchObject({ matches: 3, applications: 1 });
    expect(ai.searchedFor).toContain("AI Integration Engineer");
    expect(groups[0]!.role.name).toBe("Solutions Engineer");
    expect(byName("Solutions Engineer").similar.map((t) => t.title)).toEqual(["Solutions Architect"]);
    expect(byName("AI Automation Engineer").similar).toEqual([]);
  });

  it("puts the role's resume link in the approval when you have one", () => {
    const match = { id: "x", title: "AI Engineer", company: "Acme", url: "https://x", source: "Remote OK", role: "AI Engineer", payText: "$150k", location: "", postedAt: null };
    expect(approvalFor(match, undefined, "https://drive.google.com/file/d/abc/view").detail).toContain("Resume: https://drive.google.com/file/d/abc/view");
    expect(approvalFor(match).detail).toContain("Use your AI Engineer resume.");
  });
});

describe("Four other names for each target role", () => {
  const role = (name: string) => TARGET_ROLES.find((r) => r.name === name)!;
  const P = (r: string, ...titles: string[]) => titles.map((title) => ({ title, role: r }));

  it("counts each posting under the title phrase it matched, never company or team words", () => {
    const posts = [
      ...P("Solutions Engineer", "Solutions Architect", "Sr Solutions Architect", "Solutions Architect - SLED (West)", "Senior Integration Engineer", "Software Integration Engineer", "Customer Success Engineer, EMEA", "Senior Sales Engineer", "Senior Solutions Engineer"),
      ...P("AI Engineer", "Feltsense AI Engineer"),
    ];
    expect(similarTitlesFor(role("Solutions Engineer"), posts)).toEqual([
      { title: "Solutions Architect", count: 3, from: "postings" },
      { title: "Integration Engineer", count: 2, from: "postings" },
      { title: "Customer Success Engineer", count: 1, from: "postings" },
      { title: "Sales Engineer", count: 1, from: "postings" },
    ]);
    // "Feltsense AI Engineer" is the role's own name with a company in front: not another name.
    expect(similarTitlesFor(role("AI Engineer"), posts).every((t) => t.from === "searched")).toBe(true);
  });

  it("treats spellings as one name and fills in from the search list, marked, up to four", () => {
    const got = similarTitlesFor(role("AI Automation Engineer"), P("AI Automation Engineer", "GTM Engineer", "Go-To-Market Engineer", "Senior GTM Systems Engineer"));
    expect(got.map((t) => [t.title, t.count, t.from])).toEqual([
      ["GTM Engineer", 2, "postings"],
      ["GTM Systems Engineer", 1, "postings"],
      ["Intelligent Automation Engineer", 0, "searched"],
      ["Internal AI Engineer", 0, "searched"],
    ]);
    for (const r of TARGET_ROLES) {
      const four = similarTitlesFor(r, []);
      expect(four).toHaveLength(4);
      // Never the role's own name or a spelling of it, never a bare search term like "FDE".
      expect(four.map((t) => t.title.toLowerCase())).not.toContain(r.name.toLowerCase());
      expect(four.every((t) => t.title.split(" ").length >= 2)).toBe(true);
    }
    expect(similarTitlesFor(role("Solutions Engineer"), []).map((t) => t.title)).not.toContain("Solution Engineer");
  });
});
