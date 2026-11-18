"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { jobFit, type FitResult } from "@/lib/knowledge/jobFit";
import { careerPrefs, trackApplications } from "@/lib/agents/career";
import { findJobMail } from "@/lib/connections/google";
import { approvalFor, targetRoleFor } from "@/lib/domain/applications";
import { applyThumb } from "@/lib/applyQueue";
import { savedJobKey } from "@/lib/domain/applyPlan";
import { jobType, parsePay, roleFor } from "@/lib/domain/careerAgent";
import { scrub, scrubPhones } from "@/lib/domain/knowledge";
import { extractSkills } from "@/lib/domain/skills";
import { ANSWER_BANK } from "@/lib/domain/careerPrep";
import { draftAnswers, parseResumeText } from "@/lib/domain/answerDrafts";
import { DEMO_RESUME_TEXT } from "@/lib/data/demoResume";
import { readResumeTexts, NotionError } from "@/lib/integrations/notion";
import { draftBring } from "@/lib/knowledge/answerDraft";
import { SKILLS } from "@/lib/domain/skills";
import { APPLICATION_STATUSES, JOB_TYPES } from "@/lib/domain/types";
import { assertSessionIsOwner, ownerServiceStore } from "@/lib/owner";
import { rateLimit } from "@/lib/security/rateLimit";
import { runResumeSync } from "@/lib/agents/resumeSync";
import { firstIssue, formObject, id, type ActionResult } from "./_shared";

// The Applications Agent's owner actions. Nothing here applies to a job: Atlas is on
// Semi-Automation, so you open the posting and submit yourself, then mark it submitted.

function refresh() {
  revalidatePath("/");
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
  const p = z.object({ matchId: id, rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }).safeParse({ matchId, rating });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store, settings, now } = await getContext();
  const match = await store.jobMatches.get(p.data.matchId);
  if (!match) return { ok: false, error: "That match is gone." };
  const step = await applyThumb(store, settings, match, p.data.rating, now);
  refresh();
  revalidatePath("/inbox");
  return { ok: true, data: { queued: step.status === "pursuing" }, ...(step.note ? { message: step.note } : {}) };
}

/**
 * Clears an Approval Queue item. "submitted": you applied on their site; it goes on the
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
    if (sent && app) await store.applications.update(app.id, { notes: `${app.notes ? `${app.notes}\n` : ""}Followed up ${today}.`.slice(0, 2000) });
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
    const fields = {
      status: submitted ? ("applied" as const) : ("saved" as const),
      appliedOn: submitted ? today : null,
      statusAt: now.toISOString(),
    };
    if (existing) await store.applications.update(existing.id, fields);
    else
      await store.applications.create({
        company: (match?.company ?? item.title).slice(0, 160),
        role: (match?.title ?? item.title).slice(0, 200),
        type: match?.type ?? (item.kind === "gig-proposal" ? "gig" : "full-time"),
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
    await store.approvals.update(item.id, { status: "approved", decidedAt: now.toISOString() });
    if (match) await store.jobMatches.update(match.id, { status: submitted ? "applied" : "pursuing" });
  }
  await audit(store, { actor: "owner", action: `approval.${p.data.decision}`, target: item.kind, detail: item.title.slice(0, 200), outcome: "success" });
  refresh();
  return { ok: true, message: p.data.decision === "submitted" ? "On the board as Applied" : p.data.decision === "approve" ? "On the board as To submit" : "Dropped" };
}

const NewApplication = z.object({
  company: z.string().trim().min(1).max(160),
  role: z.string().trim().min(1).max(200),
  type: z.enum(JOB_TYPES),
  url: z.union([z.literal(""), z.url({ protocol: /^https?$/ }).max(600)]),
  payText: z.string().trim().max(40).default(""),
  status: z.enum(APPLICATION_STATUSES),
});

/** Adds an application you made outside Atlas. */
export async function addApplication(_: unknown, fd: FormData): Promise<ActionResult> {
  const p = NewApplication.safeParse(formObject(fd));
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, today, now } = await getContext();
  await store.applications.create({
    ...p.data,
    targetRole: "",
    source: "Added by you",
    tier: "semi",
    appliedOn: p.data.status === "saved" ? null : today,
    statusAt: now.toISOString(),
    notes: "",
    origin: "atlas",
    externalId: "",
  });
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
  await store.applications.update(app.id, { status: p.data.status, statusAt: now.toISOString(), ...(p.data.status === "applied" && !app.appliedOn ? { appliedOn: today } : {}) });
  await audit(store, { actor: "owner", action: "application.status", target: app.company.slice(0, 120), detail: `${app.status} -> ${p.data.status}`, outcome: "success" });
  refresh();
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
 */
