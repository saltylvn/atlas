"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { addAndPlace, cancelScheduled, draftMessage, markContacted, noteInvite, placePerson, scheduleText, sendScheduled, unplacePerson } from "@/app/actions/people";
import { calendarLink, CATEGORY, searchPeople } from "@/lib/domain/people";
import { PEOPLE_CATEGORIES, type PeopleCategory } from "@/lib/domain/types";
import { Icon } from "../Icon";

export interface BoardPerson {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  category: PeopleCategory | null;
  slot: number | null;
  /** "3 days ago", "never". */
  since: string;
  overdue: boolean;
}

export interface Scheduled {
  id: string;
  name: string;
  when: string;
  body: string;
  due: boolean;
}

type Action = "text" | "schedule" | "invite" | "more";

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/**
 * The People tab's six categories: one place for Spouse, four for each of the rest. Tap a name for Text, Schedule a text, or
 * Invite to an event. An empty place takes anyone already in Atlas (type to find them), or
 * someone new. Atlas drafts and reminds; you send, and you press Save on any invite.
 */
export function PeopleBoard({ people, scheduled, today, timezone }: { people: BoardPerson[]; scheduled: Scheduled[]; today: string; timezone: string }) {
  const [open, setOpen] = useState<{ id: string; action: Action } | null>(null);
  const placed = useMemo(() => {
    const by = new Map<string, BoardPerson>();
    for (const p of people) if (p.category && p.slot) by.set(`${p.category}:${p.slot}`, p);
    return by;
  }, [people]);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PEOPLE_CATEGORIES.map((cat) => (
          <section key={cat} className="card card-pad" aria-label={CATEGORY[cat].label}>
            <h2 className="h-display mb-2 flex items-center gap-2 text-[1rem] font-medium">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CATEGORY[cat].color }} aria-hidden="true" />
              {CATEGORY[cat].label}
            </h2>
            <ul className="space-y-2">
              {Array.from({ length: CATEGORY[cat].slots }, (_, i) => i + 1).map((slot) => {
                const p = placed.get(`${cat}:${slot}`);
                return (
                  <li key={slot}>
                    {p ? (
                      <PersonSlot person={p} open={open?.id === p.id ? open.action : null} onOpen={(action) => setOpen(open?.id === p.id && open.action === action ? null : { id: p.id, action })} today={today} timezone={timezone} />
                    ) : (
                      <EmptySlot category={cat} slot={slot} people={people} />
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <section id="scheduled" className="card card-pad scroll-mt-20" aria-label="Scheduled texts">
        <h2 className="h-display mb-1 text-[1rem] font-medium">Scheduled texts ({scheduled.length})</h2>
        <p className="mb-2 text-xs text-ink-3">Atlas reminds you on your phone when one is due. You send it from Messages.</p>
        {scheduled.length === 0 ? <p className="text-sm text-ink-3">None. Tap a name, then Schedule a text.</p> : <ScheduledList items={scheduled} />}
      </section>
    </div>
  );
}

function PersonSlot({ person, open, onOpen, today, timezone }: { person: BoardPerson; open: Action | null; onOpen: (a: Action) => void; today: string; timezone: string }) {
  return (
    <div className={`rounded-lg border ${open ? "border-line-strong" : "border-line"}`}>
      <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3 py-2 text-left" aria-expanded={Boolean(open)} onClick={() => onOpen(open ?? "text")}>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{person.name}</span>
          <span className={`block text-xs ${person.overdue ? "font-medium text-[color:var(--c-warn)]" : "text-ink-3"}`}>
            {person.overdue ? "Time to reach out · " : ""}last in touch {person.since}
          </span>
        </span>
        <Icon name="chevron" size={16} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="border-t border-line px-3 pb-3 pt-2">
          <div className="mb-2 flex flex-wrap gap-1.5" role="tablist" aria-label={`Ways to reach ${person.name}`}>
            {(
              [
                ["text", "Text"],
                ["schedule", "Schedule a text"],
                ["invite", "Invite to an event"],
                ["more", "More"],
              ] as const
            ).map(([a, label]) => (
              <button key={a} type="button" role="tab" aria-selected={open === a} className={`btn btn-sm ${open === a ? "btn-primary" : "btn-ghost"}`} onClick={() => onOpen(a)}>
                {label}
              </button>
            ))}
          </div>
          {open === "text" && <TextNow person={person} />}
          {open === "schedule" && <ScheduleForm person={person} today={today} />}
          {open === "invite" && <InviteForm person={person} today={today} timezone={timezone} />}
          {open === "more" && <More person={person} />}
        </div>
      )}
    </div>
  );
}

function TextNow({ person }: { person: BoardPerson }) {
  if (!person.phone) return <p className="text-sm text-ink-2">No phone number for {first(person.name)}. Add it below under Add someone, or from your iPhone with the Add to Atlas Shortcut.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-2">Atlas drafts a text in your voice; it opens in Messages for you to send.</p>
      <Link href={`/people?to=${person.id}&via=sms&about=${encodeURIComponent(`A check-in with ${first(person.name)}`)}#compose`} className="btn btn-primary min-h-[44px]">
        <Icon name="send" size={15} /> Write a text to {first(person.name)}
      </Link>
    </div>
  );
}

function ScheduleForm({ person, today }: { person: BoardPerson; today: string }) {
  const [pending, start] = useTransition();
  const [day, setDay] = useState(today);
  const [time, setTime] = useState("18:00");
  const [body, setBody] = useState("");
  const [by, setBy] = useState<"ai" | "template" | "you">("you");
  const [note, setNote] = useState<{ ok: boolean; text: string; calendar?: string } | null>(null);
  if (!person.phone) return <p className="text-sm text-ink-2">Add {first(person.name)}&apos;s phone number to schedule a text.</p>;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-ink-2">
          Day
          <input type="date" className="field mt-1 w-full" value={day} min={today} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="text-xs text-ink-2">
          Time
          <input type="time" className="field mt-1 w-full" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      <label className="block text-xs text-ink-2">
        The text
        <textarea className="field mt-1 min-h-20 w-full" value={body} maxLength={640} onChange={(e) => (setBody(e.target.value), setBy("you"))} placeholder={`Hey ${first(person.name)}, ...`} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm min-h-[44px]"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await draftMessage({ contactId: person.id, channel: "sms", tone: "warm", purpose: `A check-in with ${first(person.name)}` });
              if (r.ok && r.data) {
                setBody(r.data.body);
                setBy(r.data.draftedBy);
              } else if (!r.ok) setNote({ ok: false, text: r.error });
            })
          }
        >
          <Icon name="sparkle" size={14} /> Draft it for me
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm min-h-[44px]"
          disabled={pending || !body.trim()}
          onClick={() =>
            start(async () => {
              const r = await scheduleText({ contactId: person.id, day, time, body, draftedBy: by });
              setNote(r.ok ? { ok: true, text: r.message ?? "Scheduled.", calendar: r.data?.calendar } : { ok: false, text: r.error });
            })
          }
        >
          Schedule
        </button>
      </div>
      {note && (
        <p role="status" className={`text-sm ${note.ok ? "text-ink-2" : "text-bad"}`}>
          {note.text}{" "}
          {note.calendar && (
            <a href={note.calendar} target="_blank" rel="noopener noreferrer" className="font-medium text-brand hover:underline">
              Add a reminder to my calendar at that exact time
            </a>
          )}
        </p>
      )}
    </div>
  );
}

