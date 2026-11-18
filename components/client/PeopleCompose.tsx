"use client";

import { useMemo, useState } from "react";
import { CHANNEL_LABEL, textFirst } from "@/lib/domain/comms";
import { CIRCLES, type Channel, type Circle, type Snippet } from "@/lib/domain/types";
import { Icon } from "../Icon";
import { CardHeader } from "../ui";
import { Composer, type ComposerContact, type QueueItem } from "./Composer";

/** Longest thought to share: it has to fit a text with a greeting in front. */
const THOUGHT_MAX = 500;

/**
 * The left side of People: share one thought or idea with several people, and the
 * composer that sends each message. Sharing builds a queue: one draft per person, in your
 * own words with their name, a text whenever they have a phone number. You open and send
 * each one yourself (Semi-Automation: Atlas never sends).
 */
export function PeopleCompose({
  contacts,
  initialId,
  initialChannel,
  initialPurpose,
  snippets,
  queue,
  ownerName,
  enabled,
}: {
  contacts: ComposerContact[];
  initialId?: string;
  initialChannel?: Channel;
  initialPurpose?: string;
  snippets: Snippet[];
  queue: QueueItem[];
  ownerName: string;
  enabled: boolean;
}) {
  const [thought, setThought] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  // A started share: its queue replaces the due queue until you stop. `run` remounts the composer.
  const [share, setShare] = useState<{ run: number; queue: QueueItem[] } | null>(null);

  // Who can be reached at all, and how a shared thought would go to each.
  const via = useMemo(() => new Map(contacts.map((c) => [c.id, textFirst(c, c.lastChannel)])), [contacts]);
  const reachable = contacts.filter((c) => via.get(c.id));
  const circles = CIRCLES.filter((circle) => reachable.some((c) => c.circle === circle));
  const ready = thought.trim().length >= 3 && picked.length > 0;

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  function toggleCircle(circle: Circle) {
    const ids = reachable.filter((c) => c.circle === circle).map((c) => c.id);
    setPicked((p) => (ids.every((id) => p.includes(id)) ? p.filter((id) => !ids.includes(id)) : [...new Set([...p, ...ids])]));
  }
  function start() {
    // In the order shown, so the queue reads like the list.
    const order = reachable.filter((c) => picked.includes(c.id));
    setShare({ run: (share?.run ?? 0) + 1, queue: order.map((c) => ({ id: c.id, via: via.get(c.id)!, about: thought.trim() })) });
    document.getElementById("compose")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function stop() {
    setShare(null);
    setPicked([]);
    setThought("");
  }

  return (
    <div className="min-w-0 space-y-5">
      <section id="share" className="card card-brand card-pad scroll-mt-4">
        <CardHeader title="Share a thought or idea" icon="message" hint="Write it once, pick who gets it. Each person gets their own text, in your words. You send every one." />
        {reachable.length === 0 ? (
          <p className="text-sm text-ink-3">Add someone with a phone number first.</p>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="label">What&apos;s on your mind?</span>
              <textarea
                className="field min-h-[88px] leading-relaxed"
                value={thought}
                maxLength={THOUGHT_MAX}
                onChange={(e) => setThought(e.target.value)}
                placeholder="e.g. Read something today that made me think of you. Got ten minutes this week to talk it over?"
              />
            </label>
            <div>
              <span className="label">Who gets it?</span>
              <div className="space-y-2">
                {circles.map((circle) => {
                  const list = reachable.filter((c) => c.circle === circle);
                  const all = list.every((c) => picked.includes(c.id));
                  return (
                    <div key={circle} className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        aria-pressed={all}
                        onClick={() => toggleCircle(circle)}
                        className="min-h-[36px] w-[4.5rem] shrink-0 text-left text-xs font-semibold capitalize text-ink-3 hover:text-brand"
                        title={all ? `Clear ${circle}` : `Pick all of ${circle}`}
                      >
                        {circle}
                      </button>
                      {list.map((c) => {
                        const on = picked.includes(c.id);
                        const ch = via.get(c.id)!;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggle(c.id)}
                            title={`${CHANNEL_LABEL[ch].short} to ${c.name}`}
                            className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${
                              on ? "border-brand-solid bg-brand-solid text-[color:var(--on-brand)]" : "border-line bg-surface text-ink-2 hover:border-brand-border"
                            }`}
                          >
                            {on && <Icon name="check" size={13} />}
                            {c.name.split(/[ (]/)[0] || c.name}
                            {ch !== "sms" && <span className="text-xs opacity-80">· {CHANNEL_LABEL[ch].short}</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-primary min-h-[44px]" disabled={!ready} onClick={start}>
                <Icon name="send" size={15} /> {picked.length ? `Draft ${picked.length} ${picked.length === 1 ? "message" : "messages"}` : "Pick who gets it"}
              </button>
              {share && (
                <button type="button" className="btn btn-ghost min-h-[44px]" onClick={stop}>
                  Done sharing
                </button>
              )}
              {share && <span className="text-xs text-ink-3">Sharing with {share.queue.length}. Each draft opens below, one at a time.</span>}
            </div>
          </div>
        )}
      </section>

      <section id="compose" className="card card-pad min-w-0 scroll-mt-4">
        <CardHeader title={share ? "Send your thought" : "Compose"} icon="wand" hint={share ? "One person at a time. Edit, then open it in your own app and send." : "Comms drafts it, you send it."} />
        {share ? (
          <Composer
            key={`share-${share.run}`}
            mode="share"
            contacts={contacts}
            initialId={share.queue[0]!.id}
            initialChannel={share.queue[0]!.via}
            initialPurpose={share.queue[0]!.about}
            snippets={snippets}
            queue={share.queue}
            ownerName={ownerName}
            enabled={enabled}
          />
        ) : (
          <Composer
            key={`${initialId}-${initialChannel ?? ""}-${initialPurpose ?? ""}`}
            contacts={contacts}
            initialId={initialId}
            initialChannel={initialChannel}
            initialPurpose={initialPurpose}
            snippets={snippets}
            queue={queue}
            ownerName={ownerName}
            enabled={enabled}
          />
        )}
      </section>
    </div>
  );
}
