import "server-only";
import { randomUUID } from "node:crypto";
import type { Context } from "@/lib/context";
import { takeAiCallWithin } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import { BriefRewrite } from "@/lib/ai/prompts";
import { loadBrief, type BriefBundle } from "@/lib/briefing";
import { interviewsFrom, type CalendarAgentResult } from "@/lib/domain/calendarAgent";
import { assembleReport, searchText, type AgentMissing, type BriefReport } from "@/lib/domain/chiefOfStaff";
import { longDate } from "@/lib/domain/dates";
import { AFTER_WORDING_MS, aiCap, FUNCTION_LIMIT_MS, modelWait } from "@/lib/domain/deadline";
import type { CareerAgentResult } from "@/lib/domain/careerAgent";
import type { EmailAgentResult } from "@/lib/domain/emailAgent";
import type { FinanceAgentResult } from "@/lib/domain/financeAgent";
import type { NewsAgentResult } from "@/lib/domain/newsAgent";
import { SLOT_LABEL } from "@/lib/domain/briefSchedule";
import type { Store } from "@/lib/data/store";
import type { AgentId, AgentRunEvent, BriefSlot } from "@/lib/domain/types";
import { sendToAll } from "@/lib/push";
import { calendarAgentWork, runCalendarAgent } from "./calendar";
import { runCareerAgent, storedMatches } from "./career";
import { runAnalyst } from "./analyst";
import { runMentor } from "./mentor";
import { emailAgentWork, runEmailAgent } from "./email";
import { financeAgentWork, runFinanceAgent } from "./finance";
import { instructions } from "./instructions";
import { newsAgentWork, runNewsAgent } from "./news";
import { watchdog } from "./watchdog";
import { isPaused, logRun, NO_MODEL } from "./log";
import { tracer } from "./trace";

// The Chief of Staff at run time: gather the specialists' inputs, assemble the brief in
// the Standard Agent Report Format, let Claude (writer tier) word the headline and
// summary when allowed, save it to brief history, log every step, and ping the phone.

type Trigger = AgentRunEvent["trigger"];

/** The live specialists' logged results, passed in by the Chief of Staff's run. */
export interface SpecialistResults {
  calendar: CalendarAgentResult | AgentMissing;
  news: NewsAgentResult | AgentMissing;
  /** Null on Saturday: the light brief has no email section. */
  email: EmailAgentResult | AgentMissing | null;
  /** Null on Saturday: the light brief has no job matches. */
  career: CareerAgentResult | AgentMissing | null;
  /** Null on Saturday: the light brief has no finance section. Optional for older callers. */
  finance?: FinanceAgentResult | AgentMissing | null;
}

/**
 * Builds the brief for a slot without saving anything. The Chief of Staff's run passes in
 * the specialists' logged results; Today's live preview leaves them out, and their work
 * then runs here unlogged.
 */
export async function buildBriefReport(ctx: Context, slot: BriefSlot, preloaded?: BriefBundle, specialists?: SpecialistResults): Promise<BriefReport> {
  const { settings, today, now } = ctx;
  const bundle = preloaded ?? (await loadBrief(ctx));
  const [calendar, news, email, career, finance] = await Promise.all([
    specialists?.calendar ?? calendarAgentWork(ctx, slot, interviewsFrom(bundle.snapshot)),
    specialists?.news ?? newsAgentWork(ctx, slot),
    specialists ? specialists.email : slot === "saturday" ? null : emailAgentWork(ctx, slot, null),
    // The preview shows matches already stored for this brief; it never fetches job feeds.
    specialists ? specialists.career : slot === "saturday" ? null : storedMatches(ctx, slot).catch(() => null),
    specialists ? (specialists.finance ?? null) : slot === "saturday" ? null : financeAgentWork(ctx).catch(() => null),
  ]);

  return assembleReport({
    slot,
    forDate: today,
    now,
    timeZone: settings.timezone,
    brief: bundle.brief,
    calendar,
    news,
    email,
    bills: bundle.renewalsDue,
    pipeline: bundle.pipeline,
    snapshot: bundle.snapshot,
    career,
    finance,
  });
}

export type RunOutcome =
  | { status: "succeeded"; report: BriefReport; costUsd: number }
  | { status: "skipped"; why: string }
  | { status: "failed"; why: string };

