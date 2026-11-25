// What Atlas is made of, labeled the way the industry labels it.
//
// Every moving part is one of three kinds, decided by one question: who picks the next step?
//   Workflow  code runs other steps in a fixed order. It decides nothing itself.
//   Bot       one job; code decides every step. It may ask the AI model for one bounded
//             judgment or wording, checked by rules, with a rules fallback.
//   Agent     the AI model chooses its own tools and next step in a loop, up to a limit.
// Atlas has five agents (Pitch, Company Research, Interview Prep, the Weekly Strategist and Follow-up, on the shared runtime in lib/agents/runtime):
// each loops toward a goal, picks its own tools, recovers from a failed step and passes a review.
// Everything else keeps its steps in code, by design.
//
// Three tags sit beside the kind: AI use, reach (inside Atlas or acting outside it) and
// trigger. The roster (agents.ts) carries them for each bot and for the Chief of Staff; this
// file adds the workflows that run them, each bot's jobs, and the infrastructure jobs.
// Mission Control, the Team page and the Day timeline all read from here.
//
// Pure: no I/O. Task names match what each run writes to the activity log
// (test/registry.test.ts checks them against the constants in lib/agents).

import { SYNC_HOURS, isSyncDay } from "./briefSchedule";
import { weekdayIndex } from "./dates";
import type { AgentId, LocalDate } from "./types";

export type Kind = "workflow" | "bot" | "agent";

export interface KindSpec {
  label: string;
  plural: string;
  /** One sentence: what it is. */
  definition: string;
  /** Who picks the next step: the one question that separates the three. */
  decides: string;
  /** How it may use the AI model. */
  ai: string;
  /** What something must do to earn the name (docs/AGENT-ARCHITECTURE.md). */
  qualifies: readonly string[];
  /** What it looks like in Atlas. */
  example: string;
}

export const KINDS: Record<Kind, KindSpec> = {
  workflow: {
    label: "Workflow",
    plural: "Workflows",
    definition: "Runs other steps in an order fixed in code. It decides nothing itself.",
    decides: "Code, in a fixed order written ahead of time.",
    ai: "None of its own. A step it runs may be a bot that asks the model.",
    qualifies: ["It starts on a schedule or a button and runs a set list of steps.", "The order never changes with what it finds.", "It does no judging: it only runs bots and delivers what they report."],
    example: "The morning brief: copy roles, run each bot in order, write the brief, deliver it.",
  },
  bot: {
    label: "Bot",
    plural: "Bots",
    definition: "Does one job. Code decides every step; it may ask the AI model for one bounded judgment, checked by rules.",
    decides: "Code. The same input always takes the same steps.",
    ai: "Optional, and bounded: one question with a fixed answer shape (word this, rank these, judge this fit). Rules check the answer and take over when the model is off or wrong.",
    qualifies: ["It owns one job and one set of data it may write.", "Its steps are code; the model never chooses what happens next.", "Any AI answer is checked against facts the rules computed, with a rules fallback."],
    example: "The Analyst: rules compute every number in the market report; the model may only word it.",
  },
  agent: {
    label: "Agent",
    plural: "Agents",
    definition: "The AI model chooses its own tools and next step in a loop, up to a set limit.",
    decides: "The AI model, one step at a time, from what it just found.",
    ai: "Central: the model plans, picks a tool, reads the result and decides again, inside hard limits.",
    qualifies: ["It works toward a goal and checks whether it is met before stopping.", "It picks which tool to call next, itself.", "When a step fails, it reads why and tries another way.", "It runs inside limits: least-privilege tools, a step cap and a call budget, checks in code, and your approval before anything leaves Atlas."],
    example: "Tailor: reads the job and your resume, searches for proof of each must-have, checks its own claims, and is sent back by a reviewer until the packet passes.",
  },
};

