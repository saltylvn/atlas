import Link from "next/link";
import { getContext } from "@/lib/context";
import { contactsDue, dueLabel } from "@/lib/domain/relationships";
import { CHANNEL_LABEL, bestChannel, lastChannels, suggestPurpose } from "@/lib/domain/comms";
import { CHANNELS, CIRCLES, type Channel, type Circle } from "@/lib/domain/types";
import { PeopleCompose } from "@/components/client/PeopleCompose";
import { ContactForm, ContactRowActions } from "@/components/client/ContactForm";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, timeAgo } from "@/components/ui";

export const metadata = { title: "People" };

const CIRCLE_COLOR: Record<Circle, string> = {
  team: "var(--c-blue)",
  family: "var(--c-pink)",
  friends: "var(--c-green)",
  network: "var(--c-purple)",
};

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ to?: string; via?: string; about?: string }> }) {
  const { to, via, about } = await searchParams;
  const { store, today, now, settings } = await getContext();
  const [contacts, messages, snippets] = await Promise.all([store.contacts.list(), store.messages.list(), store.snippets.list()]);
  const due = contactsDue(contacts, today);
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const recent = messages
    .filter((m) => m.status === "handed_off")
    .sort((a, b) => (b.handedOffAt ?? "").localeCompare(a.handedOffAt ?? ""))
    .slice(0, 8);
  const last = lastChannels(messages);
  // Quick send: each due person gets the best channel and a suggested purpose.
  const queue = due.map((d) => ({
    id: d.contact.id,
    via: bestChannel(d.contact, last.get(d.contact.id)),
    about: suggestPurpose(d.contact, d),
  }));
  const quick = (q: { id: string; via: Channel; about: string }) => `/people?to=${q.id}&via=${q.via}&about=${encodeURIComponent(q.about)}#compose`;
  const initial = to && byId.has(to) ? to : due[0]?.contact.id;
  const initialChannel = (CHANNELS as readonly string[]).includes(via ?? "") ? (via as Channel) : undefined;
  const initialPurpose = about ? about.trim().slice(0, 200) : undefined;

  return (
    <div className="space-y-5">
      <PageHeader title="People" sub="Keep in touch by text: check in, or share a thought or idea. Atlas drafts, you send." />

      <div className="grid items-start gap-5 lg:grid-cols-[1.25fr_1fr]">
        <PeopleCompose
          contacts={contacts.map((c) => ({
            id: c.id,
            name: c.name,
            email: c.email,
            phone: c.phone,
            slackTeamId: c.slackTeamId ?? null,
            slackUserId: c.slackUserId ?? null,
            circle: c.circle,
            lastChannel: last.get(c.id) ?? null,
          }))}
          initialId={initial}
          initialChannel={initialChannel}
          initialPurpose={initialPurpose}
          snippets={snippets}
          queue={queue}
          ownerName={settings.displayName}
          enabled={settings.outboundEnabled}
        />

        <section className="card card-pad min-w-0">
          <CardHeader
            title="Due a check-in"
            icon="clock"
            hint="From each person's cadence and birthday."
            action={
              queue.length > 1 ? (
                <Link href={quick(queue[0]!)} className="btn btn-primary min-h-[44px] shrink-0 px-3 text-sm">
                  <Icon name="send" size={15} /> Start all {queue.length}
                </Link>
              ) : null
            }
          />
          {due.length === 0 ? (
            <Empty>Everyone is up to date.</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {due.map((d, i) => (
                <li key={d.contact.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold">
                      {d.reason === "birthday" && <Icon name="cake" size={15} className="text-[var(--c-pink)]" />}
                      {d.contact.name}
                    </p>
                    <p className={`text-xs ${d.reason === "cadence" && d.days > 3 ? "font-semibold text-bad" : "text-ink-3"}`}>
                      {dueLabel(d)}
                      {d.contact.notes ? ` · ${d.contact.notes}` : ""}
                    </p>
                  </div>
                  <Link
                    href={quick(queue[i]!)}
                    className="btn btn-ghost min-h-[44px] shrink-0"
                    aria-label={`Quick send to ${d.contact.name} by ${CHANNEL_LABEL[queue[i]!.via].short}`}
                  >
                    <Icon name="send" size={15} />
                    {CHANNEL_LABEL[queue[i]!.via].short}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
        <div className="min-w-0 space-y-5">
          {CIRCLES.map((circle) => {
            const list = contacts.filter((c) => c.circle === circle).sort((a, b) => a.name.localeCompare(b.name));
            if (list.length === 0) return null;
            return (
              <section key={circle} className="card overflow-hidden" style={{ ["--group" as string]: CIRCLE_COLOR[circle] }}>
                <header className="group-bar flex items-center justify-between px-4 py-3">
                  <h2 className="h-display font-semibold capitalize" style={{ color: CIRCLE_COLOR[circle] }}>
                    {circle}
                  </h2>
                  <span className="text-xs text-ink-3">{list.length}</span>
                </header>
                <ul className="group-bar divide-y divide-line border-t border-line">
                  {list.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{c.name}</p>
                        <p className="truncate text-xs text-ink-3">
                          {c.cadenceDays ? `Every ${c.cadenceDays}d` : "No cadence"} · {c.lastContactAt ? `last ${timeAgo(c.lastContactAt, now)}` : "never"}
                          {c.birthday ? ` · 🎂 ${c.birthday}` : ""}
                        </p>
                      </div>
                      <span className="hidden gap-1 text-ink-3 sm:flex">
                        {c.email && <Icon name="mail" size={15} />}
                        {c.phone && <Icon name="message" size={15} />}
                        {c.slackUserId && <Icon name="hash" size={15} />}
                      </span>
                      <Link
                        href={quick({
                          id: c.id,
                          via: bestChannel(c, last.get(c.id)),
                          about: suggestPurpose(
                            c,
                            due.find((d) => d.contact.id === c.id),
                          ),
                        })}
                        className="btn btn-ghost min-h-[44px] min-w-[44px] px-3"
                        aria-label={`Quick send to ${c.name}`}
                      >
                        <Icon name="send" size={15} />
                      </Link>
                      <ContactRowActions contact={c} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <div className="min-w-0 space-y-5">
          <section className="card card-pad">
            <CardHeader title="Add someone" icon="plus" />
            <ContactForm />
          </section>
          <section className="card card-pad">
            <CardHeader title="Recently sent" icon="mail" />
            {recent.length === 0 ? (
              <Empty>Nothing handed off yet.</Empty>
            ) : (
              <ul className="space-y-2">
                {recent.map((m) => (
                  <li key={m.id} className="rounded-lg bg-surface-2 px-3 py-2">
                    <p className="text-sm font-medium">
                      {byId.get(m.contactId)?.name ?? "Removed contact"}{" "}
                      <span className="text-xs font-normal text-ink-3">
                        · {m.channel} · {timeAgo(m.handedOffAt, now)}
                      </span>
                    </p>
                    <p className="line-clamp-2 text-xs text-ink-2">{m.subject || m.body}</p>
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
