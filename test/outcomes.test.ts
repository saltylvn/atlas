import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyFacts, diagnose, fingerprint, funnel, levelOf, linkKit, outcomeOf, resumeVersion } from "@/lib/domain/outcomes";
import type { Application, Approval, JobMatch } from "@/lib/domain/types";

// Step 0 of the agent plan (23 Nov 2026): every application records what it was sent with,
// and the funnel reads what gets replies.

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const TODAY = "2026-11-23";
const app = (over: Partial<Application>): Application => ({ id: Math.random().toString(36).slice(2), company: "Acme", role: "Software Engineer", targetRole: "Software Engineer 1", source: "Greenhouse", url: "", payText: "", tier: "semi", status: "applied", appliedOn: "2026-11-01", statusAt: "2026-11-01T12:00:00Z", notes: "", origin: "atlas", externalId: "", createdAt: "2026-11-01T12:00:00Z", ...over });
const match = (over: Partial<JobMatch>): JobMatch => ({ id: "m1", key: "k1", title: "Software Engineer I", company: "Acme", url: "https://example.com/j", source: "Greenhouse", location: "Remote", role: "Software Engineer 1", payText: "", postedAt: "2026-11-18T00:00:00Z", score: 80, shownOn: "2026-11-19", shownSlot: "morning", rating: 1, status: "pursuing", createdAt: "2026-11-19T12:00:00Z", ...over });
const kit = (matchId: string): Approval => ({ id: `a-${matchId}`, kind: "application", title: "t", detail: "", url: "https://example.com/j", matchId, status: "approved", decidedAt: null, createdAt: "2026-11-19T12:00:00Z" });

describe("What an application is sent with", () => {
  it("reads the level a title states", () => {
    expect(levelOf("Software Engineer I")).toBe("early");
    expect(levelOf("Associate Software Engineer")).toBe("early");
    expect(levelOf("Software Engineer II")).toBe("mid");
    expect(levelOf("Senior Software Engineer")).toBe("senior");
    expect(levelOf("Staff Engineer, Platform")).toBe("senior");
    expect(levelOf("Software Engineer, Growth")).toBe("unstated");
  });

  it("names the resume sent and fingerprints its text, so an edit in Figma is a new version", () => {
    const resumes = [{ name: "Software Engineer 1", text: "Built Atlas in TypeScript" }];
    const v = resumeVersion("Software Engineer 1", resumes);
    expect(v).toMatch(/^Software Engineer 1 · [0-9a-f]{8}$/);
    expect(resumeVersion("Software Engineer 1", [{ name: "Software Engineer 1", text: "Built Atlas in TypeScript and Go" }])).not.toBe(v);
    // The old Notion name still finds it.
    expect(resumeVersion("AI Software Engineer", resumes)).toBe(v);
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
  });

  it("records level, posting date, resume version, and warm when you know someone there", () => {
    expect(applyFacts({ title: "Software Engineer I", postedAt: "2026-11-18T09:00:00Z", role: "Software Engineer 1", resumes: [{ name: "Software Engineer 1", text: "x" }], knowSomeone: true })).toMatchObject({ level: "early", postedOn: "2026-11-18", warm: true });
    expect(applyFacts({ title: "Engineer", postedAt: null, role: "", resumes: [], knowSomeone: false })).toEqual({ level: "unstated", postedOn: null, resumeVersion: "", warm: null });
  });

  it("links an emailed application to the one job queued at that company in the 3 weeks before, and never guesses between two", () => {
    const m = match({});
    expect(linkKit({ company: "Acme Inc.", appliedOn: "2026-11-21", createdAt: "2026-11-21T00:00:00Z" }, [kit("m1")], [m])?.id).toBe("m1");
    const m2 = match({ id: "m2", key: "k2", title: "Backend Engineer" });
    expect(linkKit({ company: "Acme", appliedOn: "2026-11-21", createdAt: "2026-11-21T00:00:00Z" }, [kit("m1"), kit("m2")], [m, m2])).toBeNull();
    expect(linkKit({ company: "Other Co", appliedOn: "2026-11-21", createdAt: "2026-11-21T00:00:00Z" }, [kit("m1")], [m])).toBeNull();
  });

  it("the database keeps the facts, nullable where not known", () => {
    const sql = read("supabase/migrations/20261124020000_application_outcomes.sql");
    for (const c of ["level text", "posted_on date", "resume_version text not null default ''", "tailored boolean", "warm boolean"]) expect(sql).toContain(c);
    expect(read("app/actions/career.ts")).toMatch(/const facts = match \? await factsFor\(store, match\) : null;/);
    expect(read("lib/agents/career.ts")).toContain("const link = changes.create.length ? await linkerFor(persist) : null;");
  });
});

describe("The funnel", () => {
  it("judges an application once it has an answer or 14 days have passed", () => {
    expect(outcomeOf(app({ status: "applied", appliedOn: "2026-11-20" }), TODAY)).toBe("too-new");
    expect(outcomeOf(app({ status: "applied", appliedOn: "2026-11-01" }), TODAY)).toBe("silent");
    expect(outcomeOf(app({ status: "rejected", appliedOn: "2026-11-20" }), TODAY)).toBe("rejected");
    expect(outcomeOf(app({ status: "interview" }), TODAY)).toBe("replied");
  });

  it("slices by level, counts fast rejections, and says what they point at", () => {
    const apps = [
      ...Array.from({ length: 4 }, () => app({ status: "rejected", role: "Senior Software Engineer", appliedOn: "2026-11-05", statusAt: "2026-11-12T00:00:00Z" })),
      app({ status: "interview", role: "Software Engineer I", level: "early", tailored: true, appliedOn: "2026-11-05" }),
      app({ status: "applied", appliedOn: "2026-11-21" }),
    ];
    const f = funnel(apps, TODAY);
    expect(f).toMatchObject({ sent: 6, judged: 5, tooNew: 1, replied: 1, rejected: 4 });
    expect(f.by.level.find((s) => s.key === "senior")).toMatchObject({ sent: 4, replied: 0, fastRejections: 4 });
    expect(f.by.level.find((s) => s.key === "early")).toMatchObject({ sent: 1, replied: 1 });
    const reads = diagnose(f).join(" ");
    expect(reads).toContain("4 of 4 rejections came within 10 days");
    expect(reads).toContain("4 applications went to senior, staff or lead titles with no reply");
    expect(reads).toContain("5 of 6 applications were logged without their facts");
  });

  it("the Tracker shows it, and each application has Tailored and Warm", () => {
    expect(read("app/(app)/(career)/status/page.tsx")).toContain("<FunnelCard f={funnel(apps, today)} />");
    expect(read("app/(app)/(career)/applications/[id]/page.tsx")).toContain("<ApplicationFlags id={app.id}");
    expect(read("app/actions/career.ts")).toMatch(/export async function setApplicationFlags[\s\S]{0,200}Flags\.safeParse/);
  });
});
