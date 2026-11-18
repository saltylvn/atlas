import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { SLOT_LABEL } from "@/lib/domain/briefSchedule";
import { fromAppliedCompany, openCompanies, ROLE_NOT_IN_EMAIL, rolesFromMail, rolesToLookUp, targetRoleFor, trackFromEmail, type JobMail } from "@/lib/domain/applications";
import type { Scorecard } from "@/lib/domain/careerPrep";
import { candidates, careerAgentReport, payLabel, pick, roleFor, tasteFrom, type CareerAgentResult, type CareerPrefs } from "@/lib/domain/careerAgent";
import { followUpEmail, followUpsDue, isScorecardDay, weeklyScorecard } from "@/lib/domain/careerPrep";
import { prefsFrom, tagInbox } from "@/lib/domain/emailAgent";
import { readVerdict, roleFromText } from "@/lib/domain/jobMailText";
import { readJobMailTexts } from "@/lib/connections/google";
import { MAX_TEXTS_PER_RUN } from "@/lib/integrations/gmailImap";
import { addDays } from "@/lib/domain/dates";
import { extractSkills, isFirstWeekdayOfMonth, portfolioProject, skillDemand, skillGaps, type PortfolioProject } from "@/lib/domain/skills";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { rolesFrom } from "@/lib/domain/targetRoles";
import type { AgentRunEvent, BriefSlot, Contact, InboxItem, JobMatch, Settings } from "@/lib/domain/types";
import { fetchJobFeeds, REMOTE_BOARDS } from "@/lib/integrations/jobFeeds";
import { isPaused, logRun, NO_MODEL } from "./log";
import { NO_TRACE, tracer, type Tracer } from "./trace";

// The Applications Agent at run time (part 5a: matching). It reads the public job feeds,
// keeps the postings that fit your roles, location and pay floors, ranks them by
// freshness and your thumbs, and stores up to 10 full-time and 10 gig matches the brief
// has never shown. Rules only, no model call, so every run costs $0. It never applies
// anywhere: you pick matches, approve them in the Approval Queue, and submit yourself.

export const PER_BRIEF = 10;

export function careerPrefs(s: Settings): CareerPrefs {
  return { roles: rolesFrom(s.careerRoles), minSalary: s.careerMinSalary ?? 0, minRate: s.careerMinRate ?? 0 };
}

/** The job emails the Email Agent tagged, ready for the tracker. */
export function jobMailsFrom(items: InboxItem[], settings: Settings): JobMail[] {
  return tagInbox(items, prefsFrom(settings)).flatMap((i) =>
    i.tag === "job" && i.jobKind ? [{ messageId: i.messageId, fromName: i.fromName, fromEmail: i.fromEmail, subject: i.subject, receivedAt: i.receivedAt, kind: i.jobKind, ...(i.textRole ? { role: i.textRole } : {}) }] : [],
  );
}

export interface JobMailReading {
  /** The inbox, with the verdicts just read. */
  items: InboxItem[];
  read: number;
  rejections: number;
  interviews: number;
  /** Why nothing was read, when job emails were waiting. */
  skipped?: string;
}

/** Time a run must have left before it opens Gmail to read job emails. */
const READ_NEEDS_MS = 25_000;

/**
 * Reads the text of job emails not read yet (newest first, at most a dozen a run) and
 * keeps only what each says: a rejection, an interview invite, or neither, with the one
 * sentence that decided it, and the role it names. Rules only: the text is not sent to an
 * AI model, stored or logged. Read: emails the Email Agent tagged as job mail, and every
 * email from a company on your Applications board (`fromAppliedCompany`) except its
 * newsletters and promotions; never a bill, a receipt or a subscription. `read` is the Gmail reader (swapped in tests). Returns the inbox with
 * the new verdicts, for tracking.
 */
