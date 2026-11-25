import Link from "next/link";
import { getContext } from "@/lib/context";
import { contactsDue, dueLabel } from "@/lib/domain/relationships";
import { CHANNEL_LABEL, bestChannel, lastChannels, suggestPurpose } from "@/lib/domain/comms";
import { CHANNELS, CIRCLES, type Channel, type Circle } from "@/lib/domain/types";
import { PeopleCompose } from "@/components/client/PeopleCompose";
import { ContactForm, ContactRowActions } from "@/components/client/ContactForm";
import { Icon } from "@/components/Icon";
import { CardHeader, Empty, PageHeader, timeAgo } from "@/components/ui";
import { PeopleBoard } from "@/components/client/PeopleBoard";
import { daysSince, inYourLists, overdue } from "@/lib/domain/people";

export const metadata = { title: "People" };

const CIRCLE_COLOR: Record<Circle, string> = {
  team: "var(--c-blue)",
  family: "var(--c-brown)",
  friends: "var(--c-green)",
  network: "var(--c-indigo)",
};

export default async function PeoplePage({ searchParams }: { searchParams: Promise<{ to?: string; via?: string; about?: string }> }) {
  const { to, via, about } = await searchParams;
  const { store, today, now, settings } = await getContext();
  const [everyone, messages, snippets] = await Promise.all([store.contacts.list(), store.messages.list(), store.snippets.list()]);
  // Phonebook imports you have not placed are only for finding someone when you fill a place.
  const contacts = everyone.filter(inYourLists);
  const imported = everyone.length - contacts.length;
  const due = contactsDue(contacts, today);
  const byId = new Map(everyone.map((c) => [c.id, c]));
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
      <PageHeader title="People" sub="Your closest people: your spouse, then five groups of four. Tap a name to text them, schedule a text, or invite them to something. Atlas drafts and reminds; you send." />

      <PeopleBoard
        people={everyone.map((c) => {
          const since = daysSince(c, today);
          return { id: c.id, name: c.name, phone: c.phone, email: c.email, category: c.category ?? null, slot: c.slot ?? null, since: since === null ? "never" : since === 0 ? "today" : since === 1 ? "yesterday" : `${since} days ago`, overdue: Boolean(c.category) && overdue(c, today) };
        })}
        scheduled={messages
          .filter((m) => m.status === "draft" && m.remindAt)
          .sort((a, b) => (a.remindAt ?? "").localeCompare(b.remindAt ?? ""))
          .map((m) => ({
            id: m.id,
            name: byId.get(m.contactId)?.name ?? "Someone",
            when: new Date(m.remindAt!).toLocaleString("en-US", { timeZone: settings.timezone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
            body: m.body,
            due: Date.parse(m.remindAt!) <= now.getTime(),
          }))}
        today={today}
        timezone={settings.timezone}
      />

      <section className="card card-pad" aria-label="Add people from your iPhone">
        <CardHeader title="Add people from your iPhone" icon="plus" hint="A Shortcut opens your phone's own contact picker and sends Atlas only the person you pick. Atlas never reads your address book." />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
          <li>In the Shortcuts app, make a new Shortcut named <span className="font-medium text-ink">Add to Atlas</span>.</li>
          <li>Add <span className="font-medium text-ink">Select Contact</span>.</li>
          <li>
            Add <span className="font-medium text-ink">Get Contents of URL</span>: <span className="font-mono text-xs">https://atlas-optim.vercel.app/api/capture</span>, Method POST, Header{" "}
            <span className="font-mono text-xs">Authorization: Bearer</span> plus the same capture token your Siri Shortcut uses, Request Body JSON with <span className="font-mono text-xs">kind</span> = contact,{" "}
            <span className="font-mono text-xs">name</span> = the contact&apos;s Name, <span className="font-mono text-xs">phone</span> = Phone Numbers, <span className="font-mono text-xs">email</span> = Email Addresses, and optionally{" "}
            <span className="font-mono text-xs">category</span> = spouse, family, friends, colleagues, mentors or church.
          </li>
          <li>Add <span className="font-medium text-ink">Show Result</span>. Run it, pick someone, and they appear here: placed when you named a category with a free place, otherwise ready to type into any empty place.</li>
        </ol>
      </section>

      <section className="card card-pad" aria-label="Import your contact list">
        <CardHeader
          title="Import your whole contact list"
          icon="people"
          hint={
            imported
              ? `${imported} contacts from your phone are ready: type a name in any empty place to find them. They stay out of your lists until you place them.`
              : "Run once, and any empty place can find anyone in your phone by typing. Names, phones and emails only; they stay out of your lists until you place them."
          }
        />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-2">
          <li>In the Shortcuts app, make a new Shortcut named <span className="font-medium text-ink">Import contacts to Atlas</span>.</li>
          <li>
            Add <span className="font-medium text-ink">Find Contacts</span> (all contacts), then <span className="font-medium text-ink">Repeat with Each</span> item, and inside it a{" "}
            <span className="font-medium text-ink">Dictionary</span> with <span className="font-mono text-xs">name</span> = Repeat Item&apos;s Name, <span className="font-mono text-xs">phone</span> = Phone Numbers,{" "}
            <span className="font-mono text-xs">email</span> = Email Addresses.
          </li>
          <li>
            After the repeat, add <span className="font-medium text-ink">Get Contents of URL</span>: the same address, method and Authorization header as Add to Atlas, Request Body JSON with{" "}
            <span className="font-mono text-xs">kind</span> = contacts and <span className="font-mono text-xs">contacts</span> = Repeat Results (type Array).
          </li>
          <li>
            Add <span className="font-medium text-ink">Show Result</span> and run it. It says how many were added. Running it again later adds only new people and fills in missing numbers; nobody is
            added twice. Up to 2,000 contacts per run.
          </li>
        </ol>
      </section>

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
                      {d.reason === "birthday" && <Icon name="cake" size={15} className="text-[var(--c-brown)]" />}
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
