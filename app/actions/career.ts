"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { jobFit, type FitResult } from "@/lib/knowledge/jobFit";
import { careerPrefs, jobMailsFrom, saveTracked, trackApplications } from "@/lib/agents/career";
import { readNote, runPostingReader } from "@/lib/agents/postingReader";
import { runBriefResearch } from "@/lib/agents/briefResearch";
import { runCompanyResearch } from "@/lib/agents/companyResearch";
import { deskMessage } from "@/lib/domain/moreMatches";
import { runCareerDeskSearch } from "@/lib/agents/careerDesk";
import { skillsFromKit } from "@/lib/domain/postingFacts";
import { firecrawlConfigured } from "@/lib/integrations/firecrawl";
import { findJobMail } from "@/lib/connections/google";
import { approvalFor, companyFromMail, eventIndex, targetRoleFor, trackMail } from "@/lib/domain/applications";
import { ownEvent, stageEvent, stageForStatus, stageOfStatus, STAGE_LABEL } from "@/lib/domain/pipeline";
import { applyThumb, notAGoodFit } from "@/lib/applyQueue";
import { savedJobKey } from "@/lib/domain/applyPlan";
import { parsePay, payLabel, roleFor } from "@/lib/domain/careerAgent";
import { scrub, scrubPhones } from "@/lib/domain/knowledge";
import { extractSkills } from "@/lib/domain/skills";
import { ANSWER_BANK } from "@/lib/domain/careerPrep";
import { draftAnswers, parseResumeText } from "@/lib/domain/answerDrafts";
import { demoReadPage } from "@/lib/data/demoPosting";
import { DEMO_RESUME_TEXT } from "@/lib/data/demoResume";
import { readResumeTexts, NotionError } from "@/lib/integrations/notion";
import { draftBring } from "@/lib/knowledge/answerDraft";
import { SKILLS } from "@/lib/domain/skills";
import { APPLICATION_STATUSES } from "@/lib/domain/types";
import { assertSessionIsOwner, ownerServiceStore, ownerWriteStore } from "@/lib/owner";
import { recordHeardBack } from "@/lib/agents/heardBack";
import { rateLimit } from "@/lib/security/rateLimit";
import { runResumeSync } from "@/lib/agents/resumeSync";
import { firstIssue, formObject, id, type ActionResult } from "./_shared";
import { contactForCompany } from "@/lib/domain/career";
import { applyFacts } from "@/lib/domain/outcomes";
import { resumeTexts } from "@/lib/domain/resumeScore";
import type { Store } from "@/lib/data/store";
import type { JobMatch } from "@/lib/domain/types";

// The Applications Agent's owner actions. Nothing here applies to a job: Atlas is on
// Semi-Automation, so you open the posting and submit yourself, then mark it submitted.

function refresh() {
  revalidatePath("/");
  revalidatePath("/career");
  revalidatePath("/inbox");
  revalidatePath("/applications");
  revalidatePath("/mission");
}

/**
 * A thumb on a match. Up (1): you want it, so its apply kit goes to your apply queue (once:
 * the database allows one waiting kit per job). Clear (0) or down (-1): a kit still waiting
 * is taken back. Thumbs also steer how later matches are ranked. See `thumbStep`.
 */
export async function rateMatch(matchId: string, rating: number): Promise<ActionResult<{ queued: boolean }>> {
  const p = z.object({ matchId: id, rating: z.union([z.literal(-1), z.literal(0), z.literal(1), z.literal(2)]) }).safeParse({ matchId, rating });
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  const { store, settings, now } = ctx;
  const match = await store.jobMatches.get(p.data.matchId);
  if (!match) return { ok: false, error: "That match is gone." };
  const step = await applyThumb(store, settings, match, p.data.rating, now);
  // A job you just queued: read its posting into the kit once the reply is on its way,
  // so the thumb stays instant. The 2-hour sync reads any kit this misses.
  if (step.queue) {
    after(async () => {
      const kit = (await store.approvals.list()).find((a) => a.matchId === match.id && a.status === "pending");
      if (!kit) return;
      if (firecrawlConfigured()) await runPostingReader(ctx, { trigger: "owner", persist: store, only: kit.id, limit: 1 });
      // Then its apply brief's research: news, the company's own pages, the angle. Written with the
      // owner-scoped service store live (the briefs table is read-only to the session).
      const persist = ctx.mode === "live" ? (assertSessionIsOwner(ctx), ownerServiceStore()) : store;
      await runBriefResearch(ctx, { trigger: "owner", persist, only: kit.id, limit: 1 });
    });
  }
  refresh();
  revalidatePath("/inbox");
  return { ok: true, data: { queued: step.status === "pursuing" }, ...(step.note ? { message: step.note } : {}) };
}