export async function findPastApplications(): Promise<ActionResult> {
  if (!rateLimit("find-past-applications", 3, 10 * 60_000).allowed) return { ok: false, error: "Try again in a few minutes." };
  const ctx = await getContext();
  let items;
  let persist;
  if (ctx.mode === "live") {
    assertSessionIsOwner(ctx);
    persist = ownerServiceStore();
    const found = await findJobMail(persist, 90);
    if (found.status === "not_connected") return { ok: false, error: "Connect Gmail (app password) in Connectors first." };
    if (found.status === "error") return { ok: false, error: found.message };
    items = found.items;
  } else {
    persist = ctx.store;
    items = await ctx.store.inbox.list();
  }
  const { created, updated, jobEmails } = await trackApplications(ctx, items, persist);
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
  revalidatePath("/applications");
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

/** Mark a Mentor insight handled, or tell the Mentor to drop it. Dismissed insights stay away for two weeks. */
export async function setInsightStatus(insightId: string, status: string): Promise<ActionResult> {
  const p = z.object({ insightId: id, status: z.enum(["new", "done", "dismissed"]) }).safeParse({ insightId, status });
  if (!p.success) return { ok: false, error: "Bad input" };
  const { store } = await getContext();
  await store.mentor.setStatus(p.data.insightId, p.data.status);
  revalidatePath("/growth");
  revalidatePath("/");
  return { ok: true };
}

/** Your LinkedIn headline and About, pasted for the Mentor to review. Addresses, links and phone numbers are stripped before it is stored. */
export async function saveProfileText(text: string): Promise<ActionResult> {
  const p = z.string().max(12_000).safeParse(text);
  if (!p.success) return { ok: false, error: "Keep it under 12,000 characters" };
  const { store } = await getContext();
  const clean = scrubPhones(scrub(p.data)).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000);
  await store.settings.update({ linkedinProfile: clean });
  await audit(store, { actor: "owner", action: "career.linkedin.save", target: "settings", detail: `${clean.length} characters`, outcome: "success" });
  revalidatePath("/growth");
  return { ok: true, message: clean ? "Saved. The Mentor reads it at its next run." : "Cleared." };
}

const SavedJob = z.object({
  url: z.url().max(600).refine((u) => u.startsWith("https://"), "Use an https link"),
  title: z.string().trim().min(3).max(200),
  company: z.string().trim().min(1).max(160),
  type: z.enum(JOB_TYPES),
  description: z.string().max(8000).optional().default(""),
});

/**
 * "Save this job": for postings on sites with no public feed (LinkedIn, Indeed, Glassdoor,
 * Upwork). You paste the link and the description; Atlas reads the skills and pay from the
 * text, puts the job in the Approval Queue as an apply kit, and never opens the link itself.
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
      type: j.type === "gig" ? "gig" : jobType({ title: j.title, text: j.description, typeHint: j.type }),
      title: j.title,
      company: j.company,
      url: j.url,
      source: "Saved by you",
      location: "",
      role,
      payText: (parsePay(text)?.text ?? "salary not listed").slice(0, 40),
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
  await ctx.store.approvals.create({ kind: match.type === "gig" ? "gig-proposal" : "application", title, detail, url: match.url, matchId: match.id, status: "pending", decidedAt: null });
  await audit(ctx.store, { actor: "owner", action: "career.save-job", target: j.company.slice(0, 120), detail: j.title.slice(0, 200), outcome: "success" });
  refresh();
  revalidatePath("/career");
  return { ok: true, message: "Saved. Its apply kit is in the Approval Queue." };
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
  const drafts = draftAnswers(parseResumeText(text), ctx.settings.displayName);
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
    const res = await draftBring(ctx, match);
    return res.ok ? { ok: true, data: { text: res.text } } : { ok: false, error: res.why };
  } catch {
    return { ok: false, error: "The draft did not finish. Try again." };
  }
}
