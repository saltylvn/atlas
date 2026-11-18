// The Career desk, stage 4: the Mentor.
//
// The Mentor looks at the whole job hunt from above and says the one or two things that
// matter most right now. It runs three times a day with a different job each time:
//   morning   sets the day's priority
//   midday    checks progress on it
//   evening   reviews the day and the bigger picture
//
// How it stays worth listening to:
//   1. Facts come from rules. Every observation below is arithmetic over your own data:
//      a count, a rate, a date. A model never produces a number.
//   2. Judgment comes from the model. Given the observations, it decides which matter
//      most now and words them as coaching, with one concrete action each
//      (lib/agents/mentor.ts). It must name the observations it rests on, and any
//      number it writes must be in them, or its insight is dropped.
//   3. It remembers. An insight you dismissed stays away; one you have not acted on is
//      not repeated word for word, it is followed up; one that is handled is said so.
//   4. It may say nothing. Below a threshold there is no insight, and that is correct.
//
// It advises only. Nothing here edits a resume, a setting or a page. Pure: no I/O.

import { ROLE_NOT_LISTED } from "./applications";
import { daysBetween } from "./dates";
import type { MarketReport } from "./market";
import type { Application, Approval, JobMatch, LocalDate } from "./types";

export type MentorSlot = "morning" | "midday" | "evening";
export const MENTOR_SLOTS: readonly MentorSlot[] = ["morning", "midday", "evening"];
export const MENTOR_SLOT_LABEL: Record<MentorSlot, string> = { morning: "Morning priority", midday: "Midday check", evening: "Evening review" };

export type MentorArea = "activity" | "queue" | "results" | "targeting" | "skills" | "resume" | "profile" | "gigs" | "win";

export interface Observation {
  /** Stable name of what was observed ("replies:by-role"), so memory can recognise it later. */
  id: string;
  area: MentorArea;
  /** 0 to 100: how much this matters, before the time of day is taken into account. */
  severity: number;
  /** What is true, in one or two sentences, with its numbers. */
  fact: string;
  /** The default next step, used when no model words the insight. */
  action: string;
  /** The observation's number as text. When it changes, the situation changed. */
  metric: string;
}

export interface MentorInsight {
  id: string;
  forDate: LocalDate;
  slot: MentorSlot;
  /** The observation it mainly rests on. */
  key: string;
  area: MentorArea;
  title: string;
  body: string;
  action: string;
  /** The facts it rests on, as shown to you. */
  evidence: string[];
  metric: string;
  writer: "model" | "rules";
  /** "replaced": a later review with fresher numbers said it again (server only; not a judgment of yours). */
  status: "new" | "done" | "dismissed" | "replaced";
  createdAt: string;
}

export interface MentorInput {
  today: LocalDate;
  slot: MentorSlot;
  /** Target roles, first priority first. */
  roles: string[];
  applications: Application[];
  approvals: Approval[];
  /** Matches shown in the last 14 days. */
  matches: JobMatch[];
  market: MarketReport | null;
  /** Skills you marked as yours. */
  skills: string[];
  /** Names of the resumes whose text is indexed, and the skills that text mentions. Null when resumes could not be read. */
  resumes: { names: string[]; skills: string[] } | null;
  answersWritten: number;
  answersTotal: number;
  /** Your LinkedIn text as pasted, or "". */
  linkedin: string;
  /** Planned applications a day, per track. */
  plan: { fullTime: number; gigs: number };
  /** Insights from the last 14 days, newest first. */
  prior: MentorInsight[];
}

const POSITIVE = new Set(["replied", "interview", "offer"]);
const pct = (n: number) => `${Math.round(n * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const mentions = (text: string, phrase: string) => new RegExp(`(^|[^a-z0-9])${phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text.toLowerCase());
const localDay = (iso: string) => iso.slice(0, 10);

