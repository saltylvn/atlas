// The QA Agent's weekly review. Pure: every input is passed in, so the same rules run in
// the scheduled review, in tests and in the daily evals.
//
// It reviews Atlas itself, from the records every agent already writes: the activity log,
// saved briefs, eval scores, connections, AI usage, the state of your own queues, and the
// audit trail's records of tokens refused at the machine endpoints. Each
// check either passes or raises a finding: what is wrong, the evidence, and a suggested
// fix. Findings are ranked by severity and compared with last week's review, so you can
// see what is new, what is still open, and what got fixed.
//
// It also keeps the layout in mind (lib/domain/layout.ts): the owner set four main tabs,
// each with one job, and asked for options when the workflow is not smooth. So each review
// counts a week of use per tab, and a tab with something waiting that went untouched
// raises a finding whose fix is a short list of options.
//
// Rules only, no AI model: the reviewer must keep working when the model is the thing
// that is broken. It changes nothing: every fix is for you (or a build session) to make.

import { AGENTS } from "./agents";
import { ROLE_NOT_LISTED } from "./applications";
import { BRIEF_NAME, BRIEF_TIMES, isSyncDay, slotsFor, SYNC_HOURS, SYNC_TASK } from "./briefSchedule";
import { addDays, localDate, localTime, shortDate, weekdayName } from "./dates";
import { LAYOUT_SINCE, tabNotes, type TabUsage } from "./layout";
import { refusedSummary, type RefusedRecord } from "./refusedTokens";
import type { AgentId, AgentRunEvent, BriefSlot, LocalDate } from "./types";

export const QA_TASK = "Weekly QA review";
/** How many days a review looks back, the review day included. */
export const QA_WINDOW_DAYS = 7;
/** A run with no result this long after it started was stopped mid-run. */
const STALLED_AFTER_MS = 6 * 60_000;

// Task names written by other parts of Atlas. Kept as text here so this file stays pure;
// test/qa.test.ts checks each against its source.
export const QA_EVAL_TASK = "Agent evals";
export const QA_AI_CHECK_TASK = "AI connection check";

/** Refused requests in a week before the review raises them. Fewer is a stray call. */
export const QA_REFUSED_MIN = 5;
/** From here it is more than one sweep of the routes: medium. From the second number, a sustained run: high. */
export const QA_REFUSED_MEDIUM = 25;
export const QA_REFUSED_HIGH = 250;

export type QaSeverity = "high" | "medium" | "low";
export type QaArea = "reliability" | "briefs" | "ai" | "evals" | "data" | "pipeline" | "layout" | "security";

export const QA_AREA_LABEL: Record<QaArea, string> = { reliability: "Reliability", briefs: "Briefs", ai: "AI model", evals: "Quality", data: "Fresh data", pipeline: "Your queues", layout: "Layout and workflow", security: "Security" };

export interface QaFinding {
  /** Stable name of what was found, so next week's review can tell new from still open. */
  key: string;
  area: QaArea;
  severity: QaSeverity;
  title: string;
  /** The facts it rests on. Counts, task names and times: never the content of an email or a brief. */
  evidence: string[];
  /** What to do about it. */
  fix: string;
  /** How many weekly reviews in a row have raised it (1 = new this week). */
  weeks: number;
}

/** One check the review ran, whether it passed or not. */
export interface QaCheck {
  area: QaArea;
  name: string;
  ok: boolean;
  note: string;
}

export interface QaReport {
  /** The days reviewed, both included. */
  from: LocalDate;
  to: LocalDate;
  headline: string;
  findings: QaFinding[];
  checks: QaCheck[];
  /** Titles of last review's findings that are gone now. */
  resolved: string[];
  stats: { runs: number; failed: number; stalled: number; aiAnswered: number; aiFellBack: number; briefsSaved: number; briefsExpected: number };
}

/** A review as stored: one per day it was run for. */
export interface StoredQaReport {
  id: string;
  forDate: LocalDate;
  report: QaReport;
  createdAt: string;
}

