import "server-only";
import { randomUUID } from "node:crypto";
import { takeAiCall } from "@/lib/ai/budget";
import { aiName, structuredWithin, whyNoAnswer } from "@/lib/ai/model";
import { applyAngleData, applyAngleTask } from "@/lib/ai/prompts";
import { audit } from "@/lib/audit";
import type { Context } from "@/lib/context";
import type { Store } from "@/lib/data/store";
import type { AgentMissing } from "@/lib/domain/chiefOfStaff";
import { applyBrief, briefSince } from "@/lib/domain/applyBrief";
import {
  AngleOut,
  angleFacts,
  BRIEF_DAILY,
  BRIEF_PER_RUN,
  checkAngle,
  companyNewsUrl,
  companyPages,
  kitPeople,
  newsFrom,
  peopleSearchUrl,
  researchedToday,
  rulesAngle,
  type BriefResearch,
} from "@/lib/domain/briefResearch";
import { contactForCompany } from "@/lib/domain/career";
import { ANSWER_BANK } from "@/lib/domain/careerPrep";
import { countReads, readsLeft } from "@/lib/domain/postingFacts";
import type { AgentRunEvent, Approval, NewsItem } from "@/lib/domain/types";
import { firecrawlConfigured, READ_HELP, searchWeb, type WebSearcher } from "@/lib/integrations/firecrawl";
import { parseFeed } from "@/lib/integrations/rss";
import { safeFetchText } from "@/lib/security/safeFetch";
import { logRun, NO_MODEL } from "./log";
import { NO_TRACE, tracer, type Tracer } from "./trace";

// The Applications Agent researching the jobs in your Apply Queue for their apply brief
// (lib/domain/briefResearch.ts): the company's last month of news (Google News RSS, free), its
// own pages (one Firecrawl search, inside the shared reading budget and at most 10 briefs a day),
// and an angle for your application from Gemini, checked by rules. It runs after a 👍, at the
// 2-hour sync for kits with none yet, and when you press Research this company. It changes
// nothing outside Atlas, and never reads LinkedIn.

export const RESEARCH_TASK = "Research the jobs in your Apply Queue";
const NEWS_TIMEOUT_MS = 8_000;
const MODEL_WAIT_MS = 20_000;

export interface ResearchDeps {
  news?: (url: string) => Promise<NewsItem[]>;
  search?: WebSearcher;
  angle?: (task: string, data: string) => Promise<{ ok: true; value: AngleOut } | { ok: false; why: string }>;
}

export interface ResearchResult {
  researched: number;
  waiting: number;
  skipped?: string;
}

const readNews = async (url: string): Promise<NewsItem[]> => parseFeed(await safeFetchText(url, { revalidate: 3600, maxBytes: 2_000_000, timeoutMs: NEWS_TIMEOUT_MS }), "tech", "Google News", 20);

const askModel = async (task: string, data: string): Promise<{ ok: true; value: AngleOut } | { ok: false; why: string }> => {
  const r = await structuredWithin(MODEL_WAIT_MS, AngleOut, task, data);
  return r.ok ? { ok: true, value: r.value } : { ok: false, why: whyNoAnswer(r) };
};