/** Everything worth noticing right now. Each rule is small on purpose: one fact, one default action. */
export function observe(input: MentorInput): Observation[] {
  const { today, roles, applications, approvals, matches, market, skills, resumes, linkedin, plan } = input;
  const out: Observation[] = [];
  const add = (o: Observation) => out.push({ ...o, severity: Math.max(0, Math.min(100, Math.round(o.severity))) });
  const topRole = roles[0] ?? "";

  const sent = applications.filter((a) => a.appliedOn && a.status !== "saved");
  const since = (a: Application) => daysBetween(a.appliedOn!, today);
  const sentToday = sent.filter((a) => a.appliedOn === today);
  const fullTimeToday = sentToday.filter((a) => a.type === "full-time").length;

  // --- activity
  if (sent.length === 0) {
    add({ id: "activity:none", area: "activity", severity: 72, metric: "0", fact: "No applications are logged yet.", action: "Send one application today from the day's picks. The first one makes every number here start to mean something." });
  } else {
    const last = sent.map((a) => a.appliedOn!).sort().at(-1)!;
    const quiet = daysBetween(last, today);
    if (quiet >= 3) add({ id: "activity:gap", area: "activity", severity: 45 + quiet * 5, metric: String(quiet), fact: `Your last application went out ${quiet} days ago, on ${last}.`, action: `Send ${plural(plan.fullTime, "application")} today. The picks on the Career page come with the resume and your answers ready.` });
  }
  if (plan.fullTime > 0) {
    if (fullTimeToday >= plan.fullTime) add({ id: "win:plan", area: "win", severity: 38, metric: String(fullTimeToday), fact: `You sent ${plural(fullTimeToday, "full-time application")} today, which meets the plan of ${plan.fullTime}.`, action: "Stop here for today. Consistency beats volume." });
    else add({ id: "activity:today", area: "activity", severity: fullTimeToday === 0 ? 52 : 34, metric: String(fullTimeToday), fact: `${fullTimeToday} of ${plan.fullTime} planned full-time applications sent today.`, action: `Send ${plural(plan.fullTime - fullTimeToday, "more application")} from the Approval Queue before the day ends.` });
  }

  // --- the queue
  const waiting = approvals.filter((a) => a.status === "pending" && (a.kind === "application" || a.kind === "gig-proposal"));
  if (waiting.length > 0) {
    const oldest = Math.max(...waiting.map((a) => daysBetween(localDay(a.createdAt), today)));
    if (waiting.length >= 3 || oldest >= 2) add({ id: "queue:waiting", area: "queue", severity: 40 + waiting.length * 4 + oldest * 4, metric: `${waiting.length}/${oldest}`, fact: `${plural(waiting.length, "apply kit")} ${waiting.length === 1 ? "is" : "are"} waiting in the Approval Queue; the oldest has waited ${plural(oldest, "day")}.`, action: "Clear the oldest first: each kit has the resume and answers ready. Reject the ones you no longer want, so the list stays honest." });
  }
  const followUps = approvals.filter((a) => a.status === "pending" && a.kind === "follow-up").length;
  if (followUps > 0) add({ id: "queue:follow-ups", area: "queue", severity: 44 + followUps * 3, metric: String(followUps), fact: `${plural(followUps, "follow-up email")} ${followUps === 1 ? "is" : "are"} drafted and waiting for you to send.`, action: "Send them. A follow-up a week after applying is the cheapest way to raise your reply rate." });

  // --- results
  // An application logged from a confirmation email often has no role: the subject line did
  // not name it. Without the role, replies cannot be compared role by role.
  const unnamed = sent.filter((a) => a.role === ROLE_NOT_LISTED).length;
  if (sent.length >= 3 && unnamed / sent.length >= 0.4) {
    add({ id: "results:no-role", area: "results", severity: 47, metric: `${unnamed}/${sent.length}`, fact: `${unnamed} of your ${sent.length} tracked applications have no role on them, so replies cannot be compared by role.`, action: "Open Applications and fill in the role on each one. It takes a minute, and it is what lets the Mentor see which roles answer." });
  }
  const mature = sent.filter((a) => since(a) >= 7);
  const positive = (rows: Application[]) => rows.filter((a) => POSITIVE.has(a.status)).length;
  if (mature.length >= 8) {
    const rate = positive(mature) / mature.length;
    if (rate < 0.1) add({ id: "results:overall", area: "results", severity: 82, metric: `${positive(mature)}/${mature.length}`, fact: `${positive(mature)} of your ${mature.length} applications older than a week got a reply (${pct(rate)}).`, action: `Before sending more, spend one session on the top third of your ${topRole || "first-priority"} resume against the three newest postings for it. A reply rate this low is a targeting or resume problem, not a volume problem.` });
    else if (rate >= 0.25) add({ id: "win:replies", area: "win", severity: 36, metric: `${positive(mature)}/${mature.length}`, fact: `${positive(mature)} of your ${mature.length} applications older than a week got a reply (${pct(rate)}).`, action: "Keep the approach that is working, and note which resume those replies came from." });
  }
  const byRole = new Map<string, Application[]>();
  for (const a of mature) if (a.targetRole) byRole.set(a.targetRole, [...(byRole.get(a.targetRole) ?? []), a]);
  const rated = [...byRole.entries()].filter(([, rows]) => rows.length >= 4).map(([role, rows]) => ({ role, n: rows.length, pos: positive(rows), rate: positive(rows) / rows.length })).sort((a, b) => b.rate - a.rate);
  if (rated.length >= 2) {
    const best = rated[0]!;
    const worst = rated.at(-1)!;
    if (best.rate - worst.rate >= 0.25) add({ id: "results:by-role", area: "results", severity: 76, metric: `${best.role}:${best.pos}/${best.n}|${worst.role}:${worst.pos}/${worst.n}`, fact: `${best.role}: ${best.pos} of ${best.n} applications got a reply. ${worst.role}: ${worst.pos} of ${worst.n}.`, action: `Put your next applications into ${best.role}. Before sending more to ${worst.role}, compare that resume's top third with three of its postings.` });
  }
  const recent30 = sent.filter((a) => since(a) <= 30 && a.targetRole);
  const roleCounts = new Map<string, number>();
  for (const a of recent30) roleCounts.set(a.targetRole, (roleCounts.get(a.targetRole) ?? 0) + 1);
  const most = Math.max(0, ...roleCounts.values());
  if (recent30.length >= 6 && roleCounts.size >= 4 && most / recent30.length < 0.4) add({ id: "targeting:spread", area: "targeting", severity: 56, metric: `${roleCounts.size}/${recent30.length}`, fact: `Your last ${recent30.length} applications are spread across ${roleCounts.size} roles, and no role has more than ${most}.`, action: "Pick two roles for the next two weeks. With this spread, no role gets enough applications to show whether it works." });

  // --- wins that need a response
  for (const a of applications) {
    const age = daysBetween(localDay(a.statusAt), today);
    if ((a.status === "interview" || a.status === "offer") && age <= 3) add({ id: `win:${a.status}:${a.id}`, area: "win", severity: a.status === "offer" ? 90 : 68, metric: a.status, fact: `${a.company} moved your ${a.role} application to ${a.status}.`, action: a.status === "offer" ? "Read the offer against your pay floor before you answer, and ask for a day if you need one." : "Block 45 minutes to prepare. The prep notes for this interview are on the Job watchlist page." });
    else if (a.status === "replied" && age <= 2) add({ id: `win:replied:${a.id}`, area: "win", severity: 52, metric: "replied", fact: `${a.company} replied about your ${a.role} application.`, action: "Answer within a day. Speed is a signal they read." });
  }

  // --- the market, your skills and your resumes
  if (market && market.total > 0 && skills.length === 0) {
    add({ id: "skills:none-marked", area: "skills", severity: 66, metric: "0", fact: `The market report covers ${market.total} postings for your roles, but you have not marked any skills as yours, so it cannot say where you fit or what you lack.`, action: "Tick the skills you have on the Growth page. It takes two minutes, and every fit check and gap after that becomes real." });
  }
  if (market && market.total > 0) {
    const mine = new Set(skills.map((s) => s.toLowerCase()));
    // Gaps and fit mean nothing until some skills are marked; the observation above covers that.
    const gap = skills.length > 0 ? market.gaps[0] : undefined;
    if (gap && gap.share >= 0.15) {
      const onResume = resumes?.skills.some((s) => s.toLowerCase() === gap.skill.toLowerCase()) ?? false;
      if (onResume) add({ id: `skills:unmarked:${gap.skill}`, area: "skills", severity: 40, metric: pct(gap.share), fact: `${gap.skill} is asked for in ${pct(gap.share)} of postings for your roles. Your resume mentions it, but it is not marked as a skill of yours.`, action: `Tick ${gap.skill} on Growth so fit checks and the market report count it.` });
      // A real gap takes weeks to close, so it ranks under a fix you can make today
      // (a skill you have that no resume mentions scores 74).
      else add({ id: `skills:gap:${gap.skill}`, area: "skills", severity: 44 + gap.share * 40, metric: pct(gap.share), fact: `${gap.skill} is asked for in ${pct(gap.share)} of postings for your roles (${list(gap.roles)}), and it is not in your skills${resumes ? " or your resumes" : ""}.`, action: `Decide today whether ${gap.skill} is a real gap or only missing from the page. If you have used it, add one resume line with a result. If not, put a small project for it on Growth.` });
    }
    if (resumes && resumes.names.length > 0) {
      const onResume = new Set(resumes.skills.map((s) => s.toLowerCase()));
      const demanded = new Map<string, number>();
      for (const r of market.roles) for (const s of r.topSkills) demanded.set(s.skill, Math.max(demanded.get(s.skill) ?? 0, s.share));
      const unlisted = [...demanded.entries()].filter(([skill, share]) => share >= 0.2 && mine.has(skill.toLowerCase()) && !onResume.has(skill.toLowerCase())).sort((a, b) => b[1] - a[1]);
      if (unlisted[0]) add({ id: `resume:unlisted:${unlisted[0][0]}`, area: "resume", severity: 74, metric: pct(unlisted[0][1]), fact: `You mark ${unlisted[0][0]} as a skill and ${pct(unlisted[0][1])} of postings for one of your roles ask for it, but none of your indexed resumes mention it.`, action: `Add one bullet that names ${unlisted[0][0]} with a result to your ${topRole || "main"} resume. A skill a reader cannot find does not count.` });
    }
    const first = market.roles.find((r) => r.role === topRole);
    if (skills.length > 0 && market.bestFit && first && market.bestFit.role !== topRole && first.postings >= 3 && market.bestFit.coverage - first.coverage >= 0.15) {
      add({ id: "targeting:best-fit", area: "targeting", severity: 60, metric: `${market.bestFit.role}:${pct(market.bestFit.coverage)}|${pct(first.coverage)}`, fact: `Your best fit in the market is ${market.bestFit.role}: you cover ${pct(market.bestFit.coverage)} of what its postings ask for. Your first-priority role is ${topRole}, where you cover ${pct(first.coverage)}.`, action: `Your priority and your strengths point different ways. Either move ${market.bestFit.role} up in your role order in Notion, or close the top gap for ${topRole}.` });
    }
    const rising = market.roles.filter((r) => r.trend === "up" && roles.indexOf(r.role) >= 0 && roles.indexOf(r.role) < 3)[0];
    if (rising) add({ id: `targeting:demand-up:${rising.role}`, area: "targeting", severity: 42, metric: `${rising.thisWeek}/${rising.lastWeek}`, fact: `${rising.role} postings rose to ${rising.thisWeek} this week from ${rising.lastWeek} the week before.`, action: `Apply to ${rising.role} roles while they are fresh. Early applications get read.` });
  }
  if (resumes) {
    const have = new Set(resumes.names.map((n) => n.toLowerCase()));
    const missing = roles.slice(0, 3).filter((r) => !have.has(r.toLowerCase()));
    if (missing.length > 0) add({ id: "resume:no-text", area: "resume", severity: missing.includes(topRole) ? 64 : 46, metric: missing.join("|"), fact: `No resume text is indexed for ${list(missing)}.`, action: "Paste each resume's text into its page in Notion's Resumes database, then press Index on Ask Atlas. Until then, fit checks for those roles run blind." });
  }
  if (input.answersTotal > 0 && input.answersWritten < input.answersTotal) {
    const left = input.answersTotal - input.answersWritten;
    add({ id: "queue:answers", area: "queue", severity: Math.min(56, 34 + left * 3), metric: String(input.answersWritten), fact: `${input.answersWritten} of ${input.answersTotal} answer-bank questions are written.`, action: "Write the missing answers once. Every apply kit reuses them, so this is the fastest way to make applying quick." });
  }

  // --- LinkedIn
  const profile = linkedin.trim();
  if (!profile) add({ id: "profile:missing", area: "profile", severity: 40, metric: "0", fact: "Your LinkedIn profile text is not in Atlas, so it cannot be reviewed.", action: "Paste your headline and About section on the Growth page." });
  else {
    const head = profile.slice(0, 220);
    const roleWords = topRole.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    if (topRole && !roleWords.every((w) => mentions(head, w))) add({ id: "profile:headline", area: "profile", severity: 58, metric: topRole, fact: `The first lines of your LinkedIn profile do not say ${topRole}, your first-priority role.`, action: `Lead the headline with "${topRole}" and one proof point. Recruiters search by title.` });
    // Career direction (18 Nov 2026): name the title you want. "Aspiring" and "seeking" read as junior, and "entry level" anchors pay low.
    const weak = /\b(aspiring|seeking|entry[- ]level)\b/i.exec(head);
    if (weak) add({ id: "profile:wording", area: "profile", severity: 44, metric: weak[1]!.toLowerCase(), fact: `The first lines of your LinkedIn profile say "${weak[1]!.toLowerCase()}".`, action: `Take it out and name the title you want${topRole ? `, "${topRole}"` : ""}. That word reads as junior and can anchor your pay low.` });
    if (profile.length < 500) add({ id: "profile:thin", area: "profile", severity: 36, metric: String(profile.length), fact: `Your LinkedIn text is ${profile.length} characters long.`, action: "Give About three short paragraphs: what you build, proof with numbers, and what you want next." });
    if (market && market.total > 0) {
      const demanded = [...new Set(market.roles.flatMap((r) => r.topSkills.filter((s) => s.share >= 0.2).map((s) => s.skill)))];
      const absent = demanded.filter((s) => skills.some((h) => h.toLowerCase() === s.toLowerCase()) && !mentions(profile, s)).slice(0, 4);
      if (absent.length >= 2) add({ id: "profile:skills", area: "profile", severity: 50, metric: absent.join("|"), fact: `Your LinkedIn text does not mention ${list(absent)}. You mark them as skills, and postings for your roles ask for them.`, action: "Add them to About or Skills in the words the postings use." });
    }
  }

  // --- the two tracks
  const recent14 = sent.filter((a) => since(a) <= 14);
  if (recent14.length >= 5) {
    const gigs = recent14.filter((a) => a.type === "gig").length;
    if (gigs / recent14.length > 0.4) add({ id: "gigs:share", area: "gigs", severity: 55, metric: `${gigs}/${recent14.length}`, fact: `${gigs} of your last ${recent14.length} applications were gigs. Your plan is about one in five.`, action: "Full-time first this week: gigs are for the portfolio, not the goal." });
    else if (gigs === 0 && plan.gigs > 0) add({ id: "gigs:none", area: "gigs", severity: 36, metric: "0", fact: `None of your last ${recent14.length} applications were gig proposals. Your plan is about one in five.`, action: "Send one proposal this week for a small, fixed-price job in your niche. First reviews are what the profile needs." });
  }
  const untouched = matches.filter((m) => m.status === "new" && m.rating === 0 && daysBetween(m.shownOn, today) <= 7).length;
  if (untouched >= 15) add({ id: "queue:unrated", area: "queue", severity: 32, metric: String(untouched), fact: `${untouched} matches from the last week are unrated.`, action: "Thumb through them once. Your thumbs teach the ranking what to bring you." });

  return out;
}

