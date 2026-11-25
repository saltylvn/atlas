import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { saveTracked, trackApplications } from "@/lib/agents/career";
import type { Context } from "@/lib/context";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import { eventIndex, mailEvents, mailsToPlace, matchMail, NO_EVENTS, sameRole, trackFromEmail, trackMail, type JobMail, type MailKind } from "@/lib/domain/applications";
import { applyEvent, furthest, heardAt, ownEvent, project, stageEvent, stageForStatus, stageOf, stageOfStatus, standingOf, statusOfStage, stepsFor, timelineRows, type Standing } from "@/lib/domain/pipeline";
import { APPLICATION_STAGES, APPLICATION_STATUSES, EVENT_KINDS, type Application, type ApplicationEvent, type ApplicationStage, type ApplicationStatus, type InboxItem } from "@/lib/domain/types";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const NOW = new Date("2026-11-17T16:00:00Z");

const app = (over: Partial<Application> = {}): Application => ({
  id: "a1",
  company: "Acme",
  role: "AI Engineer",
  targetRole: "",
  source: "Email",
  url: "",
  payText: "",
  tier: "semi",
  status: "applied",
  appliedOn: "2026-11-01",
  statusAt: "2026-11-01T12:00:00Z",
  notes: "",
  origin: "atlas",
  externalId: "email:x",
  createdAt: "2026-11-01T12:00:00Z",
  ...over,
});
const jobMail = (kind: MailKind, at: string, id = `${kind}-${at}`, over: Partial<JobMail> = {}): JobMail => ({ messageId: id, subject: "Update on your application at Acme", fromName: "Acme Recruiting", fromEmail: "talent@acme.com", kind, receivedAt: at, ...over });
const happened = (kind: ApplicationEvent["kind"], occurredAt: string, over: Partial<ApplicationEvent> = {}) => ({ kind, occurredAt, source: "email" as const, decidedBy: "rules" as const, stage: null, ...over });
const at = (stage: ApplicationStage, stageAt = "2026-11-05T12:00:00Z"): Standing => ({ stage, stageAt, lastHeardAt: null });

describe("Stages and statuses", () => {
  it("every stage reads as one of the six board statuses, and every status has a stage that reads back as it", () => {
    for (const s of APPLICATION_STAGES) expect(APPLICATION_STATUSES).toContain(statusOfStage(s));
    for (const s of APPLICATION_STATUSES) expect(statusOfStage(stageOfStatus(s))).toBe(s);
    expect(["screen", "assessment", "interview"].map((s) => statusOfStage(s as ApplicationStage))).toEqual(["interview", "interview", "interview"]);
    expect(statusOfStage("in_review")).toBe("replied");
    expect(statusOfStage("withdrawn")).toBe("rejected");
  });

  it("trusts a stored stage only while it agrees with the status", () => {
    expect(stageOf(app({ status: "interview", stage: "screen" }))).toBe("screen");
    // A row from before the Pipeline, and one a status-only writer moved since.
    expect(stageOf(app({ status: "replied" }))).toBe("in_review");
    expect(stageOf(app({ status: "rejected", stage: "screen" }))).toBe("rejected");
  });

  it("keeps the finer stage when you pick the status it already reads as", () => {
    expect(stageForStatus(app({ status: "interview", stage: "assessment" }), "interview")).toBe("assessment");
    expect(stageForStatus(app({ status: "interview", stage: "assessment" }), "offer")).toBe("offer");
  });
});

