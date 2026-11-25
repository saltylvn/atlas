// The four tabs the weekly review counts. The owner set them on 2026-11-17. Since 24 Nov 2026
// the navigation itself is laid out by desk (components/navItems.ts: Daily Desk, Career Desk,
// Data, System); these four are still the pages whose use is counted. The QA
// Agent keeps it in mind: every weekly review checks whether each tab was used, and
// suggests options when one was not (lib/domain/qa.ts). Pure: no I/O.

import type { LocalDate } from "./types";

export type MainTab = "today" | "growth" | "career" | "people";

export interface MainTabSpec {
  id: MainTab;
  label: string;
  href: string;
  /** What the tab is for, in the owner's terms. */
  job: string;
  /** What lives in it. */
  holds: string;
}

/** The day this layout was set. A review of a week that starts before it leaves the layout alone. */
export const LAYOUT_SINCE: LocalDate = "2026-11-17";

/** The four main tabs, left to right. */
export const MAIN_TABS: readonly MainTabSpec[] = [
  { id: "today", label: "Today", href: "/", job: "The day at a glance.", holds: "The brief, what needs you, and what the Career Mentor wants you to look at." },
  { id: "growth", label: "Growth", href: "/growth", job: "Getting better: the Career Mentor and daily mentoring.", holds: "The Career Mentor's three reviews a day, your skills and gaps, your projects, your LinkedIn text." },
  { id: "career", label: "Career", href: "/career", job: "The job hunt, start to finish.", holds: "Good fits, the Apply Queue, the Tracker and Setup." },
  { id: "people", label: "People", href: "/people", job: "Keeping in touch.", holds: "Texts Atlas drafts and you send: check-ins, and a thought or idea shared with a few people." },
];

/** What the owner asked for, kept for the QA Agent's review card and its instructions. */
export const LAYOUT_BRIEF =
  "Four main tabs, left to right: Today, Growth, Career, People. Growth holds the Career Mentor and daily mentoring. Career is the main job hunt section and holds Good fits and the Apply Queue. People is for semi-automated texts to keep in touch and share thoughts or ideas. The goal is a smoother layout and workflow: suggest options, never rearrange. Since 24 Nov 2026 every page sits under one of four desks, each with its own color: Daily Desk (blue), Career Desk (orange), Data (purple) and System (green).";

/** A week of use, per main tab. Counts only. */
export interface TabUsage {
  /** Briefs saved this week, and how many of them were marked Briefed. */
  today: { saved: number; briefed: number };
  /** Career Mentor insights given this week, and how many were marked Done or Not useful. */
  growth: { given: number; answered: number };
  /** Apply kits and follow-ups queued this week, decided this week, and waiting now. */
  career: { queued: number; decided: number; waiting: number };
  /** People due a check-in now, and messages handed off this week. */
  people: { due: number; sent: number };
}

export interface TabNote {
  tab: MainTab;
  /** The week in numbers, shown whether or not anything is wrong. */
  line: string;
  /** Set when the tab went unused although there was something in it for you. */
  unused: { title: string; evidence: string[]; options: string } | null;
}

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/**
 * One note per main tab: its week in numbers, and whether it went unused. A tab only counts
 * as unused when it had something waiting (three briefs, three insights, a queue, three
 * people due) and none of it was touched: an empty tab on a quiet week is not a finding.
 */
export function tabNotes(u: TabUsage): TabNote[] {
  const { today, growth, career, people } = u;
  return [
    {
      tab: "today",
      line: `Today: ${today.briefed} of ${n(today.saved, "brief")} marked Briefed`,
      unused:
        today.saved >= 3 && today.briefed === 0
          ? {
              title: `Today: ${n(today.saved, "brief")} saved this week, none marked Briefed`,
              evidence: [`${today.saved} saved, 0 marked Briefed`],
              options: "Options to look into: a shorter brief that leads with the one thing to do; mark it Briefed when it is opened instead of with a button; one brief a day instead of two.",
            }
          : null,
    },
    {
      tab: "growth",
      line: `Growth: ${growth.answered} of ${n(growth.given, "Career Mentor insight")} answered`,
      unused:
        growth.given >= 3 && growth.answered === 0
          ? {
              title: `Growth: the Career Mentor gave ${n(growth.given, "insight")} this week and none got Done or Not useful`,
              evidence: [`${growth.given} given, 0 answered`],
              options: "Options to look into: put Done and Not useful on Today's Career Mentor card, so answering takes one tap; one insight a day instead of three; open Growth on the newest insight.",
            }
          : null,
    },
    {
      tab: "career",
      line: `Career: ${career.queued} queued, ${career.decided} decided, ${career.waiting} waiting`,
      unused:
        career.waiting >= 1 && career.queued === 0 && career.decided === 0
          ? {
              title: `Career: ${n(career.waiting, "item")} waited in your apply queues all week, with nothing queued or decided`,
              evidence: [`${career.waiting} waiting`, "0 queued and 0 decided this week"],
              options: "Options to look into: show the queue's count on the Career tab; a line on Today while something waits; clear kits older than a week with one button.",
            }
          : null,
    },
    {
      tab: "people",
      line: `People: ${people.sent} sent, ${people.due} due a check-in`,
      unused:
        people.due >= 3 && people.sent === 0
          ? {
              title: `People: ${n(people.due, "person", "people")} are due a check-in and nothing was sent this week`,
              evidence: [`${people.due} due`, "0 messages handed off this week"],
              options: "Options to look into: show who is due on Today; one set time a week to run Start all; share one thought with several people instead of separate check-ins.",
            }
          : null,
    },
  ];
}

/**
 * Counts a week of use from Atlas's own records. `from` is the first day of the week and
 * `since` its first instant; rows outside the week are ignored.
 */
export function tabUsage(input: {
  from: LocalDate;
  since: string;
  briefsSaved: number;
  briefsMarked: number;
  insights: readonly { status: string; forDate: LocalDate }[];
  approvals: readonly { status: string; createdAt: string; decidedAt?: string | null }[];
  due: number;
  handedOff: readonly (string | null)[];
}): TabUsage {
  const given = input.insights.filter((i) => i.forDate >= input.from && i.status !== "replaced");
  return {
    today: { saved: input.briefsSaved, briefed: Math.min(input.briefsMarked, input.briefsSaved) },
    growth: { given: given.length, answered: given.filter((i) => i.status === "done" || i.status === "dismissed").length },
    career: {
      queued: input.approvals.filter((a) => a.createdAt >= input.since).length,
      decided: input.approvals.filter((a) => a.status !== "pending" && (a.decidedAt ?? "") >= input.since).length,
      waiting: input.approvals.filter((a) => a.status === "pending").length,
    },
    people: { due: input.due, sent: input.handedOff.filter((at) => at && at >= input.since).length },
  };
}
