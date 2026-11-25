import { describe, expect, it } from "vitest";
import { followUpEmail } from "@/lib/domain/careerPrep";
import type { Fact } from "@/lib/domain/companyResearch";
import { followUpReplies, greeting, nightPicks, parseFollowUpOut, reviewFollowUp, type FollowUpAgentOut } from "@/lib/domain/followUpAgent";

const FACTS: Fact[] = [
  { id: "a1", text: "Applied on November 12 for the Software Engineer I role at Larkspur Labs." },
  { id: "r1", text: "Headline (2026-11-20): Larkspur Labs raises $12 million to expand its scheduling platform" },
  { id: "p1", text: "Must-have you proved: TypeScript APIs. Your proof: built a TypeScript scheduling API with tests." },
];
const base = (person: string | null = null) => ({ draft: followUpEmail({ company: "Larkspur Labs", role: "Software Engineer I", appliedOn: "2026-11-12" }, "Tyler"), company: "Larkspur Labs", role: "Software Engineer I", name: "Tyler", person });
const body = (hello = "Hi,") =>
  `${hello}\n\nI applied for the Software Engineer I role at Larkspur Labs on November 12 and wanted to follow up. Congratulations on raising $12 million to expand your scheduling platform. I recently built a TypeScript scheduling API with tests, and I would love to help the team grow the platform. Is there anything else I can share for your review?\n\nThank you,\nTyler`;
const good = (over: Partial<FollowUpAgentOut> = {}): FollowUpAgentOut => ({
  subject: "Following up on my Software Engineer I application",
  body: body(),
  hook: { text: "Larkspur Labs raised $12 million to expand its scheduling platform.", cites: ["r1"] },
  ...over,
});

describe("reviewFollowUp", () => {
  it("passes a short, specific follow-up whose hook cites what was read", () => {
    const r = reviewFollowUp(good(), FACTS, base());
    expect(r.notes).toBe("");
    expect(r.mail?.body).toContain("$12 million");
  });
  it("allows a number only when the hook's cited fact has it", () => {
    expect(reviewFollowUp(good({ body: body().replace("$12 million", "$40 million") }), FACTS, base()).pass).toBe(false);
  });
  it("refuses a hook that cites nothing read, or is not used in the email", () => {
    expect(reviewFollowUp(good({ hook: { text: "They are hiring fast across teams.", cites: ["z1"] } }), FACTS, base()).pass).toBe(false);
    expect(reviewFollowUp(good({ hook: { text: "Their Kubernetes migration finished in October.", cites: ["p1"] } }), FACTS, base()).notes).toMatch(/Use the hook|numbers/);
  });
  it("greets the person when Atlas knows one", () => {
    expect(reviewFollowUp(good(), FACTS, base("Dana Whitfield")).notes).toMatch(/Hi Dana,/);
    expect(reviewFollowUp(good({ body: body("Hi Dana,") }), FACTS, base("Dana Whitfield")).pass).toBe(true);
  });
  it("keeps the existing rules: company, role, signature, no email address", () => {
    expect(reviewFollowUp(good({ body: body().replace("Tyler", "T.") }), FACTS, base()).pass).toBe(false);
    expect(reviewFollowUp(good({ body: body().replace("Is there", "Write me at me@x.com. Is there") }), FACTS, base()).pass).toBe(false);
  });
  it("wants 50 to 120 words", () => {
    const short = "Hi,\n\nFollowing up on the Software Engineer I role at Larkspur Labs after the $12 million raise for the scheduling platform. Thanks.\n\nThank you,\nTyler";
    expect(reviewFollowUp(good({ body: short }), FACTS, base()).pass).toBe(false);
  });
});

describe("helpers", () => {
  it("greets by first name, or plainly", () => {
    expect([greeting("Dana Whitfield"), greeting(null), greeting(" "), greeting("J")]).toEqual(["Hi Dana,", "Hi,", "Hi,", "Hi,"]);
  });
  it("reads the agent's answer only in the right shape", () => {
    expect(parseFollowUpOut(JSON.stringify(good()))).toEqual(good());
    expect(parseFollowUpOut("{}")).toBeNull();
    expect(parseFollowUpOut("nope")).toBeNull();
  });
  it("picks the oldest waiting follow-ups the agent has not written", () => {
    const a = (id: string, createdAt: string, over = {}) => ({ id, kind: "follow-up" as const, status: "pending" as const, createdAt, ...over });
    const list = [a("c", "2026-11-03"), a("a", "2026-11-01"), a("b", "2026-11-02"), a("x", "2026-10-01", { kind: "application" as const }), a("y", "2026-10-02", { status: "approved" as const })];
    expect(nightPicks(list, new Set(["a"]))).toEqual(["b", "c"]);
  });
  it("counts replies within a week of a follow-up you sent, and leaves open ones out", () => {
    const fu = (id: string, app: string, decidedAt: string) => ({ id, kind: "follow-up" as const, status: "approved" as const, decidedAt, applicationId: app });
    const approvals = [fu("f1", "a1", "2026-11-10T16:00:00Z"), fu("f2", "a2", "2026-11-10T16:00:00Z"), fu("f3", "a3", "2026-11-22T16:00:00Z")];
    const apps = [
      { id: "a1", lastHeardAt: "2026-11-13T10:00:00Z" },
      { id: "a2", lastHeardAt: "2026-11-01T10:00:00Z" },
      { id: "a3", lastHeardAt: null },
    ];
    expect(followUpReplies(approvals, apps, new Set(["f1"]), "2026-11-24")).toEqual({ sent: 2, replied: 1, agent: { sent: 1, replied: 1 } });
  });
});
