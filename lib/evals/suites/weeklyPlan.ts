import type { Fact } from "@/lib/domain/companyResearch";
import { reviewPlan, rulesPlan, snapshotLines, strategistDue, type PlanOut, type WeekSnapshot } from "@/lib/domain/weeklyPlan";
import type { EvalCase } from "../types";

// The Weekly Strategist's golden set (docs/AGENT-ARCHITECTURE.md, lever 5): the code half of its
// verification. The failures that matter: not three moves, a number the data lacks, a move
// repeated from last week, a week that does not fit, and a rules plan that fails its own review.

const SNAP: WeekSnapshot = {
  funnel: { sent: 12, judged: 8, replied: 2, rejected: 4, replyRate: 0.25, findings: [] },
  queue: { waiting: 7, aboveYourLevel: 0, picks: [{ title: "Software Engineer I at Larkspur", why: "Fits your level" }], prepared: 1 },
  applications: { applied: 6, interview: 1, offer: 0, interviews: ["Support Engineer at Bluebird"] },
  market: null,
  proof: null,
  proofDone: 0,
};
const FACTS: Fact[] = [
  ...snapshotLines(SNAP, "funnel").map((text, i) => ({ id: `a${i + 1}`, text })),
  ...snapshotLines(SNAP, "queue").map((text, i) => ({ id: `q${i + 1}`, text })),
  ...snapshotLines(SNAP, "applications").map((text, i) => ({ id: `i${i + 1}`, text })),
];
const GOOD: PlanOut = {
  headline: "Reply rate is 25%: send prepared picks first.",
  moves: [
    { title: "Apply to your top picks, most prepared first", why: "7 jobs are waiting at your level.", cites: ["q1"], day: 0, minutes: 120 },
    { title: "Prepare for the Bluebird interview", why: "One application is at interview stage.", cites: ["i2"], day: 1, minutes: 90 },
    { title: "Follow up on applications with no reply", why: "Replies move the funnel.", cites: ["a1"], day: 3, minutes: 45 },
  ],
};
const verdict = (o: PlanOut, done: string[] = []) => (reviewPlan(o, FACTS, done).pass ? "pass" : "fail");

export const strategistCases: EvalCase[] = [
  { name: "Weekly plan: three cited moves pass", expected: "pass", actual: () => verdict(GOOD) },
  { name: "Weekly plan: two moves fail", expected: "fail", actual: () => verdict({ ...GOOD, moves: GOOD.moves.slice(0, 2) }) },
  { name: "Weekly plan: a number the data lacks fails", expected: "fail", actual: () => verdict({ ...GOOD, headline: "Reply rate is 60%: keep going." }) },
  { name: "Weekly plan: repeating a move finished last week fails", expected: "fail", actual: () => verdict(GOOD, ["Prepare for the Bluebird interview"]) },
  { name: "Weekly plan: a week over the time limit fails", expected: "fail", actual: () => verdict({ ...GOOD, moves: GOOD.moves.map((m) => ({ ...m, minutes: 240 })) }) },
  { name: "Weekly plan: the rules' plan passes its own review", expected: "pass", actual: () => verdict(rulesPlan(SNAP, FACTS)) },
  { name: "Weekly plan: an interview comes before nice-to-haves in the rules' plan", expected: "interview", actual: () => (/interview/i.test(rulesPlan(SNAP, FACTS).moves[1]!.title) ? "interview" : "other") },
  { name: "Weekly plan: written on Sunday night, not on Saturday", expected: "sun", actual: () => (strategistDue(null, "2026-11-29") && !strategistDue(null, "2026-11-28") ? "sun" : "other") },
];