describe("What an event does to where an application stands", () => {
  // The tracker's rule as it was before the Pipeline, written out: the reducer must agree
  // with it for every status and every kind of job email.
  const RANK: Record<ApplicationStatus, number> = { saved: 0, applied: 1, replied: 2, interview: 3, offer: 4, rejected: 5 };
  // The four kinds the reader learned in Phase 3 follow the same rule: an assessment reads as
  // "interview", a request for times or for something as "replied", an offer as "offer".
  const TARGET: Record<Exclude<MailKind, "recruiter">, ApplicationStatus> = { confirmation: "applied", reply: "replied", interview: "interview", rejection: "rejected", assessment: "interview", scheduling: "replied", info_request: "replied", offer: "offer" };
  const before = (status: ApplicationStatus, target: ApplicationStatus) =>
    (target === "rejected" ? status !== "offer" && status !== "rejected" : status !== "rejected" && RANK[target] > RANK[status]) ? target : status;

  it.each(APPLICATION_STATUSES.flatMap((s) => (Object.keys(TARGET) as (keyof typeof TARGET)[]).map((k) => [s, k] as const)))("from %s, a %s email moves it exactly as the tracker always has", (status, kind) => {
    const changes = trackFromEmail([jobMail(kind, "2026-11-10T15:00:00Z")], [app({ status })]);
    const after = changes.update[0]?.status ?? status;
    expect(after).toBe(before(status, TARGET[kind]));
    // The one thing the ladder changed: a confirmation that comes after a rejection is you applying again.
    expect(changes.create.map((c) => c.status)).toEqual(status === "rejected" && kind === "confirmation" ? ["applied"] : []);
  });

  it("treats an email older than the last move as history", () => {
    expect(trackFromEmail([jobMail("interview", "2026-10-30T15:00:00Z")], [app()]).update).toEqual([]);
    expect(applyEvent(at("applied"), happened("rejection", "2026-11-01T00:00:00Z")).stage).toBe("applied");
  });

  it("moves forward only, and a rejection closes anything short of an offer", () => {
    expect(applyEvent(at("interview"), happened("reply", "2026-11-06T12:00:00Z")).stage).toBe("interview");
    expect(applyEvent(at("in_review"), happened("rejection", "2026-11-06T12:00:00Z")).stage).toBe("rejected");
    expect(applyEvent(at("offer"), happened("rejection", "2026-11-06T12:00:00Z")).stage).toBe("offer");
    for (const kind of EVENT_KINDS.filter((k) => k !== "stage_set")) {
      expect(applyEvent(at("rejected"), happened(kind, "2026-11-06T12:00:00Z")).stage, kind).toBe("rejected");
      expect(applyEvent(at("withdrawn"), happened(kind, "2026-11-06T12:00:00Z")).stage, kind).toBe("withdrawn");
    }
  });

  it("lets a screen, an assessment and an interview come in any order: the latest is where you are", () => {
    const afterTakeHome = applyEvent(at("screen"), happened("assessment", "2026-11-06T12:00:00Z"));
    expect(afterTakeHome.stage).toBe("assessment");
    expect(applyEvent(afterTakeHome, happened("screen", "2026-11-07T12:00:00Z")).stage).toBe("screen");
    expect(applyEvent(at("interview"), happened("offer", "2026-11-08T12:00:00Z")).stage).toBe("offer");
  });

  it("a stage you set wins in any direction, even on a closed application", () => {
    const set = (stage: ApplicationStage) => happened("stage_set", "2026-11-06T12:00:00Z", { source: "you", decidedBy: "you", stage });
    expect(applyEvent(at("rejected"), set("interview")).stage).toBe("interview");
    expect(applyEvent(at("offer"), set("applied")).stage).toBe("applied");
    // Even dated before the last move: you said so.
    expect(applyEvent(at("interview"), { ...set("withdrawn"), occurredAt: "2026-11-01T00:00:00Z" }).stage).toBe("withdrawn");
  });

  it("never lets a model's reading move a stage or count as hearing back", () => {
    for (const kind of EVENT_KINDS) {
      const after = applyEvent(at("applied"), happened(kind, "2026-11-06T12:00:00Z", { decidedBy: "model", stage: kind === "stage_set" ? "offer" : null }));
      expect(after, kind).toEqual(at("applied"));
    }
  });

  it("counts a real answer as hearing back, and an automatic confirmation or your own move as not", () => {
    expect(applyEvent(at("applied"), happened("confirmation", "2026-11-06T12:00:00Z")).lastHeardAt).toBeNull();
    expect(applyEvent(at("applied"), happened("reply", "2026-11-06T12:00:00Z")).lastHeardAt).toBe("2026-11-06T12:00:00Z");
    // A reply that does not move the stage is still an answer.
    expect(applyEvent(at("interview"), happened("reply", "2026-11-06T12:00:00Z"))).toEqual({ stage: "interview", stageAt: "2026-11-05T12:00:00Z", lastHeardAt: "2026-11-06T12:00:00Z" });
    expect(applyEvent(at("applied"), happened("follow_up", "2026-11-06T12:00:00Z", { source: "you", decidedBy: "you" })).lastHeardAt).toBeNull();
    expect(heardAt([happened("reply", "2026-11-03T00:00:00Z"), happened("confirmation", "2026-11-09T00:00:00Z")], "2026-11-02T00:00:00Z")).toBe("2026-11-03T00:00:00Z");
    expect(heardAt([happened("confirmation", "2026-11-09T00:00:00Z")], null)).toBeNull();
  });
});