// ---------------------------------------------------------------------------
// Memory and timing

/** How much each area matters at each time of day. */
const WEIGHT: Record<MentorSlot, Partial<Record<MentorArea, number>>> = {
  morning: { activity: 1.2, queue: 1.15, win: 1.1 },
  midday: { activity: 1.3, queue: 1.1, results: 0.8, targeting: 0.7, skills: 0.7, resume: 0.7, profile: 0.6 },
  evening: { results: 1.3, targeting: 1.2, skills: 1.15, resume: 1.2, profile: 1.15, queue: 0.7, activity: 0.9 },
};

/** Below this, the Mentor says nothing. */
export const WORTH_SAYING = 40;
export const MAX_INSIGHTS = 2;

const DISMISS_DAYS = 14;
const DONE_DAYS = 7;
const REPEAT_DAYS = 3;

export interface Eligible extends Observation {
  /** Severity after the time of day is applied. */
  weight: number;
}

/**
 * What the Mentor may speak about in this run: the observations it has not already made,
 * was not told to drop, and, after the morning, a check on the morning's priority.
 */
/**
 * `refresh`: a review you asked for with fresh data ("Refresh and review"). Something
 * already said may be said again, today too, when its numbers moved since the latest time
 * it was said; the new insight then replaces the older one. With `rejudge` (the AI model is
 * on), something last said by the rules may be judged again by the model, as when an
 * earlier run fell back to rules because the model did not answer.
 */
