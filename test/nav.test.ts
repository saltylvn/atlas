import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CAREER, CAREER_HUB, isActive, NAV } from "@/components/navItems";
import { MAIN_TABS } from "@/lib/domain/layout";

const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");

describe("navigation", () => {
  it("has four main tabs, left to right: Today, Growth, Career, People", () => {
    expect(NAV.filter((n) => n.mobile).map((n) => n.label)).toEqual(["Today", "Growth", "Career", "People"]);
    // They come first in the sidebar too, and they are the layout the QA Agent keeps in mind.
    expect(NAV.slice(0, 4).map((n) => n.href)).toEqual(["/", "/growth", "/career", "/people"]);
    expect(MAIN_TABS.map((t) => t.label)).toEqual(["Today", "Growth", "Career", "People"]);
  });

  it("keeps Inbox, Plan and Mission Control under More, so a phone reaches them", () => {
    for (const href of ["/inbox", "/plan", "/mission"]) expect(NAV.find((n) => n.href === href)?.mobile).toBe(false);
  });

  it("puts the Approval Queue at the top of Career, and sends old links there", () => {
    expect(NAV.some((n) => n.href === "/approvals")).toBe(false);
    const career = read("app/(app)/(career)/career/page.tsx");
    const queue = career.indexOf("<ApprovalQueue ctx={ctx} />");
    expect(queue).toBeGreaterThan(career.indexOf("<PageHeader"));
    // Above today's picks: what is waiting on you comes first.
    expect(queue).toBeLessThan(career.indexOf('title="Apply today"'));
    expect(read("app/(app)/approvals/page.tsx")).toContain("redirect(APPROVALS_HREF)");
    expect(read("components/ApprovalQueue.tsx")).toContain('APPROVALS_HREF = "/career#approvals"');
    expect(read("components/client/CareerActions.tsx")).toContain('href="/career#approvals"');
    // Inbox no longer holds the queue; it only points at it while something waits.
    const inbox = read("app/(app)/inbox/page.tsx");
    expect(inbox).not.toContain("<ApprovalQueue");
    expect(inbox).toContain("href={APPROVALS_HREF}");
  });

  it("houses the job hunt's pages inside Career, and Growth on its own", () => {
    expect(CAREER.map((j) => j.label)).toEqual(["Target roles", "Applications", "Job watchlist"]);
    for (const j of CAREER) expect(NAV.some((n) => n.href === j.href)).toBe(false);
    expect(NAV.some((n) => n.href === "/growth")).toBe(true);
  });

  it("lights the Career tab on the hub and on every page it houses, not on Growth", () => {
    for (const path of [CAREER_HUB, "/roles", "/applications", "/jobs"]) expect(isActive(path, CAREER_HUB)).toBe(true);
    for (const path of ["/growth", "/plan", "/"]) expect(isActive(path, CAREER_HUB)).toBe(false);
    expect(isActive("/growth", "/growth")).toBe(true);
  });

  it("matches whole path segments only", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/inbox", "/")).toBe(false);
    expect(isActive("/people/abc", "/people")).toBe(true);
    expect(isActive("/planner", "/plan")).toBe(false);
  });

  it("has no duplicate links", () => {
    const hrefs = [...NAV, ...CAREER].map((n) => n.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
