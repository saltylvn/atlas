import Link from "next/link";
import { NAV } from "@/components/navItems";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/ui";

export const metadata = { title: "More" };

export default function MorePage() {
  const rest = NAV.filter((n) => !n.mobile);
  return (
    <div className="space-y-5">
      <PageHeader title="More" />
      <ul className="card divide-y divide-line">
        {rest.map((n) => (
          <li key={n.href}>
            <Link href={n.href} className="flex items-center gap-3 px-4 py-3.5 text-[0.95rem] font-medium hover:bg-surface-2">
              <Icon name={n.icon} size={19} className="text-brand" />
              <span className="flex-1">{n.label}</span>
              <Icon name="arrow" size={15} className="text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
