import Link from "next/link";
import { notFound } from "next/navigation";
import { BriefView } from "@/components/BriefView";
import { Icon } from "@/components/Icon";
import { PageHeader } from "@/components/ui";
import { getContext } from "@/lib/context";
import { SLOT_LABEL } from "@/lib/domain/briefSchedule";
import type { BriefReport } from "@/lib/domain/chiefOfStaff";
import { longDate } from "@/lib/domain/dates";

export const metadata = { title: "Brief" };

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(id)) notFound();
  const { store, settings } = await getContext();
  const brief = await store.briefs.get(id);
  if (!brief) notFound();
  return (
    <div className="space-y-5">
      <PageHeader
        title={SLOT_LABEL[brief.slot]}
        sub={longDate(brief.forDate)}
        action={
          <Link href="/mission" className="btn btn-ghost btn-sm">
            <Icon name="arrow" size={14} className="rotate-180" /> Mission Control
          </Link>
        }
      />
      <BriefView report={brief.report as BriefReport} timeZone={settings.timezone} stored={{ createdAt: brief.createdAt }} aiReady={false} archive />
    </div>
  );
}
