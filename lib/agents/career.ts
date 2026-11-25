import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import { SLOT_LABEL } from "@/lib/domain/briefSchedule";
import { eventIndex, fromAppliedCompany, kindToPlace, mailEvents, mailWaiting, openCompanies, ROLE_NOT_IN_EMAIL, rolesFromMail, rolesToLookUp, targetRoleFor, textRead, trackMail, type JobMail, type Tracked } from "@/lib/domain/applications";
import { heardAt } from "@/lib/domain/pipeline";
import type { Scorecard } from "@/lib/domain/careerPrep";
import { candidates, careerAgentReport, notFullTimeCount, payLabel, pick, roleFor, seniorCount, tasteFrom, type Candidate, type CareerAgentResult, type CareerPrefs } from "@/lib/domain/careerAgent";
import { MORE_COUNT, MORE_LOCAL_SEATS, ON_DEMAND_SLOT } from "@/lib/domain/moreMatches";
import { acceptPolish, emailDate, followUpEmail, followUpsDue, isOldFollowUp, isScorecardDay, spokenRole, weeklyScorecard, type FollowUp } from "@/lib/domain/careerPrep";
import { takeAiCall } from "@/lib/ai/budget";
import { structuredWithin } from "@/lib/ai/model";
import { followUpData, followUpTask, FollowUpOut } from "@/lib/ai/prompts";
import { prefsFrom, tagInbox } from "@/lib/domain/emailAgent";
import { readVerdict, roleFromText } from "@/lib/domain/jobMailText";
import { readJobMailTexts } from "@/lib/connections/google";
import { MAX_TEXTS_PER_RUN } from "@/lib/integrations/gmailImap";
import { addDays } from "@/lib/domain/dates";
import { applyFacts, levelOf, linkKit } from "@/lib/domain/outcomes";
import { resumeTexts } from "@/lib/domain/resumeScore";
import { contactForCompany } from "@/lib/domain/career";
import { extractSkills, isFirstWeekdayOfMonth, portfolioProject, skillDemand, skillGaps, type PortfolioProject } from "@/lib/domain/skills";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { payPrefs } from "@/lib/domain/searchProfile";
import { rolesFrom } from "@/lib/domain/targetRoles";
import type { AgentRunEvent, ApplicationEvent, BriefSlot, Contact, InboxItem, JobMatch, JobWatch, Settings, Application } from "@/lib/domain/types";
import { fetchJobFeeds, REMOTE_BOARDS, type FeedResult } from "@/lib/integrations/jobFeeds";
import { isPaused, logRun, NO_MODEL } from "./log";
import { briefHeld, recordHeardBack } from "./heardBack";
import { NO_TRACE, tracer, type Tracer } from "./trace";

// The Applications Agent at run time (part 5a: matching). It reads the public job feeds,
// keeps the full-time postings that fit what you are looking for (lib/domain/searchProfile.ts:
// your roles, junior to mid level, a place you can work from Salt Lake City, pay from your floor
// up), ranks them by freshness, place, pay and your thumbs, and stores up to 10 matches the
// brief has never shown, in one list. Contract, freelance, part-time and senior postings are left out.
// Rules only, no model call, so every run costs $0. It never applies anywhere: you pick
// matches, approve them with a 👍, and apply yourself on your MacBook.

/** Each brief has one Good fits list of this many jobs to judge, and the morning and afternoon briefs 20 different ones a day. */
export const PER_BRIEF = 10;
/** Seats in the list kept for Utah postings when there are any, so fresh remote postings cannot crowd them out. */
export const LOCAL_SEATS = 2;

export function careerPrefs(s: Settings): CareerPrefs {
  return { roles: rolesFrom(s.careerRoles), ...payPrefs(s) };
}

const NO_MAIL: ReadonlySet<string> = new Set();

/**
 * The job emails the tracker may place: the ones the Email Agent tagged whose text has been
 * read. An unread one is left out and waits for a run that reads it, because each email is
 * placed once and a subject alone can be wrong (`kindToPlace`, lib/domain/applications.ts).
 * Every run, the Pipeline's Needs you lane and the action behind it come through here, so
 * the rule is in one place. `neverRead` names emails no run will ever read (the one-time
 * catch-up's): those are placed by their subject, never as an interview invite.
 */