/** Application kits waiting in the Apply Queue that have no research yet (or the one asked for, again). */
export async function kitsToResearch(persist: Store, only?: string): Promise<Approval[]> {
  const kits = (await persist.approvals.list()).filter((a) => a.kind === "application" && a.status === "pending" && a.matchId && (!only || a.id === only));
  if (only) return kits;
  const done = await persist.applyBriefs.forKits(kits.map((k) => k.id));
  return kits.filter((k) => !done.has(k.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Researches up to `limit` kits. Never throws for one company's failure: it notes it and goes on. */
export async function researchWork(
  ctx: Pick<Context, "store" | "settings" | "today" | "now">,
  persist: Store,
  opts: { only?: string; limit?: number; deps?: ResearchDeps } = {},
  t: Tracer = NO_TRACE,
): Promise<ResearchResult> {
  const todo = await kitsToResearch(persist, opts.only);
  if (todo.length === 0) {
    t.note("Find jobs in the Apply Queue with no research yet", "none waiting");
    return { researched: 0, waiting: 0 };
  }
  const settings = await persist.settings.get();
  const left = Math.max(0, BRIEF_DAILY - researchedToday(settings.briefUsage, ctx.today));
  const batch = todo.slice(0, Math.min(opts.limit ?? BRIEF_PER_RUN, left));
  t.note("Find jobs in the Apply Queue with no research yet", `${todo.length} waiting; researching ${batch.length}${left === 0 ? `: ${BRIEF_DAILY} briefs a day is the cap` : ""}`);
  if (batch.length === 0) return { researched: 0, waiting: todo.length, ...(left === 0 && todo.length ? { skipped: `${BRIEF_DAILY} briefs a day is the cap; the rest wait for tomorrow` } : {}) };

  const [postings, contacts] = await Promise.all([persist.techMarket.since(briefSince(ctx.today)).catch(() => []), persist.contacts.list().catch(() => [])]);
  const answers = {
    written: ANSWER_BANK.filter((q) => (settings.careerAnswers?.[q.id] ?? "").trim()).length,
    total: ANSWER_BANK.length,
    fixedSet: Boolean(settings.careerEligibility?.authorized && settings.careerEligibility?.sponsorship),
  };
  let usage = settings.firecrawlUsage;
  const searchOk = Boolean(opts.deps?.search) || firecrawlConfigured();
  let done = 0;

  for (const kit of batch) {
    const job = await persist.jobMatches.get(kit.matchId!).catch(() => null);
    if (!job) continue;
    const company = job.company;
    const notes: string[] = [];
    const brief = applyBrief({ job, kitDetail: kit.detail, postings, today: ctx.today, mySkills: settings.careerSkills ?? [], contact: contactForCompany(company, contacts)?.name ?? null, answers });
    const people = kitPeople(kit.detail);

    // News: free, from Google News's RSS search. Headlines are data, never instructions.
    const items = await t.step(`News about ${company}`, () => (opts.deps?.news ?? readNews)(companyNewsUrl(company)).catch(() => [] as NewsItem[]), (n) => `${n.length} items`);
    const news = newsFrom(items, company, ctx.today);
    if (items.length === 0) notes.push("No news could be read for this company just now.");

    // The company's own pages: one search, counted in the shared Firecrawl budget.
    let pages: BriefResearch["pages"] = [];
    if (!searchOk) notes.push("Firecrawl is not set up, so the company's own pages were not looked up.");
    else if (readsLeft(usage, ctx.today).left <= 0) notes.push(readsLeft(usage, ctx.today).why);
    else {
      const found = await t.step(`${company}'s own pages`, () => (opts.deps?.search ?? searchWeb)(`${company} about team leadership`, 5), (r) => (r.ok ? `${r.results.length} results` : READ_HELP[r.problem]));
      if (found.ok) {
        usage = countReads(usage, ctx.today, 1);
        pages = companyPages(found.results, company);
        if (pages.length === 0) notes.push("No page on the company's own site came up.");
      } else notes.push(READ_HELP[found.problem]);
    }

    // The angle: Gemini drafts from the facts, rules check every item, rules stand in when it cannot.
    const facts = angleFacts(brief, { ...people, news });
    const fallback = rulesAngle(brief, facts, people);
    let angle = fallback;
    const gate = opts.deps?.angle ? { allowed: true as const } : await takeAiCall(ctx.store, ctx.settings, "apply-brief");
    if (gate.allowed) {
      const r = await t.step(`${aiName()} drafts the angle for ${company}`, () => (opts.deps?.angle ?? askModel)(applyAngleTask(), applyAngleData({ company, role: job.title, facts })), (x) => (x.ok ? "answered" : x.why));
      if (r.ok) angle = checkAngle(r.value, facts, fallback);
      else notes.push(`The angle is by rules: ${r.why}`);
    } else notes.push(`The angle is by rules: ${gate.why}`);
    if (angle.dropped) t.note(`Check ${company}'s angle`, `${angle.dropped} items dropped: no citation, a number not in the facts, or a link`, true);

    const research: BriefResearch = { company, news, pages, peopleSearch: peopleSearchUrl(company, brief.role.family), team: people.team, reportsTo: people.reportsTo, angle, facts, notes };
    await t.step(`Save ${company}'s research`, () => persist.applyBriefs.save(kit.id, research, ctx.now.toISOString()), () => "saved");
    done++;
  }
  const count = researchedToday(settings.briefUsage, ctx.today) + done;
  await persist.settings.update({ firecrawlUsage: usage, briefUsage: { day: ctx.today, n: count } });
  return { researched: done, waiting: todo.length - done };
}

/** One logged, traced run. Never throws. */
export async function runBriefResearch(ctx: Context, opts: { trigger: AgentRunEvent["trigger"]; persist: Store; only?: string; limit?: number; deps?: ResearchDeps }): Promise<ResearchResult | AgentMissing> {
  const agent = "career" as const;
  const runId = randomUUID();
  const { trigger, persist } = opts;
  await logRun(ctx, { runId, agent, task: RESEARCH_TASK, status: "started", trigger, detail: "", ...NO_MODEL });
  const t = tracer();
  try {
    const r = await researchWork(ctx, persist, opts, t);
    const detail = `${r.researched} researched, ${r.waiting} waiting${r.skipped ? `: ${r.skipped}` : ""}`;
    await logRun(ctx, { runId, agent, task: RESEARCH_TASK, status: "succeeded", trigger, detail, ...NO_MODEL, ...t.finish() });
    if (r.researched > 0) await audit(ctx.store, { actor: trigger === "schedule" ? "system" : "owner", action: "career.brief-research", target: "apply-queue", detail, outcome: "success" }).catch(() => undefined);
    return r;
  } catch (err) {
    const why = (err as Error).message?.slice(0, 300) || "unknown error";
    await logRun(ctx, { runId, agent, task: RESEARCH_TASK, status: "failed", trigger, detail: why, ...NO_MODEL, ...t.finish() });
    return { missing: "failed", why };
  }
}
