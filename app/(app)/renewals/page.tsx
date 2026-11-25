import Link from "next/link";
import { financeAgentWork } from "@/lib/agents/finance";
import { getContext } from "@/lib/context";
import { billLine, trackSuggestion, type FinanceBill } from "@/lib/domain/financeAgent";
import { renewalDueLabel, renewalHref, renewalView, renewalWhen, type RenewalKind, type RenewalRow } from "@/lib/domain/renewals";
import { RenewalActions, RenewalForm, TrackBillForm } from "@/components/client/RenewalForm";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, Pill } from "@/components/ui";

export const metadata = { title: "Renewals" };

const KIND_COLOR: Record<RenewalKind, string> = {
  bill: "var(--c-blue)",
  renewal: "var(--c-indigo)",
  document: "var(--c-slate)",
};

const KIND_LABEL: Record<RenewalKind, string> = { bill: "Bill", renewal: "Renewal", document: "Document" };

function Row({ row, today }: { row: RenewalRow; today: string }) {
  const href = renewalHref(row.renewal.url);
  const when = renewalWhen(row.daysUntil);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{row.renewal.title}</p>
        <p className={`mt-0.5 text-xs ${row.attention === "overdue" ? "font-semibold text-bad" : "text-ink-3"}`}>
          <span className="sr-only">{KIND_LABEL[row.renewal.kind]}. </span>
          Due {renewalDueLabel(row.renewal.dueOn, today)} · {when}
        </p>
        {row.renewal.notes && <p className="mt-1 text-xs text-ink-2">{row.renewal.notes}</p>}
      </div>
      <Pill color={KIND_COLOR[row.renewal.kind]}>{KIND_LABEL[row.renewal.kind]}</Pill>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-ghost min-h-11 px-3 text-sm">
          Open <Icon name="external" size={14} />
        </a>
      )}
      <RenewalActions id={row.renewal.id} once={row.renewal.cadence === "once"} />
    </li>
  );
}

function BillRow({ bill, today }: { bill: FinanceBill; today: string }) {
  const t = trackSuggestion(bill);
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className={bill.status === "alert" ? "font-semibold text-bad" : "font-medium"}>{billLine(bill)}</p>
        {bill.trackedId && <Pill color="var(--c-green)">On your list</Pill>}
      </div>
      <p className="text-xs text-ink-3">{bill.subject}</p>
      {!bill.trackedId && bill.status !== "paid" && <TrackBillForm title={t.title} kind={t.kind} dueOn={t.dueOn} cadence={t.cadence} today={today} />}
    </li>
  );
}

export default async function RenewalsPage() {
  const ctx = await getContext();
  const { store, today } = ctx;
  const [list, finance] = await Promise.all([store.renewals.list(), financeAgentWork(ctx).catch(() => null)]);
  const view = renewalView(list, today);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Renewals"
        sub="Bills, registrations and documents. Atlas shows them inside the lead window. Mark a repeating one handled and the next due date rolls forward."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {finance && finance.bills.length > 0 && (
            <section className="card overflow-hidden">
              <div className="card-pad pb-2">
                <CardHeader
                  title="From your email"
                  icon="mail"
                  hint="Bills, statements and payment alerts the Finance bot found. Track one and it joins your list; nothing is added without your click."
                />
              </div>
              <ul className="divide-y divide-line">
                {finance.bills.map((b) => (
                  <BillRow key={`${b.key}-${b.name}`} bill={b} today={today} />
                ))}
              </ul>
            </section>
          )}
          <section className="card overflow-hidden">
            <div className="card-pad pb-2">
              <CardHeader title="Needs attention" icon="alert" hint="Overdue, due today, or inside the warning window." />
            </div>
            {view.attention.length === 0 ? (
              <div className="px-4 pb-4">
                <Empty>Nothing is due inside its warning window.</Empty>
              </div>
            ) : (
              <ul className="divide-y divide-line">{view.attention.map((row) => <Row key={row.renewal.id} row={row} today={today} />)}</ul>
            )}
          </section>
          <section className="card overflow-hidden">
            <div className="card-pad pb-2">
              <CardHeader title="Later" icon="clock" hint="Outside the warning window." />
            </div>
            {view.later.length === 0 ? (
              <div className="px-4 pb-4">
                <Empty>Nothing else is on the list.</Empty>
              </div>
            ) : (
              <ul className="divide-y divide-line">{view.later.map((row) => <Row key={row.renewal.id} row={row} today={today} />)}</ul>
            )}
          </section>
        </div>
        <div className="space-y-5">
          <section className="card card-pad h-fit">
            <CardHeader title="Add one" icon="plus" />
            <RenewalForm />
            <p className="mt-3 text-xs text-ink-3">
              One-time items clear when you mark them done. Monthly and yearly items keep their day of month, including the 31st.{" "}
              <Link href="/settings" className="text-brand">
                Settings
              </Link>
            </p>
          </section>
          <section className="card card-pad h-fit">
            <CardHeader title="Deals" icon="bulb" hint="From the stores you keep (Settings). Holiday and 30%+ sales first." />
            {!finance || finance.deals.length === 0 ? (
              <Empty>No sales from your stores in recent email.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {finance.deals.map((d) => (
                  <li key={d.store}>
                    <span className="font-medium">{d.store}</span>
                    {d.major && (
                      <span className="ml-1.5">
                        <Pill color="var(--c-green)">{d.holiday ? "Holiday sale" : "Big sale"}</Pill>
                      </span>
                    )}
                    <p className="text-xs text-ink-2">{d.subject}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
