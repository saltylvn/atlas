"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon, type IconName } from "./Icon";
import { CAREER, CAREER_HUB, CAREER_HUB_LABEL, deskOf, DESKS, isActive, PHONE_TABS, type DeskId } from "./navItems";

const MORE = { href: "/more", label: "More", icon: "more" as IconName, mobile: true };

/** The two working desks start open; System, Data and QA open when you are on one of their pages. */
const OPEN_BY_DEFAULT: Record<DeskId, boolean> = { daily: true, career: true, system: false, data: false, qa: false };

/**
 * The sidebar (MacBook and iPad): the desks, each under its own colored label. A desk's
 * label folds it away; the desk you are in is always open on arrival.
 */
export function SideNav() {
  const path = usePathname();
  const here = deskOf(path)?.id ?? null;
  // Your click wins on the page where you made it; a new page starts from the defaults.
  const [choice, setChoice] = useState<{ path: string; open: Partial<Record<DeskId, boolean>> }>({ path, open: {} });
  const chosen = choice.path === path ? choice.open : {};
  return (
    <nav aria-label="Main" className="-mr-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
      {DESKS.map((desk) => {
        const open = chosen[desk.id] ?? (OPEN_BY_DEFAULT[desk.id] || here === desk.id);
        const id = `nav-${desk.id}`;
        return (
          <section key={desk.id} aria-label={desk.label} style={{ ["--desk" as string]: desk.color }}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={id}
              title={desk.job}
              onClick={() => setChoice({ path, open: { ...chosen, [desk.id]: !open } })}
              className="flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-surface-2"
            >
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--desk)]" />
              <span className="eyebrow flex-1 text-[color:color-mix(in_oklab,var(--desk)_70%,var(--ink))]">{desk.label}</span>
              <Icon name="chevron" size={14} className={`text-ink-3 transition-transform ${open ? "" : "-rotate-90"}`} />
            </button>
            {open && (
              <div id={id} className="mt-0.5 flex flex-col gap-0.5 border-l-2 border-[color:color-mix(in_oklab,var(--desk)_35%,transparent)] pl-1.5 ml-[0.8rem]">
                {desk.items.map((item) => {
                  const active = isActive(path, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-w-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[0.875rem] font-medium transition-colors ${
                        active ? "bg-[color:color-mix(in_oklab,var(--desk)_13%,var(--surface))] text-ink [&>svg]:text-[var(--desk)]" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      <Icon name={item.icon} size={16} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </nav>
  );
}

/** The phone's tab bar: Today, the Career hub, Ask Atlas and More. The lit tab wears its desk's color. */
export function TabBar() {
  const path = usePathname();
  const here = deskOf(path);
  return (
    <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface/95 backdrop-blur md:hidden">
      {[...PHONE_TABS, MORE].map((item) => {
        // Career lights on every Career page; More on anything the bar has no tab for.
        const onTab = item.href === CAREER_HUB ? here?.id === "career" && path !== "/growth" : item !== MORE && isActive(path, item.href);
        const active = item === MORE ? path === "/more" || !PHONE_TABS.some((t) => (t.href === CAREER_HUB ? here?.id === "career" && path !== "/growth" : isActive(path, t.href))) : onTab;
        const color = item === MORE ? (here?.color ?? "var(--ink)") : (deskOf(item.href)?.color ?? "var(--ink)");
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            style={active ? { color: `color-mix(in oklab, ${color} 75%, var(--ink))` } : undefined}
            className={`flex min-h-[54px] flex-col items-center justify-center gap-0.5 text-[0.7rem] font-medium ${active ? "" : "text-ink-3"}`}
          >
            <Icon name={item.icon} size={21} />
            {item.href === CAREER_HUB ? "Career" : item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Which desk this page is in: a thin stripe in the desk's color and its name, at the top of every page. */
export function DeskStripe() {
  const desk = deskOf(usePathname());
  if (!desk) return null;
  return (
    <div className="mb-4 flex items-center gap-2" style={{ ["--desk" as string]: desk.color }}>
      <span aria-hidden className="h-1 w-8 rounded-full bg-[var(--desk)]" />
      <span className="eyebrow text-[color:color-mix(in_oklab,var(--desk)_70%,var(--ink))]">{desk.label}</span>
      <span aria-hidden className="h-px flex-1 bg-[color:color-mix(in_oklab,var(--desk)_30%,transparent)]" />
    </div>
  );
}

/** The pages inside the Career Desk, as a row of tabs at the top of each on a phone. The first goes back to the queue and today's picks. */
export function CareerNav() {
  const path = usePathname();
  const pages = [{ href: CAREER_HUB, label: CAREER_HUB_LABEL, icon: "send" as IconName }, ...CAREER];
  return (
    <nav aria-label="Career" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:hidden">
      {pages.map((j) => {
        const on = isActive(path, j.href);
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