export interface QaInput {
  today: LocalDate;
  now: Date;
  timeZone: string;
  /** The activity log for the window (a day more is fine). */
  runs: readonly AgentRunEvent[];
  briefs: readonly { forDate: LocalDate; slot: BriefSlot; createdAt: string }[];
  connections: readonly { provider: string; status: "active" | "error"; lastSyncAt: string | null; lastError?: string | null }[];
  applications: readonly { role: string }[];
  approvals: readonly { status: string; createdAt: string }[];
  /** Mentor insights from the last two weeks. */
  insights: readonly { area: string; status: string; forDate: LocalDate }[];
  paused: readonly { agent: AgentId; paused: boolean; updatedAt: string }[];
  /** When each AI call was made (ISO), for the daily limit. */
  aiCalls: readonly string[];
  aiDailyLimit: number;
  aiOn: boolean;
  /** The model asked first and its fallback, when the provider has both. */
  models: { writer: string; fast: string | null } | null;
  /** A week of use per main tab (counts only), or null when it could not be counted. */
  usage?: TabUsage | null;
  /** The audit trail's refused-token records for the window (route, time and counts), or null when it could not be read. */
  refused?: readonly RefusedRecord[] | null;
  /** Last week's review, to tell new findings from open ones. */
  previous: Pick<QaReport, "findings"> | null;
}

const SEVERITY_RANK: Record<QaSeverity, number> = { high: 0, medium: 1, low: 2 };
const AREA_RANK: Record<QaArea, number> = { security: 0, briefs: 1, reliability: 2, ai: 3, data: 4, evals: 5, pipeline: 6, layout: 7 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, n = 180) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const nameOf = (id: AgentId) => AGENTS.find((a) => a.id === id)?.name ?? id;
const dayName = (d: LocalDate) => weekdayName(d).slice(0, 3);

interface Run {
  agent: AgentId;
  task: string;
  status: "succeeded" | "failed" | "skipped" | "stalled" | "running";
  at: string;
  detail: string;
  model: string;
  steps: { name: string; ok: boolean; note: string }[];
}