/**
 * "Read postings now": reads the postings of the jobs waiting in your apply queues and
 * adds what each asks for to its kit. It takes no input. Read-only: nothing is sent or
 * submitted, and LinkedIn, Indeed and Glassdoor are never read.
 */
export async function readPostingsNow(): Promise<ActionResult<{ read: number }>> {
  if (!rateLimit("read-postings", 6, 10 * 60_000).allowed) return { ok: false, error: "Read a lot just now. Try again in a few minutes." };
  const ctx = await getContext();
  // The demo has no key and reaches no site: it reads a made-up posting, so the kit shows what a read adds.
  const sample = ctx.mode === "demo" && !firecrawlConfigured();
  const out = await runPostingReader(ctx, { trigger: "owner", persist: ctx.store, ...(sample ? { read: demoReadPage } : {}) });
  refresh();
  revalidatePath("/career");
  if ("missing" in out) return { ok: false, error: `The postings were not read: ${out.why}` };
  if (out.read === 0 && out.unreadable === 0 && out.skipped) return { ok: false, error: `No postings were read: ${out.skipped}` };
  return { ok: true, message: `${readNote(out)}.${sample ? " Demo mode: the facts come from a sample posting, not the real one." : ""}`.replace(/^./, (c) => c.toUpperCase()), data: { read: out.read } };
}

/**
 * "Research this company": runs the Researcher on one queued job
 * (lib/agents/companyResearch.ts): news, a few searches and pages of its choosing, and a brief in
 * which every line cites what it read. A job saved by hand (no posting behind it) gets the
 * one-search version instead.
 */
export async function researchCompany(approvalId: string): Promise<ActionResult> {
  const p = id.safeParse(approvalId);
  if (!p.success) return { ok: false, error: "Bad input" };
  if (!rateLimit("brief-research", 6, 10 * 60_000).allowed) return { ok: false, error: "Researched a lot just now. Try again in a few minutes." };
  const ctx = await getContext();
  const persist = ctx.mode === "live" ? (assertSessionIsOwner(ctx), ownerServiceStore()) : ctx.store;
  const kit = await ctx.store.approvals.get(p.data);
  const match = kit?.kind === "application" && kit.status === "pending" && kit.matchId ? await ctx.store.jobMatches.get(kit.matchId).catch(() => null) : null;
  if (kit && match) {
    // The page's function stops at 60 seconds; the agent saves what it has by then.
    const res = await runCompanyResearch(ctx, { kit, match }, { persist, trigger: "owner", deadline: Date.now() + 50_000 });
    refresh();
    revalidatePath("/career");
    return { ok: true, message: res.writer === "model" ? "Researched by the agent: every line cites what it read. The brief below is up to date." : `Researched by rules (${res.why || "AI was not available"}). The brief below is up to date.` };
  }
  const out = await runBriefResearch(ctx, { trigger: "owner", persist, only: p.data, limit: 1 });
  if ("missing" in out) return { ok: false, error: `The research did not finish: ${out.why}` };
  if (out.researched === 0) return { ok: false, error: out.skipped ?? "That job is no longer waiting in the Apply Queue." };
  refresh();
  revalidatePath("/career");
  return { ok: true, message: "Researched. The brief below is up to date." };
}

/**
 * "Not a Good Fit": the job leaves your apply queue and the Tracker for good, and counts as a
 * 👎 so Atlas shows fewer like it (`notAGoodFit`).
 */
export async function markNotAGoodFit(approvalId: string): Promise<ActionResult> {
  const p = id.safeParse(approvalId);
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store, now } = await getContext();
  const res = await notAGoodFit(store, p.data, now);
  if (!res.ok) return { ok: false, error: res.why };
  refresh();
  revalidatePath("/status");
  return { ok: true, message: "Not a good fit: out of your queue and Tracker. Atlas will show fewer like it." };
}

/**
 * Clears an apply queue item. "submitted": you applied on their site; it goes on the
 * Applications board as Applied. "approve": keep it as To submit on the board. "reject":
 * drop it.
 */