describe("Replaying a timeline", () => {
  it("gives the same stage as taking the events one at a time, whatever order they are stored in", () => {
    const events = [
      happened("interview", "2026-11-12T15:00:00Z"),
      happened("applied", "2026-11-01T12:00:00Z", { source: "you", decidedBy: "you" }),
      happened("reply", "2026-11-13T15:00:00Z"),
      happened("confirmation", "2026-11-01T12:05:00Z"),
    ];
    expect(project(events)).toEqual({ stage: "interview", stageAt: "2026-11-12T15:00:00Z", lastHeardAt: "2026-11-13T15:00:00Z" });
    expect(project([])).toBeNull();
  });

  it("starts an existing application where the migration's two rows put it", () => {
    // As the backfill writes them: "applied" on the day, then the stage it had reached.
    const baseline = [happened("applied", "2026-11-01T12:00:00Z", { source: "atlas" }), happened("stage_set", "2026-11-10T09:00:00Z", { source: "atlas", stage: "in_review" })];
    expect(statusOfStage(project(baseline)!.stage)).toBe("replied");
    expect(project([...baseline, happened("interview", "2026-11-14T09:00:00Z")])!.stage).toBe("interview");
  });

  it("logs a move so that replaying it gives the stage the row was given", () => {
    const now = "2026-11-17T16:00:00Z";
    // New, or a move the forward-only rule makes anyway: logged as what it is.
    expect(stageEvent(null, "a1", "applied", now, "you:1").kind).toBe("applied");
    expect(stageEvent(app({ status: "saved" }), "a1", "applied", now, "approval:1").kind).toBe("applied");
    expect(stageEvent(null, "a1", "interview", now, "you:1")).toMatchObject({ kind: "stage_set", stage: "interview", decidedBy: "you" });
    // A move back (a kit marked submitted on an application already interviewing): set outright.
    const back = stageEvent(app({ status: "interview" }), "a1", "applied", now, "approval:2");
    expect(back).toMatchObject({ kind: "stage_set", stage: "applied" });
    expect(applyEvent(standingOf(app({ status: "interview" })), back).stage).toBe("applied");
    expect(stageEvent(null, "a1", "applied", now, "apply:run1", { source: "apply-agent", summary: "Applied by Atlas" })).toMatchObject({ source: "apply-agent", decidedBy: "rules", summary: "Applied by Atlas" });
    expect(ownEvent("a1", "follow_up", now, "approval:3")).toMatchObject({ kind: "follow_up", stage: null, summary: "You followed up" });
  });

  it("replays every demo application's timeline to the status on its card", async () => {
    const state = seedState(NOW);
    const store = createMemoryStore(state);
    for (const a of await store.applications.list()) {
      const standing = project(await store.applicationEvents.forApplication(a.id));
      expect(standing && statusOfStage(standing.stage), a.company).toBe(a.status);
    }
  });
});

describe("Job emails on the timeline", () => {
  it("is one event per email the tracker placed, and none for anything else", () => {
    const apps = [app(), app({ id: "b1", company: "Beta Co" })];
    const tracked = trackMail(
      [
        jobMail("confirmation", "2026-11-02T15:00:00Z", "m1", { threadId: "t1" }),
        jobMail("interview", "2026-11-12T15:00:00Z", "m2", { threadId: "t1", quote: "We would like to schedule a call with you." }),
        jobMail("recruiter", "2026-11-12T16:00:00Z", "m3"),
      ],
      apps,
    );
    const events = mailEvents(tracked.placed, (id) => id);
    expect(events.map((e) => [e.applicationId, e.kind, e.sourceRef, e.threadId])).toEqual([
      ["a1", "confirmation", "email:m1", "t1"],
      ["a1", "interview", "email:m2", "t1"],
    ]);
    expect(events.every((e) => e.source === "email" && e.decidedBy === "rules" && e.stage === null)).toBe(true);
    // The reader's sentence when there is one, else the subject. Never more than 200 characters.
    expect(events[0]!.summary).toBe("Update on your application at Acme");
    expect(events[1]!.summary).toBe("We would like to schedule a call with you.");
    expect(mailEvents([{ mail: jobMail("reply", "2026-11-12T15:00:00Z", "m5", { quote: "x".repeat(400) }), app: "a1" }], (id) => id)[0]!.summary).toHaveLength(200);
    // An application the run could not be matched to a stored id gets no event.
    expect(mailEvents(tracked.placed, () => undefined)).toEqual([]);
  });

  it("stores an event once, however often the same email is seen", async () => {
    const store = createMemoryStore(seedState(NOW));
    const [first] = mailEvents([{ mail: jobMail("reply", "2026-11-12T15:00:00Z", "m1"), app: "demo-app-3" }], (id) => id);
    expect(await store.applicationEvents.append([first!])).toHaveLength(1);
    expect(await store.applicationEvents.append([first!])).toEqual([]);
    const timeline = await store.applicationEvents.forApplication("demo-app-3");
    expect(timeline.filter((e) => e.sourceRef === "email:m1")).toHaveLength(1);
    expect(timeline.map((e) => e.occurredAt)).toEqual([...timeline.map((e) => e.occurredAt)].sort());
    expect((await store.applicationEvents.index()).find((e) => e.sourceRef === "email:m1")).toEqual({ applicationId: "demo-app-3", sourceRef: "email:m1", threadId: "" });
  });
});

