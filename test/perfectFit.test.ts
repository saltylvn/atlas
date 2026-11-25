import { describe, expect, it } from "vitest";
import { applyThumb, queueThumbsWithoutKit } from "@/lib/applyQueue";
import { roleResume } from "@/lib/applyResume";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { PERFECT, thumbStep, thumbsWithoutKit } from "@/lib/domain/applications";
import { perfectFirst } from "@/lib/domain/applyLane";
import { candidates, likePerfect, PERFECT_LIKE_MAX, tasteFrom, type RawJob } from "@/lib/domain/careerAgent";
import { observe, type MentorInput } from "@/lib/domain/mentor";
import { PERFECT_REVIEWED, perfectFitObservations, perfectFits, type PerfectFitInput } from "@/lib/domain/perfectFit";
import { PREVIEW_BACK, previewRole, resumePreviewHref } from "@/lib/domain/resumeProof";
import { REMOTE_BOARDS } from "@/lib/integrations/jobFeeds";
import { TARGET_ROLES } from "@/lib/domain/targetRoles";
import type { Application, Approval, Contact, JobMatch } from "@/lib/domain/types";

const NOW = new Date("2026-11-19T18:00:00Z");
const TODAY = "2026-11-19";
const gh = (n: number) => `https://job-boards.greenhouse.io/acme/jobs/${n}`;

const match = (id: string, over: Partial<JobMatch> = {}): JobMatch => ({ id, key: `key-${id}`, title: "AI Engineer", company: "Acme", url: gh(1), source: "Greenhouse", location: "Remote", role: "AI Engineer", payText: "$120k", postedAt: null, score: 80, shownOn: "2026-11-17", shownSlot: "morning", rating: PERFECT, status: "pursuing", skills: ["Python", "RAG", "Kubernetes"], createdAt: "2026-11-17T15:00:00Z", ...over });
const kit = (id: string, matchId: string | null, over: Partial<Approval> = {}): Approval => ({ id, kind: "application", title: "AI Engineer at Acme", detail: "", url: gh(1), matchId, status: "pending", decidedAt: null, createdAt: "2026-11-17T16:00:00Z", ...over }) as Approval;

describe("Perfect fit: a stronger thumbs-up", () => {
  const m = (status: JobMatch["status"] = "new") => ({ id: "m1", status });

  it("queues the job like a thumbs-up and says the Career Mentor will look at it", () => {
    expect(thumbStep(m(), [], 2)).toEqual({ queue: true, withdraw: [], status: "pursuing", note: "Perfect fit: added first in your apply queue. The Career Mentor will look at how to land it." });
    // Already queued by a thumbs-up: it is only marked, never queued twice.
    expect(thumbStep(m("pursuing"), [{ id: "a", matchId: "m1", status: "pending" }], 2)).toMatchObject({ queue: false, withdraw: [], status: "pursuing" });
    // A job already applied to keeps its place on the board.
    expect(thumbStep(m("applied"), [], 2)).toMatchObject({ queue: false, status: "applied" });
  });

  it("is stored as rating 2, audited once, and taken back like any thumb", async () => {
    const state = seedState(NOW);
    const store = createMemoryStore(state);
    (state.jobMatches ??= []).push(match("m1", { rating: 0, status: "new" }));
    await applyThumb(store, {}, (await store.jobMatches.get("m1"))!, 2, NOW);
    expect(await store.jobMatches.get("m1")).toMatchObject({ rating: 2, status: "pursuing" });
    expect((await store.jobMatches.perfect()).map((x) => x.id)).toEqual(["m1"]);
    const marked = async () => (await store.audit.recent(200)).filter((a) => a.action === "career.perfect-fit").length;
    expect(await marked()).toBe(1);
    await applyThumb(store, {}, (await store.jobMatches.get("m1"))!, 2, NOW);
    expect(await marked()).toBe(1);
    // Tapping it again clears it: out of the queue, no longer a perfect fit.
    await applyThumb(store, {}, (await store.jobMatches.get("m1"))!, 0, NOW);
    expect(await store.jobMatches.get("m1")).toMatchObject({ rating: 0, status: "new" });
    expect(await store.jobMatches.perfect()).toEqual([]);
  });

  it("keeps the thumbs-up when the database does not know Perfect fit yet", async () => {
    const state = seedState(NOW);
    const store = createMemoryStore(state);
    (state.jobMatches ??= []).push(match("m1", { rating: 0, status: "new" }));
    // A database whose rating check still allows only -1, 0 and 1.
    const old = { ...store, jobMatches: { ...store.jobMatches, update: async (id: string, patch: { rating?: number }) => (patch.rating === 2 ? Promise.reject(new Error("check constraint")) : store.jobMatches.update(id, patch as never)) } };
    const step = await applyThumb(old as never, {}, (await store.jobMatches.get("m1"))!, 2, NOW);
    expect(step.note).toContain("Saved as a 👍");
    expect(await store.jobMatches.get("m1")).toMatchObject({ rating: 1, status: "pursuing" });
    expect((await store.approvals.list()).filter((a) => a.matchId === "m1" && a.status === "pending")).toHaveLength(1);
  });

  it("a perfect fit with no kit is put back in a queue and stays a perfect fit", async () => {
    expect(thumbsWithoutKit([{ id: "p", rating: 2, status: "new" as const }], []).map((x) => x.id)).toEqual(["p"]);
    const state = seedState(NOW);
    const store = createMemoryStore(state);
    (state.jobMatches ??= []).push(match("m1", { rating: 2, status: "new" }));
    expect(await queueThumbsWithoutKit(store, {}, TODAY, NOW)).toBeGreaterThanOrEqual(1);
    expect(await store.jobMatches.get("m1")).toMatchObject({ rating: 2, status: "pursuing" });
  });
});

