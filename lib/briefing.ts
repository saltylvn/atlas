import "server-only";
import { loadCareerSnapshot } from "@/lib/career";
import type { Context } from "@/lib/context";
import { composeBrief, type Brief } from "@/lib/domain/brief";
import { briefedSlots } from "@/lib/domain/briefSchedule";
import { summarizeInbox } from "@/lib/domain/inbox";
import { summarizePipeline, type PipelineSummary } from "@/lib/domain/jobs";
import { contactsDue } from "@/lib/domain/relationships";
import { renewalView, type RenewalRow } from "@/lib/domain/renewals";
import type { BriefSlot, CareerSnapshot, LedgerEntry, NewsItem, Task, Weather } from "@/lib/domain/types";
import { getCalendar } from "@/lib/integrations/calendar";
import { demoCalendar } from "@/lib/demoCalendar";
import { getNews } from "@/lib/integrations/news";
import { getWeather } from "@/lib/integrations/weather";

export interface BriefBundle {
  brief: Brief;
  tasks: Task[];
  weather: Weather | null;
  pipeline: PipelineSummary | null;
  snapshot: CareerSnapshot | null;
  news: NewsItem[];
  calendarStatus: "ok" | "not_configured" | "error";
  briefedToday: boolean;
  /** Which of today's briefs you confirmed reading. */
  briefedSlots: BriefSlot[];
  /** The week's "briefed" rows, so the day switcher can tell which past briefs are still unread. */
  briefLedger: Pick<LedgerEntry, "agent" | "activity" | "at">[];
  minutesSavedThisWeek: number;
  gmailConnected: boolean;
  /** News feeds that failed this load (source names). */
  newsFailed: string[];
  /** Bills and renewals overdue, due today or inside their lead window. */
  renewalsDue: RenewalRow[];
}

/** Gathers every input in parallel. Each feed fails on its own without breaking the page. */
export async function loadBrief(ctx: Context): Promise<BriefBundle> {
  const { store, settings, today, now } = ctx;
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const [tasks, contacts, snapshot, weather, news, calendar, ledger, inboxItems, connections, renewals] = await Promise.all([
    store.tasks.list(),
    store.contacts.list(),
    // The career tracker: your Applications board plus interviews on your calendar.
    loadCareerSnapshot(ctx),
    getWeather(settings.latitude, settings.longitude, settings.placeName, settings.timezone),
    ctx.mode === "demo" && process.env.ATLAS_OFFLINE === "1" ? Promise.resolve({ items: [], failed: [] }) : getNews(settings.newsTopics),
    getCalendar(today, today, settings.timezone).then((c) =>
      // Demo mode with no calendar: show the same fictional meetings the time-blocker uses.
      ctx.mode === "demo" && c.status === "not_configured" ? { events: demoCalendar(today, today, settings.timezone), status: "ok" as const } : c,
    ),
    store.ledger.since(weekAgo),
    store.inbox.list(),
    store.connections.list(),
    store.renewals.list(),
  ]);

  // Demo mode shows its sample inbox; live mode only once Gmail is connected.
  const gmailConnected = ctx.mode === "demo" || connections.some((c) => c.provider === "google" || c.provider === "gmail_imap");

  const pipeline = snapshot ? summarizePipeline(snapshot, now, today) : null;
  const events = calendar.events;

  const brief = composeBrief({
    today,
    tasks,
    events,
    peopleDue: contactsDue(contacts, today),
    pipeline,
    news: news.items,
    weather,
    renewals,
    dailyCapacityMin: settings.dailyCapacityMin,
    timeZone: settings.timezone,
    inbox: gmailConnected ? summarizeInbox(inboxItems) : null,
  });

  return {
    brief,
    tasks,
    weather,
    pipeline,
    snapshot,
    news: news.items,
    calendarStatus: calendar.status,
    briefedToday: briefedSlots(ledger, today, settings.timezone).length > 0,
    briefedSlots: briefedSlots(ledger, today, settings.timezone),
    briefLedger: ledger.filter((e) => e.agent === "chief-of-staff").map((e) => ({ agent: e.agent, activity: e.activity, at: e.at })),
    minutesSavedThisWeek: ledger.reduce((n, e) => n + e.minutesSaved, 0),
    gmailConnected,
    newsFailed: news.failed,
    renewalsDue: renewalView(renewals, today).attention,
  };
}