describe("Which application an email is about (the ladder)", () => {
  const ai = app({ id: "ai", role: "AI Engineer" });
  const se = app({ id: "se", role: "Solutions Engineer, Mid-Market (Remote)" });
  const two = [ai, se];
  const named = (role: string, kind: MailKind = "reply", over: Partial<JobMail> = {}) => jobMail(kind, "2026-11-10T15:00:00Z", `n-${role}-${kind}`, { subject: `Your application for the ${role} role at Acme`, ...over });

  it("tells the same job from a different one by its title", () => {
    expect(sameRole("Solutions Engineer", "Solutions Engineer, Mid-Market (Remote)")).toBe(true);
    expect(sameRole("Senior AI Engineer", "AI Engineer II")).toBe(true);
    expect(sameRole("AI Engineer", "Solutions Engineer")).toBe(false);
    expect(sameRole("Software Engineer", "Software Engineering Manager")).toBe(false);
    expect(sameRole("", "AI Engineer")).toBe(false);
  });

  it("1. follows the Gmail thread, whatever else the email says", () => {
    const index = eventIndex([{ applicationId: "se", sourceRef: "email:old", threadId: "t9" }]);
    expect(matchMail(named("AI Engineer", "reply", { threadId: "t9" }), two, index)).toEqual({ to: "application", id: "se", by: "thread" });
    // A thread that belongs to an application no longer on the board decides nothing.
    expect(matchMail(named("AI Engineer", "reply", { threadId: "t9" }), [ai], index)).toEqual({ to: "application", id: "ai", by: "role" });
    // Only an email's thread counts: your own moves have none.
    expect(eventIndex([{ applicationId: "se", sourceRef: "you:1", threadId: "t9" }]).threadOf("t9")).toBeUndefined();
  });

  it("2. goes by the role the email names", () => {
    expect(matchMail(named("Solutions Engineer"), two)).toEqual({ to: "application", id: "se", by: "role" });
    expect(matchMail(named("Senior AI Engineer", "rejection"), two)).toEqual({ to: "application", id: "ai", by: "role" });
    // The title word for word beats a fuller form of it.
    const applied = app({ id: "aai", role: "Applied AI Engineer" });
    expect(matchMail(named("AI Engineer"), [ai, applied])).toEqual({ to: "application", id: "ai", by: "role" });
    // Two with that title: the open one.
    expect(matchMail(named("AI Engineer"), [ai, app({ id: "old", role: "AI Engineer", status: "rejected" })])).toEqual({ to: "application", id: "ai", by: "role" });
    expect(matchMail(named("AI Engineer"), [ai, app({ id: "ai2", role: "AI Engineer" })])).toEqual({ to: "ask", candidates: ["ai", "ai2"] });
  });

  it("3. with no role named, takes the company's one open application", () => {
    expect(matchMail(jobMail("reply", "2026-11-10T15:00:00Z"), [ai])).toEqual({ to: "application", id: "ai", by: "company" });
    expect(matchMail(jobMail("reply", "2026-11-10T15:00:00Z"), [ai, app({ id: "old", role: "Data Engineer", status: "rejected" })])).toEqual({ to: "application", id: "ai", by: "company" });
    // The one application there was logged before any email named its role: this is it.
    expect(matchMail(named("AI Engineer"), [app({ id: "x", role: "Role not listed" })])).toEqual({ to: "application", id: "x", by: "company" });
  });

  it("4. asks when it cannot tell, and never guesses", () => {
    expect(matchMail(jobMail("rejection", "2026-11-10T15:00:00Z"), two)).toEqual({ to: "ask", candidates: ["ai", "se"] });
    // A role none of them has, in anything but a confirmation.
    expect(matchMail(named("Data Engineer", "interview"), two)).toEqual({ to: "ask", candidates: ["ai", "se"] });
    expect(matchMail(named("Data Engineer", "rejection"), [ai])).toEqual({ to: "ask", candidates: ["ai"] });
  });

  it("5. logs a new application when there is none, when a confirmation names another role, or when you applied again", () => {
    expect(matchMail(jobMail("confirmation", "2026-11-10T15:00:00Z"), [app({ company: "Beta Co" })])).toEqual({ to: "new" });
    expect(matchMail(named("Data Engineer", "confirmation"), two)).toEqual({ to: "new" });
    const closed = app({ id: "old", status: "rejected", statusAt: "2026-11-05T12:00:00Z" });
    expect(matchMail(jobMail("confirmation", "2026-11-10T15:00:00Z"), [closed])).toEqual({ to: "new" });
    // A confirmation that came before it closed, and anything else after: history on that application.
    expect(matchMail(jobMail("confirmation", "2026-11-02T15:00:00Z"), [closed])).toEqual({ to: "application", id: "old", by: "company" });
    expect(matchMail(jobMail("rejection", "2026-11-10T15:00:00Z"), [closed])).toEqual({ to: "application", id: "old", by: "company" });
  });

  it("is not about an application at all: recruiter outreach, or no company to read", () => {
    expect(matchMail(jobMail("recruiter", "2026-11-10T15:00:00Z"), two)).toBeNull();
    expect(matchMail(jobMail("reply", "2026-11-10T15:00:00Z", "g", { subject: "Application Received", fromName: "greenhouse-mail.io", fromEmail: "no-reply@greenhouse-mail.io" }), two)).toBeNull();
  });
});