export function jobMailsFrom(items: InboxItem[], settings: Settings, neverRead: ReadonlySet<string> = NO_MAIL): JobMail[] {
  return tagInbox(items, prefsFrom(settings)).flatMap((i) => {
    const kind = i.tag === "job" && i.jobKind ? kindToPlace(i.jobKind, textRead(i), neverRead.has(i.messageId)) : null;
    return kind
      ? [
          {
            messageId: i.messageId,
            fromName: i.fromName,
            fromEmail: i.fromEmail,
            subject: i.subject,
            receivedAt: i.receivedAt,
            kind,
            threadId: i.threadId,
            ...(i.textRole ? { role: i.textRole } : {}),
            // The reader's sentence, when it is what decided this email's kind.
            ...(i.textQuote && i.textVerdict === kind ? { quote: i.textQuote } : {}),
          },
        ]
      : [];
  });
}

export interface JobMailReading {
  /** The inbox, with the verdicts just read. */
  items: InboxItem[];
  read: number;
  rejections: number;
  interviews: number;
  /** Assessments, requests for times or for something, and offers. */
  others?: number;
  /** Why nothing was read, when job emails were waiting. */
  skipped?: string;
}

/** Time a run must have left before it opens Gmail to read job emails. */
const READ_NEEDS_MS = 25_000;

/**
 * Reads the text of job emails not read yet (newest first, at most a dozen a run) and
 * keeps only what each says (a rejection, an interview invite, an assessment, a request for
 * times or for something, an offer, or none of these), with the one sentence that decided
 * it, and the role it names. Rules only: nothing here sends the text to an AI model, stores
 * it or logs it (the model reader is its own step, lib/agents/mailReader.ts, off by default). Read: emails the Email Agent tagged as job mail, and every
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
    others: rows.filter((r) => r.verdict !== "rejection" && r.verdict !== "interview" && r.verdict !== "none").length,
  };
}

/** What the trace says about a reading: counts only, never what an email said. */
export const readingNote = (r: JobMailReading) =>
  r.skipped
    ? `not read: ${r.skipped}`
    : r.read === 0
      ? "no new job emails to read"
      : `${r.read} read: ${r.rejections} rejection${r.rejections === 1 ? "" : "s"}, ${r.interviews} interview invite${r.interviews === 1 ? "" : "s"}${r.others ? `, ${r.others} other answer${r.others === 1 ? "" : "s"} (an assessment, a request or an offer)` : ""}`;

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
/** Facts for an email-logged application from the queued job it matches, or none (lib/domain/outcomes.ts). */
async function linkerFor(persist: Store): Promise<(a: Pick<Application, "company" | "appliedOn" | "role"> & { createdAt?: string }) => Partial<Application>> {
  const [kits, matches, rows, contacts] = await Promise.all([
    persist.approvals.list().catch(() => []),
    persist.jobMatches.since(addDays(new Date().toISOString().slice(0, 10), -30)).catch(() => []),
    persist.knowledge.bySource("resume", 400).catch(() => []),
    persist.contacts.list().catch(() => []),
  ]);
  const resumes = resumeTexts(rows);
  return (a) => {
    const m = linkKit({ ...a, createdAt: a.createdAt ?? new Date().toISOString() }, kits, matches);
    if (!m) return { level: levelOf(a.role || "") };
    const f = applyFacts({ title: m.title, postedAt: m.postedAt, role: m.role, resumes, knowSomeone: Boolean(contactForCompany(m.company, contacts)) });
    return { level: f.level, postedOn: f.postedOn, resumeVersion: f.resumeVersion, ...(f.warm ? { warm: true } : {}) };
  };
}

/**
 * Saves what the tracker decided: new applications, moves, and each email on its timeline
 * (one event per email, whether or not it moved anything). Returns the board afterwards.
 */
