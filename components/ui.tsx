import type { CSSProperties, ReactNode } from "react";
import type { Area, Priority, TaskStatus } from "@/lib/domain/types";
import { Icon, type IconName } from "./Icon";

export const STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  todo: { label: "Not started", color: "var(--c-grey)" },
  doing: { label: "Working on it", color: "var(--c-orange)" },
  stuck: { label: "Stuck", color: "var(--c-red)" },
  done: { label: "Done", color: "var(--c-green)" },
};

export const PRIORITY_META: Record<Priority, { label: string; color: string }> = {
  critical: { label: "Critical", color: "var(--c-red)" },
  high: { label: "High", color: "var(--c-orange)" },
  medium: { label: "Medium", color: "var(--c-blue)" },
  low: { label: "Low", color: "var(--c-grey)" },
};

export const AREA_META: Record<Area, { label: string; color: string }> = {
  work: { label: "Work", color: "var(--c-blue)" },
  career: { label: "Career", color: "var(--c-purple)" },
  family: { label: "Family", color: "var(--c-pink)" },
  health: { label: "Health", color: "var(--c-green)" },
  home: { label: "Home", color: "var(--c-teal)" },
  finance: { label: "Finance", color: "var(--c-orange)" },
  personal: { label: "Personal", color: "var(--c-indigo)" },
};

/** Sets the hue a `.pill` or `.tint` element is tinted with. */
export const hue = (color: string) => ({ "--pc": color }) as CSSProperties;

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

export function PageHeader({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="h-display text-[1.7rem] font-medium leading-tight md:text-[2rem]">{title}</h1>
        {sub && <p className="mt-1 text-sm text-ink-2">{sub}</p>}
      </div>
      {action}
    </header>
  );
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