describe("Two roles at one company", () => {
  const roleMail = (role: string, kind: MailKind, at: string, id: string) => jobMail(kind, at, id, { subject: `Your application for the ${role} role at Acme` });

  it("logs the second application, and a rejection for one leaves the other open", () => {
    const first = trackMail([roleMail("AI Engineer", "confirmation", "2026-11-02T15:00:00Z", "c1"), roleMail("Solutions Engineer", "confirmation", "2026-11-03T15:00:00Z", "c2")], []);
    expect(first.create.map((c) => [c.role, c.status])).toEqual([["AI Engineer", "applied"], ["Solutions Engineer", "applied"]]);
    expect(first.placed.map((p) => p.app)).toEqual(["email:c1", "email:c2"]);

    const stored = [app({ id: "ai", role: "AI Engineer", externalId: "email:c1" }), app({ id: "se", role: "Solutions Engineer", externalId: "email:c2" })];
    const index = eventIndex([{ applicationId: "ai", sourceRef: "email:c1", threadId: "" }, { applicationId: "se", sourceRef: "email:c2", threadId: "" }]);
    const later = trackMail([roleMail("AI Engineer", "rejection", "2026-11-09T15:00:00Z", "r1")], stored, () => "", index);
    expect(later.update).toEqual([{ id: "ai", company: "Acme", from: "applied", status: "rejected", stage: "rejected", statusAt: "2026-11-09T15:00:00Z" }]);
    expect(later.create).toEqual([]);
  });

  it("handles each email once, and leaves one it cannot place for you", () => {
    const stored = [app({ id: "ai", role: "AI Engineer" }), app({ id: "se", role: "Solutions Engineer" })];
    const mails = [jobMail("interview", "2026-11-12T15:00:00Z", "i1"), roleMail("AI Engineer", "reply", "2026-11-11T15:00:00Z", "p1")];
    const run = trackMail(mails, stored);
    expect(run.ask).toEqual([{ mail: mails[0], candidates: ["ai", "se"] }]);
    expect(run.placed.map((p) => [p.mail.messageId, p.app])).toEqual([["p1", "ai"]]);
    expect(run.update.map((u) => u.id)).toEqual(["ai"]);
    // Already on a timeline: not looked at again.
    expect(trackMail(mails, stored, () => "", eventIndex([{ applicationId: "ai", sourceRef: "email:p1", threadId: "" }, { applicationId: "se", sourceRef: "email:i1", threadId: "" }]))).toEqual({ create: [], update: [], placed: [], ask: [] });
    // Your answer goes where the ladder's would have.
    const answered = trackMail([mails[0]!], stored, () => "", NO_EVENTS, new Map([["i1", "se"]]));
    expect(answered.update).toEqual([{ id: "se", company: "Acme", from: "applied", status: "interview", stage: "interview", statusAt: "2026-11-12T15:00:00Z" }]);
    expect(trackMail([mails[0]!], stored, () => "", NO_EVENTS, new Map([["i1", "new"]])).create).toHaveLength(1);
  });

  it("puts an email on the application it was logged from, if a run stopped before its timeline was written", () => {
    const stored = [app({ id: "ai", role: "AI Engineer", externalId: "email:c1" }), app({ id: "se", role: "Solutions Engineer" })];
    const run = trackMail([jobMail("confirmation", "2026-11-01T12:00:00Z", "c1")], stored);
    expect(run).toMatchObject({ create: [], ask: [], placed: [{ app: "ai" }] });
  });

  it("shows you what to choose between, newest first, and waits when a choice is not on the board yet", () => {
    const stored = [app({ id: "ai", role: "AI Engineer", status: "interview", stage: "screen" }), app({ id: "se", role: "Solutions Engineer" })];
    const ask = [
      { mail: jobMail("rejection", "2026-11-12T15:00:00Z", "r1"), candidates: ["ai", "se"] },
      { mail: jobMail("reply", "2026-11-13T15:00:00Z", "r2"), candidates: ["ai", "email:not-saved-yet"] },
    ];
    expect(mailsToPlace(ask, stored)).toEqual([
      { messageId: "r1", company: "Acme", kind: "Rejection", subject: "Update on your application at Acme", receivedAt: "2026-11-12T15:00:00Z", choices: [{ id: "ai", role: "AI Engineer", stage: "Screen" }, { id: "se", role: "Solutions Engineer", stage: "Applied" }] },
    ]);
  });
});