export function eligible(input: MentorInput, observations: readonly Observation[] = observe(input), opts: { refresh?: boolean; rejudge?: boolean } = {}): Eligible[] {
  const { today, slot, prior } = input;
  const age = (i: MentorInsight) => daysBetween(i.forDate, today);
  const out: Observation[] = [];

  // Progress on this morning's priority: handled, moved, or not.
  const mornings = slot === "morning" ? [] : prior.filter((i) => i.forDate === today && i.slot === "morning" && i.status !== "dismissed" && i.status !== "replaced" && !i.key.startsWith("win:"));
  const followed = new Set<string>();
  for (const m of mornings) {
    followed.add(m.key);
    const now = observations.find((o) => o.id === m.key);
    const said = prior.some((i) => i.forDate === today && i.slot === slot && i.key === `progress:${m.key}`);
    if (said) continue;
    if (m.status === "done" || !now) out.push({ id: `progress:${m.key}`, area: "win", severity: 54, metric: "handled", fact: `This morning's priority is handled: ${m.title}.`, action: slot === "evening" ? "Good. Tomorrow starts clean." : "Good. Use the time you saved on the next kit in the queue." });
    else if (now.metric !== m.metric) out.push({ id: `progress:${m.key}`, area: now.area, severity: 50, metric: now.metric, fact: `Progress on this morning's priority. ${now.fact}`, action: now.action });
    else out.push({ id: `progress:${m.key}`, area: now.area, severity: slot === "midday" ? 70 : 62, metric: now.metric, fact: `This morning's priority has not moved. ${now.fact}`, action: slot === "evening" ? `Put it first tomorrow: ${m.action}` : m.action });
  }

  for (const o of observations) {
    if (followed.has(o.id)) continue;
    const before = prior.filter((i) => i.key === o.id);
    if (before.some((i) => i.status === "dismissed" && age(i) <= DISMISS_DAYS)) continue;
    if (before.some((i) => i.status === "done" && i.metric === o.metric && age(i) <= DONE_DAYS)) continue;
    if (opts.refresh) {
      // Compared with the latest time it was said: unchanged numbers are not news.
      const latest = [...before].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
      if (latest && latest.metric === o.metric && age(latest) <= REPEAT_DAYS && !(opts.rejudge && latest.writer === "rules")) continue;
      out.push(o);
      continue;
    }
    // Said recently and nothing changed: saying it again is nagging.
    if (before.some((i) => i.metric === o.metric && age(i) <= REPEAT_DAYS)) continue;
    // Said today already, even with a new number: once a day is enough unless it is this run's follow-up.
    if (before.some((i) => i.forDate === today)) continue;
    out.push(o);
  }
  return out.map((o) => ({ ...o, weight: Math.round(o.severity * (WEIGHT[slot][o.area] ?? 1)) })).sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));
}