export async function readJobMail(
  ctx: Pick<Context, "settings" | "mode" | "deadline" | "now">,
  items: InboxItem[],
  persist: Store,
  read: (ids: string[]) => Promise<Map<string, string> | null> = readJobMailTexts,
): Promise<JobMailReading> {
  const none = (skipped?: string): JobMailReading => ({ items, read: 0, rejections: 0, interviews: 0, ...(skipped ? { skipped } : {}) });
  const companies = openCompanies(await persist.applications.list().catch(() => []), ctx.now);
  const waiting = tagInbox(items, prefsFrom(ctx.settings))
    .filter((i) => (i.textVerdict === undefined || i.textVerdict === null) && (i.tag === "job" || (i.tag === null && fromAppliedCompany(i, companies) !== null)))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .slice(0, MAX_TEXTS_PER_RUN);
  if (waiting.length === 0) return none();
  // The demo has no Gmail; its sample emails come already read.
  if (ctx.mode !== "live" && read === readJobMailTexts) return none("demo mode");
  if (ctx.deadline !== undefined && ctx.deadline - Date.now() < READ_NEEDS_MS) return none("not enough time left in this run; the next sync reads them");
  const texts = await read(waiting.map((i) => i.messageId));
  if (!texts) return none("Gmail was not reachable over the app-password connection");
  const rows = waiting.filter((i) => texts.has(i.messageId)).map((i) => ({ messageId: i.messageId, ...readVerdict(texts.get(i.messageId) ?? "") }));
  await persist.inbox.setReadings(rows);
  const by = new Map(rows.map((r) => [r.messageId, r]));
  return {
    items: items.map((i) => {
      const r = by.get(i.messageId);
      return r ? { ...i, textVerdict: r.verdict, textQuote: r.quote, textRole: r.role } : i;
    }),
    read: rows.length,
    rejections: rows.filter((r) => r.verdict === "rejection").length,
    interviews: rows.filter((r) => r.verdict === "interview").length,
  };
}

/** What the trace says about a reading: counts only, never what an email said. */
export const readingNote = (r: JobMailReading) =>
  r.skipped ? `not read: ${r.skipped}` : r.read === 0 ? "no new job emails to read" : `${r.read} read: ${r.rejections} rejection${r.rejections === 1 ? "" : "s"}, ${r.interviews} interview invite${r.interviews === 1 ? "" : "s"}`;

/** The step that reads job emails, for the brief's run and the 2-hour sync. Never fails the run. */
export async function readNewJobMail(ctx: Context, persist: Store): Promise<JobMailReading> {
  const items = await ctx.store.inbox.list();
  return readJobMail(ctx, items, persist).catch(() => ({ items, read: 0, rejections: 0, interviews: 0, skipped: "reading failed" }));
}

/**
 * Logs applications from job emails: a "thank you for
 * applying" email adds the application; replies, interview invites and rejections move
 * it along. `persist` writes; nothing is logged twice.
 */
export async function trackApplications(ctx: Pick<Context, "settings">, items: InboxItem[], persist: Store): Promise<{ created: number; updated: number; jobEmails: number; roles: number }> {
  const roles = careerPrefs(ctx.settings).roles;
  const roleOf = (title: string) => roleFor(title, roles)?.name ?? "";
  const apps = await persist.applications.list();
  const mails = jobMailsFrom(items, ctx.settings);
  const changes = trackFromEmail(mails, apps, roleOf);
  for (const a of changes.create) await persist.applications.create(a);
  for (const u of changes.update) await persist.applications.update(u.id, { status: u.status, statusAt: u.statusAt });
  // A read email that names the role fills in an application logged as "Role not listed".
  const named = rolesFromMail(items, changes.create.length ? await persist.applications.list() : apps);
  for (const r of named) await persist.applications.update(r.id, { role: r.role, targetRole: targetRoleFor(r.role, roleOf) });
  return { created: changes.create.length, updated: changes.update.length, jobEmails: mails.length, roles: named.length };
}

/**
 * For each application logged as "Role not listed", reads the very email it was logged
 * from (its Gmail id is kept on the application) and fills in the role that email names.
 * At most a dozen a run; one whose email names no role is marked so it is read only once.
 * Read-only, rules only, nothing of the email stored.
 */
export async function lookUpRoles(
  ctx: Pick<Context, "settings" | "mode" | "deadline">,
  persist: Store,
  read: (ids: string[]) => Promise<Map<string, string> | null> = readJobMailTexts,
): Promise<{ looked: number; found: number; skipped?: string }> {
  const apps = await persist.applications.list();
  const todo = rolesToLookUp(apps).slice(0, MAX_TEXTS_PER_RUN);
  if (todo.length === 0) return { looked: 0, found: 0 };
  if (ctx.mode !== "live" && read === readJobMailTexts) return { looked: 0, found: 0, skipped: "demo mode" };
  if (ctx.deadline !== undefined && ctx.deadline - Date.now() < READ_NEEDS_MS) return { looked: 0, found: 0, skipped: "not enough time left in this run; the next sync looks" };
  const texts = await read(todo.map((t) => t.messageId));
  if (!texts) return { looked: 0, found: 0, skipped: "Gmail was not reachable over the app-password connection" };
  const roles = careerPrefs(ctx.settings).roles;
  let looked = 0;
  let found = 0;
  for (const t of todo) {
    const text = texts.get(t.messageId);
    const app = apps.find((a) => a.id === t.id);
    if (text === undefined || !app) continue;
    looked++;
    const role = roleFromText(text);
    if (role) {
      found++;
      await persist.applications.update(app.id, { role, targetRole: targetRoleFor(role, (title) => roleFor(title, roles)?.name ?? "") });
    } else {
      await persist.applications.update(app.id, { notes: `${app.notes ? `${app.notes}\n` : ""}${ROLE_NOT_IN_EMAIL}`.slice(0, 2000) });
    }
  }
  return { looked, found };
}

