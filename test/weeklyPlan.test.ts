import { describe, expect, it } from "vitest";
import type { Fact } from "@/lib/domain/companyResearch";
import {
  lastWeek,
  lastWeekLines,
  MOVES,
  moveDay,
  parsePlanOut,
  planWeek,
  reviewPlan,
  rulesPlan,
  snapshotLines,
  strategistDue,
  tasksForPlan,
  toPlan,
  weeklyPlanOf,
  type PlanOut,
  type WeekSnapshot,
} from "@/lib/domain/weeklyPlan";

const SNAP: WeekSnapshot = {
  funnel: { sent: 12, judged: 8, replied: 2, rejected: 4, replyRate: 0.25, findings: ["Most replies came from roles asking 1 to 3 years."] },
  queue: { waiting: 7, aboveYourLevel: 1, picks: [{ title: "Software Engineer I at Larkspur", why: "Fits your level" }], prepared: 1 },
  applications: { applied: 6, interview: 1, offer: 0, interviews: ["Support Engineer at Bluebird"] },
  market: { headline: "Demand for TypeScript roles held steady.", focus: ["Add a tested API project"] },
  proof: { skill: "PostgreSQL", assignedOn: "2026-11-20" },
  proofDone: 1,
};

const facts = (): Fact[] => {
  const out: Fact[] = [];
  const add = (prefix: string, lines: string[]) => lines.forEach((t, i) => out.push({ id: `${prefix}${i + 1}`, text: t }));
  add("a", snapshotLines(SNAP, "funnel"));
  add("q", snapshotLines(SNAP, "queue"));
  add("i", snapshotLines(SNAP, "applications"));
  add("b", snapshotLines(SNAP, "proof"));
  return out;
};

const good: PlanOut = {
  headline: "Reply rate is 25%: send your prepared picks first and prepare the interview.",
  moves: [
    { title: "Apply to your top picks, most prepared first", why: "7 jobs are waiting at your level.", cites: ["q1"], day: 0, minutes: 120 },
    { title: "Prepare for the Bluebird interview", why: "One application is at interview stage.", cites: ["i2"], day: 1, minutes: 90 },
    { title: "Push the PostgreSQL proof project forward", why: "It is open and postings ask for it.", cites: ["b1"], day: 3, minutes: 120 },
  ],
};

describe("reviewPlan", () => {
  it("passes three cited moves whose numbers come from the facts", () => {
    expect(reviewPlan(good, facts())).toEqual({ pass: true, notes: "" });
  });
  it("wants exactly three moves", () => {
    expect(reviewPlan({ ...good, moves: good.moves.slice(0, 2) }, facts()).notes).toMatch(/exactly 3/);
  });
  it("refuses a number no fact has, in a move or the headline", () => {
    expect(reviewPlan({ ...good, moves: [{ ...good.moves[0]!, why: "40 jobs are waiting." }, ...good.moves.slice(1)] }, facts()).pass).toBe(false);
    expect(reviewPlan({ ...good, headline: "Reply rate is 90%, keep going." }, facts()).notes).toMatch(/90%/);
  });
  it("refuses a citation that was never read", () => {
    expect(reviewPlan({ ...good, moves: [{ ...good.moves[0]!, cites: ["z9"] }, ...good.moves.slice(1)] }, facts()).pass).toBe(false);
  });
  it("refuses two moves that say the same thing, and one finished last week", () => {
    expect(reviewPlan({ ...good, moves: [good.moves[0]!, { ...good.moves[0]!, day: 2 }, good.moves[2]!] }, facts()).notes).toMatch(/same thing/);
    expect(reviewPlan(good, facts(), ["Prepare for the Bluebird interview"]).notes).toMatch(/finished last week/);
  });
  it("keeps the week to the time limit", () => {
    const big = { ...good, moves: good.moves.map((m) => ({ ...m, minutes: 240 })) };
    expect(reviewPlan(big, facts()).notes).toMatch(/720 minutes/);
  });
});

