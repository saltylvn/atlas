import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_RESUME_TEXT } from "@/lib/data/demoResume";
import { draftAnswers, parseResumeText, roleSummary, summaryFromPassage } from "@/lib/domain/answerDrafts";
import { ANSWER_BANK, prepareAnswers, questionsFor } from "@/lib/domain/careerPrep";
import { toChunks, type KnowledgeDoc } from "@/lib/domain/knowledge";
import { numbersGrounded } from "@/lib/domain/market";

// A resume page as Atlas reads it from Notion: one line per block, headings closed with a
// full stop, entry titles split by bars. Fictional.
const RESUME = [
  "Summary.",
  "Engineer who builds where software meets the business: multi-agent systems and integrations. Ten years in sales first.",
  "Skills.",
  "AI Agents, Evals, Multi-Agent Orchestration, Python, SQL, RAG, Workflow Automation",
  "Experience.",
  "Support Analyst | Acme Health | 2025 – Present.",
  "Turn billing requirements into XML rules that catch bad claims before submission.",
  "Configure API and SFTP integrations for enterprise clients.",
  "Projects.",
  "Orbit | Multi-Agent Chief of Staff for Daily Operations.",
  "Next.js, TypeScript, Postgres, Claude Code",
  "Designed a supervisor agent system that routes work to five specialist agents.",
  "Built an eval suite of 225 labeled cases that gates every build.",
  "Relay | Human-in-the-Loop AI Inbox Triage.",
  "Python, FastAPI, Gemini API",
  "Built an AI workflow where Gemini classifies each message and rules decide whether to ask a person.",
  "Prior Career.",
  "Sales Leadership | D2D & Software Sales | 2015 – 2024.",
  "Acquired 300+ customer accounts in a single year.",
  "Education.",
  "State University: Bachelor of Science",
  "Certifications.",
  "Google IT Support",
].join("\n");