export type AiUse = "rules" | "ai-assisted";
export const AI_USE: Record<AiUse, { label: string; definition: string }> = {
  rules: { label: "Rules only", definition: "Never calls an AI model." },
  "ai-assisted": { label: "AI-assisted", definition: "Rules decide the steps; the model makes one bounded judgment or wording, and rules take over when it is off or wrong." },
};

export type Reach = "inside" | "outside";
export const REACH: Record<Reach, { label: string; definition: string }> = {
  inside: { label: "Inside Atlas", definition: "Reads sources and writes only to Atlas. Drafts, never sends." },
  outside: { label: "Acts outside", definition: "Takes an action on a site outside Atlas, and only after you approve it." },
};

export type Trigger = "schedule" | "button" | "both";
export const TRIGGER: Record<Trigger, { label: string }> = {
  schedule: { label: "Scheduled" },
  button: { label: "On demand" },
  both: { label: "Scheduled + on demand" },
};

/** The hue each kind's badge uses, everywhere. Status hues from the Atlas look. */
/** Workflows are system design (yellow); agents are AI (pink); a bot is neutral and wears its desk's color on its avatar. */
export const KIND_COLOR: Record<Kind, string> = { workflow: "var(--c-system)", bot: "var(--c-slate)", agent: "var(--c-ai)" };

// ---- workflows ----

export interface Workflow {
  id: string;
  name: string;
  kind: "workflow";
  /** The industry name for its shape, for explaining it in a sentence. */
  pattern: string;
  trigger: Trigger;
  /** When it runs, in words. */
  when: string;
  /** What runs it: the Chief of Staff, or a scheduler outside Atlas. */
  runBy: string;
  /** Its steps, in order. */
  steps: readonly string[];
  /** The bots it runs. */
  runs: readonly AgentId[];
  /** Activity-log tasks written by this workflow's own run, if it logs one. */
  tasks: readonly string[];
  /** The local times ("HH:MM") it is planned for on a day. A band for the 15-minute watch. */
  planned: (day: LocalDate) => readonly string[];
  band?: { from: string; to: string; everyMinutes: number };
  ai: AiUse;
  reach: Reach;
}

const weekday = (day: LocalDate) => weekdayIndex(day) <= 4;
const hhmm = (h: number) => `${String(h).padStart(2, "0")}:00`;

