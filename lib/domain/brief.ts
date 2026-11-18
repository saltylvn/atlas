// The morning brief, built by rules. Claude may rewrite the headline and the summary
// lines (lib/ai/brief.ts), but the facts on the page always come from here, so the
// brief is correct with no API key and cannot be talked into inventing a meeting.

import { localTime } from "./dates";
import { capacityFor, comparePriority, minutesLabel } from "./planner";
import { dueLabel, type ContactDue } from "./relationships";
import type { InboxSummary } from "./inbox";
import type { PipelineSummary } from "./jobs";
import { renewalView, renewalWhen } from "./renewals";
import type { CalendarEvent, LocalDate, NewsItem, NewsTopic, Renewal, Task, Weather } from "./types";


export interface BriefInput {
  today: LocalDate;
  tasks: Task[];
  events: CalendarEvent[];
  peopleDue: ContactDue[];
  pipeline: PipelineSummary | null;
  news: NewsItem[];
  weather: Weather | null;
  /** Omitted means the caller is not asking about bills and renewals. */
  renewals?: Renewal[];
  dailyCapacityMin: number;
  timeZone: string;
  /** Null when Gmail is not connected. */
  inbox?: InboxSummary | null;
}

export interface Brief {
  headline: string;
  summary: string[];
  focus: Task[];
  agenda: CalendarEvent[];
  plannedMin: number;
  capacityMin: number;
  overdue: Task[];
  peopleDue: ContactDue[];
  headlines: NewsItem[];
  risks: string[];
  inbox: InboxSummary | null;
  source: "rules" | "ai";
}

const TOPIC_ORDER: NewsTopic[] = ["ai", "tech", "politics", "world"];

export function composeBrief(input: BriefInput): Brief {
  const { today, tasks, events, peopleDue, pipeline, news, weather } = input;

  const open = tasks.filter((t) => t.status !== "done");
  const todays = open.filter((t) => t.day === today).sort(comparePriority);
  const overdue = open.filter((t) => t.day !== null && t.day < today).sort(comparePriority);
  const focus = [...overdue.filter((t) => t.priority === "critical"), ...todays].slice(0, 3);
  const plannedMin = todays.reduce((n, t) => n + t.estimateMin, 0);
  const capacityMin = capacityFor(today, input.dailyCapacityMin);
  const agenda = [...events].sort((a, b) => a.start.localeCompare(b.start));
  const meetingMin = agenda
    .filter((e) => !e.allDay)
    .reduce((n, e) => n + Math.max(0, (Date.parse(e.end) - Date.parse(e.start)) / 60_000), 0);

  const risks: string[] = [];
  if (plannedMin + meetingMin > capacityMin) {
    risks.push(
      `Today is over capacity: ${minutesLabel(plannedMin)} of tasks plus ${minutesLabel(Math.round(meetingMin))} of meetings against ${minutesLabel(capacityMin)}. Push one low-priority task.`,
    );
  }
  if (overdue.length > 0) {
    risks.push(`${overdue.length} task${overdue.length === 1 ? " is" : "s are"} overdue. Re-plan them from the Plan tab.`);
  }
  if (todays.some((t) => t.status === "stuck")) {
    risks.push("A task planned for today is marked Stuck. Decide the next step or hand it off.");
  }
  const dueRenewals = renewalView(input.renewals ?? [], today).attention;
  if (dueRenewals.length > 0) {
    const first = dueRenewals[0]!;
    const when = renewalWhen(first.daysUntil).toLowerCase();
    risks.push(
      dueRenewals.length === 1
        ? `${first.renewal.title} is ${when}.`
        : `${dueRenewals.length} bills or renewals need a look. First: ${first.renewal.title} (${when}).`,
    );
  }

  // Two per topic, from two different outlets when possible.
  const headlines = TOPIC_ORDER.flatMap((topic) => {
    const inTopic = news.filter((n) => n.topic === topic);
    const firstPerSource = inTopic.filter((n, i) => inTopic.findIndex((m) => m.source === n.source) === i);
    return [...firstPerSource, ...inTopic.filter((n) => !firstPerSource.includes(n))].slice(0, 2);
  });

  const summary: string[] = [];
  if (weather) {
    summary.push(
      `${weather.place}: ${weather.summary.toLowerCase()}, ${Math.round(weather.highF)}° / ${Math.round(weather.lowF)}°${weather.precipChance >= 40 ? `, ${weather.precipChance}% chance of rain` : ""}.`,
    );
  }
  summary.push(
    agenda.length === 0
      ? "No meetings on the calendar: a good day for deep work."
      : `${agenda.length} thing${agenda.length === 1 ? "" : "s"} on the calendar, first at ${firstTime(agenda, input.timeZone)}.`,
  );
  if (todays.length > 0) {
    summary.push(`${todays.length} task${todays.length === 1 ? "" : "s"} planned (${minutesLabel(plannedMin)}). Start with “${focus[0]?.title ?? todays[0]!.title}”.`);
  } else {
    summary.push("Nothing planned yet today. Pull from the backlog or run the planner.");
  }
  const inbox = input.inbox ?? null;
  if (inbox && inbox.needsReply > 0) {
    const names = [...new Set(inbox.waiting.map((i) => i.fromName))].slice(0, 2).join(" and ");
    summary.push(`Inbox: ${inbox.needsReply} need${inbox.needsReply === 1 ? "s" : ""} a reply, starting with ${names}.`);
  } else if (inbox) {
    summary.push("Inbox: nothing waiting on a reply.");
  }
  if (pipeline) {
    const next = pipeline.upcomingInterviews[0];
    summary.push(
      next
        ? `Job hunt: ${pipeline.active} active, next interview with ${next.company} (${next.round}).`
        : `Job hunt: ${pipeline.active} active application${pipeline.active === 1 ? "" : "s"}${pipeline.followUps.length ? `, ${pipeline.followUps.length} follow-up${pipeline.followUps.length === 1 ? "" : "s"} due` : ""}.`,
    );
  }
  if (peopleDue[0]) {
    summary.push(`Reach out to ${peopleDue[0].contact.name} (${dueLabel(peopleDue[0]).toLowerCase()}).`);
  }

  const headline =
    risks.length > 0 && plannedMin + meetingMin > capacityMin
      ? "Heavy day. Protect your top three."
      : focus.length > 0
        ? `Today's one thing: ${focus[0]!.title}`
        : "Open day. Plan it before it plans you.";

  return {
    headline,
    summary,
    focus,
    agenda,
    plannedMin,
    capacityMin,
    overdue,
    peopleDue: peopleDue.slice(0, 4),
    headlines,
    risks,
    inbox,
    source: "rules",
  };
}

function firstTime(agenda: CalendarEvent[], timeZone: string): string {
  const first = agenda.find((e) => !e.allDay) ?? agenda[0]!;
  if (first.allDay) return "all day";
  return localTime(new Date(first.start), timeZone);
}