describe("The tracker writes the timeline as it logs applications", () => {
  function live(): Context {
    const state = seedState(NOW);
    state.inbox.length = 0;
    state.applications = [];
    state.applicationEvents = [];
    return { mode: "live", userId: "owner", store: createMemoryStore(state), settings: state.settings, now: NOW, today: "2026-11-17", time: "09:00" };
  }
  const inboxMail = (messageId: string, subject: string, receivedAt: string, over: Partial<InboxItem> = {}): InboxItem => ({
    id: messageId,
    messageId,
    threadId: `t-${messageId}`,
    fromName: "Acme Recruiting",
    fromEmail: "no-reply@acme.greenhouse.io",
    subject,
    snippet: "",
    receivedAt,
    category: "noise",
    reason: "Notification sender",
    done: false,
    createdAt: receivedAt,
    // Read, and the text decided nothing, unless a test says otherwise: only read mail is tracked.
    textVerdict: "none",
    textQuote: "",
    ...over,
  });

  it("logs the application and its events, moves it on the invite, and adds nothing on a second run", async () => {
    const ctx = live();
    const store = ctx.store;
    const items = [
      inboxMail("c1", "Thank you for applying to Acme", "2026-11-10T15:00:00Z"),
      inboxMail("i1", "Interview availability for AI Engineer at Acme", "2026-11-14T15:00:00Z", { textVerdict: "interview", textQuote: "We would like to schedule a call with you." }),
    ];
    const first = await trackApplications(ctx, items, store);
    expect(first).toMatchObject({ created: 1, jobEmails: 2 });

    const [logged] = await store.applications.list();
    expect(logged).toMatchObject({ company: "Acme", status: "interview", stage: "interview", lastHeardAt: "2026-11-14T15:00:00Z" });
    const timeline = await store.applicationEvents.forApplication(logged!.id);
    expect(timeline.map((e) => [e.kind, e.sourceRef, e.threadId, e.summary])).toEqual([
      ["confirmation", "email:c1", "t-c1", "Thank you for applying to Acme"],
      ["interview", "email:i1", "t-i1", "We would like to schedule a call with you."],
    ]);
    // The log and the row agree.
    expect(project(timeline)).toMatchObject({ stage: "interview", lastHeardAt: "2026-11-14T15:00:00Z" });

    const again = await trackApplications(ctx, items, store);
    expect(again).toMatchObject({ created: 0, updated: 0 });
    expect(await store.applicationEvents.forApplication(logged!.id)).toHaveLength(2);
  });

  it("puts an email that moves nothing on the timeline too, and a confirmation alone is not hearing back", async () => {
    const ctx = live();
    const store = ctx.store;
    await trackApplications(ctx, [inboxMail("c1", "Thank you for applying to Acme", "2026-11-10T15:00:00Z")], store);
    const [logged] = await store.applications.list();
    expect(logged).toMatchObject({ status: "applied", stage: "applied" });
    expect(logged!.lastHeardAt ?? null).toBeNull();

    // A second confirmation (a survey from the hiring system): same stage, one more event.
    await trackApplications(ctx, [inboxMail("c2", "Demographic Survey from Acme", "2026-11-10T15:05:00Z")], store);
    expect((await store.applications.list())[0]!.status).toBe("applied");
    expect((await store.applicationEvents.forApplication(logged!.id)).map((e) => e.sourceRef)).toEqual(["email:c1", "email:c2"]);
  });
});