export const WORKFLOWS: readonly Workflow[] = [
  {
    id: "morning-brief",
    name: "Morning brief",
    kind: "workflow",
    pattern: "Orchestrator-worker, fixed plan",
    trigger: "both",
    when: "Mon–Fri 9:00 AM, Sat 9:00 AM (lighter); Run now",
    runBy: "Chief of Staff, started by Vercel Cron",
    steps: ["Copy target roles from Notion", "Score every bot's evals", "Run Email, then Calendar, News, Finance", "Run Analyst, Applications, then Career Mentor", "Write the brief (AI wording, rules facts)", "Deliver: brief, pages, phone alert"],
    runs: ["email", "calendar", "news", "finance", "analyst", "career", "mentor"],
    tasks: ["Morning Brief", "Saturday Brief"],
    planned: (day) => (weekdayIndex(day) <= 5 ? ["09:00"] : []),
    ai: "ai-assisted",
    reach: "inside",
  },
  {
    id: "afternoon-brief",
    name: "2:00 PM brief",
    kind: "workflow",
    pattern: "Orchestrator-worker, fixed plan",
    trigger: "both",
    when: "Mon–Fri 2:00 PM; Run now",
    runBy: "Chief of Staff, started by Vercel Cron",
    steps: ["Run the same bots as the morning", "Keep only what is new since the morning", "Write the brief (AI wording, rules facts)", "Deliver"],
    runs: ["email", "calendar", "news", "finance", "analyst", "career", "mentor"],
    tasks: ["2:00 PM Brief"],
    planned: (day) => (weekday(day) ? ["14:00"] : []),
    ai: "ai-assisted",
    reach: "inside",
  },
  {
    id: "sync",
    name: "2-hour sync",
    kind: "workflow",
    pattern: "Sequential pipeline",
    trigger: "both",
    when: "Mon–Sat 6 AM to 4 PM, every 2 hours; Sync now",
    runBy: "Chief of Staff, started by Vercel Cron",
    steps: ["Copy target roles from Notion", "Email sorts the inbox", "Calendar, News, Applications, Finance, Scout refresh", "Scout reads your GitHub projects", "Remind you of texts you scheduled"],
    runs: ["email", "calendar", "news", "career", "finance", "scout"],
    tasks: ["2-hour sync"],
    planned: (day) => (isSyncDay(day) ? SYNC_HOURS.map(hhmm) : []),
    ai: "rules",
    reach: "inside",
  },
  {
    id: "evening",
    name: "Evening run",
    kind: "workflow",
    pattern: "Sequential pipeline",
    trigger: "schedule",
    when: "Mon–Sat about 6 PM",
    runBy: "Vercel Cron",
    steps: ["Applications: resume sync, Figma to Notion (Mondays)", "Mentor: evening review", "Mentor: target role profiles (Mondays)", "Scout: national benchmarks, BLS and FRED (Mondays)", "Mentor: AI check of engineering-type labels (daily)", "Mentor: career map (Mondays)"],
    runs: ["career", "mentor", "scout"],
    tasks: [],
    planned: (day) => (isSyncDay(day) ? ["18:00"] : []),
    ai: "ai-assisted",
    reach: "inside",
  },
  {
    id: "watch",
    name: "15-minute watch",
    kind: "workflow",
    pattern: "Polling pipeline",
    trigger: "schedule",
    when: "Every 15 minutes, 7 AM to 9 PM, every day",
    runBy: "Supabase Cron",
    steps: ["Read Gmail headers (read-only)", "Read new job emails by rules: rejection, interview, neither", "Add timeline events", "One phone alert"],
    runs: ["career"],
    tasks: ["Heard back watch"],
    planned: () => [],
    band: { from: "07:00", to: "21:00", everyMinutes: 15 },
    ai: "rules",
    reach: "inside",
  },
  {
    id: "more-fits",
    name: "Find more good fits",
    kind: "workflow",
    pattern: "Sequential pipeline",
    trigger: "button",
    when: "When you press it, on Career",
    runBy: "You",
    steps: ["Scout records new postings", "Analyst refreshes the market report", "Applications picks 5 postings never shown before"],
    runs: ["scout", "analyst", "career"],
    tasks: [],
    planned: () => [],
    ai: "ai-assisted",
    reach: "inside",
  },
  {
    id: "night-shift",
    name: "Night shift",
    kind: "workflow",
    pattern: "Sequential pipeline over four agents",
    trigger: "schedule",
    when: "Every night, 10 to 11 PM, in a few short runs",
    runBy: "Vercel Cron",
    steps: ["Clear jobs above your level from the Apply Queue and Good fits (rules)", "Sunday only: the Planner proposes next week's plan, for your approval", "Find today's top picks and what is already prepared", "The Researcher on each, in order", "The Tailor on each", "The Nudger on the two oldest waiting follow-ups", "Stop when the day's AI calls or the time run out"],
    runs: ["career"],
    tasks: ["Night shift: prepare tomorrow's applications"],
    planned: () => ["22:10", "22:40", "23:10", "23:40"],
    ai: "ai-assisted",
    reach: "inside",
  },
  {
    id: "mentor-refresh",
    name: "Refresh and review",
    kind: "workflow",
    pattern: "Sequential pipeline",
    trigger: "button",
    when: "When you press it, on the Career Mentor's card",
    runBy: "You",
    steps: ["Career desk brings its data up to date", "Career Mentor reviews with it"],
    runs: ["scout", "analyst", "mentor"],
    tasks: ["Refresh and review"],
    planned: () => [],
    ai: "ai-assisted",
    reach: "inside",
  },
];