export type NewInsight = Omit<MentorInsight, "id" | "createdAt">;

const titleOf = (o: Observation) => {
  const first = o.fact.split(/(?<=[.!?])\s/)[0]!.replace(/\.$/, "");
  return first.length > 90 ? `${first.slice(0, 89).trimEnd()}…` : first;
};

/** Two insights should be two subjects: the heaviest observation of each area, heaviest first. */
export function onePerArea<T extends { area: MentorArea }>(pool: readonly T[]): T[] {
  const seen = new Set<MentorArea>();
  return pool.filter((o) => (seen.has(o.area) ? false : (seen.add(o.area), true)));
}

/** The Mentor without a model: the heaviest observations, in the rules' own words. */
export function rulesInsights(input: MentorInput, pool: readonly Eligible[] = eligible(input)): NewInsight[] {
  return onePerArea(pool.filter((o) => o.weight >= WORTH_SAYING))
    .slice(0, MAX_INSIGHTS)
    .map((o) => {
      const title = titleOf(o);
      // The title is the fact's first sentence; the body is what the fact says beyond it.
      const rest = o.fact.slice(o.fact.indexOf(title) + title.length).replace(/^[.…]?\s*/, "").trim();
      return { forDate: input.today, slot: input.slot, key: o.id, area: o.area, title, body: rest || o.fact, action: o.action, evidence: [o.fact], metric: o.metric, writer: "rules" as const, status: "new" as const };
    });
}

