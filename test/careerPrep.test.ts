import { describe, expect, it } from "vitest";
import { ANSWER_BANK, fillAnswer, followUpEmail, followUpsDue, isScorecardDay, prepareAnswers, weeklyScorecard } from "@/lib/domain/careerPrep";
import type { Application } from "@/lib/domain/types";

const TODAY = "2026-11-20"; // a Friday
let seq = 0;
const app = (over: Partial<Application>): Application => {
  seq++;
  return {
    id: `a${seq}`,
    company: `Co${seq}`,
    role: "Solutions Engineer",
    type: "full-time",
    targetRole: "Solutions Engineer",
    source: "Email",
    url: "",
    payText: "",
    tier: "semi",
    status: "applied",
    appliedOn: "2026-11-10",
    statusAt: "2026-11-10T15:00:00Z",
    notes: "",
    origin: "atlas",
    externalId: "",
    createdAt: "2026-11-10T15:00:00Z",
    ...over,
  };
};

describe("Answer bank", () => {
  it("tailors answers to the job and falls back to starter text", () => {
    expect(fillAnswer("Why {company}? As a {role}...", { company: "Acme", role: "FDE" })).toBe("Why Acme? As a FDE...");
    const ready = prepareAnswers({ intro: "I build AI workflows.", whyCompany: "I admire {company}'s product." }, { company: "Acme", role: "Solutions Engineer" });
    expect(ready.find((a) => a.id === "whyCompany")).toEqual({ id: "whyCompany", question: "Why do you want to work at Acme?", answer: "I admire Acme's product.", isStarter: false });
    expect(ready.find((a) => a.id === "salary")).toMatchObject({ isStarter: true });
    // Questions with no answer and no starter text are left out.
    expect(ready.find((a) => a.id === "workHistory")).toBeUndefined();
    expect(ANSWER_BANK.map((q) => q.id)).toContain("authorization");
  });
});

describe("Follow-ups", () => {
  it("queues one follow-up for applications quiet for a week, never twice", () => {
    const quiet = app({ appliedOn: "2026-11-12" });
    const recent = app({ appliedOn: "2026-11-16", statusAt: "2026-11-16T15:00:00Z" });
    const moved = app({ status: "replied" });
    const noDate = app({ appliedOn: null });
    expect(followUpsDue([quiet, recent, moved, noDate], [], TODAY).map((a) => a.id)).toEqual([quiet.id]);
    expect(followUpsDue([quiet], [{ kind: "follow-up", applicationId: quiet.id }], TODAY)).toEqual([]);
    expect(followUpsDue([quiet], [{ kind: "application", applicationId: null }], TODAY)).toHaveLength(1);
  });

  it("writes a short follow-up you send yourself", () => {
    const named = followUpEmail({ company: "Acme", role: "Solutions Engineer", appliedOn: "2026-11-10" }, "Tyler");
    expect(named.subject).toBe("Following up: Solutions Engineer application");
    expect(named.body).toContain("the Solutions Engineer role at Acme on 2026-11-10");
    expect(named.body.endsWith("Tyler")).toBe(true);
    expect(followUpEmail({ company: "Brightcall", role: "Role not listed", appliedOn: null }, "Tyler").subject).toBe("Following up on my application to Brightcall");
  });
});

describe("Friday scorecard", () => {
  it("counts the last seven days and the overall response rate", () => {
    const s = weeklyScorecard(
      [
        app({ appliedOn: "2026-11-18" }),
        app({ appliedOn: "2026-11-15", status: "replied", statusAt: "2026-11-19T15:00:00Z" }),
        app({ appliedOn: "2026-11-01", status: "interview", statusAt: "2026-11-17T15:00:00Z" }),
        app({ appliedOn: "2026-11-01", status: "rejected", statusAt: "2026-11-02T15:00:00Z" }),
        app({ status: "saved", appliedOn: null }),
      ],
      TODAY,
    );
    expect(s).toMatchObject({ from: "2026-11-14", to: TODAY, sent: 2, replies: 1, interviews: 1, offers: 0, rejections: 0, responseRate: 75, open: 3 });
    expect(isScorecardDay(TODAY)).toBe(true);
    expect(isScorecardDay("2026-11-19")).toBe(false);
  });
});

describe("Applications with no role", () => {
  it("are raised by the Mentor once they are a real share of the tracker", async () => {
    const { observe } = await import("@/lib/domain/mentor");
    const base = { today: TODAY, slot: "morning" as const, roles: ["AI Engineer"], approvals: [], matches: [], market: null, skills: [], resumes: null, answersWritten: 0, answersTotal: 0, linkedin: "", plan: { fullTime: 3, gigs: 1 }, prior: [] };
    const blind = [app({ role: "Role not listed", targetRole: "" }), app({ role: "Role not listed", targetRole: "" }), app({})];
    const seen = observe({ ...base, applications: blind }).find((o) => o.id === "results:no-role");
    expect(seen).toMatchObject({ area: "results", metric: "2/3" });
    expect(seen!.fact).toBe("2 of your 3 tracked applications have no role on them, so replies cannot be compared by role.");
    // One in four is not worth a nudge, and neither is a tracker with two rows.
    expect(observe({ ...base, applications: [app({ role: "Role not listed" }), app({}), app({}), app({})] }).some((o) => o.id === "results:no-role")).toBe(false);
    expect(observe({ ...base, applications: [app({ role: "Role not listed" }), app({ role: "Role not listed" })] }).some((o) => o.id === "results:no-role")).toBe(false);
  });
});

describe("The target role of a title you applied for", () => {
  it("sets the level aside, and says nothing for a title that is not one of your roles", async () => {
    const { targetRoleFor } = await import("@/lib/domain/applications");
    const { roleFor } = await import("@/lib/domain/careerAgent");
    const { rolesFrom } = await import("@/lib/domain/targetRoles");
    const roles = rolesFrom(["AI Engineer", "Solutions Engineer", "Forward Deployed Engineer"]);
    const of = (t: string) => targetRoleFor(t, (x) => roleFor(x, roles)?.name ?? "");
    expect(of("Solutions Engineer")).toBe("Solutions Engineer");
    expect(of("Senior Solutions Engineer")).toBe("Solutions Engineer");
    expect(of("Staff AI Engineer II")).toBe("AI Engineer");
    expect(of("Sr. Forward Deployed Engineer")).toBe("Forward Deployed Engineer");
    expect(of("Office Manager")).toBe("");
    expect(of("Senior")).toBe("");
  });
});