export async function decideApproval(approvalId: string, decision: "submitted" | "approve" | "reject"): Promise<ActionResult> {
  const p = z.object({ approvalId: id, decision: z.enum(["submitted", "approve", "reject"]) }).safeParse({ approvalId, decision });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store, today, now } = await getContext();
  const item = await store.approvals.get(p.data.approvalId);
  if (!item || item.status !== "pending") return { ok: false, error: "Already decided." };
  const match = item.matchId ? await store.jobMatches.get(item.matchId) : null;

  // A follow-up: "submitted"/"approve" mean you sent it; "reject" skips it. Either way the
  // application stays where it is; a sent follow-up is noted on it.
  if (item.kind === "follow-up") {
    const sent = p.data.decision !== "reject";
    await store.approvals.update(item.id, { status: sent ? "approved" : "rejected", decidedAt: now.toISOString() });
    const app = item.applicationId ? await store.applications.get(item.applicationId) : null;
    if (sent && app) {
      await store.applications.update(app.id, { notes: `${app.notes ? `${app.notes}\n` : ""}Followed up ${today}.`.slice(0, 2000) });
      await store.applicationEvents.append([ownEvent(app.id, "follow_up", now.toISOString(), `approval:${item.id}`)]);
    }
    await audit(store, { actor: "owner", action: sent ? "approval.follow-up-sent" : "approval.follow-up-skipped", target: "follow-up", detail: item.title.slice(0, 200), outcome: "success" });
    refresh();
    return { ok: true, message: sent ? "Noted on the application" : "Skipped" };
  }

  if (p.data.decision === "reject") {
    await store.approvals.update(item.id, { status: "rejected", decidedAt: now.toISOString() });
    if (match) await store.jobMatches.update(match.id, { status: "dismissed" });
  } else {
    const submitted = p.data.decision === "submitted";
    const externalId = match ? `match:${match.key}`.slice(0, 600) : `approval:${item.id}`;
    const existing = (await store.applications.list()).find((a) => a.externalId === externalId);
    // What it is sent with (Step 0): level, posting date, resume version, and whether you know someone there.
    const facts = match ? await factsFor(store, match) : null;
    const fields = {
      status: submitted ? ("applied" as const) : ("saved" as const),
      stage: submitted ? ("applied" as const) : ("saved" as const),
      appliedOn: submitted ? today : null,
      statusAt: now.toISOString(),
      ...(facts ? { level: facts.level, postedOn: facts.postedOn, resumeVersion: facts.resumeVersion, ...(facts.warm ? { warm: true } : {}) } : {}),
    };
    const saved = existing
      ? await store.applications.update(existing.id, fields)
      : await store.applications.create({
          company: (match?.company ?? item.title).slice(0, 160),
          role: (match?.title ?? item.title).slice(0, 200),
          targetRole: match?.role ?? "",
          source: match?.source ?? "",
          url: item.url,
          payText: match?.payText ?? "",
          tier: "semi",
          notes: "",
          origin: "atlas",
          externalId,
          ...fields,
        });
    // On its timeline once, however many times the kit is decided: the kit is the source.
    if (saved) await store.applicationEvents.append([stageEvent(existing ?? null, saved.id, fields.stage, fields.statusAt, `approval:${item.id}`, { summary: submitted ? "You applied" : STAGE_LABEL.saved })]);
    await store.approvals.update(item.id, { status: "approved", decidedAt: now.toISOString() });
    if (match) await store.jobMatches.update(match.id, { status: submitted ? "applied" : "pursuing" });
  }
  await audit(store, { actor: "owner", action: `approval.${p.data.decision}`, target: item.kind, detail: item.title.slice(0, 200), outcome: "success" });
  refresh();
  return { ok: true, message: p.data.decision === "submitted" ? "On the board as Applied" : p.data.decision === "approve" ? "On the board as To submit" : "Dropped" };
}

/** The facts an application records when you apply from the queue (lib/domain/outcomes.ts). */
async function factsFor(store: Store, match: JobMatch) {
  const [rows, contacts] = await Promise.all([store.knowledge.bySource("resume", 400).catch(() => []), store.contacts.list().catch(() => [])]);
  return applyFacts({ title: match.title, postedAt: match.postedAt, role: match.role, resumes: resumeTexts(rows), knowSomeone: Boolean(contactForCompany(match.company, contacts)) });
}

const Flags = z.object({ applicationId: id, tailored: z.boolean().nullable(), warm: z.boolean().nullable() });

/**
 * Tailored and Warm on one application: whether you changed the resume or wrote a note for
 * this job, and whether you knew someone there. The funnel compares reply rates by both.
 */
