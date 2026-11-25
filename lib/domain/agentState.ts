// An agent run's state (docs/AGENT-ARCHITECTURE.md, lever 2): a typed scratchpad of the goal,
// what the agent has found, every step it took and what remains, passed to the model in place
// of a long history and saved after every step. Pure.

export interface StepRecord {
  n: number;
  tool: string;
  /** A short summary of the input, never raw text. */
  input: string;
  ok: boolean;
  /** What came back, in a line: the result's gist, or the fix a failed tool asked for. */
  note: string;
  ms: number;
}

export interface AgentState {
  agent: string;
  goal: string;
  /** Facts the agent has gathered so far, each a short line it can cite. */
  facts: string[];
  /** Checks that must pass before the goal is met; ticked off as they do. */
  open: string[];
  steps: StepRecord[];
  /** Model calls used, against the run's budget. */
  calls: number;
  budget: { steps: number; calls: number };
  /** Set when the agent declares the goal met: its answer, for the reviewer. */
  answer?: string;
  startedAt: string;
}

export function startState(agent: string, goal: string, open: string[], budget: { steps: number; calls: number }, now: string): AgentState {
  return { agent, goal: goal.slice(0, 600), facts: [], open: [...open], steps: [], calls: 0, budget, startedAt: now };
}

const MAX_FACTS = 30;
const MAX_LINE = 300;

/** The state after one tool step: the step logged, and a new fact when it found one. */
export function recordStep(s: AgentState, step: Omit<StepRecord, "n">, fact?: string): AgentState {
  const facts = fact ? [...s.facts, fact.slice(0, MAX_LINE)].slice(-MAX_FACTS) : s.facts;
  return { ...s, facts, steps: [...s.steps, { ...step, n: s.steps.length + 1, input: step.input.slice(0, 160), note: step.note.slice(0, MAX_LINE) }] };
}

export const closeCheck = (s: AgentState, check: string): AgentState => ({ ...s, open: s.open.filter((c) => c !== check) });
export const countCall = (s: AgentState): AgentState => ({ ...s, calls: s.calls + 1 });

/** Why the run must stop now, or null to go on: the step cap or the call budget. */
export function outOfBudget(s: AgentState): string | null {
  if (s.steps.length >= s.budget.steps) return `Reached its ${s.budget.steps}-step limit.`;
  if (s.calls >= s.budget.calls) return `Used its ${s.budget.calls} model calls.`;
  return null;
}

/** The same tool with the same input already tried and failed: the agent must change something. */
export const triedAndFailed = (s: AgentState, tool: string, input: string): boolean => s.steps.some((x) => !x.ok && x.tool === tool && x.input === input.slice(0, 160));

/**
 * What the model sees each cycle: the goal, the facts, what remains, and the last few steps
 * with their results (failed ones say how to fix them). Never the full history.
 */
export function stateForModel(s: AgentState): string {
  return JSON.stringify({
    goal: s.goal,
    stillToDo: s.open,
    facts: s.facts,
    recentSteps: s.steps.slice(-5).map((x) => ({ step: x.n, tool: x.tool, input: x.input, ok: x.ok, result: x.note })),
    left: { steps: s.budget.steps - s.steps.length, modelCalls: s.budget.calls - s.calls },
  });
}

export interface Trajectory {
  steps: number;
  failed: number;
  /** The same tool and input called more than once: wasted turns. */
  repeats: number;
  ms: number;
  recovered: number;
}

/** How the run got there, for evals and Mission Control: steps, failures, repeats, recoveries. */
export function trajectory(s: AgentState): Trajectory {
  const seen = new Set<string>();
  const recoveredFrom = new Set<string>();
  let repeats = 0;
  s.steps.forEach((x, i) => {
    const k = `${x.tool}|${x.input}`;
    if (seen.has(k)) repeats++;
    seen.add(k);
    // A failed call later followed by a success of the same tool with a different input: it adapted (counted once per failed call).
    if (!x.ok && s.steps.slice(i + 1).some((y) => y.ok && y.tool === x.tool && y.input !== x.input)) recoveredFrom.add(k);
  });
  const recovered = recoveredFrom.size;
  return { steps: s.steps.length, failed: s.steps.filter((x) => !x.ok).length, repeats, ms: s.steps.reduce((n, x) => n + x.ms, 0), recovered };
}

// ---- memory: short dated lessons, kept only while outcomes confirm them

export interface Lesson {
  id: string;
  agent: string;
  lesson: string;
  evidence: string;
  confirmed: number;
  expiresOn: string;
}

export const LESSON_DAYS = 21;

/** The lessons an agent should read now: unexpired, the most confirmed first, at most 8. */
export function activeLessons(all: readonly Lesson[], agent: string, today: string): Lesson[] {
  return all
    .filter((l) => l.agent === agent && l.expiresOn >= today)
    .sort((a, b) => b.confirmed - a.confirmed || b.expiresOn.localeCompare(a.expiresOn))
    .slice(0, 8);
}