// ---- agents: the model picks its own next tool, in a loop, inside limits ----

export interface LoopAgent {
  id: string;
  name: string;
  kind: "agent";
  pattern: string;
  /** What it produces, in a few words. */
  role: string;
  owns: string;
  never: string;
  /** The tools it may pick from: all read-only; none writes, sends or deletes. */
  tools: readonly AgentToolInfo[];
  /** Its hard limits a run. */
  limits: string;
  /** The bot its runs are logged under, and whose Pause stops it. */
  runsUnder: AgentId;
  /** The activity-log task its runs write (test/registry.test.ts checks it against lib/agents). */
  task: string;
  trigger: Trigger;
  when: string;
  color: string;
  initials: string;
}

/** What an agent's tool can reach. Every tool is read-only. */
export type ToolReach = "atlas" | "web" | "check";
export const TOOL_REACH: Record<ToolReach, { label: string; hint: string }> = {
  atlas: { label: "Reads Atlas", hint: "Reads your own data in Atlas. Writes nothing." },
  web: { label: "Public web", hint: "Reads public pages or headlines, inside a per-run cap and Firecrawl's monthly budget." },
  check: { label: "Rules check", hint: "Checks the draft in code against what the agent read. Reads and writes nothing." },
};

/** One tool an agent may pick, in plain words. The name matches its defineTool in lib/agents. */
export interface AgentToolInfo {
  name: string;
  does: string;
  reach: ToolReach;
}