export async function setApplicationFlags(applicationId: string, flags: { tailored: boolean | null; warm: boolean | null }): Promise<ActionResult> {
  const p = Flags.safeParse({ applicationId, ...flags });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store } = await getContext();
  const app = await store.applications.get(p.data.applicationId);
  if (!app) return { ok: false, error: "That application is gone." };
  await store.applications.update(app.id, { tailored: p.data.tailored, warm: p.data.warm });
  revalidatePath(`/applications/${app.id}`);
  revalidatePath("/status");
  return { ok: true, message: "Saved" };
}

const NewApplication = z.object({
  company: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(200),
  url: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(600)]),
  payText: z.string().trim().max(40).default(""),
  status: z.enum(APPLICATION_STATUSES),
});

/** Adds an application you made outside Atlas. */
export async function addApplication(_: unknown, fd: FormData): Promise<ActionResult> {
  const p = NewApplication.safeParse(formObject(fd));
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, today, now } = await getContext();
  const stage = stageOfStatus(p.data.status);
  const made = await store.applications.create({
    ...p.data,
    stage,
    targetRole: "",
    source: "Added by you",
    tier: "semi",
    appliedOn: p.data.status === "saved" ? null : today,
    statusAt: now.toISOString(),
    notes: "",
    origin: "atlas",
    externalId: "",
  });
  await store.applicationEvents.append([stageEvent(null, made.id, stage, made.statusAt, `you:${made.id}`, { summary: `Added by you as ${STAGE_LABEL[stage]}` })]);
  refresh();
  return { ok: true, message: "Added" };
}

/** Moves an application to another column on the board. */
export async function setApplicationStatus(appId: string, status: string): Promise<ActionResult> {
  const p = z.object({ appId: id, status: z.enum(APPLICATION_STATUSES) }).safeParse({ appId, status });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store, today, now } = await getContext();
  const app = await store.applications.get(p.data.appId);
  if (!app) return { ok: false, error: "Not found" };
  const stage = stageForStatus(app, p.data.status);
  await store.applications.update(app.id, { status: p.data.status, stage, statusAt: now.toISOString(), ...(p.data.status === "applied" && !app.appliedOn ? { appliedOn: today } : {}) });
  // Your own move is an event too, and on the timeline it wins over what the emails said.
  if (p.data.status !== app.status) await store.applicationEvents.append([ownEvent(app.id, "stage_set", now.toISOString(), `you:${randomUUID()}`, { stage, summary: `You moved it to ${STAGE_LABEL[stage]}` })]);
  await audit(store, { actor: "owner", action: "application.status", target: app.company.slice(0, 120), detail: `${app.status} -> ${p.data.status}`, outcome: "success" });
  refresh();
  return { ok: true };
}

/**
 * Puts a job email the tracker could not place on the application you pick, or logs a new
 * application from it (docs/design-pipeline.md, 5.3). The choice must be one the tracker
 * offered for that email: it is worked out again here, not taken from the page.
 */
export async function placeJobMail(messageId: string, choice: string): Promise<ActionResult> {
  const p = z.object({ messageId: z.string().min(1).max(200), choice: z.union([z.literal("new"), id]) }).safeParse({ messageId, choice });
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  const { store, settings } = ctx;
  const roles = careerPrefs(settings).roles;
  const roleOf = (title: string) => roleFor(title, roles)?.name ?? "";
  const [inbox, apps, rows] = await Promise.all([store.inbox.list(), store.applications.list(), store.applicationEvents.index()]);
  const index = eventIndex(rows);
  const asked = trackMail(jobMailsFrom(inbox, settings), apps, roleOf, index).ask.find((a) => a.mail.messageId === p.data.messageId);
  if (!asked) return { ok: false, error: "That email is already on a timeline." };
  if (p.data.choice !== "new" && !asked.candidates.includes(p.data.choice)) return { ok: false, error: "Pick one of the applications shown." };
  // The same tracker, for this one email, with your answer in place of the ladder's.
  const changes = trackMail([asked.mail], apps, roleOf, index, new Map([[asked.mail.messageId, p.data.choice]]));
  const { board, added } = await saveTracked(store, changes, apps);
  // It is an answer, so Heard back lists it: already read, and no ping, since you placed it.
  // Only the server writes that table; if it cannot here, the timeline is still saved.
  const listed = await Promise.resolve()
    .then(() => recordHeardBack(ownerWriteStore(ctx), added, board, settings, ctx.now, true))
    .then(() => true)
    .catch(() => false);
  const where = p.data.choice === "new" ? "as a new application" : "on an existing application";
  await audit(store, { actor: "owner", action: "application.email-placed", target: (companyFromMail(asked.mail) || "application").slice(0, 120), detail: listed ? where : `${where}; Heard back could not be written`, outcome: "success" });
  refresh();
  return { ok: true, message: p.data.choice === "new" ? "Logged as a new application" : "Added to its timeline" };
}