describe("Perfect fits come first in a queue", () => {
  it("orders by perfect fit, then by how long each has waited", () => {
    const kits = [kit("old", "m-old", { createdAt: "2026-11-10T10:00:00Z" }), kit("best", "m-best", { createdAt: "2026-11-18T10:00:00Z" }), kit("new", "m-new", { createdAt: "2026-11-15T10:00:00Z" }), kit("follow", null, { createdAt: "2026-11-09T10:00:00Z" })];
    expect(perfectFirst(kits, new Set(["m-best"])).map((k) => k.id)).toEqual(["best", "follow", "old", "new"]);
    expect(perfectFirst(kits, new Set()).map((k) => k.id)).toEqual(["follow", "old", "new"].concat("best").sort((a, b) => kits.find((k) => k.id === a)!.createdAt.localeCompare(kits.find((k) => k.id === b)!.createdAt)));
  });

  it("puts a perfect fit at the top of the Apply Queue", () => {
    const kits = [kit("a", "m-a", { url: gh(1), createdAt: "2026-11-10T10:00:00Z" }), kit("b", "m-b", { url: gh(2), createdAt: "2026-11-18T10:00:00Z" })];
    expect(perfectFirst(kits, new Set()).map((k) => k.id)).toEqual(["a", "b"]);
    expect(perfectFirst(kits, new Set(["m-b"])).map((k) => k.id)).toEqual(["b", "a"]);
  });
});