/** What the trace says about looking up roles: counts only. */
export const lookUpNote = (r: { looked: number; found: number; skipped?: string }) =>
  r.skipped ? `not read: ${r.skipped}` : r.looked === 0 ? "every application names its role" : `${r.found} of ${r.looked} roles found in the application emails`;

/** Queues one follow-up in the Approval Queue for each application quiet for a week (at most 5 a run). */
export async function queueFollowUps(ctx: Pick<Context, "settings" | "today">, persist: Store): Promise<number> {
  const [apps, approvals] = await Promise.all([persist.applications.list(), persist.approvals.list()]);
  const due = followUpsDue(apps, approvals, ctx.today).slice(0, 5);
  for (const a of due) {
    const mail = followUpEmail(a, ctx.settings.displayName);
    await persist.approvals.create({
      kind: "follow-up",
      title: `Follow up with ${a.company}`.slice(0, 300),
      detail: `Subject: ${mail.subject}\n\n${mail.body}`.slice(0, 4000),
      url: a.url,
      matchId: null,
      applicationId: a.id,
      status: "pending",
      decidedAt: null,
    });
  }
  return due.length;
}

/**
 * Finds and stores this brief's matches. `persist` is the store that may write matches:
 * the owner-scoped service store in live mode (the owner's session may only rate them),
 * the demo store in demo mode.
 */
export async function careerAgentWork(ctx: Context, slot: BriefSlot, persist: Store, t: Tracer = NO_TRACE): Promise<CareerAgentResult> {
  const prefs = careerPrefs(ctx.settings);
  const [watches, seen, rated, contacts, approvals, todays] = await t.step(
    "Load your watchlist, thumbs and matches already shown",
    () => Promise.all([ctx.store.watches.list(), persist.jobMatches.keys(), ctx.store.jobMatches.rated(), ctx.store.contacts.list(), ctx.store.approvals.list(), persist.jobMatches.since(ctx.today)]),
    ([w, s, r]) => `${w.length} watched companies, ${s.size} matches never to repeat, ${r.length} thumbs`,
  );
  // A second run in the same brief (Run Now) only tops the brief up to 10 of each.
  const already = todays.filter((m) => m.shownOn === ctx.today && m.shownSlot === slot);
  const room = (type: JobMatch["type"]) => Math.max(0, PER_BRIEF - already.filter((m) => m.type === type).length);
  // First, keep the tracker current from the inbox the Email Agent just synced.
  const reading = await t.step("Read the text of new job emails (read-only, rules only)", () => readNewJobMail(ctx, persist), readingNote);
  const tracked = await t.step(
    "Track applications from job emails",
    async () => trackApplications(ctx, reading.items, persist).catch(() => ({ created: 0, updated: 0, jobEmails: 0, roles: 0 })),
    (r) => `${r.jobEmails} job emails: ${r.created} new applications, ${r.updated} moved forward${r.roles ? `, ${r.roles} roles filled in` : ""}`,
  );
  await t.step("Look up missing roles in the application emails (read-only, rules only)", () => lookUpRoles(ctx, persist).catch(() => ({ looked: 0, found: 0, skipped: "lookup failed" })), lookUpNote);
  const followUps = await t.step("Queue follow-ups for quiet applications", () => queueFollowUps(ctx, persist).catch(() => 0), (n) => `${n} queued for your approval`);
  const scorecard = isScorecardDay(ctx.today) ? weeklyScorecard(await persist.applications.list(), ctx.today) : undefined;
  const project = isFirstWeekdayOfMonth(ctx.today)
    ? portfolioProject(skillGaps(skillDemand(await persist.jobMatches.since(addDays(ctx.today, -60)), prefs.roles, ctx.settings.careerSkills ?? [])))
    : null;
  const feeds = await t.step(
    "Read the job feeds",
    () => fetchJobFeeds(watches, prefs.roles.flatMap((r) => r.titles)),
    (f) => `${f.jobs.length} postings from ${f.sourceCount} sources${f.failed.length ? `; ${f.failed.length} failed: ${f.failed.join(", ")}` : ""}`,
  );
  // A link longer than the database allows would fail the whole insert: leave that posting out.
  const ranked = candidates(feeds.jobs, prefs, tasteFrom(rated), ctx.now, REMOTE_BOARDS).filter((c) => c.url.length <= 600);
  const chosen = [...pick(ranked, "full-time", room("full-time"), seen), ...pick(ranked, "gig", room("gig"), seen)];
  t.note(
    "Filter by role, location and pay, then rank and pick",
    `${ranked.length} of ${feeds.jobs.length} fit your ${prefs.roles.length} roles; picked ${chosen.filter((c) => c.type === "full-time").length} full-time and ${chosen.filter((c) => c.type === "gig").length} gigs (room for ${room("full-time")} and ${room("gig")})`,
  );
  const added = await persist.jobMatches.add(
    chosen.map((c) => ({
      key: c.key.slice(0, 600),
      type: c.type,
      title: c.title.slice(0, 200),
      company: (c.company || "Unknown company").slice(0, 160),
      url: c.url,
      source: c.source.slice(0, 80),
      location: c.location.slice(0, 200),
      role: c.role.name.slice(0, 80),
      payText: payLabel(c.title, c.pay),
      postedAt: c.postedAt,
      score: Math.max(-100, Math.min(200, Math.round(c.score))),
      shownOn: ctx.today,
      shownSlot: slot,
      rating: 0,
      status: "new" as const,
      skills: extractSkills(`${c.title} ${c.text}`).slice(0, 30),
    })),
  );
  const pending = approvals.filter((a) => a.status === "pending").length + followUps;
  return briefMatches([...already, ...added], slot, contacts, pending, feeds.failed, feeds.sourceCount, tracked, { followUps, scorecard, project });
}