export async function saveTracked(persist: Store, changes: Tracked, apps: Application[]): Promise<{ board: Application[]; added: ApplicationEvent[] }> {
  // An application logged from a "thank you for applying" email takes the facts of the queued
  // job it most likely was (Step 0: level, posting date, resume version, warm).
  const link = changes.create.length ? await linkerFor(persist) : null;
  for (const a of changes.create) await persist.applications.create(link ? { ...a, ...link(a) } : a);
  for (const u of changes.update) await persist.applications.update(u.id, { status: u.status, stage: u.stage, statusAt: u.statusAt });
  const board = changes.create.length || changes.update.length ? await persist.applications.list() : apps;
  // An email already on a timeline is skipped by the database, so only the new ones come back.
  const added = await persist.applicationEvents.append(mailEvents(changes.placed, (app) => board.find((a) => a.id === app || a.externalId === app)?.id));
  for (const a of board) {
    const heard = heardAt(added.filter((e) => e.applicationId === a.id), a.lastHeardAt);
    if (heard && heard !== (a.lastHeardAt ?? null)) await persist.applications.update(a.id, { lastHeardAt: heard });
  }
  return { board, added };
}

/**
 * Tracks the job emails whose text has been read, then puts each answer among them in the
 * Heard back outbox (lib/agents/heardBack.ts). An unread email is not placed: it waits for
 * a run that reads it, and `waiting` counts those. `heard` is how many answers were new;
 * null when the outbox could not be written (the timelines are saved either way, and the
 * trace says so). Nothing is pushed here: the scheduled runs send what is due.
 * `neverRead` is the catch-up's alone (see `jobMailsFrom`).
 */
export async function trackApplications(
  ctx: Pick<Context, "settings"> & { now?: Date },
  items: InboxItem[],
  persist: Store,
  neverRead: ReadonlySet<string> = NO_MAIL,
): Promise<{ created: number; updated: number; jobEmails: number; roles: number; toPlace: number; heard: number | null; waiting: number }> {
  const roles = careerPrefs(ctx.settings).roles;
  const roleOf = (title: string) => roleFor(title, roles)?.name ?? "";
  const apps = await persist.applications.list();
  const mails = jobMailsFrom(items, ctx.settings, neverRead);
  const index = eventIndex(await persist.applicationEvents.index());
  // Each email is matched to its application by the ladder (thread, then role, then company);
  // one it cannot place waits for you in the Pipeline's Needs you lane.
  const changes = trackMail(mails, apps, roleOf, index);
  const { board, added } = await saveTracked(persist, changes, apps);
  // A read email that names the role fills in an application logged as "Role not listed".
  const named = rolesFromMail(items, board);
  for (const r of named) await persist.applications.update(r.id, { role: r.role, targetRole: targetRoleFor(r.role, roleOf) });
  // Each answer just put on a timeline goes in the outbox, named as the board now names it.
  const namedBoard = board.map((a) => ({ ...a, role: named.find((r) => r.id === a.id)?.role ?? a.role }));
  const heard = await recordHeardBack(persist, added, namedBoard, ctx.settings, ctx.now ?? new Date())
    .then((rows) => rows.length)
    .catch(() => null);
  const waiting = mailWaiting(tagInbox(items.filter((i) => !neverRead.has(i.messageId)), prefsFrom(ctx.settings)), index);
  return { created: changes.create.length, updated: changes.update.length, jobEmails: mails.length, roles: named.length, toPlace: changes.ask.length, heard, waiting };
}

/** The tracker's result when it could not run at all. */
export const NOT_TRACKED = { created: 0, updated: 0, jobEmails: 0, roles: 0, toPlace: 0, heard: 0, waiting: 0 } as const;

/** What the trace says about tracking: counts only. */
export const trackedNote = (r: { created: number; updated: number; jobEmails: number; roles: number; toPlace?: number; heard?: number | null; waiting?: number }): string =>
  `${r.jobEmails} job emails: ${r.created} new applications, ${r.updated} moved forward${r.roles ? `, ${r.roles} roles filled in` : ""}${r.toPlace ? `, ${r.toPlace} waiting for you to say which application` : ""}${r.heard ? `, ${r.heard} new in Heard back` : ""}${r.waiting ? `, ${r.waiting} not placed until ${r.waiting === 1 ? "its" : "their"} text is read` : ""}${r.heard === null ? ". Heard back could not be written; the timelines are saved" : ""}`;

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

