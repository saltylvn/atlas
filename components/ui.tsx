import type { CSSProperties, ReactNode } from "react";
import type { Area, Priority, TaskStatus } from "@/lib/domain/types";
import { Icon, type IconName } from "./Icon";
import { FoldDetails } from "./client/FoldDetails";

export const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "Not started", color: "var(--c-grey)" },
  doing: { label: "Working on it", color: "var(--c-warn)" },
  stuck: { label: "Stuck", color: "var(--c-red)" },
  done: { label: "Done", color: "var(--c-green)" },
};

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  critical: { label: "Critical", color: "var(--c-red)" },
  high: { label: "High", color: "var(--c-warn)" },
  medium: { label: "Medium", color: "var(--c-indigo)" },
  low: { label: "Low", color: "var(--c-grey)" },
};

export const AREA_META: Record<Area, { label: string; color: string }> = {
  work: { label: "Work", color: "var(--c-blue)" },
  career: { label: "Career", color: "var(--c-career)" },
  family: { label: "Family", color: "var(--c-brown)" },
  health: { label: "Health", color: "var(--c-green)" },
  home: { label: "Home", color: "var(--c-slate)" },
  finance: { label: "Finance", color: "var(--c-grey)" },
  personal: { label: "Personal", color: "var(--c-indigo)" },
};

/** Sets the hue a `.pill` or `.tint` element is tinted with. */
/** The pastel hues (System yellow, warning teal, and pink) need a deeper text mix to stay readable. */
const PASTEL = /--c-(pink|system|yellow|connector|warn|teal)\)/;
export const hue = (color: string) => ({ "--pc": color, ...(PASTEL.test(color) ? { "--pc-mix": "42%" } : {}) }) as CSSProperties;

export function Pill({ color, children, className = "" }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span className={`pill ${className}`} style={hue(color)}>
      {children}
    </span>
  );
}

export function StatusPill({ status }: { status: TaskStatus }) {
  const m = STATUS_META[status];
  return <Pill color={m.color}>{m.label}</Pill>;
}

export function PriorityPill({ priority }: { priority: Priority }) {
  const m = PRIORITY_META[priority];
  return <Pill color={m.color}>{m.label}</Pill>;
}

export function AreaDot({ area }: { area: Area }) {
  const m = AREA_META[area];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-2">
      <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

export function CardHeader({
  title,
  icon,
  action,
  hint,
}: {
  title: string;
  icon?: IconName;
  action?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="h-display flex items-center gap-2 text-[1rem] font-semibold">
          {icon && <Icon name={icon} size={17} className="text-brand" />}
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-xs text-ink-3">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-ink-3">{children}</p>;
}

export function Meter({ value, max, color = "var(--brand)" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  const over = value > max;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={value} aria-valuemax={max} aria-valuemin={0}>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "var(--c-red)" : color }} />
    </div>
  );
}

/**
 * A page's title, its line of text and an action. `toggle` is a switch between views of the
 * page: it always sits first, top left, so it stays in the same place whichever view is open.
 */
export function PageHeader({ title, sub, action, toggle }: { title: string; sub?: ReactNode; action?: ReactNode; toggle?: ReactNode }) {
  return (
    <header className="mb-5">
      {toggle && <ViewSwitchSlot>{toggle}</ViewSwitchSlot>}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="h-display text-[1.7rem] font-medium leading-tight md:text-[2rem]">{title}</h1>
          {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
        </div>
        {action}
      </div>
    </header>
  );
}

/** Where a view toggle sits: the top left of the page, the same on every view. */
export function ViewSwitchSlot({ children }: { children: ReactNode }) {
  return <div className="mb-4 flex">{children}</div>;
}

export function Avatar({ initials, color, size = 36 }: { initials: string; color: string; size?: number }) {
  return (
    <span
      className="tint inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{ ...hue(color), width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function timeAgo(iso: string | null, now: Date): string {
  if (!iso) return "";
  const min = Math.round((now.getTime() - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** A list longer than this starts folded. */
export const FOLD_OVER = 4;

/**
 * A queue's list behind one Show / Hide bar. Folded by default when the list is long, so the
 * page stays short; a short list starts open. `label` reads after the verb: "the 32 good fits".
 * With `alert`, the list is waiting on you: the bar shows `alert` as an orange badge instead
 * ("13 jobs to take action on"), so it catches the eye. Show and Hide are still read aloud.
 * `alwaysOpen` starts it open however long it is (the Apply Queue, owner's request, 23 Nov 2026).
 */
export function QueueFold({ count, label, alert, alwaysOpen = false, children }: { count: number; label: string; alert?: string; alwaysOpen?: boolean; children: ReactNode }) {
  return (
    <FoldDetails defaultOpen={alwaysOpen || count <= FOLD_OVER} className="group/fold">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <Icon name="chevron" size={16} className="group-open/fold:rotate-180" />
        {alert ? (
          <>
            <span className="sr-only group-open/fold:hidden">Show</span>
            <span className="sr-only hidden group-open/fold:inline">Hide</span>
            <Pill color="var(--c-warn)" className="!h-auto min-h-7 gap-1.5 whitespace-normal py-1 text-left text-sm">
              <Icon name="alert" size={14} /> {alert}
            </Pill>
          </>
        ) : (
          <>
            <span className="group-open/fold:hidden">Show {label}</span>
            <span className="hidden group-open/fold:inline">Hide {label}</span>
          </>
        )}
      </summary>
      {children}
    </FoldDetails>
  );
}
