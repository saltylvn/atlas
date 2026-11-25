import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAREER, CAREER_HUB, CAREER_HUB_LABEL, deskOf, DESKS, inCareer, isActive, NAV, PHONE_TABS } from "@/components/navItems";
import { MAIN_TABS } from "@/lib/domain/layout";

const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");

describe("navigation", () => {
  it("is laid out by desk: Daily Desk, Career Desk, System, Data and QA, each with its own color (24 Nov 2026)", () => {
    expect(DESKS.map((d) => [d.label, d.color])).toEqual([
      ["Daily Desk", "var(--c-daily)"],
      ["Career Desk", "var(--c-career)"],
      ["System", "var(--c-system)"],
      ["Data", "var(--c-data)"],
      ["QA", "var(--c-qa)"],
    ]);
    expect(DESKS.find((d) => d.id === "daily")!.items.map((i) => i.label)).toEqual(["Today", "Inbox", "Plan", "News", "Renewals", "People", "Projects", "Ask Atlas"]);
    expect(DESKS.find((d) => d.id === "career")!.items.map((i) => i.label)).toEqual(["Apply", "Pipeline", "Tracker", "Market", "Career Map", "Target Roles", "Resume Optimization", "Setup", "Growth"]);
    expect(DESKS.find((d) => d.id === "data")!.items.map((i) => i.label)).toEqual(["Data Pipeline"]);
    expect(DESKS.find((d) => d.id === "qa")!.items.map((i) => i.label)).toEqual(["QA review", "Evals"]);
    expect(DESKS.find((d) => d.id === "system")!.items.map((i) => i.label)).toEqual(["Mission Control", "Your team", "Connectors", "Settings"]);
    // The phone's bar: Today, the Career hub and Ask Atlas, then More (which lists every desk).
    expect(PHONE_TABS.map((n) => n.href)).toEqual(["/", "/career", "/ask"]);
    expect(PHONE_TABS.every((n) => n.mobile)).toBe(true);
    // The four tabs the QA bot's weekly review counts are still pages.
    for (const t of MAIN_TABS) expect(NAV.some((n) => n.href === t.href), t.label).toBe(true);
    expect(read("components/Nav.tsx")).toContain("DESKS.map((desk)");
    expect(read("app/(app)/more/page.tsx")).toContain("DESKS.map((desk)");
    expect(read("app/(app)/layout.tsx")).toContain("<DeskStripe />");
  });

  it("knows which desk every page belongs to, older and nested pages included", () => {
    const desk = (p: string) => deskOf(p)?.id ?? null;
    expect([desk("/"), desk("/inbox"), desk("/people/abc"), desk("/ask")]).toEqual(["daily", "daily", "daily", "daily"]);
    expect([desk("/career"), desk("/applications/demo-app-1"), desk("/status"), desk("/career/setup"), desk("/jobs"), desk("/roles"), desk("/growth")]).toEqual(["career", "career", "career", "career", "career", "career", "career"]);
    expect([desk("/data"), desk("/evals"), desk("/qa")]).toEqual(["data", "qa", "qa"]);
    expect([desk("/mission"), desk("/team"), desk("/connectors"), desk("/settings")]).toEqual(["system", "system", "system", "system"]);
    expect(desk("/more")).toBeNull();
  });

  it("keeps Inbox, Plan and Mission Control under More, so a phone reaches them", () => {
    for (const href of ["/inbox", "/plan", "/mission"]) expect(NAV.find((n) => n.href === href)?.mobile).toBe(false);
  });

  it("orders Apply as fits, then the one Apply Queue, and sends old links there", () => {
    expect(NAV.some((n) => n.href === "/approvals")).toBe(false);
    const career = read("app/(app)/(career)/career/page.tsx");
    const queue = career.indexOf("<ApprovalQueue ctx={ctx}");
    // Good fits is the one list you decide from, first on the page; the Apply Queue is under it.
    expect(career.indexOf("id={FITS_ID}")).toBeGreaterThan(career.indexOf("<PageHeader"));
    expect(career.indexOf("id={FITS_ID}")).toBeLessThan(queue);
    // Atlas no longer applies for you (23 Nov 2026): no auto lane, and no "Apply on MacBook".
    expect(career).not.toContain("ApplyLaneCard");
    expect(career).not.toContain('title="Apply today"');
    expect(read("components/ApprovalQueue.tsx")).toContain("title={`${APPLY_QUEUE} (${pending.length})`}");
    expect(read("components/ApprovalQueue.tsx")).not.toContain("Apply on MacBook");
    expect(read("components/ApprovalQueue.tsx")).not.toContain("Approval Queue (");
    expect(read("app/(app)/approvals/page.tsx")).toContain("redirect(APPROVALS_HREF)");
    expect(read("components/ApprovalQueue.tsx")).toContain('APPROVALS_HREF = "/career#approvals"');
    expect(read("components/client/CareerActions.tsx")).toContain('href="/career#approvals"');
    // Inbox no longer holds the queue; it only points at it while something waits.
    const inbox = read("app/(app)/inbox/page.tsx");
    expect(inbox).not.toContain("<ApprovalQueue");
    expect(inbox).toContain("href={APPROVALS_HREF}");
  });

  it("gives Career eight tabs: Apply, Pipeline, Tracker, Market, Career Map, Target Roles, Resume Optimization and Setup", () => {
    expect([CAREER_HUB_LABEL, ...CAREER.map((j) => j.label)]).toEqual(["Apply", "Pipeline", "Tracker", "Market", "Career Map", "Target Roles", "Resume Optimization", "Setup"]);
    expect(CAREER.map((j) => j.href)).toEqual(["/applications", "/status", "/career/market", "/career/map", "/career/roles", "/career/resume-optimization", "/career/setup"]);
    // Every Career page is its own link in the Career Desk.
    for (const j of CAREER) expect(NAV.some((n) => n.href === j.href)).toBe(true);
    expect(NAV.some((n) => n.href === "/growth")).toBe(true);
    // Your fixed answers are on Setup; Apply is only for applying. The test application went with the Apply bot.
    expect(read("app/(app)/(career)/career/page.tsx")).not.toContain("<EligibilityAnswers");
    expect(read("app/(app)/(career)/career/setup/page.tsx")).toContain("<EligibilityAnswers");
    expect(read("app/(app)/(career)/career/setup/page.tsx")).toContain("<ProfileAnswers");
    expect(read("app/(app)/(career)/career/setup/page.tsx")).not.toContain("ApplyTestCard");
  });

  it("lights Apply on the hub only, and each Career page on its own pages and the older ones behind it", () => {
    for (const path of [CAREER_HUB, "/status", "/career/setup", "/roles", "/applications", "/jobs"]) expect(inCareer(path)).toBe(true);
    for (const path of ["/growth", "/plan", "/"]) expect(inCareer(path)).toBe(false);
    expect([isActive(CAREER_HUB, CAREER_HUB), isActive("/career/resume/abc", CAREER_HUB), isActive("/status", CAREER_HUB), isActive("/career/market", CAREER_HUB)]).toEqual([true, true, false, false]);
    expect(isActive("/growth", "/growth")).toBe(true);
    // The Pipeline is a tab of its own: lit on the list and on each application's page, and Tracker is not.
    expect([isActive("/applications", "/applications"), isActive("/applications/demo-app-1", "/applications"), isActive("/status", "/applications")]).toEqual([true, true, false]);
    expect([isActive("/applications", "/status"), isActive("/status", "/status"), isActive("/roles", "/status")]).toEqual([false, true, false]);
    expect([isActive("/roles", "/career/setup"), isActive("/jobs", "/career/setup"), isActive("/applications", "/career/setup")]).toEqual([true, true, false]);
  });

  it("matches whole path segments only", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/inbox", "/")).toBe(false);
    expect(isActive("/people/abc", "/people")).toBe(true);
    expect(isActive("/planner", "/plan")).toBe(false);
  });

  it("has no duplicate links", () => {
    const hrefs = NAV.map((n) => n.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