/**
 * Marks answers in Heard back read: one application's, when you open its page, or all of
 * them. The only thing a session may change on a notification (docs/design-pipeline.md, 5.7).
 */
export async function markHeardBackSeen(applicationId?: string): Promise<ActionResult> {
  const p = z.object({ applicationId: id.optional() }).safeParse({ applicationId });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store, now } = await getContext();
  const marked = await store.notifications.markSeen(now.toISOString(), p.data.applicationId);
  if (marked) revalidatePath("/applications");
  return { ok: true };
}

/**
 * Sets the role on an application, for one the tracker logged from an email that did not
 * name it. The target role is worked out from the title unless you pick one.
 */
export async function setApplicationRole(appId: string, role: string, targetRole: string): Promise<ActionResult> {
  const p = z.object({ appId: id, role: z.string().trim().min(2).max(160), targetRole: z.string().trim().max(80) }).safeParse({ appId, role, targetRole });
  if (!p.success) return { ok: false, error: "Type the role, between 2 and 160 characters." };
  const { store, settings } = await getContext();
  const app = await store.applications.get(p.data.appId);
  if (!app) return { ok: false, error: "Not found" };
  const roles = careerPrefs(settings).roles;
  const title = p.data.role.replace(/\s+/g, " ");
  // A target role you pick must be one of yours; otherwise it is read from the title.
  const target = roles.find((r) => r.name === p.data.targetRole)?.name ?? targetRoleFor(title, (t) => roleFor(t, roles)?.name ?? "");
  await store.applications.update(app.id, { role: title, targetRole: target });
  await audit(store, { actor: "owner", action: "application.role", target: app.company.slice(0, 120), detail: target ? `set, counts as ${target}` : "set", outcome: "success" });
  refresh();
  return { ok: true, message: target ? `Saved. Counts as ${target}.` : "Saved." };
}

/**
 * One-time catch-up: searches Gmail for past application emails (read-only, headers
 * only, last 90 days, archived ones too) and logs them on the board. Safe to repeat:
 * nothing is logged twice. Day to day, the Applications Agent does this before every brief.
 * Its emails outside the inbox are never read, so their subjects place them, and a subject
 * cannot make an interview invite: it is logged as a reply (docs/design-pipeline.md, 13).
 */
export async function findPastApplications(): Promise<ActionResult> {
  if (!rateLimit("find-past-applications", 3, 10 * 60_000).allowed) return { ok: false, error: "Try again in a few minutes." };
  const ctx = await getContext();
  let items;
  let persist;
  // Emails this search found that are not in the inbox: no run will ever read their text.
  let neverRead: ReadonlySet<string> = new Set();
  if (ctx.mode === "live") {
    assertSessionIsOwner(ctx);
    persist = ownerServiceStore();
    const found = await findJobMail(persist, 90);
    if (found.status === "not_connected") return { ok: false, error: "Connect Gmail (app password) in Connectors first." };
    if (found.status === "error") return { ok: false, error: found.message };
    // One still in the inbox is tracked as every run tracks it: once its text is read, and
    // with that reading. The rest are placed by their subject, never as an interview invite.
    const stored = new Map((await ctx.store.inbox.list()).map((i) => [i.messageId, i]));
    items = found.items.map((i) => stored.get(i.messageId) ?? i);
    neverRead = new Set(found.items.filter((i) => !stored.has(i.messageId)).map((i) => i.messageId));
  } else {
    persist = ctx.store;
    items = await ctx.store.inbox.list();
  }
  const { created, updated, jobEmails } = await trackApplications(ctx, items, persist, neverRead);
  await audit(ctx.store, { actor: "owner", action: "application.find-in-gmail", target: "gmail", detail: `${jobEmails} job emails, ${created} logged, ${updated} moved`, outcome: "success" });
  refresh();
  return {
    ok: true,
    message: created || updated ? `Found ${jobEmails} job emails: ${created} application${created === 1 ? "" : "s"} logged, ${updated} moved` : `Checked ${jobEmails} job email${jobEmails === 1 ? "" : "s"}: your board is up to date`,
  };
}

