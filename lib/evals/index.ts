import { calendarSuite } from "./suites/calendar";
import { careerSuite } from "./suites/career";
import { analystSuite, applyCases, mentorSuite, scoutSuite } from "./suites/careerDesk";
import { outlookCases, portfolioCases, roleCases } from "./suites/targetRoles";
import { chiefOfStaffSuite } from "./suites/chiefOfStaff";
import { emailSuite } from "./suites/email";
import { financeSuite } from "./suites/finance";
import { newsSuite } from "./suites/news";
import { qaSuite } from "./suites/qa";
import { retrievalSuite } from "./suites/retrieval";
import { pct, runSuite, type EvalSuite, type SuiteResult } from "./types";

export * from "./types";

/** The activity-log task name of the daily eval run. */
export const EVAL_TASK = "Agent evals";

/** One suite per agent, in roster order, then Ask Atlas (the Chief of Staff answers questions too). */
export const SUITES: readonly EvalSuite[] = [chiefOfStaffSuite, calendarSuite, newsSuite, emailSuite, { ...careerSuite, cases: [...careerSuite.cases, ...applyCases] }, financeSuite,
  retrievalSuite,
  // Which roles to target: reading GitHub projects, the role outlook, and the Mentor's proposal.
  { ...scoutSuite, cases: [...scoutSuite.cases, ...portfolioCases] },
  { ...analystSuite, cases: [...analystSuite.cases, ...outlookCases] },
  { ...mentorSuite, cases: [...mentorSuite.cases, ...roleCases] },
  // The reviewer is reviewed too: a week with one thing wrong must raise exactly that.
  qaSuite,
];

export interface EvalReport {
  suites: SuiteResult[];
  total: number;
  passed: number;
  score: number;
  /** True when every suite meets its threshold. */
  ok: boolean;
  /** How long scoring took, in milliseconds. */
  tookMs: number;
}

/** Runs every suite. Pure and fast: a few milliseconds, no network. */
export function runEvals(suites: readonly EvalSuite[] = SUITES): EvalReport {
  const started = performance.now();
  const results = suites.map(runSuite);
  const total = results.reduce((n, r) => n + r.total, 0);
  const passed = results.reduce((n, r) => n + r.passed, 0);
  return { suites: results, total, passed, score: total ? passed / total : 1, ok: results.every((r) => r.ok), tookMs: Math.max(1, Math.round(performance.now() - started)) };
}

/** "248/254 (98%): Chief of Staff 26/26, Calendar 31/32, ..." for the activity log. */
export function evalSummary(report: EvalReport, nameOf: (agent: SuiteResult["agent"]) => string): string {
  const seen = new Set<string>();
  // An agent's first suite goes by the agent's name; a second one (Ask Atlas) by its own title.
  const label = (s: SuiteResult) => (seen.has(s.agent) ? s.title.split(":")[0]! : (seen.add(s.agent), nameOf(s.agent)));
  return `${report.passed}/${report.total} (${pct(report.score)}): ${report.suites.map((s) => `${label(s)} ${s.passed}/${s.total}`).join(", ")}`;
}