describe("More like your perfect fits", () => {
  const now = new Date("2026-11-16T15:00:00Z");
  const prefs = { roles: [...TARGET_ROLES], minSalary: 85_000 };
  let n = 0;
  const job = (text: string): RawJob => ({ key: `j${++n}`, source: "Remote OK", title: "AI Engineer", company: `Co ${n}`, url: `https://x.test/${n}`, location: "", text, postedAt: new Date(now.getTime() - 5 * 3_600_000).toISOString() });

  it("remembers the skills a perfect fit asks for, and ignores a plain thumbs-up's", () => {
    const taste = tasteFrom([
      { role: "AI Engineer", company: "Acme", source: "Greenhouse", rating: 2, skills: ["Python", "RAG"] },
      { role: "AI Engineer", company: "Bolt", source: "Greenhouse", rating: 2, skills: ["RAG"] },
      { role: "AI Engineer", company: "Cask", source: "Jobicy", rating: 1, skills: ["Kubernetes"] },
    ]);
    expect([...taste.skills]).toEqual([["python", 1], ["rag", 2]]);
    // A perfect fit counts double for its role, company and source.
    expect(taste.role.get("ai engineer")).toBe(5);
    expect(taste.company.get("acme")).toBe(2);
  });

  it("gives a posting 3 for each shared skill, up to 12, and nothing when none is marked", () => {
    const taste = tasteFrom([{ role: "AI Engineer", company: "Acme", source: "x", rating: 2, skills: ["Python", "RAG", "MCP", "AI agents", "LLM apps"] }]);
    expect(likePerfect(["Python"], taste)).toBe(3);
    expect(likePerfect(["Python", "RAG", "Kubernetes"], taste)).toBe(6);
    expect(likePerfect(["Python", "RAG", "MCP", "AI agents", "LLM apps"], taste)).toBe(PERFECT_LIKE_MAX);
    expect(likePerfect(["Python", "RAG"], tasteFrom([]))).toBe(0);
  });

  it("ranks a posting that asks for the same skills above one that does not", () => {
    const alike = job("We build RAG pipelines and AI agents in Python.");
    const other = job("We maintain billing reports.");
    const plain = candidates([other, alike], prefs, tasteFrom([]), now, REMOTE_BOARDS);
    expect(plain[0]!.score).toBe(plain[1]!.score);
    const taste = tasteFrom([{ role: "Solutions Engineer", company: "Elsewhere", source: "Somewhere", rating: 2, skills: ["RAG", "AI agents", "Python"] }]);
    const ranked = candidates([other, alike], prefs, taste, now, REMOTE_BOARDS);
    expect(ranked[0]!.key).toBe(alike.key);
    expect(ranked[0]!.score - ranked[1]!.score).toBe(9);
  });
});