/** Saves (or clears) the link to your resume for one target role, e.g. a Google Drive file. */
export async function setResumeLink(role: string, url: string): Promise<ActionResult> {
  const { store, settings } = await getContext();
  const roles = careerPrefs(settings).roles.map((r) => r.name);
  const p = z
    .object({ role: z.enum(roles as [string, ...string[]]), url: z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(600)]) })
    .safeParse({ role, url: url.trim() });
  if (!p.success) return { ok: false, error: "Use an https link, e.g. from Google Drive (Share > Copy link)." };
  const next = { ...(settings.careerResumes ?? {}) };
  if (p.data.url) next[p.data.role] = p.data.url;
  else delete next[p.data.role];
  await store.settings.update({ careerResumes: next });
  await audit(store, { actor: "owner", action: "career.resume-link", target: p.data.role, detail: p.data.url ? "set" : "cleared", outcome: "success" });
  revalidatePath("/roles");
  return { ok: true, message: p.data.url ? "Saved" : "Cleared" };
}

/** Saves your answer bank. Unknown questions are ignored; each answer is kept short. */
export async function saveAnswers(answers: Record<string, string>): Promise<ActionResult> {
  const ids = ANSWER_BANK.map((q) => q.id);
  const p = z.record(z.string(), z.string().max(3000)).safeParse(answers);
  if (!p.success) return { ok: false, error: "Each answer can be up to 3,000 characters." };
  const clean = Object.fromEntries(Object.entries(p.data).filter(([k, v]) => ids.includes(k) && v.trim()).map(([k, v]) => [k, v.trim()]));
  const { store } = await getContext();
  await store.settings.update({ careerAnswers: clean });
  await audit(store, { actor: "owner", action: "career.answers", target: "answer-bank", detail: `${Object.keys(clean).length} answers`, outcome: "success" });
  // The answer bank is on Setup; the apply kits that use it are on Apply and in the inbox.
  revalidatePath("/career/setup");
  revalidatePath("/inbox");
  return { ok: true, message: "Saved" };
}

/** Saves which skills you already have, so Atlas can tell your skill gaps apart. */
export async function setSkills(have: string[]): Promise<ActionResult> {
  const known = new Set(SKILLS.map((x) => x.name));
  const p = z.array(z.string().max(60)).max(80).safeParse(have);
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store } = await getContext();
  const clean = [...new Set(p.data.filter((x) => known.has(x)))];
  await store.settings.update({ careerSkills: clean });
  await audit(store, { actor: "owner", action: "career.skills", target: "skills", detail: `${clean.length} skills`, outcome: "success" });
  revalidatePath("/growth");
  return { ok: true, message: "Saved" };
}

/** How a job match fits your resume, and which resume to send. A read: it changes nothing. */
export async function matchFit(matchId: string): Promise<ActionResult<FitResult>> {
  const p = id.safeParse(matchId);
  if (!p.success) return { ok: false, error: "Bad input" };
  const ctx = await getContext();
  if (!rateLimit("job-fit", 20, 60_000).allowed) return { ok: false, error: "That is a lot of checks. Try again in a minute." };
  const match = await ctx.store.jobMatches.get(p.data);
  if (!match) return { ok: false, error: "That match is gone." };
  try {
    return { ok: true, data: await jobFit(ctx, match) };
  } catch {
    return { ok: false, error: "The check did not finish. Try again." };
  }
}

/** Mark a Career Mentor insight handled, or tell the Career Mentor to drop it. Dismissed insights stay away for two weeks. */
/**
 * Your answer to a Career Mentor insight: Action Taken ("done", with an optional line on what
 * you did), Not useful ("dismissed"), or open again ("new"). The note is your own words for the
 * Career Mentor's next reviews; addresses and phone numbers are stripped before it is stored.
 */
export async function setInsightStatus(insightId: string, status: string, note?: string): Promise<ActionResult> {
  const p = z.object({ insightId: id, status: z.enum(["new", "done", "dismissed"]), note: z.string().max(2000).optional() }).safeParse({ insightId, status, note });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store } = await getContext();
  const clean = p.data.note === undefined ? undefined : scrubPhones(scrub(p.data.note)).replace(/\s+/g, " ").trim().slice(0, 500);
  await store.mentor.setStatus(p.data.insightId, p.data.status, p.data.status === "done" ? clean : p.data.status === "new" ? "" : undefined);
  revalidatePath("/growth");
  revalidatePath("/");
  return { ok: true };
}

