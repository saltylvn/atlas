// The Chief of Staff's brief, assembled from specialist reports. Pure: every input is
// passed in, so the same function builds the stored 9:00 AM / 2:00 PM brief and the
// live preview, and the tests can pin it down.
//
// Each section is a specialist's report in the Standard Agent Report Format:
//   headline · details · needs approval · errors
// The Hot List always comes first: any job with a reply, interview or offer.

import type { Brief } from "./brief";
import { findConflicts, type CalendarAgentResult, type CalendarSection } from "./calendarAgent";
import { prepChecklist } from "./career";
import type { CareerAgentResult, CareerSection } from "./careerAgent";
import type { EmailAgentResult, EmailSection } from "./emailAgent";
import type { FinanceAgentResult, FinanceSection } from "./financeAgent";
import type { PipelineSummary } from "./jobs";
import type { RenewalRow } from "./renewals";
import type { NewsAgentResult, BriefStory } from "./newsAgent";
import type { AgentId, BriefSlot, CareerSnapshot, LocalDate } from "./types";

export { findConflicts };
export type { BriefEvent } from "./calendarAgent";

export interface StandardReport {
  agent: AgentId;
  headline: string;
  details: string[];
  needsApproval: string[];
  errors: string[];
}

export type HotKind = "offer" | "interview" | "reply";

export interface HotItem {
  kind: HotKind;
  company: string;
  role: string;
  detail: string;
  link: string;
}

export interface BriefReport {
  version: 1;
  slot: BriefSlot;
  forDate: LocalDate;
  generatedAt: string;
  headline: string;
  summary: string[];
  source: "rules" | "ai";
  hotList: HotItem[];
  focus: { id: string; title: string }[];
  /** The Calendar Agent's section, with the Applications Agent's prep notes on each interview. */
  calendar: CalendarSection | null;
  /** The Email Agent's section (weekdays). */
  email: EmailSection | null;
  /** The News Agent's stories: 3 per area (tech, U.S. politics, world), 1 each on Saturday. */
  news: BriefStory[];
  bills: { title: string; when: string; kind: string }[];
  jobs: { active: number; interviewing: number; offers: number; followUps: string[] } | null;
  /** The Applications Agent's matches for this brief (weekdays). Added in build step 5. */
  matches?: CareerSection | null;
  /** The Finance Agent's bills, payment alerts and deals (weekdays). Added in build step 6. */
  finance?: FinanceSection | null;
  /** The Mentor's insights for this brief (weekdays), at most two. Added with the Career desk. */
  mentor?: { title: string; body: string; action: string }[];
  reports: StandardReport[];
  /** Anything that failed or was skipped. Shown in the brief, never silently dropped. */
  errors: string[];
}

const HOT_RANK: Record<HotKind, number> = { offer: 0, interview: 1, reply: 2 };
const HOT_WINDOW_DAYS = 14;

