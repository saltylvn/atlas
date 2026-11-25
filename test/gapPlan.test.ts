import { describe, expect, it } from "vitest";
import type { Lesson } from "@/lib/domain/agentState";
import { assign, briefOk, closingRepo, EMPTY_PLAN, gradeInsight, lessonCandidates, lessonsToSave, nextProof, proofPlan, rankGaps, rulesBrief, similarity } from "@/lib/domain/gapPlan";
import { findings, funnel } from "@/lib/domain/outcomes";
import { skillEvidence } from "@/lib/domain/portfolio";
import type { Application } from "@/lib/domain/types";

const ROLE = "Software Engineer 1";
const post = (title: string, skills: string[], role = ROLE) => ({ title, role, skills });
const POSTINGS = [
  post("Software Engineer I", ["TypeScript", "AWS", "Docker"]),
  post("Junior Software Engineer", ["TypeScript", "AWS"]),
  post("Software Engineer", ["AWS", "Kubernetes"]),
  post("Associate Software Engineer", ["Docker", "TypeScript"]),
  post("Senior Software Engineer", ["Kubernetes", "Go"]),
  post("Staff Software Engineer", ["Kubernetes", "Go"]),
  post("Data Engineer", ["Spark"], "Data Engineer"),
];

describe("rankGaps", () => {
  const evidence = skillEvidence([{ name: "atlas", skills: ["TypeScript"], pushedAt: "2026-11-20" }], [], ["Go"]);

  it("ranks the skills nothing of yours shows, junior postings weighing more", () => {
    const g = rankGaps(POSTINGS, ROLE, evidence);
    expect(g.map((x) => x.skill)).toEqual(["AWS", "Docker", "Kubernetes"]);
    expect(g[0]).toMatchObject({ share: 0.5, postings: 6 });
  });

  it("leaves out what a project or resume shows, but not a skill only ticked", () => {
    const g = rankGaps(POSTINGS, ROLE, evidence, 10).map((x) => x.skill);
    expect(g).not.toContain("TypeScript");
    expect(g).toContain("Go");
  });

  it("measures shares over postings that name skills, so title-only postings do not make every skill look rare", () => {
    const titleOnly = Array.from({ length: 40 }, () => post("Software Engineer", []));
    expect(rankGaps([...POSTINGS, ...titleOnly], ROLE, evidence)[0]).toMatchObject({ skill: "AWS", share: 0.5, postings: 6 });
  });

  it("says nothing on too few postings", () => {
    expect(rankGaps(POSTINGS.slice(0, 3), ROLE, evidence)).toEqual([]);
  });
});

describe("proof projects, one at a time", () => {
  const gaps = rankGaps(POSTINGS, ROLE, new Map());
  const repo = (name: string, skills: string[], pushedAt: string) => ({ name, skills, pushedAt });

  it("assigns the top gap when nothing is open", () => {
    const step = nextProof(EMPTY_PLAN, gaps, [], "2026-11-24");
    expect(step.kind).toBe("assign");
    if (step.kind !== "assign") return;
    const plan = assign(step.plan, step.gap, ROLE, { text: rulesBrief(step.gap.skill, ROLE), writer: "rules" }, "2026-11-24");
    expect(plan.current).toMatchObject({ skill: step.gap.skill, assignedOn: "2026-11-24", closedOn: null });
  });

  it("keeps it open until a repo pushed since then shows the skill, then closes it", () => {
    const plan = assign(EMPTY_PLAN, gaps[0]!, ROLE, { text: "x", writer: "rules" }, "2026-11-24");
    const skill = gaps[0]!.skill;
    expect(nextProof(plan, gaps, [repo("old", [skill], "2026-11-01")], "2026-11-25").kind).toBe("keep");
    const step = nextProof(plan, gaps, [repo("old", [skill], "2026-11-01"), repo("new-thing", [skill.toLowerCase()], "2026-11-26T10:00:00Z")], "2026-11-27");
    expect(step.kind).toBe("closed");
    if (step.kind === "closed") {
      expect(step.closed).toMatchObject({ closedOn: "2026-11-27", repo: "new-thing" });
      expect(step.plan.current).toBeNull();
      // The next day assigns the next gap, never the closed one again.
      const next = nextProof(step.plan, gaps, [], "2026-11-28");
      expect(next.kind === "assign" && next.gap.skill).toBe(gaps[1]!.skill);
    }
  });

  it("closingRepo needs both the date and the skill", () => {
    expect(closingRepo({ skill: "AWS", assignedOn: "2026-11-24" }, [repo("a", ["Docker"], "2026-11-25")])).toBeNull();
  });

  it("a model's brief must name the skill, stay short and carry no links", () => {
    expect(briefOk("Build a small AWS Lambda API with tests and a README, in a week.", "AWS")).toBe(true);
    expect(briefOk("Build a small API with tests and a README, in a week or so.", "AWS")).toBe(false);
    expect(briefOk("Use AWS like https://example.com shows, with tests and a README.", "AWS")).toBe(false);
  });

  it("a bad stored plan reads as empty", () => {
    expect(proofPlan({ current: 3 })).toEqual(EMPTY_PLAN);
    expect(proofPlan(undefined)).toEqual(EMPTY_PLAN);
  });
});