/** Your LinkedIn headline and About, pasted for the Career Mentor to review. Addresses, links and phone numbers are stripped before it is stored. */
export async function saveProfileText(text: string): Promise<ActionResult> {
  const p = z.string().max(12_000).safeParse(text);
  if (!p.success) return { ok: false, error: "Keep it under 12,000 characters" };
  const { store } = await getContext();
  const clean = scrubPhones(scrub(p.data)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000);
  await store.settings.update({ linkedinProfile: clean });
  await audit(store, { actor: "owner", action: "career.linkedin.save", target: "settings", detail: `${clean.length} characters`, outcome: "success" });
  revalidatePath("/growth");
  return { ok: true, message: clean ? "Saved. The Career Mentor reads it at its next run." : "Cleared." };
}

const SavedJob = z.object({
  url: z.url().max(600).refine((u) => u.startsWith("https://"), "Use an https link"),
  title: z.string().trim().min(3).max(200),
  company: z.string().trim().min(1).max(160),
  description: z.string().max(8000).optional().default(""),
});

/**
 * "Save this job": for postings on sites with no public feed (LinkedIn, Indeed,
 * Glassdoor). You paste the link and the description; Atlas reads the skills and pay from the
 * text, puts the job in the Apply Queue as an apply kit, and never opens the link itself.
 */
export async function saveJob(_: unknown, fd: FormData): Promise<ActionResult> {
  const p = SavedJob.safeParse(formObject(fd));
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const ctx = await getContext();
  if (!rateLimit("save-job", 30, 10 * 60_000).allowed) return { ok: false, error: "Saved a lot just now. Try again in a few minutes." };
  let persist = ctx.store;
  if (ctx.mode === "live") {
    assertSessionIsOwner(ctx);
    persist = ownerServiceStore();
  }
  const j = p.data;
  const text = `${j.title} ${j.description}`;
  const role = roleFor(j.title, careerPrefs(ctx.settings).roles)?.name ?? "Other role";
  const key = savedJobKey(j.url);
  if ((await persist.jobMatches.keys()).has(key)) return { ok: false, error: "You already saved that job." };
  const [match] = await persist.jobMatches.add([
    {
      key,
      title: j.title,
      company: j.company,
      url: j.url,
      source: "Saved by you",
      location: "",
      role,
      payText: payLabel(j.title, parsePay(text)),
      postedAt: null,
      score: 100,
      shownOn: ctx.today,
      shownSlot: "morning",
      rating: 1,
      status: "pursuing",
      skills: extractSkills(text).slice(0, 30),
    },
  ]);
  if (!match) return { ok: false, error: "That job could not be saved." };
  const { title, detail } = approvalFor(match, undefined, ctx.settings.careerResumes?.[match.role]);
  await ctx.store.approvals.create({ kind: "application", title, detail, url: match.url, matchId: match.id, status: "pending", decidedAt: null });
  await audit(ctx.store, { actor: "owner", action: "career.save-job", target: j.company.slice(0, 120), detail: j.title.slice(0, 200), outcome: "success" });
  refresh();
  revalidatePath("/career");
  return { ok: true, message: "Saved. It is in your Apply Queue." };
}

/**
 * "Find more good fits": sets the Career desk to work, now. The Scout records the postings
 * on the boards and feeds, the Analyst refreshes the market report when something new was
 * recorded, and the Applications Agent stores up to 5 more matches for your review on the
 * Career page. Same rules as a brief, never a
 * posting already shown, and no brief shows them again. It takes no input: what to look
 * for comes from your settings. Nothing is applied to or sent.
 */
export async function findMoreJobs(): Promise<ActionResult<{ found: number }>> {
  // The feeds are cached for about half an hour, so pressing again soon reads nothing new.
  if (!rateLimit("find-more-jobs", 6, 10 * 60_000).allowed) return { ok: false, error: "Searched a lot just now. Try again in a few minutes." };
  const ctx = await getContext();
  // Matches are written with the owner-scoped service store, after confirming the session is the owner.
  let persist = ctx.store;
  if (ctx.mode === "live") {
    assertSessionIsOwner(ctx);
    persist = ownerServiceStore();
  }
  const { more: out, said: did } = await runCareerDeskSearch(ctx, { persist });
  const failed = "missing" in out || out.allFailed;
  await audit(ctx.store, { actor: "owner", action: "career.find-more", target: "jobs", detail: "missing" in out ? out.why.slice(0, 120) : `${out.found.length} found; scout ${did.scout ?? "did not run"}, analyst ${did.analyst}`, outcome: failed ? "error" : "success" });
  refresh();
  revalidatePath("/career");
  if ("missing" in out) return { ok: false, error: `The search did not finish: ${out.why}` };
  const said = deskMessage(did);
  return said.ok ? { ok: true, message: said.text, data: { found: out.found.length } } : { ok: false, error: said.text };
}