/** One entry per run: a "started" row and the row that ends it share a run id. */
function pairRuns(rows: readonly AgentRunEvent[], nowMs: number): Run[] {
  const byId = new Map<string, { start?: AgentRunEvent; end?: AgentRunEvent }>();
  for (const r of rows) {
    const slot = byId.get(r.runId) ?? {};
    if (r.status === "started") slot.start ??= r;
    else slot.end ??= r;
    byId.set(r.runId, slot);
  }
  const out: Run[] = [];
  for (const { start, end } of byId.values()) {
    const row = end ?? start!;
    const status: Run["status"] = end ? (end.status as Run["status"]) : nowMs - Date.parse(start!.at) > STALLED_AFTER_MS ? "stalled" : "running";
    out.push({ agent: row.agent, task: row.task, status, at: (start ?? row).at, detail: row.detail ?? "", model: row.model ?? "", steps: (row.trace ?? []).map((s) => ({ name: s.name, ok: s.ok, note: s.note ?? "" })) });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Why a model call gave no answer, from a trace note: "rules ranking (no answer in time)". */
const FELL_BACK = /(?:rules (?:ranking|wording|proposal)|Fell back to the rules-based text) \((.+)\)\s*$/;
const EVAL_NOTE = /^(\d+)\/(\d+) pass \(needs (\d+)%\)(?:\. Missed: (.*))?$/;

export function qaReview(input: QaInput): QaReport {
  const { today, now, timeZone: tz } = input;
  const from = addDays(today, -(QA_WINDOW_DAYS - 1));
  const days = Array.from({ length: QA_WINDOW_DAYS }, (_, i) => addDays(from, i));
  const dayOf = (iso: string) => localDate(new Date(iso), tz);
  const when = (iso: string) => `${dayName(dayOf(iso))} ${localTime(new Date(iso), tz)}`;
  const timeNow = localTime(now, tz);

  const found: Omit<QaFinding, "weeks">[] = [];
  const checks: QaCheck[] = [];
  // At most four lines of evidence; when there is more, the last line says how much.
  const add = (f: Omit<QaFinding, "weeks">) => found.push({ ...f, evidence: (f.evidence.length > 4 ? [...f.evidence.slice(0, 3), `and ${f.evidence.length - 3} more`] : f.evidence).map((e) => clip(e)) });
  const check = (area: QaArea, name: string, ok: boolean, note: string) => checks.push({ area, name, ok, note: clip(note, 160) });

  const all = pairRuns(input.runs.filter((r) => dayOf(r.at) >= from), now.getTime());
  // The review itself and the two self-tests are judged on their own, not as agent work.
  const work = all.filter((r) => r.task !== QA_TASK && r.task !== QA_EVAL_TASK && r.task !== QA_AI_CHECK_TASK && r.status !== "running");

  // ---- reliability: did every agent's runs finish?
  let failed = 0;
  let stalled = 0;
  for (const a of AGENTS) {
    const mine = work.filter((r) => r.agent === a.id && r.status !== "skipped");
    const bad = mine.filter((r) => r.status === "failed" || r.status === "stalled");
    failed += bad.filter((r) => r.status === "failed").length;
    stalled += bad.filter((r) => r.status === "stalled").length;
    if (bad.length === 0) continue;
    const stops = bad.filter((r) => r.status === "stalled").length;
    add({
      key: `runs:${a.id}`,
      area: "reliability",
      severity: bad.length >= 3 || (mine.length >= 4 && bad.length / mine.length >= 0.25) ? "high" : "medium",
      title: `${a.name}: ${bad.length} of ${plural(mine.length, "run")} did not finish`,
      evidence: bad.map((r) => `${when(r.at)} · ${r.task}: ${r.status === "stalled" ? "stopped mid-run, no result logged" : `failed${r.detail ? `: ${r.detail}` : ""}`}`),
      fix: stops
        ? "A run that stops mid-way usually hit its time limit. Open it in Mission Control's activity log: the last step in its trace is where it stopped."
        : "Open the failed run in Mission Control's activity log: its trace names the step that failed.",
    });
  }
  const counted = work.filter((r) => r.status !== "skipped").length;
  check("reliability", "Every agent's runs finished", failed + stalled === 0, `${plural(counted, "run")}: ${failed} failed, ${stalled} stopped mid-run`);

  // ---- reliability: the 2-hour sync kept its schedule
  const thin: string[] = [];
  for (const d of days.filter(isSyncDay)) {
    const expected = d === today ? SYNC_HOURS.filter((h) => `${String(h + 1).padStart(2, "0")}:00` <= timeNow).length : SYNC_HOURS.length;
    if (expected < 2) continue;
    const ran = work.filter((r) => r.task === SYNC_TASK && r.status === "succeeded" && dayOf(r.at) === d).length;
    if (ran < Math.ceil(expected / 2)) thin.push(`${dayName(d)}: ${ran} of ${expected} syncs`);
  }
  if (thin.length)
    add({ key: "sync:thin", area: "reliability", severity: thin.length >= 3 ? "high" : "medium", title: `The 2-hour sync ran too few times on ${plural(thin.length, "day")}`, evidence: thin, fix: "Check the cron runs in Vercel (Project → Cron Jobs) and the sync's runs in Mission Control. Sync now brings the pages up to date meanwhile." });
  check("reliability", "The 2-hour sync kept its schedule", thin.length === 0, thin.length ? thin.join("; ") : "Ran on schedule every sync day");

  // ---- briefs: saved, and on time
  const missing: string[] = [];
  const late: string[] = [];
  let expectedBriefs = 0;
  for (const d of days) {
    for (const slot of slotsFor(d)) {
      if (d === today && BRIEF_TIMES[slot] > timeNow) continue;
      expectedBriefs++;
      const saved = input.briefs.find((b) => b.forDate === d && b.slot === slot);
      if (!saved) missing.push(`${dayName(d)} · ${BRIEF_NAME[slot]}`);
      else if (dayOf(saved.createdAt) > d || localTime(new Date(saved.createdAt), tz) > BRIEF_TIMES[slot]) late.push(`${dayName(d)} · ${BRIEF_NAME[slot]}: ready ${when(saved.createdAt)}, due ${BRIEF_TIMES[slot]}`);
    }
  }
  if (missing.length)
    add({ key: "briefs:missing", area: "briefs", severity: "high", title: `${plural(missing.length, "brief")} ${missing.length === 1 ? "was" : "were"} not saved`, evidence: missing, fix: "Check that run's trace in Mission Control for the step that stopped it. Today's can still be saved from Today (Save the brief); an earlier day's cannot." });
  if (late.length)
    add({ key: "briefs:late", area: "briefs", severity: late.length >= 3 ? "medium" : "low", title: `${plural(late.length, "brief")} ${late.length === 1 ? "was" : "were"} ready after ${late.length === 1 ? "its" : "their"} time`, evidence: late, fix: "A late brief was usually saved by hand after its scheduled run failed. The run's trace says why it failed." });
  check("briefs", "Every brief was saved, on time", missing.length + late.length === 0, `${expectedBriefs - missing.length} of ${expectedBriefs} saved${late.length ? `, ${late.length} late` : ""}`);

  // ---- AI: did the model answer when asked?
  let aiAnswered = 0;
  let aiFellBack = 0;
  if (!input.aiOn) check("ai", "The AI model answered when asked", true, "AI is off: every agent uses its rules");
  else {
    const reasons = new Map<string, number>();
    const who = new Map<string, number>();
    const answeredBy = new Map<string, number>();
    for (const r of work) {
      const why = r.steps.map((s) => FELL_BACK.exec(s.note)?.[1]).filter((x): x is string => Boolean(x));
      if (r.model) {
        aiAnswered++;
        answeredBy.set(r.model, (answeredBy.get(r.model) ?? 0) + 1);
      }
      for (const w of why) {
        aiFellBack++;
        reasons.set(w, (reasons.get(w) ?? 0) + 1);
        who.set(nameOf(r.agent), (who.get(nameOf(r.agent)) ?? 0) + 1);
      }
    }
    const asked = aiAnswered + aiFellBack;
    const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (aiFellBack >= 2 && aiFellBack / asked >= 0.3)
      add({
        key: "ai:fallbacks",
        area: "ai",
        severity: aiFellBack / asked >= 0.6 ? "high" : "medium",
        title: `The AI model gave no answer ${aiFellBack} of ${asked} times, so agents used their rules`,
        evidence: [`Why: ${top(reasons).slice(0, 3).map(([w, n]) => `${n}× ${w}`).join(", ")}`, `Who fell back: ${top(who).map(([w, n]) => `${w} ${n}×`).join(", ")}`],
        fix: "Press Check the connection on Mission Control's AI card to see which model fails and why. If the model asked first is the one failing, make the one that answers the first choice (ATLAS_GEMINI_MODEL_WRITER in Vercel).",
      });
    check("ai", "The AI model answered when asked", !(aiFellBack >= 2 && aiFellBack / Math.max(1, asked) >= 0.3), asked ? `Answered ${aiAnswered} of ${asked} times` : "Not asked this week");

    const writer = input.models?.writer;
    const byFallback = writer && input.models?.fast ? aiAnswered - (answeredBy.get(writer) ?? 0) : 0;
    if (writer && aiAnswered >= 4 && byFallback / aiAnswered > 0.5)
      add({
        key: "ai:fallback-model",
        area: "ai",
        severity: "low",
        title: `The fallback model wrote ${byFallback} of ${aiAnswered} answers`,
        evidence: top(answeredBy).map(([m, n]) => `${m}: ${n}`),
        fix: `Nothing is broken: every call still got an answer. If ${writer} keeps failing, make the model that answers the first choice (ATLAS_GEMINI_MODEL_WRITER in Vercel), so calls stop waiting on it.`,
      });
    check("ai", "The model asked first did the writing", !(writer && aiAnswered >= 4 && byFallback / aiAnswered > 0.5), writer ? `${writer}: ${answeredBy.get(writer) ?? 0} of ${aiAnswered} answers` : "One model in use");

    const lastCheck = all.filter((r) => r.task === QA_AI_CHECK_TASK && r.status !== "running").at(-1);
    // Only the models in use count: a watched model that is not in use only informs.
    const down = (lastCheck?.steps ?? []).filter((s) => !s.ok && /^(Writer|Fast): /.test(s.name));
    if (lastCheck && down.length)
      add({
        key: "ai:check",
        area: "ai",
        severity: down.some((s) => s.name.startsWith("Fast")) ? "medium" : "low",
        title: `At the last connection check, ${down.map((s) => s.name.replace(/^(Writer|Fast): /, "")).join(" and ")} did not answer`,
        evidence: down.map((s) => `${s.name.replace(/^(Writer|Fast): /, "")}: ${s.note}`).concat(`Checked ${when(lastCheck.at)}`),
        fix: "Run Check the connection again. A model that is busy on the free tier often comes back; one that stays down should not be the first choice.",
      });
    check("ai", "The last connection check passed", !down.length, lastCheck ? (down.length ? `${down.length} model${down.length === 1 ? "" : "s"} did not answer` : `Passed ${when(lastCheck.at)}`) : "No check this week");

    const perDay = new Map<string, number>();
    for (const at of input.aiCalls) if (at.slice(0, 10) >= from) perDay.set(at.slice(0, 10), (perDay.get(at.slice(0, 10)) ?? 0) + 1);
    const busiest = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
    const near = Boolean(busiest && input.aiDailyLimit > 0 && busiest[1] >= input.aiDailyLimit * 0.8);
    if (near)
      add({ key: "ai:limit", area: "ai", severity: busiest![1] >= input.aiDailyLimit ? "medium" : "low", title: `AI calls came close to the daily limit: ${busiest![1]} of ${input.aiDailyLimit}`, evidence: [`Busiest day: ${dayName(busiest![0])} (${busiest![0]}, UTC)`], fix: "Past the limit every agent uses its rules until the next day. Raise ATLAS_AI_DAILY_LIMIT in Vercel if the calls were ones you wanted." });
    check("ai", "AI calls stayed under the daily limit", !near, busiest ? `Busiest day: ${busiest[1]} of ${input.aiDailyLimit}` : "No AI calls this week");
  }

  // ---- quality: the daily evals
  const evalRuns = input.runs.filter((r) => r.task === QA_EVAL_TASK && r.status !== "started" && dayOf(r.at) >= from).sort((a, b) => a.at.localeCompare(b.at));
  const suitesOf = (r: AgentRunEvent) =>
    new Map(
      (r.trace ?? []).flatMap((s) => {
        const m = EVAL_NOTE.exec(s.note ?? "");
        return m ? [[s.name, { passed: Number(m[1]), total: Number(m[2]), needs: Number(m[3]), missed: m[4] ? m[4].split("; ") : [] }] as const] : [];
      }),
    );
  if (evalRuns.length === 0) {
    add({ key: "evals:none", area: "evals", severity: "medium", title: "The daily evals did not run this week", evidence: ["No eval run in the activity log for the last 7 days"], fix: "They run before each scheduled morning brief. Open Evals and press Run now; if the morning brief is failing, fix that first." });
    check("evals", "Every agent's rules kept their score", false, "No eval run this week");
  } else {
    const first = suitesOf(evalRuns[0]!);
    const last = suitesOf(evalRuns.at(-1)!);
    let slipped = 0;
    for (const [name, s] of last) {
      const before = first.get(name);
      if (s.total && (s.passed / s.total) * 100 < s.needs) {
        slipped++;
        add({ key: `evals:below:${name}`, area: "evals", severity: "high", title: `${name} is below its bar: ${s.passed}/${s.total}, needs ${s.needs}%`, evidence: s.missed.slice(0, 3).map((m) => `Missed: ${m}`), fix: "Open Evals for the failing cases. A change made this agent worse, or a new case shows a real gap in its rules." });
      } else if (before && before.total === s.total && s.passed < before.passed) {
        slipped++;
        add({ key: `evals:drop:${name}`, area: "evals", severity: "medium", title: `${name} got worse this week: ${before.passed} to ${s.passed} of ${s.total}`, evidence: s.missed.filter((m) => !before.missed.includes(m)).slice(0, 3).map((m) => `Newly missed: ${m}`), fix: "Open Evals and compare with the start of the week: a change this week broke these cases." });
      } else if (s.missed.length && evalRuns.length >= 3 && evalRuns.every((r) => (suitesOf(r).get(name)?.missed.length ?? 0) > 0)) {
        add({ key: `evals:misses:${name}`, area: "evals", severity: "low", title: `${name}: ${plural(s.missed.length, "case")} failed all week`, evidence: s.missed.slice(0, 3).map((m) => `Missed: ${m}`), fix: "Each is a rule worth improving or a known limit to accept. The Evals page shows what the rules answered and what a person would." });
      }
    }
    const score = [...last.values()].reduce((a, s) => ({ p: a.p + s.passed, t: a.t + s.total }), { p: 0, t: 0 });
    check("evals", "Every agent's rules kept their score", slipped === 0, `${score.p}/${score.t} cases pass across ${plural(last.size, "suite")}, ${plural(evalRuns.length, "eval run")} this week`);
  }

  // ---- fresh data: connections
  for (const c of input.connections) {
    const label = c.provider === "gmail_imap" || c.provider === "google" ? "Gmail" : c.provider;
    const age = c.lastSyncAt ? (now.getTime() - Date.parse(c.lastSyncAt)) / 3_600_000 : Infinity;
    if (c.status === "error") add({ key: `conn:error:${c.provider}`, area: "data", severity: "high", title: `The ${label} connection has an error`, evidence: [c.lastError ? clip(c.lastError, 160) : "The last sync failed", c.lastSyncAt ? `Last good sync ${when(c.lastSyncAt)}` : "Never synced"], fix: "Open Connectors and reconnect it. Until then Inbox and the Applications tracker read old email." });
    else if (age > 50) add({ key: `conn:stale:${c.provider}`, area: "data", severity: "medium", title: `${label} has not synced for ${Math.floor(age / 24)} days`, evidence: [c.lastSyncAt ? `Last sync ${when(c.lastSyncAt)}` : "Never synced"], fix: "Press Sync now in Mission Control. If it fails, the Email Agent's run trace says why." });
  }
  const badConn = found.filter((f) => f.key.startsWith("conn:")).length;
  check("data", "Connections are healthy and fresh", badConn === 0, input.connections.length ? (badConn ? `${badConn} of ${input.connections.length} need attention` : `${plural(input.connections.length, "connection")} synced within two days`) : "No connection set up");

  // ---- your queues
  const unnamed = input.applications.filter((a) => a.role === ROLE_NOT_LISTED).length;
  if (unnamed) add({ key: "data:roles", area: "pipeline", severity: unnamed >= 5 ? "medium" : "low", title: `${plural(unnamed, "application")} still ${unnamed === 1 ? "has" : "have"} no role`, evidence: [`${unnamed} of ${input.applications.length} on the Applications board say "${ROLE_NOT_LISTED}"`], fix: "Type each once under Applications → Fill in the role. Results by role, follow-ups and the Mentor all need it." });
  check("pipeline", "Every application names its role", unnamed === 0, `${input.applications.length - unnamed} of ${input.applications.length} named`);

  const waitDays = (iso: string) => Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000);
  const old = input.approvals.filter((a) => a.status === "pending" && waitDays(a.createdAt) > 3);
  if (old.length) {
    const oldest = Math.max(...old.map((a) => waitDays(a.createdAt)));
    add({ key: "queue:old", area: "pipeline", severity: old.length >= 5 || oldest >= 7 ? "medium" : "low", title: `${plural(old.length, "item")} in your apply queue ${old.length === 1 ? "has" : "have"} waited more than 3 days`, evidence: [`Oldest: ${plural(oldest, "day")}`, `${input.approvals.filter((a) => a.status === "pending").length} waiting in all`], fix: "Clear the oldest first. A 👎 on a job you no longer want takes it out, so the queue stays honest." });
  }
  check("pipeline", "Nothing has waited long in your apply queue", old.length === 0, `${input.approvals.filter((a) => a.status === "pending").length} waiting, ${old.length} for more than 3 days`);

  const dismissed = new Map<string, number>();
  for (const i of input.insights) if (i.status === "dismissed" && i.forDate >= addDays(today, -13)) dismissed.set(i.area, (dismissed.get(i.area) ?? 0) + 1);
  const tuned = [...dismissed.entries()].filter(([, n]) => n >= 3);
  for (const [area, n] of tuned) add({ key: `mentor:dismissed:${area}`, area: "pipeline", severity: "low", title: `You dismissed ${n} Mentor insights about ${area} in two weeks`, evidence: [`${n} marked Not useful`], fix: "The Mentor's rule for this subject is probably off for you. Note what was wrong with the next one, and the rule can be tuned." });
  check("pipeline", "The Mentor's insights are landing", tuned.length === 0, tuned.length ? `Often dismissed: ${tuned.map(([a]) => a).join(", ")}` : "No subject dismissed three times");

  const longPaused = input.paused.filter((p) => p.paused && waitDays(p.updatedAt) >= 7);
  for (const p of longPaused) add({ key: `paused:${p.agent}`, area: "reliability", severity: "low", title: `${nameOf(p.agent)} has been paused for ${plural(waitDays(p.updatedAt), "day")}`, evidence: [`Paused since ${when(p.updatedAt)}`], fix: "Resume it in Mission Control if the pause was not meant to last." });
  check("reliability", "No agent was left paused", longPaused.length === 0, longPaused.length ? longPaused.map((p) => nameOf(p.agent)).join(", ") : "None paused for a week");

  // ---- security: tokens refused at the machine endpoints (lib/domain/refusedTokens.ts)
  const REFUSED_CHECK = "No run of refused tokens at the machine endpoints";
  if (!input.refused) check("security", REFUSED_CHECK, true, "The audit trail was not read this week");
  else {
    // Each row is read as data: only its time, its route and the counts it holds.
    const week = refusedSummary(input.refused.filter((r) => !Number.isNaN(Date.parse(r.at)) && dayOf(r.at) >= from));
    const raised = week.refused >= QA_REFUSED_MIN;
    if (raised) {
      const rest = week.refused - week.missing - week.wrong;
      add({
        key: "security:refused-tokens",
        area: "security",
        severity: week.refused >= QA_REFUSED_HIGH ? "high" : week.refused >= QA_REFUSED_MEDIUM ? "medium" : "low",
        // A floor: the count is kept per server instance, and one that is recycled takes its unwritten tail with it.
        title: `At least ${week.refused} requests to the machine endpoints were refused: no token, or a wrong one`,
        evidence: [
          `${plural(week.records, "record")} in the audit trail: ${week.missing} with no token, ${week.wrong} with a wrong token${rest > 0 ? `, ${rest} not broken down` : ""}`,
          week.routes.map((r) => `${r.route}: ${r.refused}`).join(" · "),
          `First ${when(week.first!)}, last ${when(week.last!)}`,
        ],
        fix: "A refused request got nothing: each token is 32 or more random characters, compared in constant time. If these were yours (a Shortcut or a scheduled job holding an old token), update the token there. If not, add the Vercel Firewall rate-limit rule for /api/* (Yours to do in docs/SECURITY-REVIEW.md), and rotate that route's token if wrong ones keep arriving (the table in docs/SECURITY.md).",
      });
    }
    check("security", REFUSED_CHECK, !raised, week.refused ? `${plural(week.refused, "request")} refused in ${plural(week.records, "record")}${raised ? "" : `, under the ${QA_REFUSED_MIN} that raise a finding`}` : "No token was refused this week");
  }

  // ---- layout and workflow: was each main tab used? (the owner's four tabs, lib/domain/layout.ts)
  if (!input.usage) check("layout", "Each main tab was used", true, "Use per tab was not counted this week");
  else if (from < LAYOUT_SINCE) check("layout", "Each main tab was used", true, `The layout changed on ${shortDate(LAYOUT_SINCE)}: the first full week is reviewed next`);
  else {
    const notes = tabNotes(input.usage);
    for (const t of notes) {
      if (!t.unused) continue;
      // A habit, not a fault: low, until the same tab goes unused three reviews running.
      const weeksBefore = input.previous?.findings.find((f) => f.key === `layout:${t.tab}`)?.weeks ?? 0;
      add({ key: `layout:${t.tab}`, area: "layout", severity: weeksBefore >= 2 ? "medium" : "low", title: t.unused.title, evidence: t.unused.evidence, fix: t.unused.options });
    }
    check("layout", "Each main tab was used", notes.every((t) => !t.unused), notes.map((t) => t.line).join(" · "));
  }

  // ---- rank, and compare with last week
  const before = new Map((input.previous?.findings ?? []).map((f) => [f.key, f]));
  const findings: QaFinding[] = found
    .map((f) => ({ ...f, weeks: (before.get(f.key)?.weeks ?? 0) + 1 }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || AREA_RANK[a.area] - AREA_RANK[b.area] || a.key.localeCompare(b.key))
    .slice(0, 24);
  const keys = new Set(findings.map((f) => f.key));
  const resolved = (input.previous?.findings ?? []).filter((f) => !keys.has(f.key)).map((f) => clip(f.title, 140)).slice(0, 12);

  const n = (s: QaSeverity) => findings.filter((f) => f.severity === s).length;
  const passed = checks.filter((c) => c.ok).length;
  const headline = findings.length
    ? `${plural(findings.length, "finding")}: ${[n("high") && `${n("high")} high`, n("medium") && `${n("medium")} medium`, n("low") && `${n("low")} low`].filter(Boolean).join(", ")}. ${passed} of ${checks.length} checks passed.`
    : `All ${checks.length} checks passed.`;

  return { from, to: today, headline, findings, checks, resolved, stats: { runs: counted, failed, stalled, aiAnswered, aiFellBack, briefsSaved: expectedBriefs - missing.length, briefsExpected: expectedBriefs } };
}

/** The findings worth a note on Today: high severity, from a review at most two days old. */
export function qaAlerts(report: Pick<QaReport, "findings" | "to"> | null, today: LocalDate): QaFinding[] {
  if (!report || report.to < addDays(today, -2)) return [];
  return report.findings.filter((f) => f.severity === "high");
}
