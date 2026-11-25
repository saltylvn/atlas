import "server-only";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { Store } from "@/lib/data/store";
import { startState } from "@/lib/domain/agentState";
import { addDays, localDate, localTime } from "@/lib/domain/dates";
import type { ProofPlan } from "@/lib/domain/gapPlan";
import type { PrepPacket } from "@/lib/domain/interviewPrep";
import type { PitchPacket } from "@/lib/domain/pitch";

// The public demo connector's data (app/api/mcp-demo): a fictional job search, held in memory.
// It is built from the demo seed plus a few finished pieces (a resume, a tailored application,
// an interview prep, a proof project), so every tool has something worth showing.
//
// Isolation: this file never imports the owner's store, the service client or the environment's
// keys. The demo endpoint cannot reach real data because nothing here can.
// It is rebuilt once a day, so its dates stay current and nothing accumulates.

const RESUME = [
  "Sam Rivera · Software Engineer",
  "Built Trailhead, a Next.js and TypeScript app for planning hikes, with 320 tests and CI on every pull request.",
  "Trailhead's UI is React with accessible components; data in PostgreSQL with row-level security.",
  "Cut Trailhead's page load from 4 seconds to 1 by caching map tiles and trimming the bundle.",
  "Wrote a Python script that imports 12 public trail datasets nightly, with retries and rate limits.",
  "Skills: TypeScript, React, Node.js, PostgreSQL, Python",
].join("\n");

const PITCH: PitchPacket = {
  resume: "Software Engineer",
  map: [
    { requirement: "TypeScript", status: "proven", evidence: "Built Trailhead, a Next.js and TypeScript app, with 320 tests and CI on every pull request." },
    { requirement: "React", status: "proven", evidence: "Trailhead's UI is React with accessible components." },
    { requirement: "AWS", status: "gap", evidence: "" },
  ],
  swaps: [{ from: "Built Trailhead, a Next.js and TypeScript app for planning hikes", to: "Built Trailhead in TypeScript and React: 320 tests, CI on every pull request.", why: "Names both must-haves and the test discipline up front." }],
  note: "I'm applying for this role because I build the way your posting describes: TypeScript and React, tested and shipped through CI. Trailhead, my hike-planning app, has 320 tests. I have not used AWS in production yet and would be glad to talk about how I'd get up to speed.",
};

const PREP: PrepPacket = {
  questions: [
    { question: "Walk me through something you built with TypeScript. What would you do differently?", kind: "technical", requirement: "TypeScript", story: { situation: "I wanted one place to plan hikes from public trail data.", task: "Build Trailhead end to end.", action: "Built it in Next.js and TypeScript with React, PostgreSQL with row-level security, and CI on every pull request.", result: "It has 320 tests, and I would add end-to-end tests earlier next time." }, source: "Resume: Software Engineer" },
    { question: "Tell me about a time you made something faster.", kind: "behavioral", requirement: "", story: { situation: "Trailhead's pages took 4 seconds to load.", task: "Make it feel instant.", action: "Cached map tiles and trimmed the bundle.", result: "Page load went from 4 seconds to 1." }, source: "Resume: Software Engineer" },
    { question: "Tell me about a time you had to learn something new quickly.", kind: "behavioral", requirement: "", story: null, source: "" },
  ],
  gaps: [{ requirement: "AWS", plan: "Say plainly I have not used AWS in production, name what Trailhead deploys on today, and how I would get up to speed in the first weeks." }],
  ask: ["What would I work on in my first 90 days?", "How do code review and mentoring work for early-career engineers here?"],
};

const done = (agent: string, goal: string, answer: unknown, at: string) => ({ ...startState(agent, goal, [], { steps: 12, calls: 10 }, at), answer: JSON.stringify(answer) });

async function build(now: Date): Promise<Store> {
  const store = createMemoryStore(seedState(now));
  const today = localDate(now, "America/Denver");
  const at = now.toISOString();
  await store.knowledge.upsert([{ source: "resume", sourceId: "showcase-resume", chunkIndex: 0, title: "Resume: Software Engineer", content: RESUME, href: "", occurredAt: addDays(today, -7), hash: "showcase-resume-1" }]);
  const proof: ProofPlan = {
    current: { skill: "AWS", role: "Software Engineer 1", share: 0.42, assignedOn: addDays(today, -3), brief: "Deploy a small TypeScript API on AWS Lambda with one DynamoDB table, a README that says what it does and why, and tests. Keep it to a week and push it to GitHub.", writer: "rules", closedOn: null, repo: null },
    done: [{ skill: "PostgreSQL", role: "Software Engineer 1", share: 0.31, assignedOn: addDays(today, -30), brief: "Add row-level security to a small app.", writer: "rules", closedOn: addDays(today, -12), repo: "trailhead" }],
  };
  await store.settings.update({ displayName: "Sam", careerSkills: ["TypeScript", "React", "Node.js", "PostgreSQL", "Python"], careerProof: proof, mcpEnabled: true });
  const interview = (await store.applications.list()).find((a) => a.status === "interview");
  if (interview) await store.agentRunState.save(`prep:${interview.id}`, "prep", "done", done("prep", "Prepare for the interview.", PREP, at));
  // Two queued jobs at made-up companies; the first is already tailored by Pitch.
  const kit = await store.approvals.create({ kind: "application", title: "Software Engineer I at Larkspur Labs", detail: "Software Engineer · $105k-$125k · Remote\nSkills it names: TypeScript, React, AWS\nAsks for: 1+ years of experience\nTeam: Platform", url: "https://example.com/jobs/larkspur-software-engineer-i", matchId: null, status: "pending", decidedAt: null });
  await store.approvals.create({ kind: "application", title: "Associate Software Engineer at Juniper Health", detail: "Software Engineer · $98k-$112k · Salt Lake City\nSkills it names: Python, PostgreSQL, Docker\nAsks for: 0-2 years of experience", url: "https://example.com/jobs/juniper-associate-software-engineer", matchId: null, status: "pending", decidedAt: null });
  await store.agentRunState.save(`pitch:${kit.id}`, "pitch", "done", done("pitch", "Tailor the application.", PITCH, at));
  return store;
}

let cached: { day: string; store: Promise<Store> } | null = null;

/** The showcase's Context for one request: fictional data only, rebuilt when the day changes. */
export async function showcaseContext(now: Date = new Date()): Promise<Context> {
  const day = now.toISOString().slice(0, 10);
  if (!cached || cached.day !== day) cached = { day, store: build(now) };
  const store = await cached.store;
  const settings = await store.settings.get();
  return { mode: "demo", userId: "demo", store, settings, now, today: localDate(now, settings.timezone), time: localTime(now, settings.timezone) };
}