describe("Placing an email yourself", () => {
  it("asks once, writes nothing until you answer, then follows the thread by itself", async () => {
    const state = seedState(NOW);
    state.inbox.length = 0;
    state.applications = [];
    state.applicationEvents = [];
    const store = createMemoryStore(state);
    const ctx: Context = { mode: "live", userId: "owner", store, settings: state.settings, now: NOW, today: "2026-11-17", time: "09:00" };
    // Every email here has been read: only read mail is tracked, and only the text makes an invite.
    const inbox = (messageId: string, subject: string, receivedAt: string, threadId: string, textVerdict: InboxItem["textVerdict"] = "none"): InboxItem => ({ id: messageId, messageId, threadId, fromName: "Acme Recruiting", fromEmail: "no-reply@acme.greenhouse.io", subject, snippet: "", receivedAt, category: "noise", reason: "Notification sender", done: false, createdAt: receivedAt, textVerdict, textQuote: "" });
    const confirmations = [inbox("c1", "Thank you for applying for the AI Engineer role at Acme", "2026-11-02T15:00:00Z", "t1"), inbox("c2", "Thank you for applying for the Solutions Engineer role at Acme", "2026-11-03T15:00:00Z", "t2")];
    expect(await trackApplications(ctx, confirmations, store)).toMatchObject({ created: 2, toPlace: 0 });
    const [ai, se] = (await store.applications.list()).sort((a, b) => a.role.localeCompare(b.role));

    // An invite that names no role: two open applications at Acme, so it waits.
    const invite = inbox("i1", "Interview availability at Acme", "2026-11-12T15:00:00Z", "t3", "interview");
    const waiting = await trackApplications(ctx, [...confirmations, invite], store);
    expect(waiting).toMatchObject({ created: 0, updated: 0, toPlace: 1 });
    expect((await store.applicationEvents.index()).some((e) => e.sourceRef === "email:i1")).toBe(false);

    // You say it is the Solutions Engineer one.
    const apps = await store.applications.list();
    const mine = trackMail([{ messageId: "i1", fromName: invite.fromName, fromEmail: invite.fromEmail, subject: invite.subject, receivedAt: invite.receivedAt, kind: "interview", threadId: "t3" }], apps, () => "", eventIndex(await store.applicationEvents.index()), new Map([["i1", se!.id]]));
    await saveTracked(store, mine, apps);
    expect((await store.applications.get(se!.id))!).toMatchObject({ status: "interview", lastHeardAt: "2026-11-12T15:00:00Z" });
    expect((await store.applications.get(ai!.id))!.status).toBe("applied");

    // The next email in that thread needs no question.
    const next = await trackApplications(ctx, [...confirmations, invite, inbox("i2", "Re: Interview availability at Acme", "2026-11-13T15:00:00Z", "t3")], store);
    expect(next.toPlace).toBe(0);
    expect((await store.applicationEvents.forApplication(se!.id)).map((e) => e.sourceRef)).toEqual(["email:c2", "email:i1", "email:i2"]);
  });

  it("the action goes through getContext, checks the choice against what the tracker offers, and is audited", () => {
    const src = read("app/actions/career.ts").split("export async function placeJobMail")[1]!.split("\nexport async function ")[0]!;
    expect(src).toContain("await getContext()");
    expect(src).toContain('z.union([z.literal("new"), id])');
    expect(src).toContain("!asked.candidates.includes(p.data.choice)");
    expect(src).toContain('action: "application.email-placed"');
  });
});

