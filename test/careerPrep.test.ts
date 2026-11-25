import { describe, expect, it } from "vitest";
import { acceptPolish, ANSWER_BANK, emailDate, fillAnswer, followUpEmail, followUpsDue, isOldFollowUp, spokenRole, isScorecardDay, prepareAnswers, weeklyScorecard } from "@/lib/domain/careerPrep";
import type { Application } from "@/lib/domain/types";

const TODAY = "2026-11-20"; // a Friday
let seq = 0;
const app = (over: Partial<Application>): Application => {
  seq++;
  return {
    id: `a${seq}`,
    company: `Co${seq}`,
    role: "Solutions Engineer",
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

  it("writes a short follow-up you send yourself, in plain words", () => {
    const named = followUpEmail({ company: "Acme", role: "Solutions Engineer", appliedOn: "2026-11-10" }, "Tyler");
    expect(named.subject).toBe("Following up on my Solutions Engineer application");
    expect(named.body).toContain("I applied for the Solutions Engineer role at Acme on November 10");
    expect(named.body.startsWith("Hi,\n\n")).toBe(true);
    expect(named.body.endsWith("Thank you,\nTyler")).toBe(true);
    // No role known: it says so once, not "the role I applied for".
    const bare = followUpEmail({ company: "Brightcall", role: "Role not listed", appliedOn: null }, "Tyler");
    expect(bare.subject).toBe("Following up on my application to Brightcall");
    expect(bare.body).toContain("I applied to Brightcall recently");
    expect(bare.body).not.toMatch(/applied for the role I applied for|role role/);
  });

  it("says a job title the way a person would", () => {
    const cases: [string, string][] = [
      ["Applied AI Engineer - USA", "Applied AI Engineer"],
      ["Solutions Engineer (Remote)", "Solutions Engineer"],
      ["Solutions Engineer, Remote", "Solutions Engineer"],
      ["Integration Engineer | Lehi, UT", "Integration Engineer"],
      ["Software Engineer II - R-12345", "Software Engineer II"],
      ["Forward Deployed Engineer role", "Forward Deployed Engineer"],
      ["Solutions Consultant", "Solutions Consultant"],
      ["AI/ML Engineer", "AI/ML Engineer"],
      ["Role not listed", ""],
      ["", ""],
    ];
    for (const [raw, said] of cases) expect(spokenRole(raw), raw).toBe(said);
    expect(emailDate("2026-11-12")).toBe("November 12");
    expect(emailDate(null)).toBe("");
    expect(followUpEmail({ company: "Inviso", role: "Applied AI Engineer - USA", appliedOn: "2026-11-12" }, "Tyler").body).toContain("for the Applied AI Engineer role at Inviso on November 12");
  });

  it("does not word every follow-up the same, and never doubles a word", () => {
    const companies = ["Inviso", "1-800 Contacts", "Datarails", "AxisCare", "ScaleOps", "Talkdesk", "Acme", "Northwind"];
    const bodies = companies.map((company) => followUpEmail({ company, role: "", appliedOn: "2026-11-11" }, "Tyler").body);
    expect(new Set(bodies.map((b) => b.replace(/Inviso|1-800 Contacts|Datarails|AxisCare|ScaleOps|Talkdesk|Acme|Northwind/g, "X"))).size).toBeGreaterThan(1);
    for (const b of bodies) {
      const w = b.toLowerCase().match(/[a-z']+/g)!;
      expect(w.some((x, i) => i > 0 && x === w[i - 1]), b).toBe(false);
      expect(b).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    }
    // The same application always gets the same wording.
    expect(followUpEmail({ company: "Acme", role: "", appliedOn: null }, "Tyler")).toEqual(followUpEmail({ company: "Acme", role: "", appliedOn: null }, "Tyler"));
    // Every draft the old template wrote is recognized, and none the new one writes.
    expect(isOldFollowUp("Subject: Following up: Solutions Consultant application\n\nHi,\n\nI applied for the Solutions Consultant role at Datarails on 2026-11-11 and wanted to follow up.")).toBe(true);
    expect(isOldFollowUp("Hi,\n\nI applied for the role I applied for at Talkdesk on 2026-11-11 and wanted to follow up.")).toBe(true);
    for (const b of bodies) expect(isOldFollowUp(b)).toBe(false);
  });

  it("keeps a model's rewrite only when it keeps the facts, adds none, and reads cleanly", () => {
    const facts = { company: "Acme", role: "Solutions Engineer", name: "Tyler" };
    const draft = followUpEmail({ company: "Acme", role: "Solutions Engineer", appliedOn: "2026-11-10" }, "Tyler");
    const good = { subject: "Following up on my Solutions Engineer application", body: "Hi,\n\nI applied for the Solutions Engineer role at Acme on November 10 and wanted to check in on where things stand. I remain very interested in the position and would be glad to talk through my background whenever it is convenient. Please let me know if there is anything more I can send along.\n\nThank you,\nTyler" };
    expect(acceptPolish(draft, good, facts)).toEqual(good);
    const bad: [string, Partial<typeof good>][] = [
      ["drops the company", { body: good.body.replace("at Acme ", "") }],
      ["drops the role", { subject: "Following up", body: good.body.replace("the Solutions Engineer role", "a role") }],
      ["changes the sign-off", { body: good.body.replace(/Tyler$/, "T.") }],
      ["adds a number", { body: good.body.replace("my background", "my 7 years of background") }],
      ["changes the date", { body: good.body.replace("November 10", "November 12") }],
      ["adds a link", { body: good.body.replace("send along.", "send along: https://example.com.") }],
      ["leaves a placeholder", { body: good.body.replace("Hi,", "Hi [Hiring Manager],") }],
      ["doubles a word", { body: good.body.replace("wanted to check", "wanted to to check") }],
      ["says a sentence twice", { body: good.body.replace("\n\nThank you", " Please let me know if there is anything more I can send along.\n\nThank you") }],
      ["is too long", { body: good.body.replace("\n\nThank you", ` ${"I am a careful and reliable engineer who enjoys new problems. ".repeat(12)}\n\nThank you`) }],
      ["is too short", { body: "Hi,\n\nAny update on Acme and the Solutions Engineer role?\n\nThank you,\nTyler" }],
    ];
    for (const [why, change] of bad) expect(acceptPolish(draft, { ...good, ...change }, facts), why).toBeNull();
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
  it("are raised by the Career Mentor once they are a real share of the tracker", async () => {
    const { observe } = await import("@/lib/domain/mentor");
    const base = { today: TODAY, slot: "morning" as const, roles: ["AI Engineer"], approvals: [], matches: [], market: null, skills: [], resumes: null, answersWritten: 0, answersTotal: 0, linkedin: "", plan: 3, prior: [] };
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

describe("Follow-ups in the queue", () => {
  const NOW = new Date("2026-11-19T16:00:00Z");
  async function world() {
    const { createMemoryStore, seedState } = await import("@/lib/data/memory");
    const { queueFollowUps } = await import("@/lib/agents/career");
    const state = seedState(NOW);
    state.approvals = [];
    state.applications = [];
    const store = createMemoryStore(state);
    const ctx = { settings: { ...state.settings, displayName: "Tyler" }, today: "2026-11-19" };
    const app = (company: string, role: string) => store.applications.create({ company, role, targetRole: "", source: "email", url: "", payText: "", tier: "semi", status: "applied", appliedOn: "2026-11-11", statusAt: "2026-11-11T12:00:00.000Z", notes: "", origin: "atlas", externalId: `email:${company}` });
    return { store, ctx, app, queueFollowUps };
  }

  it("keeps the rules' draft when the model is off, fails, or writes something that breaks a check", async () => {
    const w = await world();
    await w.app("Datarails", "Solutions Consultant");
    await w.app("Talkdesk", "Role not listed");
    await w.app("Inviso", "Applied AI Engineer - USA");
    const calls: string[] = [];
    const n = await w.queueFollowUps(w.ctx, w.store, async (draft, facts) => {
      calls.push(facts.company);
      if (facts.company === "Datarails") return null;
      if (facts.company === "Talkdesk") throw new Error("model down");
      return { subject: draft.subject, body: draft.body.replace("November 11", "November 11, 2026, with 9 years of experience") };
    });
    expect(n).toBe(3);
    expect(calls.sort()).toEqual(["Datarails", "Inviso", "Talkdesk"]);
    const drafts = (await w.store.approvals.list()).map((a) => a.detail);
    for (const d of drafts) {
      expect(d).not.toMatch(/9 years|2026-11-11|the role I applied for|role role| - USA/);
      expect(d).toMatch(/^Subject: Following up on my /);
      expect(d.endsWith("Thank you,\nTyler")).toBe(true);
    }
    expect(drafts.find((d) => d.includes("Inviso"))).toContain("for the Applied AI Engineer role at Inviso on November 11");
  });

  it("uses the model's rewrite when it passes every check, and writes old waiting drafts again", async () => {
    const w = await world();
    const a = await w.app("Datarails", "Solutions Consultant");
    const old = await w.store.approvals.create({ kind: "follow-up", title: "Follow up with Datarails", detail: "Subject: Following up: Solutions Consultant application\n\nHi,\n\nI applied for the Solutions Consultant role at Datarails on 2026-11-11 and wanted to follow up.\n\nThank you,\nTyler", url: "", matchId: null, applicationId: a.id, status: "pending", decidedAt: null });
    const better = "Hi,\n\nI applied for the Solutions Consultant role at Datarails on November 11 and wanted to check in on where things stand. I remain very interested in the position and would be glad to talk through my background whenever it is convenient. Please let me know if there is anything more I can send along.\n\nThank you,\nTyler";
    const n = await w.queueFollowUps(w.ctx, w.store, async () => ({ subject: "Following up on my Solutions Consultant application", body: better }));
    // Already queued once: nothing new, but the old draft is rewritten in place.
    expect(n).toBe(0);
    expect((await w.store.approvals.get(old.id))!.detail).toBe(`Subject: Following up on my Solutions Consultant application\n\n${better}`);
    expect(await w.store.approvals.list()).toHaveLength(1);
  });
});

describe("The status board", () => {
  const T = "2026-11-19";
  const A = (over: Partial<Parameters<typeof app>[0]> & { id?: string } = {}) => ({ ...app(over), id: over.id ?? `a${Math.random()}` });

  it("puts every sent application in exactly one stage", async () => {
    const { huntBoard, STAGES } = await import("@/lib/domain/huntBoard");
    const apps = [
      A({ id: "fresh", appliedOn: "2026-11-17", statusAt: "2026-11-17T12:00:00Z" }),
      A({ id: "quiet", appliedOn: "2026-11-08", statusAt: "2026-11-08T12:00:00Z" }),
      A({ id: "nudged", appliedOn: "2026-11-01", statusAt: "2026-11-01T12:00:00Z", notes: "Followed up 2026-11-12." }),
      A({ id: "silent", appliedOn: "2026-10-10", statusAt: "2026-10-10T12:00:00Z" }),
      A({ id: "reply", appliedOn: "2026-11-10", status: "replied", statusAt: "2026-11-15T12:00:00Z" }),
      A({ id: "interview", appliedOn: "2026-11-05", status: "interview", statusAt: "2026-11-16T12:00:00Z", tier: "auto" }),
      A({ id: "no", appliedOn: "2026-11-02", status: "rejected", statusAt: "2026-11-14T12:00:00Z" }),
      A({ id: "saved", status: "saved", appliedOn: null }),
    ];
    const approvals = [{ id: "f1", kind: "follow-up" as const, title: "", detail: "", url: "", matchId: null, applicationId: "silent", status: "approved" as const, decidedAt: "2026-10-20T15:00:00Z", createdAt: "2026-10-18T15:00:00Z" }];
    const b = huntBoard({ apps, approvals, matches: [], today: T });
    const where = (id: string) => STAGES.filter((s) => b.stages[s].some((c) => c.id === id));
    expect(where("fresh")).toEqual(["applied"]);
    expect(where("quiet")).toEqual(["followUp"]);
    expect(where("nudged")).toEqual(["followedUp"]);
    expect(where("silent")).toEqual(["noLuck"]);
    expect(where("reply")).toEqual(["talking"]);
    expect(where("interview")).toEqual(["talking"]);
    expect(where("no")).toEqual(["rejected"]);
    // A job you only saved was never sent: it is on no stage and in no count.
    expect(where("saved")).toEqual([]);
    expect([b.sent, b.answered]).toEqual([7, 3]);
    expect(b.stages.talking.find((c) => c.id === "interview")).toMatchObject({ note: "interview", by: "atlas" });
    expect(b.stages.applied[0]).toMatchObject({ note: "applied 2d ago", by: "you" });
    expect(b.stages.noLuck[0]!.note).toBe("followed up 30d ago");
  });

  it("shows every undecided job as a fit, and every 👍 in the one Apply Queue", async () => {
    const { huntBoard } = await import("@/lib/domain/huntBoard");
    const match = (id: string, url: string, rating = 0) => ({ id, key: id, title: "Solutions Engineer", company: "Acme", url, source: "x", location: "", role: "Solutions Engineer", payText: "$95k–$120k", score: 50, rating, status: rating ? "pursuing" : "new", shownOn: T, slot: "morning", createdAt: `${T}T12:00:00Z` }) as never;
    const kit = { id: "k1", kind: "application" as const, title: "Solutions Engineer at Acme", detail: "", url: "https://job-boards.greenhouse.io/acme/jobs/2", matchId: null, status: "pending" as const, decidedAt: null, createdAt: `${T}T13:00:00Z` };
    const manual = { ...kit, id: "k2", title: "Solutions Engineer at Feed Co", url: "https://jobicy.com/jobs/1" };
    const b = huntBoard({ apps: [], approvals: [kit, manual, { ...manual, id: "k3", status: "approved" as const }], matches: [match("m1", "https://job-boards.greenhouse.io/acme/jobs/1"), match("m2", "https://www.linkedin.com/jobs/view/1"), match("m3", "https://job-boards.greenhouse.io/acme/jobs/2", 1)], today: T });
    // Good fits holds every job you have not decided on, whatever site it is on.
    expect(b.stages.fits.map((c) => c.id).sort()).toEqual(["m1", "m2"]);
    // Every job you said yes to waits in the Apply Queue, for your MacBook; a decided kit does not.
    expect(b.stages.queue.map((c) => c.id).sort()).toEqual(["k1", "k2"]);
    expect(b.stages.queue.find((c) => c.id === "k2")).toMatchObject({ title: "Solutions Engineer at Feed Co", note: "queued today" });
  });
});

describe("What the Career Mentor is told about the Apply Queue", () => {
  const T = "2026-11-19";
  const base = { today: T, slot: "morning" as const, roles: ["Solutions Engineer"], applications: [], matches: [], market: null, skills: [], resumes: null, answersWritten: 0, answersTotal: 0, linkedin: "", plan: 3, prior: [] };
  const kit = (id: string, url: string, day = T) => ({ id, kind: "application" as const, title: "Solutions Engineer at Acme", detail: "", url, matchId: null, status: "pending" as const, decidedAt: null, createdAt: `${day}T12:00:00Z` });
  const gh = (n: number) => `https://job-boards.greenhouse.io/acme/jobs/${n}`;

  it("says when jobs wait in the Apply Queue, and when good fits wait for a thumb", async () => {
    const { observe } = await import("@/lib/domain/mentor");
    const seen = observe({ ...base, approvals: [kit("a", gh(1)), kit("c", "https://jobicy.com/jobs/1", "2026-11-15"), kit("d", "https://www.linkedin.com/jobs/view/1", "2026-11-15")] } as never);
    // One queue: every job you said yes to, wherever it is posted.
    expect(seen.find((o) => o.id === "queue:waiting")!.fact).toContain("3 apply kits are waiting in your Apply Queue");
    expect(seen.some((o) => o.id === "queue:apply-for-me")).toBe(false);
    const match = (n: number, url: string) => ({ id: `m${n}`, key: `m${n}`, title: "Solutions Engineer", company: "Acme", url, source: "x", location: "", role: "Solutions Engineer", payText: "", score: 50, rating: 0, status: "new", shownOn: T });
    const fits = observe({ ...base, approvals: [], matches: [match(1, gh(1)), match(2, gh(2)), match(3, "https://jobicy.com/jobs/3")] } as never);
    expect(fits.find((o) => o.id === "queue:fits")?.fact).toBe("3 good fits are waiting for your thumb.");
  });

  it("no longer tells the Analyst's reader about automatic applying", async () => {
    const { marketReport } = await import("@/lib/domain/market");
    const { rolesFrom } = await import("@/lib/domain/targetRoles");
    const post = (n: number, url: string) => ({ id: `p${n}`, key: `p${n}`, title: "Solutions Engineer", company: `Co${n}`, source: "Feed", url, location: "Remote", role: "Solutions Engineer", place: "remote", payMin: null, payMax: null, payUnit: "", skills: [], postedAt: null, firstSeen: "2026-11-15", lastSeen: T, createdAt: `${T}T00:00:00Z` });
    const report = marketReport([post(1, gh(1)), post(2, gh(2)), post(3, "https://jobicy.com/jobs/3")] as never, rolesFrom(["Solutions Engineer"]), [], T);
    expect(report.facts.some((f) => f.includes("Greenhouse") || f.includes("Atlas can apply"))).toBe(false);
  });
});


describe("Lists that wait on you say so", () => {
  it("words the alert the same everywhere, with the count first", async () => {
    const { actionLabel } = await import("@/lib/domain/applyLane");
    expect(actionLabel(13)).toBe("13 jobs to take action on");
    expect(actionLabel(1)).toBe("1 job to take action on");
  });

  it("marks only the Tracker stages a job leaves when you act", async () => {
    const { ACTION_STAGES, STAGES } = await import("@/lib/domain/huntBoard");
    expect(STAGES.filter((s) => ACTION_STAGES.has(s))).toEqual(["fits", "queue", "followUp"]);
    // The bar keeps Show and Hide for screen readers when it shows the alert instead.
    const { readFileSync } = await import("node:fs");
    const ui = readFileSync("components/ui.tsx", "utf8");
    expect(ui).toContain('<span className="sr-only group-open/fold:hidden">Show</span>');
  });
});

describe("The Tracker's last two stages", () => {
  it("shows Dead end before Rejected, and says the work there is done", async () => {
    const { STAGES, STAGE_LABEL, STAGE_HINT } = await import("@/lib/domain/huntBoard");
    expect(STAGES.slice(-2).map((s) => STAGE_LABEL[s])).toEqual(["Dead end", "Rejected"]);
    expect(STAGE_HINT.noLuck).toBe("Silent 14 days after your follow-up: your work here is done");
    expect(Object.values(STAGE_LABEL)).not.toContain("No luck");
  });
});