describe("the questions", () => {
  it("keeps every id the saved answers already use", () => {
    const ids = ANSWER_BANK.map((q) => q.id);
    for (const id of ["intro", "workHistory", "salary", "authorization", "startDate", "location", "whyCompany", "links"]) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("splits by track: a gig never gets the salary question, a job never gets the hourly rate", () => {
    const job = questionsFor("full-time").map((q) => q.id);
    const gig = questionsFor("gig").map((q) => q.id);
    expect(job).toContain("salary");
    expect(job).not.toContain("rate");
    expect(gig).toContain("rate");
    expect(gig).not.toContain("salary");
    expect(job).toContain("intro");
    expect(gig).toContain("intro");
  });

  it("asks nothing demographic", () => {
    const text = ANSWER_BANK.map((q) => `${q.question} ${q.starter}`).join(" ").toLowerCase();
    for (const word of ["gender", "race", "ethnicity", "veteran", "disability", "date of birth", "age"]) expect(text).not.toMatch(new RegExp(`\\b${word}\\b`));
  });
});

describe("drafts from a resume", () => {
  const parsed = parseResumeText(RESUME);
  const drafts = draftAnswers(parsed, "Sam");

  it("reads the sections, entries and bullets", () => {
    expect(parsed.summary).toMatch(/^Engineer who builds/);
    expect(parsed.skills).toContain("RAG");
    expect(parsed.experience[0]!.parts).toEqual(["Support Analyst", "Acme Health", "2025 – Present"]);
    expect(parsed.projects.map((p) => p.parts[0])).toEqual(["Orbit", "Relay"]);
    expect(parsed.projects[0]!.stack).toBe("Next.js, TypeScript, Postgres, Claude Code");
    expect(parsed.projects[0]!.bullets).toHaveLength(2);
    expect(parsed.prior[0]!.bullets).toEqual(["Acquired 300+ customer accounts in a single year."]);
  });

  it("drafts the intro, work history, project, AI experience and proposal opener", () => {
    expect(drafts.intro).toBe(`${parsed.summary} I'm currently a Support Analyst at Acme Health, and built Orbit and Relay.`);
    expect(drafts.workHistory).toBe(
      "Support Analyst, Acme Health, 2025 – Present\n- Turn billing requirements into XML rules that catch bad claims before submission.\n- Configure API and SFTP integrations for enterprise clients.\n\nSales Leadership, D2D & Software Sales, 2015 – 2024\n- Acquired 300+ customer accounts in a single year.",
    );
    expect(drafts.project).toMatch(/^Orbit \(Multi-Agent Chief of Staff for Daily Operations\), built with Next\.js, TypeScript, Postgres, Claude Code\. Designed a supervisor/);
    const vowel = draftAnswers(parseResumeText(RESUME.replace("Support Analyst |", "Integration Analyst |")));
    expect(vowel.intro).toContain("I'm currently an Integration Analyst at Acme Health");
    expect(drafts.aiExperience).toMatch(/^Hands-on with AI Agents, Evals, Multi-Agent Orchestration and RAG\./);
    expect(drafts.proposalOpener).toMatch(/^Hi, I'm Sam\. I can help with \{role\}\. Engineer who builds/);
  });

  it("reads a job the way the resume sync mirrors it from Figma: title, then employer and dates", () => {
    // The live layout after the first sync: an entry title on its own line.
    const mirrored = RESUME.replace("Support Analyst | Acme Health | 2025 – Present.", "Support Analyst.\nAcme Health | 2025 – Present").replace("Sales Leadership | D2D & Software Sales | 2015 – 2024.", "Sales Leadership.\nD2D & Software Sales | 2015 – 2024");
    const p = parseResumeText(mirrored);
    expect(p.experience).toEqual(parsed.experience);
    expect(p.prior).toEqual(parsed.prior);
    expect(p.projects).toEqual(parsed.projects);
    expect(draftAnswers(p, "Sam")).toEqual(drafts);
  });

  it("never drafts what only you can answer", () => {
    for (const id of ["authorization", "salary", "whyLooking", "yearsExperience", "rate", "links", "whyCompany"]) expect(drafts[id]).toBeUndefined();
  });

  it("adds no number that is not in the resume", () => {
    expect(numbersGrounded(Object.values(drafts), [RESUME])).toBe(true);
  });

  it("works on the demo resume, and says nothing for an empty page", () => {
    expect(Object.keys(draftAnswers(parseResumeText(DEMO_RESUME_TEXT)))).toEqual(expect.arrayContaining(["intro", "workHistory", "project", "aiExperience"]));
    expect(draftAnswers(parseResumeText(""))).toEqual({});
    expect(draftAnswers(parseResumeText("Just some notes.\nNo sections here."))).toEqual({});
  });
});

describe("the matching resume's summary in an apply kit", () => {
  // Built the way the indexer builds resume passages, so the two cannot drift apart.
  const docs: KnowledgeDoc[] = [
    { source: "resume", sourceId: "ai-engineer", title: "Resume: AI Engineer", text: "Summary. Builds AI agent systems that run unattended. Ships LLM features end to end. Skills. AI Agents, Evals.", href: "", occurredAt: null },
    { source: "resume", sourceId: "master-resume", title: "Resume: Master Resume", text: "Summary. The master copy. Skills. Everything.", href: "", occurredAt: null },
  ];
  const passages = toChunks(docs).filter((c) => c.chunkIndex === 0);

  it("reads the summary from the first passage", () => {
    expect(summaryFromPassage(passages[0]!.content)).toBe("Builds AI agent systems that run unattended. Ships LLM features end to end.");
    expect(summaryFromPassage("No summary heading here.")).toBe("");
  });

  it("finds the resume for the job's role, never the master", () => {
    expect(roleSummary(passages, "AI Engineer")).toEqual({ resume: "AI Engineer", text: "Builds AI agent systems that run unattended. Ships LLM features end to end." });
    expect(roleSummary(passages, "ai engineer")?.resume).toBe("AI Engineer");
    expect(roleSummary(passages, "Master Resume")).toBeNull();
    expect(roleSummary(passages, "GTM Engineer")).toBeNull();
    expect(roleSummary(passages, "")).toBeNull();
  });

  it("is offered beside your own intro, never instead of it, and only on the right track", () => {
    const summary = roleSummary(passages, "AI Engineer");
    const ready = prepareAnswers({ intro: "My own intro.", salary: "Mine." }, { company: "Acme", role: "AI Engineer" }, { roleSummary: summary });
    expect(ready.map((a) => a.id).slice(0, 2)).toEqual(["intro", "introResume"]);
    expect(ready[0]!.answer).toBe("My own intro.");
    expect(ready[1]).toMatchObject({ fromResume: "AI Engineer", isStarter: false });
    // The same text twice is shown once.
    expect(prepareAnswers({ intro: summary!.text }, { company: "Acme", role: "AI Engineer" }, { roleSummary: summary }).filter((a) => a.id.startsWith("intro"))).toHaveLength(1);
    const gig = prepareAnswers({ salary: "Mine.", rate: "$90/hr" }, { company: "Client", role: "Agent build" }, { type: "gig" });
    expect(gig.map((a) => a.id)).toContain("rate");
    expect(gig.map((a) => a.id)).not.toContain("salary");
  });
});

describe("the per-job AI draft", () => {
  const src = readFileSync("lib/knowledge/answerDraft.ts", "utf8");

  it("searches resumes only, spends one budgeted call, and checks citations and numbers", () => {
    expect(src).toContain('sources: ["resume"]');
    expect(src).toContain("takeAiCall(ctx.store, ctx.settings, \"answer-draft\")");
    expect(src).toContain("checkCitations(");
    expect(src).toContain("numbersGrounded(");
  });

  it("stores nothing and logs counts only", () => {
    expect(src).not.toMatch(/\.(create|update|add|upsert)\(/);
    expect(src).toContain("`draft of ${text.length} characters");
    // The draft text never reaches the activity log.
    expect(src).not.toMatch(/detail: [^,]*\btext\b(?!\.length)/);
  });
});