describe("gradeInsight: the critique before a rewrite", () => {
  const ev = ["obs"];
  it("passes one concrete, evidenced step for today", () => {
    expect(gradeInsight({ action: "Apply to the two junior roles at Acme today with your Software Engineer resume.", evidence: ev }).pass).toBe(true);
  });
  it("fails advice for later, with no evidence, or that repeats what you did", () => {
    expect(gradeInsight({ action: "Over the next month, learn AWS.", evidence: ev }).notes.join()).toContain("today");
    expect(gradeInsight({ action: "Apply to one job.", evidence: [] }).notes.join()).toContain("observation");
    const g = gradeInsight({ action: "Add a TypeScript testing bullet to your resume.", evidence: ev }, ["Added a TypeScript testing bullet to the resume"]);
    expect(g.notes.join()).toContain("already did");
  });
  it("similarity is about the words, not their order", () => {
    expect(similarity("resume bullet about testing", "testing bullet resume")).toBe(1);
    expect(similarity("", "x")).toBe(0);
  });
});

describe("memory: lessons kept while results confirm them", () => {
  const app = (status: Application["status"], appliedOn: string, statusAt: string, role = "Senior Software Engineer"): Application =>
    ({ id: appliedOn + status + role, company: "Co", role, targetRole: ROLE, source: "x", url: "", payText: "", status, appliedOn, statusAt, createdAt: appliedOn, level: null, resumeVersion: null, postedOn: null, tailored: null, warm: null }) as unknown as Application;
  const apps = [app("rejected", "2026-11-01", "2026-11-05T00:00:00Z"), app("rejected", "2026-11-02", "2026-11-06T00:00:00Z"), app("rejected", "2026-11-03", "2026-11-07T00:00:00Z")];
  const f = findings(funnel(apps, "2026-11-24"));

  it("funnel findings carry stable ids", () => {
    expect(f.map((x) => x.id)).toEqual(expect.arrayContaining(["early-read", "fast-screen", "senior-silent"]));
  });

  it("adds a lesson once, then confirms it when the funnel says it again", () => {
    const c = lessonCandidates(f, [], "2026-11-24");
    const first = lessonsToSave([], c, "2026-11-24");
    expect(first.add.map((l) => l.evidence.split(" | ")[0])).toEqual(["funnel:fast-screen", "funnel:senior-silent"]);
    const stored: Lesson[] = first.add.map((l, i) => ({ ...l, id: `l${i}`, confirmed: 0 }));
    const again = lessonsToSave(stored, c, "2026-11-30");
    expect(again.add).toEqual([]);
    expect(again.confirm).toEqual([
      { id: "l0", expiresOn: "2026-12-21" },
      { id: "l1", expiresOn: "2026-12-21" },
    ]);
  });

  it("remembers an Action Taken note once, and only a done one from the last 30 days", () => {
    const ins = [
      { id: "i1", status: "done" as const, ownerNote: "Added AWS to my resume", title: "Close the AWS gap", forDate: "2026-11-20" },
      { id: "i2", status: "dismissed" as const, ownerNote: "no", title: "x", forDate: "2026-11-20" },
      { id: "i3", status: "done" as const, ownerNote: "old", title: "y", forDate: "2026-09-01" },
    ];
    const c = lessonCandidates([], ins, "2026-11-24");
    expect(c.map((x) => x.key)).toEqual(["action:i1"]);
    const expired: Lesson = { id: "x", agent: "mentor", lesson: "", evidence: "action:i1 | note", confirmed: 0, expiresOn: "2026-11-01" };
    expect(lessonsToSave([expired], c, "2026-11-24").add).toEqual([]);
  });
});

describe("the Career Mentor sees your proof project", () => {
  it("raises the open project, then a win once GitHub closes it", async () => {
    const { observe } = await import("@/lib/domain/mentor");
    const base = { today: "2026-12-02", slot: "morning", roles: [ROLE], applications: [], approvals: [], matches: [], market: null, skills: ["TypeScript"], resumes: null, answersWritten: 9, answersTotal: 9, linkedin: "x", plan: 0, prior: [], perfect: [], contacts: [] };
    const plan = assign(EMPTY_PLAN, { skill: "AWS", share: 0.5, earlyShare: 0.6, postings: 20, score: 0.56 }, ROLE, { text: "Build a small AWS Lambda API with tests. Push it.", writer: "model" }, "2026-11-24");
    const open = observe({ ...base, proof: plan } as never).find((o) => o.id === "skills:proof:AWS");
    expect(open).toMatchObject({ severity: 62, metric: "8d" });
    expect(open!.action).toContain("Build a small AWS Lambda API with tests.");
    const closed = { current: null, done: [{ ...plan.current!, closedOn: "2026-12-01", repo: "lambda-api" }] };
    expect(observe({ ...base, proof: closed } as never).find((o) => o.id === "win:proof:AWS")?.fact).toContain("lambda-api");
  });
});