export const LOOP_AGENTS: readonly LoopAgent[] = [
  {
    id: "pitch",
    name: "Tailor",
    kind: "agent",
    pattern: "Tool-using loop with a reviewer and a judge",
    role: "Tailors one application",
    owns: "For one job in your Apply Queue: maps each must-have to proof from your resume or names it a gap, proposes up to 3 resume line swaps in the posting's own words, and drafts a short note. Finishes only after a rules review (no number or skill that is not in your material) and a separate judge.",
    never: "Edit your resume, send anything, or claim experience you do not have. You make the changes in Figma and apply yourself.",
    tools: [
      { name: "readJob", does: "The job: title, company and must-haves.", reach: "atlas" },
      { name: "readResume", does: "The resume to tailor, line by line.", reach: "atlas" },
      { name: "findEvidence", does: "Your best proof for one must-have, from your resumes and projects (hybrid search).", reach: "atlas" },
      { name: "checkClaims", does: "Flags any swap or note line your material does not support.", reach: "check" },
    ],
    limits: "12 steps and 10 AI calls a run; 6 runs per 10 minutes; resumes after 50 seconds",
    runsUnder: "career",
    task: "Pitch: tailor an application",
    trigger: "button",
    when: "Tailor this job, on a queued job",
    color: "var(--c-ai)",
    initials: "TA",
  },
  {
    id: "research",
    name: "Researcher",
    kind: "agent",
    pattern: "Tool-using loop with a reviewer and a judge",
    role: "Researches one company",
    owns: "For one job in your Apply Queue: looks the company up on the public web, choosing its own next search or page, and writes what it does, why them, your angle and what to ask. Every line cites a fact it read; a rules review and a separate judge check it. The Tailor, the Coach and Claude read the result.",
    never: "Read LinkedIn, Indeed or Glassdoor, open a page its own search did not return, write about a person's private life, or state a number its sources lack.",
    tools: [
      { name: "readJob", does: "What the posting says and how you fit it.", reach: "atlas" },
      { name: "companyNews", does: "The company's headlines from the last month.", reach: "web" },
      { name: "searchWeb", does: "Searches the public web for the company (3 a run).", reach: "web" },
      { name: "readPage", does: "Opens one result its own search returned (3 a run).", reach: "web" },
      { name: "checkLines", does: "Checks every line cites a fact it read and states no number it lacks.", reach: "check" },
    ],
    limits: "3 searches, 3 pages, 12 steps and 8 AI calls a run; inside Firecrawl's monthly budget",
    runsUnder: "career",
    task: "Company Research: research a company",
    trigger: "both",
    when: "Every night for your top picks, or Research this company on a queued job",
    color: "var(--c-ai)",
    initials: "RE",
  },
  {
    id: "prep",
    name: "Coach",
    kind: "agent",
    pattern: "Tool-using loop with a reviewer and a judge",
    role: "Prepares one interview",
    owns: "For one application: likely questions (one per must-have, plus behavioral), a true story for each from your resumes and projects (situation, task, action, result, with its source), the gaps to answer honestly, and questions to ask them. Claude can run it as a spoken mock interview through the connector.",
    never: "Invent a story, a result or a number, or send anything. It prepares; you practise and answer.",
    tools: [
      { name: "readJob", does: "The job: must-haves and the questions they suggest.", reach: "atlas" },
      { name: "readCompany", does: "What the Researcher found about the company.", reach: "atlas" },
      { name: "findStory", does: "A true story for one must-have or question, from your resumes and projects.", reach: "atlas" },
      { name: "checkClaims", does: "Flags any story line your material does not support.", reach: "check" },
    ],
    limits: "14 steps and 10 AI calls a run; 6 runs per 10 minutes; one new interview per sync",
    runsUnder: "career",
    task: "Interview Prep: prepare for an interview",
    trigger: "both",
    when: "When an application reaches Interview, or Prepare on an application",
    color: "var(--c-ai)",
    initials: "CO",
  },
  {
    id: "strategist",
    name: "Planner",
    kind: "agent",
    pattern: "Tool-using loop with a reviewer and a judge",
    role: "Plans your week",
    owns: "Reads your funnel, Apply Queue, applications, the market, your proof project and what happened to last week's plan, choosing what to read next, and proposes exactly three moves for the week. Every move cites the numbers it rests on; a rules review and a separate judge check it. You approve; then the moves become tasks on your days.",
    never: "Put anything on your days before you approve, repeat a move you finished last week, or state a number your data lacks.",
    tools: [
      { name: "readFunnel", does: "Applications sent, replies, rejections and reply rate.", reach: "atlas" },
      { name: "readQueue", does: "The Apply Queue: jobs at your level and today's top picks.", reach: "atlas" },
      { name: "readLastWeek", does: "Last week's plan and which moves you finished.", reach: "atlas" },
      { name: "readApplications", does: "Applications waiting, at interview or with an offer.", reach: "atlas" },
      { name: "readMarket", does: "The latest market report and its one recommendation.", reach: "atlas" },
      { name: "readProof", does: "Your open proof project and how many are finished.", reach: "atlas" },
      { name: "checkPlan", does: "Checks each move cites facts it read and states no number they lack.", reach: "check" },
    ],
    limits: "12 steps and 9 AI calls a run; 4 runs per half hour",
    runsUnder: "career",
    task: "Weekly Strategist: plan the week",
    trigger: "both",
    when: "Sunday night for the coming week (night shift), or Plan my week on Growth",
    color: "var(--c-ai)",
    initials: "PL",
  },
  {
    id: "followup",
    name: "Nudger",
    kind: "agent",
    pattern: "Tool-using loop with a reviewer and a judge",
    role: "Writes one follow-up",
    owns: "For an application quiet for a week, rewrites the waiting follow-up with one specific, true reason to reply, from the saved company research or tailored pitch, and greets someone you know there by first name. A rules review and a separate judge check it; otherwise the template stands. Tracker shows how many follow-ups got a reply.",
    never: "Send an email, use an email address, guess a recruiter's contact, or state a number its sources lack. You send it yourself.",
    tools: [
      { name: "readApplication", does: "The role, the company, when you applied and how long it has been quiet.", reach: "atlas" },
      { name: "readResearch", does: "The saved company research, for a specific hook.", reach: "atlas" },
      { name: "readPitch", does: "The tailored pitch: must-haves you proved, with proof.", reach: "atlas" },
      { name: "findPerson", does: "Someone you know at the company, by first name only.", reach: "atlas" },
      { name: "checkDraft", does: "Checks the hook is cited, the greeting, the length and the follow-up rules.", reach: "check" },
    ],
    limits: "10 steps and 6 AI calls a run; two a night; 6 rewrites per 10 minutes",
    runsUnder: "career",
    task: "Follow-up: write a follow-up",
    trigger: "both",
    when: "Every night for the oldest waiting follow-ups (night shift), or Rewrite with agent in the Apply Queue",
    color: "var(--c-ai)",
    initials: "NU",
  },
];

