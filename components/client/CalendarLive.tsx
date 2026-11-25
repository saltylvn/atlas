"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { refreshCalendar } from "@/app/actions/calendar";
import { Icon } from "../Icon";
import { HOURS_COOKIE } from "@/lib/domain/dayCalendar";

// The live parts of Today's calendar view, for an iPad left standing: the clock, the line that
// marks now, a refresh from Google Calendar every few minutes, and a screen that stays awake
// while the page is showing. It talks only to Atlas.

const REFRESH_MS = 5 * 60_000;

/** Minutes from midnight in a time zone, and the clock as text. */
function clockIn(timeZone: string, at: Date): { minutes: number; text: string } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: false }).formatToParts(at);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return { minutes: h * 60 + m, text: new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(at) };
}

function useNow(): Date | null {
  // Null until the page is live in the browser, so the server and the first paint agree.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** The big clock in the calendar's header. */
export function LiveClock({ timeZone, initial }: { timeZone: string; initial: string }) {
  const now = useNow();
  return <span className="tabular-nums">{now ? clockIn(timeZone, now).text : initial}</span>;
}

/** The line across the grid at the current time. Hidden when now is off the grid. */
export function NowLine({ timeZone, from, to, initialMin }: { timeZone: string; from: number; to: number; initialMin: number }) {
  const now = useNow();
  const minute = now ? clockIn(timeZone, now).minutes : initialMin;
  if (minute < from || minute > to) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: `${((minute - from) / (to - from)) * 100}%` }}>
      <span className="-ml-1.5 h-3 w-3 rounded-full bg-[#ea4335]" />
      <span className="h-0.5 flex-1 bg-[#ea4335]" />
    </div>
  );
}

/**
 * On an iPad or a Mac (768px and wider), sizes its box to fill the screen from where it starts
 * down to the bottom, so the whole day shows without scrolling. On a phone it keeps the height
 * the page gave it, and the day scrolls.
 */
export function FitToScreen({ children, className, label, fallbackPx, minPx = 360 }: { children: React.ReactNode; className?: string; label: string; fallbackPx: number; minPx?: number }) {
  const ref = useRef<HTMLElement>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 768px)");
    const fit = () => {
      const el = ref.current;
      if (!el || !wide.matches) return setH(null);
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Whatever the page puts below the box (a note, the page's bottom padding) has to fit on screen too.
      const main = el.closest("main");
      const end = main ? main.getBoundingClientRect().bottom + window.scrollY : top + el.offsetHeight + 16;
      const below = Math.max(0, end - (top + el.offsetHeight));
      setH(Math.max(minPx, Math.floor(window.innerHeight - top - below)));
    };
    fit();
    window.addEventListener("resize", fit);
    wide.addEventListener("change", fit);
    return () => {
      window.removeEventListener("resize", fit);
      wide.removeEventListener("change", fit);
    };
  }, [minPx]);
  return (
    <section ref={ref} aria-label={label} className={className} style={{ height: h ?? fallbackPx }}>
      {children}
    </section>
  );
}

/**
 * The day's grid inside a window `hours` tall (4, 6 or 8, your pick): the grid is sized so that
 * many hours fill the window, and the window opens an hour before now (or at the first hour when
 * the day has not reached the grid yet). The rest of the day is a scroll away.
 */
export function HourWindow({ children, from, to, nowMin, hours, timeZone }: { children: React.ReactNode; from: number; to: number; nowMin: number; hours: number; timeZone: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState<number | null>(null);
  // Where the window opens: an hour before now on this device's clock, set once when the page opens,
  // so a refresh every few minutes never moves where you scrolled. `nowMin` is the server's guess until then.
  const startAt = useRef<number | null>(null);
  const spanH = (to - from) / 60;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const size = () => setInner(Math.round((el.clientHeight * spanH) / hours));
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    return () => ro.disconnect();
  }, [spanH, hours]);
  // Once the grid has its real height, scroll to the start; and again when you pick a new window
  // size (4, 6 or 8 hours), keeping the same hour at the top. Other resizes leave your scroll alone.
  const placedFor = useRef<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    // Wait for the height that matches this window size (it lands a render after a change).
    if (!el || !inner || inner !== Math.round((el.clientHeight * spanH) / hours)) return;
    if (startAt.current === null) {
      const now = clockIn(timeZone, new Date()).minutes || nowMin;
      startAt.current = Math.max(from, Math.min(now - 60, to - hours * 60));
    }
    if (placedFor.current === hours) return;
    placedFor.current = hours;
    el.scrollTop = ((startAt.current - from) / (to - from)) * inner;
  }, [inner, from, to, hours, timeZone, nowMin, spanH]);
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div style={{ height: inner ?? `${(spanH / hours) * 100}%` }}>{children}</div>
    </div>
  );
}

/**
 * How many hours the calendar shows at once. The choice goes in the address (so a Home Screen
 * shortcut keeps it) and in a cookie on this device, which the page reads when the address has none.
 */
export function HoursPicker({ hours, choices }: { hours: number; choices: readonly number[] }) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2">
      <span className="sr-only">Hours shown at a time</span>
      <select
        className="field min-h-11 !w-auto py-0 pr-8 text-base md:text-sm"
        value={hours}
        onChange={(e) => {
          const v = Number(e.target.value);
          document.cookie = `${HOURS_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax; secure`;
          router.replace(`/?view=calendar&hours=${v}`, { scroll: false });
        }}
      >
        {choices.map((n) => (
          <option key={n} value={n}>
            Show {n} hours at a time
          </option>
        ))}
      </select>
    </label>
  );
}

/** Reads the calendar again now, instead of waiting for the five-minute refresh. */
export function RefreshCalendar() {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="btn btn-ghost btn-sm min-h-11"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await refreshCalendar();
            setNote(r.ok ? null : { ok: false, text: r.error });
          })
        }
      >
        <Icon name="refresh" size={14} className={pending ? "motion-safe:animate-spin" : ""} /> {pending ? "Refreshing…" : "Refresh calendar"}
      </button>
      {note && (
        <span role="status" className="text-xs text-bad">
          {note.text}
        </span>
      )}
    </span>
  );
}

/** Keeps the calendar fresh and the screen awake while it is showing. Renders nothing. */
export function KeepCurrent() {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    // The screen stays on while this view is up (iPad Safari supports it); it is released when you leave.
    let lock: { release: () => Promise<void> } | null = null;
    const wake = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (document.visibilityState === "visible" && nav.wakeLock) lock = await nav.wakeLock.request("screen");
      } catch {
        // Not allowed or not supported: the calendar still works, the screen just follows its own timer.
      }
    };
    void wake();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
      void lock?.release().catch(() => undefined);
    };
  }, [router]);
  return null;
}