function InviteForm({ person, today, timezone }: { person: BoardPerson; today: string; timezone: string }) {
  const [title, setTitle] = useState(`Catch up with ${first(person.name)}`);
  const [day, setDay] = useState(today);
  const [time, setTime] = useState("12:00");
  const [minutes, setMinutes] = useState(60);
  const [place, setPlace] = useState("");
  const [details, setDetails] = useState("");
  const href = calendarLink({ title, day, time, minutes, place, details, guests: person.email ? [person.email] : [], timezone });
  return (
    <div className="space-y-2">
      <label className="block text-xs text-ink-2">
        What
        <input className="field mt-1 w-full" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <label className="text-xs text-ink-2">
          Day
          <input type="date" className="field mt-1 w-full" value={day} min={today} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="text-xs text-ink-2">
          Time
          <input type="time" className="field mt-1 w-full" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <label className="text-xs text-ink-2">
          How long
          <select className="field mt-1 w-full" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[30, 60, 90, 120, 180].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60} h`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-xs text-ink-2">
        Where
        <input className="field mt-1 w-full" value={place} maxLength={300} onChange={(e) => setPlace(e.target.value)} placeholder="A place, an address, or a video link" />
      </label>
      <label className="block text-xs text-ink-2">
        Note
        <input className="field mt-1 w-full" value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} />
      </label>
      {!person.email && <p className="text-xs text-ink-3">No email for {first(person.name)}, so they are not added as a guest. Add it, or text them the details.</p>}
      <a href={href} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm min-h-[44px]" onClick={() => void noteInvite(person.id)}>
        <Icon name="plan" size={14} /> Open the invite in Google Calendar
      </a>
      <p className="text-xs text-ink-3">Nothing is sent until you press Save in your calendar.</p>
    </div>
  );
}

function More({ person }: { person: BoardPerson }) {
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" disabled={pending} onClick={() => start(async () => void (await markContacted(person.id)))}>
        <Icon name="check" size={14} /> We talked today
      </button>
      <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" disabled={pending} onClick={() => start(async () => void (await unplacePerson(person.id)))}>
        Remove from this place
      </button>
    </div>
  );
}

/** An empty place: type to find someone in Atlas, or add someone new. */
function EmptySlot({ category, slot, people }: { category: PeopleCategory; slot: number; people: BoardPerson[] }) {
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  // People not placed yet come first; someone placed elsewhere can still be found.
  const hits = searchPeople([...people].sort((a, b) => Number(Boolean(a.category)) - Number(Boolean(b.category))), query, 6);
  const listId = `find-${category}-${slot}`;
  return (
    <div className="rounded-lg border border-dashed border-line px-3 py-2">
      <label className="sr-only" htmlFor={listId}>
        Add a {CATEGORY[category].one}
      </label>
      <input
        id={listId}
        className="field w-full"
        placeholder={`Add a ${CATEGORY[category].one}: type a name`}
        value={query}
        autoComplete="off"
        onChange={(e) => (setQuery(e.target.value), setError(""))}
      />
      {query.trim() && (
        <ul className="mt-1 space-y-1">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="flex min-h-[40px] w-full items-center justify-between rounded-md px-2 text-left text-sm hover:bg-surface-2"
                disabled={pending || Boolean(h.category)}
                onClick={() =>
                  start(async () => {
                    const r = await placePerson({ contactId: h.id, category, slot });
                    if (!r.ok) setError(r.error);
                    else setQuery("");
                  })
                }
              >
                <span>{h.name}</span>
                <span className="text-xs text-ink-3">{h.category ? `in ${CATEGORY[h.category].label}` : h.phone ? "Add" : "Add (no phone yet)"}</span>
              </button>
            </li>
          ))}
          <li>
            {!adding ? (
              <button type="button" className="min-h-[40px] w-full rounded-md px-2 text-left text-sm font-medium text-brand hover:bg-surface-2" onClick={() => setAdding(true)}>
                + Add &ldquo;{query.trim()}&rdquo; as someone new
              </button>
            ) : (
              <div className="mt-1 flex gap-2">
                <input className="field min-w-0 flex-1" placeholder="Phone (optional)" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label={`Phone for ${query.trim()}`} />
                <button
                  type="button"
                  className="btn btn-primary btn-sm min-h-[44px]"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await addAndPlace({ name: query.trim(), phone, category, slot });
                      if (!r.ok) setError(r.error);
                      else {
                        setQuery("");
                        setPhone("");
                        setAdding(false);
                      }
                    })
                  }
                >
                  Add
                </button>
              </div>
            )}
          </li>
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

function ScheduledList({ items }: { items: Scheduled[] }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <ul className="divide-y divide-line">
      {items.map((s) => (
        <li key={s.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {s.name} · <span className={s.due ? "text-[color:var(--c-warn)]" : "text-ink-2"}>{s.due ? "due now" : s.when}</span>
            </p>
            <p className="text-xs text-ink-2 break-words">{s.body}</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm min-h-[44px]"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await sendScheduled(s.id);
                  if (r.ok && r.data) window.location.href = r.data.href;
                  else if (!r.ok) setError(r.error);
                })
              }
            >
              <Icon name="send" size={14} /> Send in Messages
            </button>
            <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" disabled={pending} onClick={() => start(async () => void (await cancelScheduled(s.id)))}>
              Cancel
            </button>
          </div>
        </li>
      ))}
      {error && <li className="py-2 text-xs text-bad">{error}</li>}
    </ul>
  );
}