/**
 * Runs the resume sync now: reads the Figma frames linked from the Resumes rows and, where
 * the text changed, rewrites the block Atlas owns on that row's Notion page. Writing uses
 * the Notion connection's own permission; a page you edited by hand is never overwritten.
 */
export async function syncResumesNow(): Promise<ActionResult> {
  if (!rateLimit("resume-sync", 4, 10 * 60_000).allowed) return { ok: false, error: "Ran a lot just now. Try again in a few minutes." };
  const ctx = await getContext();
  if (ctx.mode !== "live") return { ok: false, error: "The resume sync needs Figma and Notion connected. Demo mode has neither." };
  assertSessionIsOwner(ctx);
  const res = await runResumeSync(ctx, { trigger: "run-now", honorPause: false, persist: ownerServiceStore() });
  const failed = "missing" in res;
  await audit(ctx.store, { actor: "owner", action: "resume.sync", target: "notion", detail: failed ? res.missing : `${res.report.updated.length} updated, ${res.report.unchanged} unchanged`, outcome: failed && res.missing === "failed" ? "error" : "success" });
  revalidatePath("/roles");
  revalidatePath("/mission");
  revalidatePath("/ask");
  return failed ? { ok: false, error: res.why } : { ok: true, message: res.headline };
}

/**
 * Drafts for the answer bank from your Master Resume in Notion (rules, no model). The
 * drafts are returned to the form for you to edit; nothing is saved until you press Save.
 */
export async function draftAnswersFromResume(): Promise<ActionResult<{ drafts: Record<string, string>; from: string }>> {
  if (!rateLimit("answer-drafts", 6, 10 * 60_000).allowed) return { ok: false, error: "Drafted a lot just now. Try again in a few minutes." };
  const ctx = await getContext();
  let text = DEMO_RESUME_TEXT;
  let from = "the demo resume";
  if (ctx.mode === "live") {
    try {
      const resumes = await readResumeTexts(ctx.settings.notionResumesId);
      const pick = resumes.find((r) => /^(master|general|base)\b/i.test(r.role)) ?? resumes[0];
      if (!pick) return { ok: false, error: "No resume page in Notion has text yet. Put each resume's text in its page in the Resumes database." };
      text = pick.text;
      from = `your ${pick.role}`;
    } catch (err) {
      return { ok: false, error: err instanceof NotionError ? err.message : "Notion could not be read. Try again in a minute." };
    }
  }
  const drafts = draftAnswers(parseResumeText(text));
  if (Object.keys(drafts).length === 0) return { ok: false, error: "That resume has no Summary, Experience or Projects section to draft from." };
  await audit(ctx.store, { actor: "owner", action: "career.answers.draft", target: "answer-bank", detail: `${Object.keys(drafts).length} drafts`, outcome: "success" });
  return { ok: true, data: { drafts, from } };
}

/** "What I'd bring" to one queued job, drafted by the AI model from your resume passages. Shown to copy; never stored. */
export async function draftBringForApproval(approvalId: string): Promise<ActionResult<{ text: string }>> {
  const p = id.safeParse(approvalId);
  if (!p.success) return { ok: false, error: "Bad input" };
  if (!rateLimit("answer-draft", 6, 60_000).allowed) return { ok: false, error: "That is a lot of drafts. Try again in a minute." };
  const ctx = await getContext();
  const approval = await ctx.store.approvals.get(p.data);
  if (!approval?.matchId) return { ok: false, error: "This item has no job behind it to draft for." };
  const match = await ctx.store.jobMatches.get(approval.matchId);
  if (!match) return { ok: false, error: "The job behind this item is gone." };
  try {
    // The skills the full posting names, when Atlas has read it: the draft is searched and
    // written against what the job really asks for. Only skill names from Atlas's own list
    // come from the kit; none of the posting's text reaches the model.
    const skills = [...new Set([...(match.skills ?? []), ...skillsFromKit(approval.detail)])].slice(0, 30);
    const res = await draftBring(ctx, { ...match, skills });
    return res.ok ? { ok: true, data: { text: res.text } } : { ok: false, error: res.why };
  } catch {
    return { ok: false, error: "The draft did not finish. Try again." };
  }
}