export interface ModelInsight {
  /** Ids of the observations it rests on. */
  evidence: string[];
  title: string;
  insight: string;
  action: string;
}

const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));

/**
 * Checks what a model wrote against what it was shown. An insight is kept only when every
 * observation it cites was really offered, and every number in it appears in those
 * observations (or is the day's plan). The rest is dropped, not repaired.
 */
export function acceptInsights(input: MentorInput, pool: readonly Eligible[], proposed: readonly ModelInsight[], materials: readonly string[] = []): NewInsight[] {
  const byId = new Map(pool.map((o) => [o.id, o]));
  const out: NewInsight[] = [];
  const used = new Set<string>();
  for (const p of proposed) {
    const cited = [...new Set(p.evidence)].map((id) => byId.get(id)).filter((o): o is Eligible => Boolean(o));
    if (cited.length === 0 || cited.length !== new Set(p.evidence).size) continue;
    const main = cited[0]!;
    // Two insights are two subjects: never the same observation, never the same area.
    if (used.has(main.id) || out.some((i) => i.area === main.area)) continue;
    const known = new Set([...cited.flatMap((o) => [...numbers(o.fact), ...numbers(o.action)]), ...materials.flatMap(numbers), String(input.plan.fullTime), String(input.plan.gigs)]);
    if (![p.title, p.insight, p.action].flatMap(numbers).every((n) => known.has(n))) continue;
    used.add(main.id);
    out.push({ forDate: input.today, slot: input.slot, key: main.id, area: main.area, title: p.title.trim(), body: p.insight.trim(), action: p.action.trim(), evidence: cited.map((o) => o.fact), metric: main.metric, writer: "model", status: "new" });
    if (out.length >= MAX_INSIGHTS) break;
  }
  return out;
}