// ---- each bot's jobs ----

export interface Job {
  bot: AgentId;
  name: string;
  ai: AiUse;
  trigger: Trigger;
  when: string;
  reach?: Reach;
}

export const JOBS: readonly Job[] = [
  { bot: "chief-of-staff", name: "Write each brief, Hot List first", ai: "ai-assisted", trigger: "both", when: "In each brief" },
  { bot: "calendar", name: "Review today and the week ahead, flag conflicts", ai: "rules", trigger: "schedule", when: "Briefs and syncs" },
  { bot: "news", name: "Pick 9 stories from allowlisted feeds", ai: "rules", trigger: "schedule", when: "Briefs and syncs" },
  { bot: "email", name: "Sort the inbox, flag job and finance mail", ai: "rules", trigger: "schedule", when: "Briefs and syncs" },
  { bot: "email", name: "Archive and unsubscribe what you tick", ai: "rules", trigger: "button", when: "On Inbox" },
  { bot: "finance", name: "Read tagged bills and payment alerts", ai: "rules", trigger: "schedule", when: "Weekday briefs and syncs" },
  { bot: "scout", name: "Record the job market: 6 public feeds, Adzuna once a day with its key, and your watchlist on 6 job-board systems, with descriptions and pay once a day", ai: "rules", trigger: "both", when: "Every sync" },
  { bot: "scout", name: "Record the U.S. tech market: role family, level, pay; duplicates merged; daily summary", ai: "rules", trigger: "both", when: "Every sync" },
  { bot: "scout", name: "Read national benchmarks: BLS JOLTS and OEWS pay, FRED (Indeed postings)", ai: "rules", trigger: "schedule", when: "Mondays, evening run" },
  { bot: "scout", name: "Find a company's job board: free checks, then Firecrawl (2 credits)", ai: "rules", trigger: "button", when: "On Data Pipeline and Setup" },
  { bot: "scout", name: "Read your GitHub projects", ai: "rules", trigger: "schedule", when: "Once a day, in a sync" },
  { bot: "analyst", name: "Daily market report", ai: "ai-assisted", trigger: "both", when: "Morning brief" },
  { bot: "analyst", name: "Read your funnel, rank your gaps, assign and close a proof project, keep lessons", ai: "ai-assisted", trigger: "both", when: "With the daily report" },
  { bot: "analyst", name: "Sort unclear job titles into your six roles (up to 40 a day)", ai: "ai-assisted", trigger: "schedule", when: "Once a day, with the report" },
  { bot: "career", name: "Applications and follow-ups", ai: "rules", trigger: "schedule", when: "Every sync" },
  { bot: "career", name: "Apply to these 5 today, by your level (rules)", ai: "rules", trigger: "both", when: "On the Apply page" },
  { bot: "career", name: "Clear queued jobs whose posting closed (Greenhouse and Lever)", ai: "rules", trigger: "schedule", when: "Every sync" },
  { bot: "career", name: "Run the Researcher on a queued job", ai: "ai-assisted", trigger: "both", when: "Every night for your top picks, or Research this company" },
  { bot: "career", name: "Run the Tailor on a queued job", ai: "ai-assisted", trigger: "both", when: "Every night for your top picks, or Tailor this job" },
  { bot: "career", name: "Night shift: prepare tomorrow's applications", ai: "ai-assisted", trigger: "schedule", when: "Every night, 10 to 11 PM" },
  { bot: "career", name: "Run the Coach", ai: "ai-assisted", trigger: "both", when: "When an application reaches Interview, or Prepare" },
  { bot: "career", name: "Match a job to your resume", ai: "ai-assisted", trigger: "both", when: "Briefs, Find more good fits" },
  { bot: "career", name: "Draft an application answer", ai: "ai-assisted", trigger: "button", when: "On an apply kit" },
  { bot: "career", name: "Read the postings you approved", ai: "rules", trigger: "button", when: "After a 👍" },
  { bot: "career", name: "Research the jobs in your Apply Queue (news, company pages, your angle)", ai: "ai-assisted", trigger: "button", when: "After a 👍, at syncs, or Research this company" },
  { bot: "career", name: "Find the employer's own posting", ai: "rules", trigger: "button", when: "After a 👍" },
  { bot: "career", name: "Read what rules cannot (model reader)", ai: "ai-assisted", trigger: "schedule", when: "Syncs, only when you turn it on" },
  { bot: "career", name: "Resume sync, Figma to Notion", ai: "rules", trigger: "schedule", when: "Mondays, evening run" },
  { bot: "mentor", name: "Morning priority, midday check, evening review (advice graded by rules, one rewrite when weak)", ai: "ai-assisted", trigger: "schedule", when: "Briefs and evening run" },
  { bot: "mentor", name: "Data mentor: review the pipeline, or one setup step", ai: "ai-assisted", trigger: "button", when: "On Data Pipeline" },
  { bot: "mentor", name: "Type check: AI second opinion on 40 jobs' engineering-type labels (display-only)", ai: "ai-assisted", trigger: "schedule", when: "Evening run, daily; or Check now on Market" },
  { bot: "mentor", name: "Career map: 15 paths, junior to staff, with pay, skills and steps (rules for facts, AI for steps)", ai: "ai-assisted", trigger: "schedule", when: "Evening run, Mondays; or Update now on Career Map" },
  { bot: "mentor", name: "Target roles review", ai: "ai-assisted", trigger: "button", when: "On Growth" },
  { bot: "mentor", name: "Target role profiles", ai: "ai-assisted", trigger: "schedule", when: "Weekly" },
  { bot: "mentor", name: "Target role descriptions (one web search each)", ai: "ai-assisted", trigger: "schedule", when: "Monthly" },
  { bot: "qa", name: "Weekly QA review", ai: "rules", trigger: "schedule", when: "Sunday evening" },
  { bot: "qa", name: "Score every bot's evals", ai: "rules", trigger: "schedule", when: "Before the morning brief" },
  { bot: "qa", name: "AI connection check", ai: "rules", trigger: "button", when: "On Mission Control" },
  { bot: "apply", name: "Answer a form for Atlas Autofill", ai: "ai-assisted", trigger: "button", when: "From the browser extension" },
];

export const jobsOf = (bot: AgentId): Job[] => JOBS.filter((j) => j.bot === bot);

// ---- infrastructure: automations that keep Atlas running, not part of its work ----

export interface InfraJob {
  name: string;
  kind: Kind;
  pattern: string;
  when: string;
  runBy: string;
}

export const INFRA: readonly InfraJob[] = [
  { name: "CI checks: lint, types, tests", kind: "workflow", pattern: "CI pipeline", when: "Every pull request", runBy: "GitHub Actions" },
  { name: "Keep Supabase awake", kind: "workflow", pattern: "Scheduled job", when: "Mondays and Thursdays", runBy: "GitHub Actions" },
  { name: "Preview and production deploys", kind: "workflow", pattern: "CD pipeline", when: "Every push", runBy: "Vercel" },
];

/** The workflow whose own run wrote this log task, if any. */
export const workflowForTask = (task: string): Workflow | undefined => WORKFLOWS.find((w) => w.tasks.includes(task));