/** Builds the report from stored matches (also used for Today's preview: no fetching). */
export function briefMatches(
  matches: JobMatch[],
  slot: BriefSlot,
  contacts: Contact[],
  pending: number,
  failed: string[] = [],
  sourceCount = 0,
  tracked?: { created: number; updated: number },
  extra: { followUps?: number; scorecard?: Scorecard; project?: PortfolioProject | null } = {},
): CareerAgentResult {
  const bySlot = [...matches].sort((a, b) => b.score - a.score);
  return careerAgentReport({
    slot,
    fullTime: bySlot.filter((m) => m.type === "full-time").slice(0, PER_BRIEF),
    gigs: bySlot.filter((m) => m.type === "gig").slice(0, PER_BRIEF),
    contacts,
    failedSources: failed,
    sourceCount,
    pendingApprovals: pending,
    tracked,
    ...extra,
  });
}

/** Today's preview: the matches already stored for this slot. Never fetches feeds. */
export async function storedMatches(ctx: Context, slot: BriefSlot): Promise<CareerAgentResult> {
  const [today, contacts, approvals] = await Promise.all([ctx.store.jobMatches.since(ctx.today), ctx.store.contacts.list(), ctx.store.approvals.list()]);
  return briefMatches(
    today.filter((m) => m.shownOn === ctx.today && m.shownSlot === slot),
    slot,
    contacts,
    approvals.filter((a) => a.status === "pending").length,
  );
}

export interface CareerRunOptions {
  trigger: AgentRunEvent["trigger"];
  /** Scheduled and Chief of Staff runs honor Pause; the agent's own Run Now does not. */
  honorPause: boolean;
  persist: Store;
}

/** One logged Applications Agent run. Never throws: a failure comes back as `missing`. */
export async function runCareerAgent(ctx: Context, slot: BriefSlot, opts: CareerRunOptions): Promise<CareerAgentResult | AgentMissing> {
  const agent = "career" as const;
  const runId = randomUUID();
  const task = `Job and gig matches for the ${SLOT_LABEL[slot]}`;
  const { trigger } = opts;

  if (opts.honorPause && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { missing: "skipped", why: "paused in Mission Control" };
  }

  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const result = await careerAgentWork(ctx, slot, opts.persist, t);
    const detail = [result.report.headline.replace(/\.$/, ""), result.report.errors[0] ?? ""].filter(Boolean).join(" · ");
    await logRun(ctx, { runId, agent, task, status: result.allFailed ? "failed" : "succeeded", trigger, detail, ...NO_MODEL, ...t.finish() });
    return result;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
