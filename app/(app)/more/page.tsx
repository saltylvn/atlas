import Link from "next/link";
import { DESKS } from "@/components/navItems";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "More" };

// Every page, desk by desk, in each desk's color: the phone's way to anything the tab bar has no tab for.
export default function MorePage() {
  return (
    <div className="space-y-5">
      <PageHeader title="More" sub="Every page, by desk." />
      {DESKS.map((desk) => (
        <section key={desk.id} aria-labelledby={`more-${desk.id}`} style={{ ["--desk" as string]: desk.color }}>
          <h2 id={`more-${desk.id}`} className="mb-2 flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-[var(--desk)]" />
            <span className="eyebrow text-[color:color-mix(in_oklab,var(--desk)_70%,var(--ink))]">{desk.label}</span>
            <span className="text-xs text-ink-3">{desk.job}</span>
          </h2>
          <ul className="card divide-y divide-line border-l-[3px] border-l-[var(--desk)]">
            {desk.items.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="flex min-h-11 items-center gap-3 px-4 py-3 text-[0.95rem] font-medium hover:bg-surface-2">
                  <Icon name={n.icon} size={19} className="text-[var(--desk)]" />
                  <span className="flex-1">{n.label}</span>
                  <Icon name="arrow" size={15} className="text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