/** Something this serious is said even when a model chose silence. */
export const MUST_SAY = 80;

/** The line the Mentor reports to the Chief of Staff. */
export function mentorHeadline(slot: MentorSlot, insights: readonly Pick<MentorInsight, "title">[]): string {
  return insights.length ? `${MENTOR_SLOT_LABEL[slot]}: ${insights[0]!.title}${insights.length > 1 ? ` (and ${insights.length - 1} more)` : ""}` : `${MENTOR_SLOT_LABEL[slot]}: nothing new worth your attention.`;
}

/** How many days an open insight stays on the Today page. Three covers a Sunday with no runs. */
export const TODAY_INSIGHT_DAYS = 3;

/**
 * The insights the Today page points at: still open, from the last few days, newest
 * first, at most `max`. Growth keeps the full list; Today only says "go look".
 */
export function insightsForToday(insights: readonly MentorInsight[], today: LocalDate, max = 2): MentorInsight[] {
  return insights
    .filter((i) => i.status === "new" && daysBetween(i.forDate, today) >= 0 && daysBetween(i.forDate, today) < TODAY_INSIGHT_DAYS)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, max);
}

/** When each review is due on the owner's clock: with the two briefs, then early evening. */
export const MENTOR_SLOT_TIME: Record<MentorSlot, string> = { morning: "09:00", midday: "14:00", evening: "18:00" };

