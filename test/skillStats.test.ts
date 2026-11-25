import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { averageSkills, SNAPSHOT_SKILLS, skillSnapshot } from "@/lib/domain/skillStats";
import { createMemoryStore, seedState } from "@/lib/data/memory";

const post = (role: string, skills: string[], url: string) => ({ role, skills, url });
const read = (f: string) => readFileSync(f, "utf8");

describe("Skills logged per role per day", () => {
  it("counts each posting once across job boards and searches, under today's role names", () => {
    const rows = skillSnapshot({
      boards: [post("AI Engineer", ["Python", "RAG", "Python"], "https://x/1"), post("GTM Engineer", ["n8n"], "https://x/2")],
      searches: [post("AI Engineer", ["Python"], "https://x/1?utm=li"), post("AI Engineer", ["AWS"], "https://x/3")],
      roles: ["AI Engineer", "AI Automation Engineer", "Software Engineer"],
      day: "2026-11-20",
      windowDays: 30,
    });
    expect(rows).toEqual([
      { forDate: "2026-11-20", role: "AI Engineer", postings: 2, skills: [{ skill: "Python", asked: 1 }, { skill: "RAG", asked: 1 }, { skill: "AWS", asked: 1 }].sort((a, b) => a.skill.localeCompare(b.skill)), windowDays: 30 },
      // A posting stored under an old name counts for the role it folded into.
      { forDate: "2026-11-20", role: "AI Automation Engineer", postings: 1, skills: [{ skill: "n8n", asked: 1 }], windowDays: 30 },
      // A role with no postings is still logged, so a gap in demand is on record.
      { forDate: "2026-11-20", role: "Software Engineer", postings: 0, skills: [], windowDays: 30 },
    ]);
  });

  it("keeps at most thirty skills a day, most asked first", () => {
    const many = Array.from({ length: 40 }, (_, i) => `Skill ${String(i).padStart(2, "0")}`);
    const [row] = skillSnapshot({ boards: [post("AI Engineer", many, "https://x/1"), post("AI Engineer", ["Skill 39"], "https://x/2")], searches: [], roles: ["AI Engineer"], day: "2026-11-20", windowDays: 30 });
    expect(row!.skills).toHaveLength(SNAPSHOT_SKILLS);
    expect(row!.skills[0]).toEqual({ skill: "Skill 39", asked: 2 });
  });

  it("averages a skill's share across days, counting a missing day as zero", () => {
    const day = (forDate: string, postings: number, skills: [string, number][]) => ({ forDate, role: "AI Engineer", postings, skills: skills.map(([skill, asked]) => ({ skill, asked })) });
    const stats = [
      day("2026-11-17", 10, [["Python", 8], ["Spike", 10]]),
      day("2026-11-18", 10, [["Python", 6]]),
      day("2026-11-19", 10, [["Python", 7]]),
      day("2026-11-19", 10, [["Python", 10]]), // written twice that day: the later row wins
      day("2026-11-20", 2, [["Thin", 2]]), // too few postings to count
      day("2026-08-01", 10, [["Old", 10]]), // older than the window
      { ...day("2026-11-18", 10, [["Other", 10]]), role: "Software Engineer" },
    ];
    const a = averageSkills(stats, "AI Engineer", { today: "2026-11-20", have: ["python"] });
    expect(a).toMatchObject({ role: "AI Engineer", days: 3, from: "2026-11-17", to: "2026-11-19", postings: 10 });
    expect(a.skills.map((s) => [s.skill, Math.round(s.share * 100), s.have])).toEqual([
      ["Python", 80, true],
      ["Spike", 33, false],
    ]);
    expect(averageSkills([], "AI Engineer", { today: "2026-11-20" })).toMatchObject({ days: 0, from: null, skills: [] });
  });

  it("stores one row per role per day: a second run that day replaces the first", async () => {
    const store = createMemoryStore(seedState(new Date("2026-11-20T15:00:00Z")));
    const before = (await store.roleSkills.since("2026-11-20")).length;
    await store.roleSkills.save([{ forDate: "2026-11-20", role: "AI Engineer", postings: 3, skills: [], windowDays: 30 }]);
    await store.roleSkills.save([{ forDate: "2026-11-20", role: "AI Engineer", postings: 5, skills: [], windowDays: 30 }]);
    const mine = (await store.roleSkills.since("2026-11-20")).filter((r) => r.role === "AI Engineer");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.postings).toBe(5);
    expect((await store.roleSkills.since("2026-11-20")).length).toBe(before + 1);
  });

  it("is read-only for you in the database, kept two years, and renames the old role names", () => {
    const sql = read("supabase/migrations/20261120070000_role_skill_stats.sql");
    expect(sql).toContain("alter table public.role_skill_stats enable row level security;");
    expect(sql).toContain("using (owner_id = (select auth.uid()) and (select public.is_owner_aal2()))");
    expect(sql).toContain("grant select on public.role_skill_stats to authenticated;");
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*role_skill_stats/);
    expect(sql).toContain("delete from public.role_skill_stats where for_date < current_date - 730;");
    expect(sql).toContain("('GTM Engineer', 'AI Automation Engineer')");
    // The Analyst writes it; nothing else does.
    expect(read("lib/agents/analyst.ts")).toContain("persist.roleSkills.save(rows)");
  });
});