describe("What the Career Mentor is told about a perfect fit", () => {
  const contact = (name: string, notes: string): Contact => ({ id: name, name, circle: "network", email: null, phone: null, cadenceDays: 0, lastContactAt: null, notes }) as Contact;
  const input = (over: Partial<PerfectFitInput> = {}): PerfectFitInput => ({ today: TODAY, perfect: [match("m1")], approvals: [kit("k1", "m1")], applications: [], skills: ["Python", "RAG"], resumeSkills: ["Python"], contacts: [], ...over });
  const application = (over: Partial<Application>): Application => ({ id: "app1", company: "Acme", role: "AI Engineer", targetRole: "AI Engineer", source: "Greenhouse", url: gh(1), payText: "", tier: "auto", status: "applied", appliedOn: "2026-11-18", statusAt: "2026-11-18T15:00:00Z", notes: "", origin: "atlas", externalId: "match:key-m1", createdAt: "2026-11-18T15:00:00Z", ...over }) as Application;

  it("says what it asks, what you have, what is missing and where it stands", () => {
    const [f] = perfectFits(input());
    expect(f).toMatchObject({ asks: ["Python", "RAG", "Kubernetes"], have: ["Python", "RAG"], missing: ["Kubernetes"], notOnResume: ["RAG"], stage: "apply-queue", days: 2, referral: "" });
    const [o] = perfectFitObservations(input());
    expect(o).toMatchObject({ id: "perfect:m1", area: "targeting", metric: "apply-queue/1/2" });
    expect(o!.fact).toBe("You marked AI Engineer at Acme a perfect fit. It asks for Python, RAG and Kubernetes; you have 2 of 3, and not Kubernetes. No resume of yours mentions RAG, which you list as yours. It is first in your Apply Queue, not applied to yet, 2 days after you chose it.");
    expect(o!.action).toBe("Add one line that shows RAG to your AI Engineer resume, then apply today. Lead your answers with Python and RAG.");
  });

  it("puts a referral first, and names the right queue", () => {
    const [o] = perfectFitObservations(input({ contacts: [contact("Dana Lee", "Works at Acme on the platform team")], resumeSkills: ["Python", "RAG"] }));
    expect(o!.fact).toContain("You know Dana Lee there.");
    expect(o!.action).toBe("Message Dana Lee about Acme before you apply, then apply today. Lead your answers with Python and RAG.");
    const mac = perfectFitObservations(input({ approvals: [kit("k1", "m1", { url: "https://jobicy.com/jobs/1" })], resumeSkills: ["Python", "RAG"] }))[0]!;
    expect(mac.fact).toContain("It is first in your Apply Queue, not applied to yet");
    expect(mac.action).toContain("Apply to it on your MacBook today");
    const phone = perfectFitObservations(input({ resumeSkills: ["Python", "RAG"] }))[0]!;
    expect(phone.action).toContain("Apply to it on your MacBook today");
  });

  it("changes its advice once you have applied, and again when the company is quiet", () => {
    const sent = perfectFitObservations(input({ applications: [application({})] }))[0]!;
    expect(sent.fact).toContain("You applied 1 day ago and have no reply yet.");
    expect(sent.action).toContain("While you wait, write two short stories");
    const quiet = perfectFitObservations(input({ applications: [application({ appliedOn: "2026-11-10" })] }))[0]!;
    expect(quiet.action).toContain("Send the follow-up to Acme");
    expect(quiet.severity).toBeGreaterThan(sent.severity);
    expect(quiet.metric).not.toBe(sent.metric);
    const answered = perfectFitObservations(input({ applications: [application({ status: "interview" })] }))[0]!;
    expect(answered.action).toContain("Reply to Acme today");
  });

  it("looks at three at most, the ones not applied to first, and never a dismissed one", () => {
    const perfect = [match("a"), match("b"), match("c"), match("d"), match("gone", { status: "dismissed" })];
    const out = perfectFitObservations(input({ perfect, approvals: [], applications: [application({ externalId: "match:key-a" })] }));
    expect(out).toHaveLength(PERFECT_REVIEWED);
    expect(out.map((o) => o.id)).toEqual(["perfect:b", "perfect:c", "perfect:d"]);
    expect(perfectFitObservations(input({ perfect: [] }))).toEqual([]);
  });

  it("reaches the Career Mentor as its most pressing observation", () => {
    const base: MentorInput = { today: TODAY, slot: "morning", roles: ["AI Engineer"], applications: [], approvals: [kit("k1", "m1")], matches: [], market: null, skills: ["Python", "RAG"], resumes: { names: ["AI Engineer"], skills: ["Python", "RAG"] }, answersWritten: 9, answersTotal: 9, linkedin: "x", plan: 0, prior: [], perfect: [match("m1")], contacts: [] };
    const seen = observe(base);
    const top = [...seen].sort((a, b) => b.severity - a.severity)[0]!;
    expect(top.id).toBe("perfect:m1");
    // With none marked, nothing is said about them.
    expect(observe({ ...base, perfect: [] }).some((o) => o.id.startsWith("perfect:"))).toBe(false);
  });
});

describe("The resume a job will use, shown before it is prepared", () => {
  it("links to the in-app viewer by role, and returns to where you were", () => {
    expect(resumePreviewHref("AI + Automation Engineer", "fits")).toBe("/career/resume?role=AI%20%2B%20Automation%20Engineer&from=fits");
    expect(PREVIEW_BACK).toEqual({ brief: "/", fits: "/career#fits", queue: "/career#apply-lane", mac: "/career#approvals" });
  });

  it("accepts a role name and nothing that could be an address or markup", () => {
    expect(previewRole(" AI Engineer ")).toBe("AI Engineer");
    expect(previewRole("AI + Automation Engineer")).toBe("AI + Automation Engineer");
    for (const bad of [undefined, "", "https://evil.test/x.pdf", "<script>", "a".repeat(81), "role\nname", "x?y=z"]) expect(previewRole(bad)).toBe("");
  });

  it("names the resume and returns the PDF in the demo, without calling Notion", async () => {
    const ctx = { settings: {}, mode: "demo" } as never;
    expect(await roleResume(ctx, "AI Engineer", false)).toEqual({ ok: true, resume: "AI Engineer" });
    const file = await roleResume(ctx, "AI Engineer", true);
    expect(file.ok && file.bytes && Buffer.from(file.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
