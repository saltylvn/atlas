import type { IconName } from "./Icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** In the phone's tab bar. The rest are reached from More. */
  mobile: boolean;
}

/**
 * The Career pages after Apply (the hub itself), in the order you use them. The older
 * pages still exist and are reached from them.
 */
export const CAREER: readonly NavItem[] = [
  // Every application as a list: what needs you, who wrote back, where each one stands (docs/design-pipeline.md).
  { href: "/applications", label: "Pipeline", icon: "jobs", mobile: false },
  // Where every job stands, stage by stage: yours and the ones Atlas applied to.
  { href: "/status", label: "Tracker", icon: "growth", mobile: false },
  // The tech job market right now: demand, pay, levels and skills, from every U.S. tech posting the Scout reads.
  { href: "/career/market", label: "Market", icon: "chart", mobile: false },
  { href: "/career/map", label: "Career Map", icon: "growth", mobile: false },
  // What you are aiming for: your top roles, what each is, and the gaps to close.
  { href: "/career/roles", label: "Target Roles", icon: "sparkle", mobile: false },
  // Each resume from Figma against its role's postings, and the Career Mentor's suggested edits (23 Nov 2026).
  { href: "/career/resume-optimization", label: "Resume Optimization", icon: "wand", mobile: false },
  // What you set once: answers, resumes, target roles, watched boards.
  { href: "/career/setup", label: "Setup", icon: "settings", mobile: false },
];

/** The hub's own name in the Career pages. */
export const CAREER_HUB_LABEL = "Apply";

/** Older pages, each housed by one of the tabs: its tab is lit while you are on it. */
export const CAREER_HOUSED: Readonly<Record<string, string>> = { "/jobs": "/career/setup", "/roles": "/career/setup" };

export const CAREER_HUB = "/career";

// ---- the desks (owner's layout, 24 Nov 2026) ----
//
// Atlas is laid out by desk, so it is clear which part of the system a page belongs to:
// the Daily Desk runs the day, the Career Desk runs the job hunt, Data holds the job-market
// data, System is how Atlas itself is built and set up, and QA checks Atlas's quality. Each desk has one
// color: its label, its active link and the stripe at the top of each of its pages use it.
// The sidebar, the phone's tab bar and the More page are all drawn from this list.

export type DeskId = "daily" | "career" | "system" | "data" | "qa";

export interface Desk {
  id: DeskId;
  label: string;
  /** What the desk is for, in a few words. */
  job: string;
  /** The desk's color, a CSS color value. */
  color: string;
  items: readonly NavItem[];
}

export const DESKS: readonly Desk[] = [
  {
    id: "daily",
    label: "Daily Desk",
    job: "Runs your day",
    color: "var(--c-daily)",
    items: [
      { href: "/", label: "Today", icon: "today", mobile: true },
      { href: "/inbox", label: "Inbox", icon: "inbox", mobile: false },
      { href: "/plan", label: "Plan", icon: "plan", mobile: false },
      { href: "/news", label: "News", icon: "news", mobile: false },
      { href: "/renewals", label: "Renewals", icon: "clock", mobile: false },
      { href: "/people", label: "People", icon: "people", mobile: false },
      { href: "/projects", label: "Projects", icon: "bulb", mobile: false },
      { href: "/ask", label: "Ask Atlas", icon: "sparkle", mobile: true },
    ],
  },
  {
    id: "career",
    label: "Career Desk",
    job: "Runs the job hunt",
    color: "var(--c-career)",
    items: [
      // The hub: good fits, today's five and the Apply Queue. On a phone it is the Career tab.
      { href: CAREER_HUB, label: CAREER_HUB_LABEL, icon: "jobs", mobile: true },
      ...CAREER,
      // The Career Mentor's daily reviews, your skills, gaps and proof project.
      { href: "/growth", label: "Growth", icon: "growth", mobile: false },
    ],
  },
  {
    id: "system",
    label: "System",
    job: "How Atlas is built and set up",
    color: "var(--c-system)",
    items: [
      { href: "/mission", label: "Mission Control", icon: "shield", mobile: false },
      { href: "/team", label: "Your team", icon: "team", mobile: false },
      { href: "/connectors", label: "Connectors", icon: "plug", mobile: false },
      { href: "/settings", label: "Settings", icon: "settings", mobile: false },
    ],
  },
  {
    id: "data",
    label: "Data",
    job: "The job-market data",
    color: "var(--c-data)",
    items: [
      // The job-market data: set it up one step at a time, with the Data Mentor beside you.
      { href: "/data", label: "Data Pipeline", icon: "flow", mobile: false },
    ],
  },
  {
    id: "qa",
    label: "QA",
    job: "Checks Atlas's quality",
    color: "var(--c-qa)",
    items: [
      // The QA bot's weekly review of Atlas, and what needs attention.
      { href: "/qa", label: "QA review", icon: "shield", mobile: false },
      // Each agent's golden set and the daily eval run.
      { href: "/evals", label: "Evals", icon: "check", mobile: false },
    ],
  },
];

/** Every page in the navigation, desk by desk. */
export const NAV: readonly NavItem[] = DESKS.flatMap((d) => d.items);

/** The phone's tab bar: Today, the Career hub and Ask Atlas, then More. */
export const PHONE_TABS: readonly NavItem[] = ["/", CAREER_HUB, "/ask"].map((href) => NAV.find((n) => n.href === href)!);

const matches = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

/** True when `path` is one of the Career pages: the hub, its tabs, or an older page one of them houses. */
export function inCareer(path: string): boolean {
  return matches(path, CAREER_HUB) || CAREER.some((j) => matches(path, j.href)) || Object.keys(CAREER_HOUSED).some((old) => matches(path, old));
}

/**
 * True when `path` is this item's page. Apply (the Career hub) is lit on the hub and its resume
 * viewer only; each Career page is lit on its own pages and on the older pages it houses.
 */
export function isActive(path: string, href: string): boolean {
  if (href === CAREER_HUB) return path === CAREER_HUB || matches(path, `${CAREER_HUB}/resume`);
  const housed = Object.keys(CAREER_HOUSED).find((old) => matches(path, old));
  return matches(path, href) || (housed !== undefined && CAREER_HOUSED[housed] === href);
}

/** The desk a page belongs to, or null for a page outside the navigation (More, sign-in). */
export function deskOf(path: string): Desk | null {
  if (inCareer(path)) return DESKS.find((d) => d.id === "career")!;
  return DESKS.find((d) => d.items.some((i) => isActive(path, i.href))) ?? null;
}