describe("rulesPlan", () => {
  it("writes three moves that pass its own review", () => {
    const f = facts();
    const plan = rulesPlan(SNAP, f);
    expect(plan.moves).toHaveLength(MOVES);
    expect(reviewPlan(plan, f)).toEqual({ pass: true, notes: "" });
    expect(plan.moves[1]!.title).toMatch(/interview/i);
  });
  it("carries over last week's unfinished move when there is no interview", () => {
    const snap = { ...SNAP, applications: { ...SNAP.applications, interview: 0, interviews: [] } };
    const prev = { weekOf: "2026-11-16", moves: [{ title: "Follow up with Lumen Works", done: false }] };
    const f = [...facts().filter((x) => !x.id.startsWith("i")), ...lastWeekLines(prev).map((t, i) => ({ id: `w${i + 1}`, text: t }))];
    const plan = rulesPlan(snap, f, prev);
    expect(plan.moves[1]!.title).toBe("Follow up with Lumen Works");
    expect(reviewPlan(plan, f).pass).toBe(true);
  });
  it("refills the queue when nothing at your level waits", () => {
    const plan = rulesPlan({ ...SNAP, queue: { ...SNAP.queue, picks: [], waiting: 0 } }, facts());
    expect(plan.moves[0]!.title).toMatch(/Refill/);
  });
});

describe("the plan's week and days", () => {
  it("is this week on a weekday, next week at the weekend", () => {
    expect(planWeek("2026-11-25")).toBe("2026-11-23"); // Wednesday
    expect(planWeek("2026-11-29")).toBe("2026-11-30"); // Sunday
  });
  it("is due on Sunday when next week has no plan", () => {
    expect(strategistDue(null, "2026-11-29")).toBe(true);
    expect(strategistDue(null, "2026-11-28")).toBe(false);
    const plan = toPlan(good, facts(), { weekOf: "2026-11-30", createdAt: "2026-11-29T05:00:00Z", writer: "model" });
    expect(strategistDue(plan, "2026-11-29")).toBe(false);
  });
  it("never puts a move on a day that has passed", () => {
    expect(moveDay("2026-11-23", 0, "2026-11-25")).toBe("2026-11-25");
    expect(moveDay("2026-11-23", 3, "2026-11-25")).toBe("2026-11-26");
  });
});

describe("saving and approving", () => {
  it("round-trips through settings and rejects anything malformed", () => {
    const plan = toPlan(good, facts(), { weekOf: "2026-11-30", createdAt: "2026-11-29T05:00:00Z", writer: "model" });
    expect(weeklyPlanOf(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    expect(plan.moves.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(plan.facts.map((f) => f.id).sort()).toEqual(["b1", "i2", "q1"]);
    expect(weeklyPlanOf({ ...plan, status: "maybe" })).toBeNull();
    expect(weeklyPlanOf("nope")).toBeNull();
  });
  it("becomes one high-priority Career task per move, on its day", () => {
    const plan = toPlan(good, facts(), { weekOf: "2026-11-30", createdAt: "2026-11-29T05:00:00Z", writer: "model" });
    const tasks = tasksForPlan(plan, "2026-11-29");
    expect(tasks.map((t) => [t.title, t.day, t.estimateMin, t.area, t.priority, t.energy])).toEqual([
      ["Apply to your top picks, most prepared first", "2026-11-30", 120, "career", "high", "deep"],
      ["Prepare for the Bluebird interview", "2026-12-01", 90, "career", "high", "deep"],
      ["Push the PostgreSQL proof project forward", "2026-12-03", 120, "career", "high", "deep"],
    ]);
  });
  it("remembers which moves were finished, and none of a plan never approved", () => {
    const plan = { ...toPlan(good, facts(), { weekOf: "2026-11-23", createdAt: "x", writer: "model" as const }), status: "approved" as const, taskIds: ["t1", "t2", "t3"] };
    expect(lastWeek(plan, [{ id: "t1", status: "done" }, { id: "t2", status: "todo" }])!.moves.map((m) => m.done)).toEqual([true, false, false]);
    expect(lastWeek({ ...plan, status: "proposed" }, [{ id: "t1", status: "done" }])!.moves.every((m) => !m.done)).toBe(true);
    expect(lastWeek(null, [])).toBeNull();
  });
  it("reads the agent's answer only when it is valid JSON of the right shape", () => {
    expect(parsePlanOut(JSON.stringify(good))).toEqual(good);
    expect(parsePlanOut("{}")).toBeNull();
    expect(parsePlanOut("not json")).toBeNull();
  });
});