export interface MentoringSlot {
  slot: MentorSlot;
  /** "spoke": it has something for you. "quiet": its time passed with nothing to flag. "ahead": still to come today. */
  state: "spoke" | "quiet" | "ahead";
  insights: MentorInsight[];
}

/**
 * Daily mentoring: today's three reviews in order, each with what it said. An insight a
 * later review replaced is left out, since the newer one stands in for it.
 */
export function dailyMentoring(insights: readonly MentorInsight[], today: LocalDate, hhmm: string): MentoringSlot[] {
  return MENTOR_SLOTS.map((slot) => {
    const mine = insights.filter((i) => i.forDate === today && i.slot === slot && i.status !== "replaced").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { slot, state: mine.length ? "spoke" : MENTOR_SLOT_TIME[slot] > hhmm ? "ahead" : "quiet", insights: mine };
  });
}

/** Which run this is, from the owner's clock: before noon, the afternoon, or 5 PM on. */
export function slotAt(hhmm: string): MentorSlot {
  const h = Number(hhmm.slice(0, 2));
  return h < 12 ? "morning" : h < 17 ? "midday" : "evening";
}

/**
 * Why the Mentor's last review deserves another try, or null when it went fine: it did not
 * finish, or it fell back to its rules while the AI model is on (the model did not answer).
 * Today and Mission Control then offer Refresh and review.
 */
export function mentorRetryReason(runs: readonly { agent: string; task: string; status: string; detail: string }[], aiOn: boolean): string | null {
  const last = runs.find((r) => r.agent === "mentor" && r.status !== "started" && (r.task.startsWith("Mentor: ") || r.task === "Refresh and review"));
  if (!last) return null;
  if (last.status === "failed") return "The Mentor's last review did not finish.";
  if (aiOn && /by rules/.test(last.detail)) return "The Mentor's last review used its rules: the AI model did not answer.";
  return null;
}