/** Rewrites one follow-up with the model, or returns null to keep the rules' draft. */
export type FollowUpPolisher = (draft: FollowUp, facts: { company: string; role: string; appliedOn: string; name: string }) => Promise<FollowUp | null>;

const POLISH_WAIT_MS = 12_000;

/**
 * The model's pass over a follow-up: better wording, same facts. Gated like every model call
 * (kill switch, daily limit); anything short of a clean answer keeps the rules' draft.
 */
function modelPolisher(ctx: Pick<Context, "settings">, persist: Store): FollowUpPolisher {
  return async (draft, facts) => {
    const gate = await takeAiCall(persist, ctx.settings, "follow-up");
    if (!gate.allowed) return null;
    const res = await structuredWithin(POLISH_WAIT_MS, FollowUpOut, followUpTask(), followUpData(draft, facts));
    return res.ok ? res.value : null;
  };
}

/** One application's follow-up: the rules write it, the model may polish it, and the rules decide whether the polish is kept. */
async function writeFollowUp(a: Pick<Application, "company" | "role" | "appliedOn">, name: string, polish: FollowUpPolisher): Promise<FollowUp> {
  const draft = followUpEmail(a, name);
  const facts = { company: a.company.replace(/\s+/g, " ").trim(), role: spokenRole(a.role), appliedOn: emailDate(a.appliedOn), name: name.trim() || "Tyler" };
  const polished = await polish(draft, facts).catch(() => null);
  return (polished && acceptPolish(draft, polished, facts)) || draft;
}

/**
 * Queues one follow-up in the Apply Queue for each application quiet for a week (at most 5
 * a run), and writes again any waiting draft the older template wrote. Never sends anything.
 */
