import { MAIN_TABS } from "@/lib/domain/layout";
import type { IconName } from "./Icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** A main tab: first in the sidebar, and in the phone tab bar. The rest live under More. */
  mobile: boolean;
}

/** The job hunt's pages, inside the Career tab, in this order. The Approval Queue is on the hub itself. */
export const CAREER: readonly NavItem[] = [
  { href: "/roles", label: "Target roles", icon: "team", mobile: false },
  { href: "/applications", label: "Applications", icon: "jobs", mobile: false },
  { href: "/jobs", label: "Job watchlist", icon: "hash", mobile: false },
];

export const CAREER_HUB = "/career";

const MAIN_ICON: Record<(typeof MAIN_TABS)[number]["id"], IconName> = { today: "today", growth: "growth", career: "jobs", people: "people" };

/** The four main tabs, left to right: Today, Growth, Career, People (lib/domain/layout.ts). */
const MAIN: readonly NavItem[] = MAIN_TABS.map((t) => ({ href: t.href, label: t.label, icon: MAIN_ICON[t.id], mobile: true }));

// Shared by the client nav bars and the server-rendered More page.
export const NAV: readonly NavItem[] = [
  ...MAIN,
  { href: "/inbox", label: "Inbox", icon: "inbox", mobile: false },
  { href: "/ask", label: "Ask Atlas", icon: "sparkle", mobile: false },
  { href: "/plan", label: "Plan", icon: "plan", mobile: false },
  { href: "/projects", label: "Projects", icon: "bulb", mobile: false },
  { href: "/news", label: "News", icon: "news", mobile: false },
  { href: "/renewals", label: "Renewals", icon: "clock", mobile: false },
  { href: "/team", label: "Your team", icon: "team", mobile: false },
  { href: "/mission", label: "Mission Control", icon: "shield", mobile: false },
  { href: "/evals", label: "Evals", icon: "check", mobile: false },
  { href: "/connectors", label: "Connectors", icon: "plug", mobile: false },
  { href: "/settings", label: "Settings", icon: "settings", mobile: false },
];

const matches = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

/** True when `path` is this item's page. The Career tab is also active on each page it houses. */
export function isActive(path: string, href: string): boolean {
  if (href === CAREER_HUB) return matches(path, CAREER_HUB) || CAREER.some((j) => matches(path, j.href));
  return matches(path, href);
}