/**
 * One Chief of Staff run for a brief slot. `trigger` is "schedule" (the cron) or
 * "run-now" (Mission Control). A paused agent skips scheduled runs; Run Now still runs.
 */
/**
 * `service` is the owner-scoped service store in live mode: the Email Agent syncs Gmail
 * with it and the Applications Agent stores matches with it (the owner's session may only read
 * the inbox and rate matches). Null in demo mode, where the demo store does both.
 */
export async function runChiefOfStaff(ctx: Context, slot: BriefSlot, trigger: Trigger, opts: { service: Store | null } = { service: null }): Promise<RunOutcome> {
  // The function is stopped at its time limit, mid-step. Every model call in this run waits
  // only for the time left (the scheduler sets the deadline when it calls; Run Now starts here).
  ctx = { ...ctx, deadline: ctx.deadline ?? Date.now() + FUNCTION_LIMIT_MS };
  const agent: AgentId = "chief-of-staff";
  const runId = randomUUID();
  const task = SLOT_LABEL[slot];

  if (trigger === "schedule" && (await isPaused(ctx, agent))) {
    await logRun(ctx, { runId, agent, task, status: "skipped", trigger, detail: "Paused in Mission Control", ...NO_MODEL });
    return { status: "skipped", why: "paused" };
  }

  await logRun(ctx, { runId, agent, task, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  const stopWatchdog = watchdog(ctx, { runId, agent, task, trigger }, t);
  // What a specialist reported, for the trace: its headline, or why it did not report.
  const said = (r: { report: { headline: string } } | AgentMissing | null) => (!r ? "not part of this brief" : "missing" in r ? `${r.missing}: ${r.why}` : r.report.headline);
  try {
    // Specialists report first, each with only the context it needs: the Email Agent reads
    // the inbox (weekdays), the Calendar Agent gets the tracked interviews, the News Agent
    // reads its own feeds. The inbox syncs before the brief's other inputs are gathered.
    const email = slot === "saturday" ? null : await t.step("Ask the Email bot", () => runEmailAgent(ctx, slot, { trigger, honorPause: true, sync: opts.service }), said);
    const bundle = await t.step("Gather tasks, people, renewals and the career tracker", () => loadBrief(ctx), (b) => `${b.renewalsDue.length} renewals due, ${b.snapshot?.applications.length ?? 0} tracked applications`);
    // The Analyst needs nothing from the others (it reads what the Scout recorded at the
    // syncs), so it works alongside them. Its report is reused within a day.
    const persist = opts.service ?? ctx.store;
    const analystRun = slot === "saturday" ? Promise.resolve(null) : t.step("Ask the Analyst", () => runAnalyst(ctx, { trigger, honorPause: true, persist, reuseToday: trigger === "schedule" || slot !== "morning" }), said);
    const [calendar, news, career, finance] = await Promise.all([
      t.step("Ask the Calendar bot", () => runCalendarAgent(ctx, slot, { trigger, interviews: interviewsFrom(bundle.snapshot), honorPause: true }), said),
      t.step("Ask the News bot", () => runNewsAgent(ctx, slot, { trigger, honorPause: true }), said),
      slot === "saturday" ? Promise.resolve(null) : t.step("Ask the Applications bot", () => runCareerAgent(ctx, slot, { trigger, honorPause: true, persist: opts.service ?? ctx.store }), said),
      // The Finance Agent reads the inbox the Email Agent just synced.
      slot === "saturday" ? Promise.resolve(null) : t.step("Ask the Finance bot", () => runFinanceAgent(ctx, { trigger, honorPause: true }), said),
    ]);
    // The Career Mentor goes last: it reviews everything, including the Analyst's report and
    // what the Applications Agent just did. Weekdays only.
    const analyst = await analystRun;
    const mentor = slot === "saturday" ? null : await t.step("Ask the Career Mentor", () => runMentor(ctx, slot === "afternoon" ? "midday" : "morning", { trigger, honorPause: true, persist }), said);

    const report = await t.step(
      "Assemble the brief, Hot List first",
      () => buildBriefReport(ctx, slot, bundle, { calendar, news, email, career, finance }),
      (r) => `${r.hotList.length} on the Hot List, ${r.reports.length} specialist reports, ${r.errors.length} problems reported in the brief`,
    );
    // The desk reports like every specialist: a failure is named, never dropped.
    for (const [name, r] of [["Analyst", analyst], ["Career Mentor", mentor]] as const) {
      if (!r) continue;
      if ("missing" in r) {
        if (r.missing === "failed") report.errors.push(`${name} failed: ${r.why}`);
      } else report.reports.push(r.report);
    }
    if (mentor && !("missing" in mentor) && mentor.insights.length > 0) report.mentor = mentor.insights.map((i) => ({ title: i.title, body: i.body, action: i.action }));

    // Saved before the model words it: if the model is slow and the run is stopped, the
    // rules-based brief is already on Today, with its Briefed button.
    const save = () => ctx.store.briefs.save({ forDate: ctx.today, slot, headline: report.headline.slice(0, 300), report, search: searchText(report) });
    await t.step("Save the brief to history", save);

    // The model words the headline and summary (writer tier) when AI is on, under budget,
    // and the run has time left to wait for it.
    let usage: { model: string; inputTokens: number; outputTokens: number; costUsd: number } = NO_MODEL;
    const wait = modelWait(aiCap(ctx, 25_000), ctx.deadline, Date.now(), AFTER_WORDING_MS);
    const gate = await takeAiCallWithin(ctx.store, ctx.settings, `brief:${slot}`, wait);
    if (!gate.allowed) t.note("Word the headline and summary", `Rules-based wording: ${gate.why} No model call, $0.`);
    if (gate.allowed) {
      const wordingStarted = Date.now();
      const res = await structuredWithin(
        wait,
        BriefRewrite,
        `${instructions(agent)}\n\nRewrite the ${task} below. Keep every fact; add none. Return a headline (one sentence, at most 14 words) and 3 to 6 summary lines.`,
        JSON.stringify({
          owner: ctx.settings.displayName,
          date: longDate(ctx.today),
          brief: task,
          draftHeadline: report.headline,
          draftSummary: report.summary,
          hotList: report.hotList,
          calendarToday: report.calendar?.today.map((e) => ({ title: e.title, start: e.start, allDay: e.allDay, important: e.important ?? null })) ?? [],
          keepInMind: report.calendar?.important?.filter((e) => e.day !== ctx.today).map((e) => ({ day: e.day, title: e.title, kind: e.kind })) ?? [],
          conflicts: report.calendar?.conflicts ?? [],
          errors: report.errors,
        }),
        { tier: "writer", effort: "low" },
      );
      if (res.usage) usage = { model: res.usage.model, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, costUsd: res.usage.costUsd };
      if (res.ok) {
        report.headline = res.value.headline;
        report.summary = res.value.summary;
        report.source = "ai";
      } else {
        report.errors.push(`${aiName()} could not word the brief (${whyNoAnswer(res)}); the rules-based text is shown.`);
      }
      t.note(`Word the headline and summary with ${aiName()} (${Date.now() - wordingStarted} ms)`, res.ok ? `${usage.inputTokens} tokens in, ${usage.outputTokens} out` : `Fell back to the rules-based text (${whyNoAnswer(res)})`, res.ok);
      await t.step(res.ok ? "Save the model's wording" : "Save the note that the model could not word it", save);
    }

    const detail = [
      report.hotList.length ? `${report.hotList.length} hot` : "",
      report.calendar ? `${report.calendar.today.length} events today` : "",
      `${report.news.length} stories`,
      report.errors.length ? `${report.errors.length} errors` : "",
    ]
      .filter(Boolean)
      .join(", ");
    stopWatchdog();
    await logRun(ctx, { runId, agent, task, status: "succeeded", trigger, detail, ...usage, ...t.finish() });

    // The phone ping is for scheduled briefs; a manual run happens with the app open.
    if (trigger === "schedule" && ctx.settings.outboundEnabled) {
      await sendToAll(ctx.store, { title: report.headline, body: `${task} is ready in Atlas.`, url: "/" }).catch(() => undefined);
    }
    return { status: "succeeded", report, costUsd: usage.costUsd };
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    stopWatchdog();
    await logRun(ctx, { runId, agent, task, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { status: "failed", why };
  }
}