export async function queueFollowUps(ctx: Pick<Context, "settings" | "today">, persist: Store, polish: FollowUpPolisher = modelPolisher(ctx, persist)): Promise<number> {
  const [apps, approvals] = await Promise.all([persist.applications.list(), persist.approvals.list()]);
  const name = ctx.settings.displayName;
  // Drafts still waiting that doubled words or printed raw dates: at most 5 a run.
  for (const old of approvals.filter((p) => p.kind === "follow-up" && p.status === "pending" && isOldFollowUp(p.detail)).slice(0, 5)) {
    const app = apps.find((x) => x.id === old.applicationId);
    if (!app) continue;
    const mail = await writeFollowUp(app, name, polish);
    await persist.approvals.update(old.id, { detail: `Subject: ${mail.subject}\n\n${mail.body}`.slice(0, 4000) });
  }
  const due = followUpsDue(apps, approvals, ctx.today).slice(0, 5);
  for (const a of due) {
    const mail = await writeFollowUp(a, name, polish);
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
export async function careerAgentWork(ctx: Context, slot: BriefSlot, persist: Store, t: Tracer = NO_TRACE, read: FeedReader = fetchJobFeeds): Promise<CareerAgentResult> {
  const prefs = careerPrefs(ctx.settings);
  const [watches, seen, rated, contacts, approvals, todays] = await t.step(
    "Load your watchlist, thumbs and matches already shown",
    () => Promise.all([ctx.store.watches.list(), persist.jobMatches.keys(), ctx.store.jobMatches.rated(), ctx.store.contacts.list(), ctx.store.approvals.list(), persist.jobMatches.since(ctx.today)]),
    ([w, s, r]) => `${w.length} watched companies, ${s.size} matches never to repeat, ${r.length} thumbs`,
  );
  // A second run in the same brief (Run Now) only tops its list up to PER_BRIEF.
  const already = todays.filter((m) => m.shownOn === ctx.today && m.shownSlot === slot);
  const room = Math.max(0, PER_BRIEF - already.length);
  // First, keep the tracker current from the inbox the Email Agent just synced.
  const reading = await t.step("Read the text of new job emails (read-only, rules only)", () => readNewJobMail(ctx, persist), readingNote);
  const tracked = await t.step(
    "Track applications from job emails",
    async () => trackApplications(ctx, reading.items, persist).catch(() => NOT_TRACKED),
    trackedNote,
  );
  // Rejections you asked to hold are told here, once.
  const held = await briefHeld(persist, ctx.now).catch(() => null);
  await t.step("Look up missing roles in the application emails (read-only, rules only)", () => lookUpRoles(ctx, persist).catch(() => ({ looked: 0, found: 0, skipped: "lookup failed" })), lookUpNote);
  const followUps = await t.step("Queue follow-ups for quiet applications", () => queueFollowUps(ctx, persist).catch(() => 0), (n) => `${n} queued for your approval`);
  const scorecard = isScorecardDay(ctx.today) ? weeklyScorecard(await persist.applications.list(), ctx.today) : undefined;
  const project = isFirstWeekdayOfMonth(ctx.today)
    ? portfolioProject(skillGaps(skillDemand(await persist.jobMatches.since(addDays(ctx.today, -60)), prefs.roles, ctx.settings.careerSkills ?? [])))
    : null;
  const { feeds, ranked, note } = await readAndRank(ctx, prefs, watches, rated, t, read);
  const chosen = pick(ranked, room, seen, LOCAL_SEATS);
  t.note("Filter by role, level, full-time, place and pay, then rank and pick", `${note}; picked ${chosen.length} (${PER_BRIEF} at most)`);
  const added = await persist.jobMatches.add(chosen.map((c) => matchRow(c, ctx.today, slot)));
  const pending = approvals.filter((a) => a.status === "pending").length + followUps;
  return briefMatches([...already, ...added], slot, contacts, pending, feeds.failed, feeds.sourceCount, tracked, { followUps, scorecard, project, targetSalary: prefs.targetSalary, held });
}

/** Reads the job feeds. Swapped in tests, which must not reach the network. */
export type FeedReader = typeof fetchJobFeeds;

/**
 * Reads the feeds and ranks every posting that fits what you are looking for, best first.
 * The brief's run and "Find more good fits" share it, so both always apply the same rules.
 */
async function readAndRank(ctx: Pick<Context, "now">, prefs: CareerPrefs, watches: JobWatch[], rated: Parameters<typeof tasteFrom>[0], t: Tracer, read: FeedReader): Promise<{ feeds: FeedResult; ranked: Candidate[]; note: string }> {
  const feeds = await t.step(
    "Read the job feeds",
    () => read(watches, prefs.roles.flatMap((r) => r.titles)),
    (f) => `${f.jobs.length} postings from ${f.sourceCount} sources${f.failed.length ? `; ${f.failed.length} failed: ${f.failed.join(", ")}` : ""}`,
  );
  // A link longer than the database allows would fail the whole insert: leave that posting out.
  const ranked = candidates(feeds.jobs, prefs, tasteFrom(rated), ctx.now, REMOTE_BOARDS).filter((c) => c.url.length <= 600);
  const leftOut = notFullTimeCount(feeds.jobs, prefs.roles);
  const senior = seniorCount(feeds.jobs, prefs.roles, prefs.maxYears);
  const local = ranked.filter((c) => c.place.tier !== "remote").length;
  const note = `${ranked.length} of ${feeds.jobs.length} fit your ${prefs.roles.length} roles (${local} in Utah: remote, hybrid or an office inside the commute); ${senior} above your level (senior, or more than ${prefs.maxYears} years asked) and ${leftOut} contract or part-time posting${leftOut === 1 ? "" : "s"} left out`;
  return { feeds, ranked, note };
}

/** A ranked posting as the row that stores it: for a brief's slot, or found on demand. */
function matchRow(c: Candidate, today: string, slot: string): Omit<JobMatch, "id" | "createdAt"> {
  return {
    key: c.key.slice(0, 600),
    title: c.title.slice(0, 200),
    company: (c.company || "Unknown company").slice(0, 160),
    url: c.url,
    source: c.source.slice(0, 80),
    // The place as the brief shows it ("Hybrid · Lehi, UT · ~25 min"); it reads back to the same group.
    location: c.place.label.slice(0, 200),
    role: c.role.name.slice(0, 80),
    payText: payLabel(c.title, c.pay),
    postedAt: c.postedAt,
    score: Math.max(-100, Math.min(200, Math.round(c.score))),
    shownOn: today,
    shownSlot: slot,
    rating: 0,
    status: "new",
    skills: extractSkills(`${c.title} ${c.text}`).slice(0, 30),
  };
}

// ---------------------------------------------------------------------------
// "Find more good fits": a search you start yourself, between briefs

export const MORE_TASK = "Find more good fits";

export interface MoreMatches {
  /** The matches found and stored for your review, best first. */
  found: JobMatch[];
  /** Postings that fit and had never been shown, before this run took its share. */
  unseen: number;
  failedSources: string[];
  /** True when no job feed could be read. */
  allFailed: boolean;
}

export interface MoreOptions {
  trigger: AgentRunEvent["trigger"];
  /** The store that may write matches: the owner-scoped service store live, the demo store in demo mode. */
  persist: Store;
  read?: FeedReader;
}

/**
 * Searches the job feeds again and stores up to 5 more matches for your review: the same
 * rules as a brief, never a posting already shown, and under their own slot, so no brief
 * counts them as its own or shows them again. Started by you, so it runs even when the
 * agent is paused. Rules only: $0. Never throws: a failure comes back as `missing`.
 */
export async function findMoreMatches(ctx: Context, opts: MoreOptions): Promise<MoreMatches | AgentMissing> {
  const agent = "career" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  await logRun(ctx, { runId, agent, task: MORE_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const prefs = careerPrefs(ctx.settings);
    const [watches, seen, rated] = await t.step(
      "Load your watchlist, thumbs and matches already shown",
      () => Promise.all([ctx.store.watches.list(), persist.jobMatches.keys(), ctx.store.jobMatches.rated()]),
      ([w, s, r]) => `${w.length} watched companies, ${s.size} matches never to repeat, ${r.length} thumbs`,
    );
    const { feeds, ranked, note } = await readAndRank(ctx, prefs, watches, rated, t, opts.read ?? fetchJobFeeds);
    const unseen = ranked.filter((c) => !seen.has(c.key)).length;
    // A seat is kept for a Utah posting, so fresh remote ones do not crowd it out.
    const chosen = pick(ranked, MORE_COUNT, seen, MORE_LOCAL_SEATS);
    t.note("Filter by role, level, full-time, place and pay, then rank and pick", `${note}; ${unseen} never shown; picked ${chosen.length} of the ${MORE_COUNT} asked for`);
    const stored = await t.step("Store them for your review", () => persist.jobMatches.add(chosen.map((c) => matchRow(c, ctx.today, ON_DEMAND_SLOT))), (rows) => `${rows.length} stored under their own slot; no brief will show them again`);
    const found = [...stored].sort((a, b) => b.score - a.score);
    const allFailed = feeds.sourceCount > 0 && feeds.failed.length >= feeds.sourceCount;
    const detail = allFailed
      ? "No job feed could be read"
      : [`${found.length} more found for review (${unseen} fit and had not been shown)`, feeds.failed.length ? `${feeds.failed.length} job source${feeds.failed.length === 1 ? "" : "s"} failed: ${feeds.failed.join(", ")}` : ""].filter(Boolean).join(" · ");
    await logRun(ctx, { runId, agent, task: MORE_TASK, status: allFailed ? "failed" : "succeeded", trigger, detail, ...NO_MODEL, ...t.finish() });
    return { found, unseen, failedSources: feeds.failed, allFailed };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: MORE_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
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
  extra: { followUps?: number; scorecard?: Scorecard; project?: PortfolioProject | null; targetSalary?: number; held?: string | null } = {},
): CareerAgentResult {
  const bySlot = [...matches].sort((a, b) => b.score - a.score);
  return careerAgentReport({
    slot,
    // Best first, one list.
    fullTime: bySlot.slice(0, PER_BRIEF),
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
    [],
    0,
    undefined,
    { targetSalary: payPrefs(ctx.settings).targetSalary },
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
  const task = `Job matches for the ${SLOT_LABEL[slot]}`;
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
