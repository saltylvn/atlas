import { describe, expect, it } from "vitest";
import { AGENTS } from "@/lib/domain/agents";
import { pct, runEvals, runSuite, SUITES } from "@/lib/evals";

// The agent evals, run in CI. A suite below its threshold fails the build, so a change
// can never quietly make an agent worse. `npm run evals` prints the table on its own.

const report = runEvals();

describe("Agent evals", () => {
  it("prints the scores", () => {
    console.table(report.suites.map((s) => ({ agent: s.agent, suite: s.title, cases: s.total, passed: s.passed, score: pct(s.score), needs: pct(s.threshold), ok: s.ok ? "yes" : "NO" })));
    for (const s of report.suites) for (const f of s.failures) console.log(`[${s.agent}] ${f.knownGap ? "known gap" : "FAILED"}: ${f.name}\n   expected: ${f.expected}\n   got:      ${f.actual}`);
    expect(report.total).toBeGreaterThan(150);
  });

  it("covers every live agent", () => {
    expect([...new Set(SUITES.map((s) => s.agent))].sort()).toEqual(AGENTS.filter((a) => a.status === "live").map((a) => a.id).sort());
  });

  for (const suite of SUITES) {
    it(`${suite.agent}: ${suite.title} stays at or above ${pct(suite.threshold)}`, () => {
      const r = runSuite(suite);
      expect(r.score, r.failures.map((f) => `${f.name}: expected "${f.expected}", got "${f.actual}"`).join("\n")).toBeGreaterThanOrEqual(suite.threshold);
    });

    it(`${suite.agent}: ${suite.title}: every failure is a known gap, and every known gap still fails`, () => {
      const r = runSuite(suite);
      // A new failure must be fixed or written down as a known gap with its reason.
      expect(r.failures.filter((f) => !f.knownGap).map((f) => `${f.name}: expected "${f.expected}", got "${f.actual}"`)).toEqual([]);
      // A known gap that now passes is good news: remove its note.
      const failing = new Set(r.failures.map((f) => f.name));
      expect(suite.cases.filter((c) => c.knownGap && !failing.has(c.name)).map((c) => c.name)).toEqual([]);
    });
  }
});
