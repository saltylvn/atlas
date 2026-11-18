"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import { CAREER, CAREER_HUB, isActive, NAV } from "./navItems";

const MORE = { href: "/more", label: "More", icon: "more" as IconName, mobile: true };

export function SideNav() {
  const path = usePathname();
  // The Career pages fold away: closed until you open them, open while you are on one.
  // Your click wins on the page where you made it; a new page starts from that default.
  const inCareer = isActive(path, CAREER_HUB);
  const [choice, setChoice] = useState<{ path: string; open: boolean } | null>(null);
  const careerOpen = choice?.path === path ? choice.open : inCareer;
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5">
      {NAV.map((item, i) => {
        const hub = item.href === CAREER_HUB;
        // On the hub itself the tab is the current page; on a page it houses, the child is.
        const active = hub ? path === CAREER_HUB : isActive(path, item.href);
        // A rule between the four main tabs and everything else.
        const firstOfRest = !item.mobile && NAV[i - 1]?.mobile;
        return (
          <div key={item.href} className={firstOfRest ? "mt-2 border-t border-line pt-2" : undefined}>
            <div className="flex items-center gap-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-[0.9rem] font-medium transition-colors ${
                  active ? "bg-surface-2 text-ink [&>svg]:text-brand" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                }`}
              >
                <Icon name={item.icon} size={18} />
                {item.label}
              </Link>
              {hub && (
                <button
                  type="button"
                  aria-expanded={careerOpen}
                  aria-controls="nav-career"
                  aria-label={careerOpen ? "Hide the Career pages" : "Show the Career pages"}
                  onClick={() => setChoice({ path, open: !careerOpen })}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  <Icon name="chevron" size={16} className={`transition-transform ${careerOpen ? "" : "-rotate-90"}`} />
                </button>
              )}
            </div>
            {hub && careerOpen && (
              <div id="nav-career" className="ml-[1.35rem] mt-0.5 flex flex-col gap-0.5 border-l border-line pl-2">
                {CAREER.map((j) => {
                  const on = isActive(path, j.href);
                  return (
                    <Link
                      key={j.href}
                      href={j.href}
                      aria-current={on ? "page" : undefined}
                      className={`rounded-md px-3 py-1.5 text-[0.85rem] font-medium transition-colors ${on ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
                    >
                      {j.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function TabBar() {
  const path = usePathname();
  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 backdrop-blur md:hidden"
    >
      {[...NAV.filter((n) => n.mobile), MORE].map((item) => {
        const active = item === MORE ? NAV.some((n) => !n.mobile && isActive(path, n.href)) || path === "/more" : isActive(path, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-[54px] flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium ${
              active ? "text-brand" : "text-ink-3"
            }`}
          >
            <Icon name={item.icon} size={21} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** The pages inside the Career tab, as a row of tabs at the top of each. The first goes back to the queue and today's picks. */
export function CareerNav() {
  const path = usePathname();
  const pages = [{ href: CAREER_HUB, label: "Queue and picks", icon: "check" as IconName }, ...CAREER];
  return (
    <nav aria-label="Career" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:hidden">
      {pages.map((j) => {
        const on = j.href === CAREER_HUB ? path === CAREER_HUB : isActive(path, j.href);
        return (
          <Link
            key={j.href}
            href={j.href}
            aria-current={on ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium ${
              on ? "border-brand-solid bg-brand-solid text-[color:var(--on-brand)]" : "border-line bg-surface text-ink-2"
            }`}
          >
            <Icon name={j.icon} size={15} />
            {j.label}
          </Link>
        );
      })}
    </nav>
  );
}