/** Jobs that jump above everything else: offers, interviews, then replies. */
export function hotList(snapshot: CareerSnapshot | null, now: Date, timeZone: string): HotItem[] {
  if (!snapshot) return [];
  const recent = (iso: string) => iso !== "" && now.getTime() - Date.parse(iso) <= HOT_WINDOW_DAYS * 86_400_000;
  const items: HotItem[] = [];
  for (const a of snapshot.applications) {
    const kind: HotKind | null = /offer/i.test(a.stage) ? "offer" : /interview/i.test(a.stage) ? "interview" : /repl|recruiter|screen/i.test(a.stage) ? "reply" : null;
    if (!kind) continue;
    const upcoming = snapshot.interviews
      .filter((i) => i.applicationId === a.applicationId && !/^cancel/i.test(i.status) && Date.parse(i.start) >= now.getTime())
      .sort((x, y) => x.start.localeCompare(y.start))[0];
    if (!upcoming && !recent(a.stageUpdatedAt)) continue;
    const when = upcoming
      ? `${upcoming.round} ${new Date(upcoming.start).toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
      : "";
    const next = a.nextAction ? `Next: ${a.nextAction}${a.nextActionDue ? ` (by ${a.nextActionDue})` : ""}` : "";
    items.push({
      kind,
      company: a.company,
      role: a.role,
      detail: [when, next].filter(Boolean).join(" · ") || (kind === "offer" ? "Offer received" : kind === "interview" ? "Interviewing" : "They replied"),
      link: a.postingUrl,
    });
  }
  return items.sort((x, y) => HOT_RANK[x.kind] - HOT_RANK[y.kind]);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A specialist that did not report: paused (skipped) or failed. */
export interface AgentMissing {
  missing: "skipped" | "failed";
  why: string;
}
export type CalendarMissing = AgentMissing;

export interface AssembleInput {
  slot: BriefSlot;
  forDate: LocalDate;
  now: Date;
  timeZone: string;
  brief: Brief;
  /** The Calendar Agent's result, or why it did not report (paused or failed). */
  calendar: CalendarAgentResult | AgentMissing;
  /** The Email Agent's result, why it did not report, or null when the slot has no email (Saturday). */
  email: EmailAgentResult | AgentMissing | null;
  /** The News Agent's result, or why it did not report. */
  news: NewsAgentResult | AgentMissing;
  bills: RenewalRow[];
  pipeline: PipelineSummary | null;
  snapshot: CareerSnapshot | null;
  /** The Applications Agent's result, why it did not report, or null when the slot has no matches (Saturday). */
  career?: CareerAgentResult | AgentMissing | null;
  /** The Finance Agent's result, why it did not report, or null when the slot has no finance section (Saturday). */
  finance?: FinanceAgentResult | AgentMissing | null;
}

export function assembleReport(input: AssembleInput): BriefReport {
  const { slot, forDate, now, timeZone, brief } = input;
  const light = slot === "saturday";
  const errors: string[] = [];
  const reports: StandardReport[] = [];

  // Career: the Hot List from the career tracker, then the Applications Agent's matches.
  const hot = hotList(input.snapshot, now, timeZone);
  const careerErrors: string[] = [];
  let matches: BriefReport["matches"] = null;
  const career = input.career;
  const hotHeadline = hot.length ? `${plural(hot.length, "hot item")}: ${hot.map((h) => h.company).join(", ")}.` : "No replies, interviews or offers waiting.";
  if (career && "missing" in career) {
    const msg = career.missing === "skipped" ? `Applications Agent skipped (${career.why}); no new matches in this brief.` : `Applications Agent failed: ${career.why}`;
    careerErrors.push(msg);
  }
  if (career && !("missing" in career)) matches = career.section;
  if (input.snapshot || hot.length || career) {
    const agentReport = career && !("missing" in career) ? career.report : null;
    reports.push({
      agent: "career",
      headline: agentReport ? `${hotHeadline} ${agentReport.headline}` : hotHeadline,
      details: [...(input.pipeline?.followUps ?? []).map((a) => `Follow up: ${a.company} (${a.role})`), ...(agentReport?.details ?? [])],
      needsApproval: agentReport?.needsApproval ?? [],
      errors: [...careerErrors, ...(agentReport?.errors ?? [])],
    });
    errors.push(...(agentReport?.errors ?? []));
  }
  errors.push(...careerErrors);

  // Calendar: the Calendar Agent's report. For each interview, the Chief of Staff asks the
  // Applications Agent for prep notes (its prep checklist) and puts them alongside.
  let calendar: BriefReport["calendar"] = null;
  const cal = input.calendar;
  if ("missing" in cal) {
    const msg = cal.missing === "skipped" ? `Calendar Agent skipped (${cal.why}); the calendar is left out of this brief.` : `Calendar Agent failed: ${cal.why}`;
    errors.push(msg);
    reports.push({ agent: "calendar", headline: msg, details: [], needsApproval: [], errors: [msg] });
  } else {
    if (cal.section) {
      calendar = { ...cal.section, interviews: (cal.section.interviews ?? []).map((i) => ({ ...i, prep: prepChecklist(i) })) };
    }
    if (cal.status !== "not_configured") reports.push(cal.report);
    errors.push(...cal.report.errors);
  }

  // Email (weekdays): the Email Agent's report.
  let email: BriefReport["email"] = null;
  if (!light && input.email) {
    if ("missing" in input.email) {
      const msg = input.email.missing === "skipped" ? `Email Agent skipped (${input.email.why}); the inbox is left out of this brief.` : `Email Agent failed: ${input.email.why}`;
      errors.push(msg);
      reports.push({ agent: "email", headline: msg, details: [], needsApproval: [], errors: [msg] });
    } else {
      email = input.email.section;
      reports.push(input.email.report);
      errors.push(...input.email.report.errors);
    }
  }

  // News: the News Agent's report.
  let stories: BriefStory[] = [];
  if ("missing" in input.news) {
    const msg = input.news.missing === "skipped" ? `News Agent skipped (${input.news.why}); no stories in this brief.` : `News Agent failed: ${input.news.why}`;
    errors.push(msg);
    reports.push({ agent: "news", headline: msg, details: [], needsApproval: [], errors: [msg] });
  } else {
    stories = input.news.stories;
    reports.push(input.news.report);
    errors.push(...input.news.report.errors);
  }

  // Bills and renewals (Finance), weekdays
  const bills = light ? [] : input.bills.map((r) => ({ title: r.renewal.title, kind: r.renewal.kind, when: r.daysUntil < 0 ? `${-r.daysUntil}d overdue` : r.daysUntil === 0 ? "due today" : `in ${r.daysUntil}d` }));
  // Finance (weekdays): the Finance Agent's report. Before it reports (or in old callers),
  // the Renewals list alone stands in.
  let finance: BriefReport["finance"] = null;
  const fin = light ? null : input.finance;
  if (fin && "missing" in fin) {
    const msg = fin.missing === "skipped" ? `Finance Agent skipped (${fin.why}); only your Renewals list is in this brief.` : `Finance Agent failed: ${fin.why}`;
    errors.push(msg);
    reports.push({ agent: "finance", headline: msg, details: bills.map((b) => `${b.title} ${b.when}`), needsApproval: [], errors: [msg] });
  } else if (fin) {
    finance = fin.section;
    reports.push(fin.report);
    errors.push(...fin.report.errors);
  } else if (bills.length) {
    reports.push({ agent: "finance", headline: `${plural(bills.length, "bill or renewal", "bills or renewals")} coming up.`, details: bills.map((b) => `${b.title} ${b.when}`), needsApproval: [], errors: [] });
  }

  const jobs = light || !input.pipeline ? null : {
    active: input.pipeline.active,
    interviewing: input.pipeline.interviewing,
    offers: input.pipeline.offers,
    followUps: input.pipeline.followUps.map((a) => `${a.company} (${a.role})`),
  };

  const headline = hot[0]
    ? `${hot[0].kind === "offer" ? "Offer" : hot[0].kind === "interview" ? "Interview" : "Reply"} from ${hot[0].company}. ${hot.length > 1 ? `${hot.length - 1} more on the Hot List.` : "Start there."}`
    : brief.headline;

  return {
    version: 1,
    slot,
    forDate,
    generatedAt: now.toISOString(),
    headline,
    summary: brief.summary,
    source: brief.source,
    hotList: hot,
    focus: light ? [] : brief.focus.map((t) => ({ id: t.id, title: t.title })),
    calendar,
    email,
    news: stories,
    bills,
    jobs,
    matches: light ? null : matches,
    finance,
    reports,
    errors,
  };
}

/** Flattened text for brief-history search. */
export function searchText(r: BriefReport): string {
  return [
    r.headline,
    ...r.summary,
    ...r.hotList.map((h) => `${h.company} ${h.role} ${h.detail}`),
    ...(r.calendar?.today.map((e) => e.title) ?? []),
    ...(r.calendar?.important?.map((e) => e.title) ?? []),
    ...(r.calendar?.interviews?.map((i) => `${i.company} ${i.role} ${i.round}`) ?? []),
    ...r.news.map((n) => n.title),
    ...r.bills.map((b) => b.title),
    ...(r.email?.waiting.map((w) => `${w.fromName} ${w.subject}`) ?? []),
    ...(r.email?.jobs?.map((j) => `${j.fromName} ${j.subject}`) ?? []),
    ...[...(r.matches?.fullTime ?? []), ...(r.matches?.gigs ?? [])].map((m) => `${m.title} ${m.company}`),
    ...[...(r.finance?.alerts ?? []), ...(r.finance?.bills ?? [])].map((b) => `${b.name} ${b.subject}`),
    ...(r.finance?.deals ?? []).map((d) => `${d.store} ${d.subject}`),
  ]
    .join("\n")
    .slice(0, 20_000);
}