describe("The events table", () => {
  const sql = read("supabase/migrations/20261120120000_application_events.sql");

  it("is the owner's alone, and a session can read and add but never change or delete", () => {
    expect(sql).toContain("alter table public.application_events enable row level security");
    expect(sql.match(/create policy \w+ on public\.application_events for (\w+)/g)).toEqual(["create policy owner_read on public.application_events for select", "create policy owner_insert on public.application_events for insert"]);
    expect(sql.match(/is_owner_aal2\(\)/g)).toHaveLength(2);
    expect(sql).toContain("revoke all on public.application_events from authenticated, anon;");
    expect(sql).toContain("grant select, insert on public.application_events to authenticated;");
    expect(sql).not.toMatch(/grant[^;]*(update|delete)[^;]*application_events/i);
  });

  it("allows the same stages and kinds as the code, and one event per source and kind", () => {
    const list = (values: readonly string[]) => `(${values.map((v) => `'${v}'`).join(", ")})`;
    expect(sql.split(`stage in ${list(APPLICATION_STAGES)}`)).toHaveLength(3);
    expect(sql).toContain(`kind in ${list(EVENT_KINDS)}`);
    expect(sql).toContain("unique (owner_id, source_ref, kind)");
    // The store's "skip a repeat" names that key.
    expect(read("lib/data/supabase.ts")).toContain('onConflict: "owner_id,source_ref,kind", ignoreDuplicates: true');
  });

  it("holds no email text: a summary is short, and the tracker only ever gives it a subject or the reader's one sentence", () => {
    expect(sql).toContain("summary text not null default '' check (char_length(summary) <= 300)");
    expect(read("lib/domain/applications.ts")).toContain("const said = (m.quote || m.subject)");
  });
});

describe("An application's page", () => {
  const event = (kind: ApplicationEvent["kind"], occurredAt: string, over: Partial<ApplicationEvent> = {}): ApplicationEvent => ({
    id: `${kind}-${occurredAt}`,
    applicationId: "a1",
    kind,
    occurredAt,
    source: "email",
    sourceRef: `email:${kind}-${occurredAt}`,
    threadId: "",
    decidedBy: "rules",
    stage: null,
    summary: "",
    createdAt: occurredAt,
    ...over,
  });

  it("shows four steps with the one you are at, and names the third for what it is", () => {
    expect(stepsFor("applied")).toEqual({ steps: [{ label: "Applied", state: "current" }, { label: "In review", state: "todo" }, { label: "Interview", state: "todo" }, { label: "Offer", state: "todo" }], closed: null });
    expect(stepsFor("assessment").steps.map((s) => [s.label, s.state])).toEqual([["Applied", "done"], ["In review", "done"], ["Assessment", "current"], ["Offer", "todo"]]);
    expect(stepsFor("offer").steps.at(-1)).toEqual({ label: "Offer", state: "current" });
    // Not submitted yet: nothing is done or current.
    expect(stepsFor("saved").steps.every((s) => s.state === "todo")).toBe(true);
  });

  it("shows how far a closed application got, with nothing current", () => {
    const events = [event("applied", "2026-11-01T12:00:00Z", { source: "you" }), event("screen", "2026-11-05T12:00:00Z"), event("rejection", "2026-11-09T12:00:00Z")];
    expect(furthest(events)).toBe("screen");
    expect(stepsFor("rejected", furthest(events))).toEqual({ steps: [{ label: "Applied", state: "done" }, { label: "In review", state: "done" }, { label: "Screen", state: "done" }, { label: "Offer", state: "todo" }], closed: "Rejected" });
    expect(stepsFor("withdrawn", furthest([])).closed).toBe("Withdrawn");
    expect(furthest([])).toBe("applied");
  });

  it("lists the timeline newest first: an email by its kind and what it said, your own move in your words", () => {
    const rows = timelineRows([
      event("applied", "2026-11-01T12:00:00Z", { source: "apply-agent", summary: "Applied by Atlas" }),
      event("confirmation", "2026-11-01T12:05:00Z", { summary: "Thank you for applying to Acme" }),
      event("stage_set", "2026-11-12T12:00:00Z", { source: "you", decidedBy: "you", stage: "interview", summary: "You moved it to Interview" }),
      event("rejection", "2026-11-14T12:00:00Z", { summary: "Rejection" }),
    ]);
    expect(rows.map((r) => [r.title, r.said, r.via])).toEqual([
      ["Rejection", "", "Email"],
      ["You moved it to Interview", "", "You"],
      ["Application received", "Thank you for applying to Acme", "Email"],
      ["Applied by Atlas", "", "Atlas"],
    ]);
  });

  it("goes through getContext, reads one application and its events, and takes only a plain id", () => {
    const page = read("app/(app)/(career)/applications/[id]/page.tsx");
    expect(page).toContain("await getContext()");
    expect(page).toContain("if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) notFound();");
    expect(page).toContain("store.applicationEvents.forApplication(app.id)");
    expect(page).not.toMatch(/supabase|createClient|"use client"/);
  });
});
