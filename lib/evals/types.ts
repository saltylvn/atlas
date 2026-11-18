// Agent evals: "How do you know your agents are working?"
//
// Each agent has a suite of labeled cases: a real-looking input (an email, a job title,
// a bill subject, a calendar, a pair of headlines) and the answer a person would give.
// A suite runs the agent's own rules on every case and scores the share it gets right.
// Pure and fast (no network, no model, $0), so the same code runs in CI on every pull
// request, on the Evals page, and once a day after the morning brief.
//
// A case that fails is either a bug to fix or a known limit of the rules; either way it
// stays in the suite and shows on the Evals page. A suite's `threshold` is the score it
// must keep: CI fails below it, so a change can never quietly make an agent worse.

import type { AgentId } from "@/lib/domain/types";

export interface EvalCase {
  /** What is being judged, in plain words: the email subject, the job title... */
  name: string;
  /** The answer a person would give. */
  expected: string;
  /** What the agent's rules answer. */
  actual: () => string;
  /** Set on a case the rules are known to get wrong, with the reason. */
  knownGap?: string;
}

export interface EvalSuite {
  agent: AgentId;
  title: string;
  /** One sentence: what skill of the agent this measures. */
  what: string;
  /** Minimum share of cases that must pass, 0 to 1. */
  threshold: number;
  cases: EvalCase[];
}

export interface EvalFailure {
  name: string;
  expected: string;
  actual: string;
  knownGap?: string;
}

export interface SuiteResult {
  agent: AgentId;
  title: string;
  what: string;
  threshold: number;
  total: number;
  passed: number;
  /** passed / total, 0 to 1. */
  score: number;
  /** True when the score meets the threshold. */
  ok: boolean;
  failures: EvalFailure[];
}

export function runSuite(suite: EvalSuite): SuiteResult {
  const failures: EvalFailure[] = [];
  for (const c of suite.cases) {
    let actual: string;
    try {
      actual = c.actual();
    } catch (err) {
      actual = `threw: ${(err as Error).message}`;
    }
    if (actual !== c.expected) failures.push({ name: c.name, expected: c.expected, actual, ...(c.knownGap ? { knownGap: c.knownGap } : {}) });
  }
  const total = suite.cases.length;
  const passed = total - failures.length;
  const score = total ? passed / total : 1;
  return { agent: suite.agent, title: suite.title, what: suite.what, threshold: suite.threshold, total, passed, score, ok: score >= suite.threshold, failures };
}

export const pct = (score: number) => `${Math.round(score * 100)}%`;
