"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createSnippet, deleteSnippet, draftMessage, recordHandOff } from "@/app/actions/people";
import { templateDraft, thoughtDraft } from "@/lib/domain/drafts";
import { TONES, type Tone } from "@/lib/domain/tones";
import { CHANNEL_LABEL, bestChannel, defaultTone, clipboardText, fillSnippet, handOffLink, hasChannel, smsStats } from "@/lib/domain/comms";
import type { Channel, Circle, Snippet } from "@/lib/domain/types";
import { Icon, type IconName } from "../Icon";

export interface ComposerContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  slackTeamId: string | null;
  slackUserId: string | null;
  circle: Circle;
  /** Channel used for the last hand-off, if any. */
  lastChannel: Channel | null;
}

/** One person in the "due today" queue, with the suggested channel and purpose. */
export interface QueueItem {
  id: string;
  via: Channel;
  about: string;
}

const PRESETS = [
  "Checking in to see how things are going",
  "Quick status update on what I shipped this week",
  "Following up on our last conversation",
  "Happy birthday!",
  "Want to grab coffee or a call next week?",
  "Thank you for your help",
];

const CHANNEL_ICON: Record<Channel, IconName> = {
  email: "mail",
  sms: "message",
  slack: "hash",
};
const CHANNELS: Channel[] = ["email", "sms", "slack"];

export function Composer({
  contacts,
  initialId,
  initialChannel,
  initialPurpose,
  snippets,
  queue = [],
  ownerName,
  enabled,
  mode = "checkin",
}: {
  contacts: ComposerContact[];
  initialId?: string;
  initialChannel?: Channel;
  initialPurpose?: string;
  snippets: Snippet[];
  queue?: QueueItem[];
  ownerName: string;
  enabled: boolean;
  /** "share": the purpose is a thought of yours, kept in your words for each person in the queue. */
  mode?: "checkin" | "share";
}) {
  const sharing = mode === "share";
  const instantDraft = sharing ? thoughtDraft : templateDraft;
  const instantNote = sharing ? "Your words, with a greeting. Make it personal if you like, then send." : "Instant draft. Tap Rewrite with Claude for a better one, or just send.";
  const first = contacts.find((c) => c.id === initialId) ?? contacts[0];
  const startChannel = first ? (initialChannel && hasChannel(first, initialChannel) ? initialChannel : bestChannel(first, first.lastChannel)) : "email";
  // Quick send: arrive with an instant offline draft so one more tap opens the app.
  const instant = first && initialPurpose ? instantDraft(first, initialPurpose, startChannel, ownerName) : null;

  const [contactId, setContactId] = useState(first?.id ?? "");
  const contact = contacts.find((c) => c.id === contactId);
  const [channel, setChannel] = useState<Channel>(startChannel);
  const [tone, setTone] = useState<Tone>(first ? defaultTone(first.circle) : "warm");
  const [purpose, setPurpose] = useState(initialPurpose ?? "");
  const [subject, setSubject] = useState(instant?.subject ?? "");
  const [body, setBody] = useState(instant?.body ?? "");
  const [draftedBy, setDraftedBy] = useState<"ai" | "template" | "you">(instant ? "template" : "you");
  const [note, setNote] = useState(instant ? instantNote : "");
  const [error, setError] = useState("");
  const [sent, setSent] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [slackFallback, setSlackFallback] = useState(false);
  const [savingSnippet, setSavingSnippet] = useState(false);
  const [snippetTitle, setSnippetTitle] = useState("");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const link = useMemo(() => (contact ? handOffLink(channel, contact, subject, body) : null), [contact, channel, subject, body]);
  const missing = contact && !hasChannel(contact, channel);
  const channelSnippets = snippets.filter((s) => s.channel === channel);
  const justSent = contact ? sent.includes(contact.id) : false;
  const nextUp = queue.find((q) => !sent.includes(q.id) && q.id !== contactId);
  const label = CHANNEL_LABEL[channel];

  if (contacts.length === 0 || !contact) return <p className="text-sm text-ink-3">Add a contact first.</p>;

  function reset(next: { id: string; via?: Channel; about?: string }) {
    const c = contacts.find((x) => x.id === next.id);
    if (!c) return;
    const ch = next.via && hasChannel(c, next.via) ? next.via : bestChannel(c, c.lastChannel);
    setContactId(c.id);
    setChannel(ch);
    setTone(defaultTone(c.circle));
    setPurpose(next.about ?? "");
    const t = next.about ? instantDraft(c, next.about, ch, ownerName) : null;
    setSubject(t?.subject ?? "");
    setBody(t?.body ?? "");
    setDraftedBy(t ? "template" : "you");
    setNote(t ? instantNote : "");
    setError("");
    setCopied(false);
    setSlackFallback(false);
  }

  function switchChannel(ch: Channel) {
    setChannel(ch);
    setSlackFallback(false);
    // Keep instant drafts in the right shape for the new channel; never overwrite your own words.
    if (draftedBy === "template" && purpose.trim().length >= 3 && contact) {
      const t = instantDraft(contact, purpose, ch, ownerName);
      setSubject(t.subject);
      setBody(t.body);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(clipboardText(channel, subject, body));
      setCopied(true);
      return true;
    } catch {
      setError("Couldn't copy. Select the text and copy it by hand.");
      return false;
    }
  }

  function record() {
    const cid = contactId;
    start(async () => {
      const r = await recordHandOff({
        contactId: cid,
        channel,
        subject: channel === "email" ? subject : "",
        body,
        draftedBy,
      });
      if (r.ok) setSent((s) => [...s, cid]);
      else setError(r.error);
    });
  }

  function draft() {
    start(async () => {
      setError("");
      const r = await draftMessage({ contactId, channel, tone, purpose });
      if (!r.ok) return setError(r.error);
      if (r.data) {
        setSubject(r.data.subject);
        setBody(r.data.body);
        setDraftedBy(r.data.draftedBy);
        setNote(r.data.note ?? (r.data.draftedBy === "ai" ? "Drafted by Claude. Read it before you send." : ""));
      }
    });
  }

  const canOpen = Boolean(link && enabled && body.trim());
  const stats = smsStats(body);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label>
          <span className="label">To</span>
          <select className="field min-h-[44px]" value={contactId} onChange={(e) => reset({ id: e.target.value })}>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.circle}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="label">Tone</span>
          <select className="field min-h-[44px] capitalize" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
            {TONES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <span className="label">Channel</span>
        <div className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-surface-2 p-1" role="radiogroup" aria-label="Channel">
          {CHANNELS.map((ch) => {
            const ok = hasChannel(contact, ch);
            return (
              <button
                key={ch}
                type="button"
                role="radio"
                aria-checked={channel === ch}
                onClick={() => switchChannel(ch)}
                title={ok ? undefined : `No ${ch === "email" ? "email" : ch === "sms" ? "phone" : "Slack ID"} for ${contact.name}`}
                className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-semibold ${
                  channel === ch ? "bg-surface text-ink ring-1 ring-line-strong" : ok ? "text-ink-2" : "text-ink-3 opacity-60"
                }`}
              >
                <Icon name={CHANNEL_ICON[ch]} size={16} />
                {CHANNEL_LABEL[ch].short}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className="label">{sharing ? "Your thought" : "What\u2019s it about?"}</span>
        <input
          className="field min-h-[44px]"
          value={purpose}
          maxLength={500}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="e.g. Ask if Saturday still works for the hike"
        />
      </label>
      {!sharing && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible">
          {PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setPurpose(p)} className="chip min-h-[36px] shrink-0 hover:border-brand-border hover:text-brand">
              {p}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:flex">
        <button type="button" className="btn btn-ghost min-h-[44px]" disabled={pending || purpose.trim().length < 3} onClick={draft}>
          <Icon name="wand" size={16} /> {pending ? "Drafting…" : body && draftedBy !== "you" ? "Rewrite with Claude" : "Draft it"}
        </button>
      </div>

      {channelSnippets.length > 0 && (
        <div>
          <span className="label">Snippets</span>
          <div className="flex flex-wrap gap-1.5">
            {channelSnippets.map((s) => (
              <span key={s.id} className="inline-flex items-center overflow-hidden rounded-full border border-line bg-surface">
                <button
                  type="button"
                  className="min-h-[40px] px-3 text-sm font-medium hover:text-brand"
                  onClick={() => {
                    setBody(fillSnippet(s.body, contact, ownerName));
                    if (channel === "email" && !subject) setSubject(s.title);
                    setDraftedBy("template");
                    setNote(`From your "${s.title}" snippet.`);
                  }}
                >
                  {s.title}
                </button>
                <button
                  type="button"
                  aria-label={`Delete snippet ${s.title}`}
                  className="flex min-h-[40px] items-center px-2 text-ink-3 hover:text-bad"
                  onClick={() => start(async () => void (confirm(`Delete snippet "${s.title}"?`) && (await deleteSnippet(s.id))))}
                >
                  <Icon name="x" size={13} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
        {channel === "email" && (
          <input
            className="field min-h-[44px]"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            aria-label="Subject"
            maxLength={200}
          />
        )}
        <textarea
          className="field min-h-[150px] leading-relaxed"
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            if (draftedBy !== "you" && !e.target.value) setDraftedBy("you");
          }}
          placeholder={channel === "slack" ? "Short and casual works best on Slack" : "Write or draft a message"}
          aria-label="Message"
          maxLength={5000}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
          <span>{note}</span>
          {channel === "sms" && (
            <span className={stats.segments > 2 ? "font-semibold text-bad" : ""} aria-live="polite">
              {stats.chars} chars · {stats.segments} {stats.segments === 1 ? "text" : "texts"}
            </span>
          )}
          {channel === "slack" && <span className={stats.chars > 300 ? "font-semibold text-bad" : ""}>{stats.chars} chars</span>}
        </div>
        {missing && (
          <p className="text-sm text-bad">
            No {channel === "email" ? "email address" : channel === "sms" ? "phone number" : "Slack member ID"} for {contact.name}. Add it under Edit on their
            row.
          </p>
        )}
        {channel === "slack" && link && (
          <p className="text-xs text-ink-3">Slack links can&apos;t carry text, so Atlas copies your draft and opens the DM. Paste, then Send.</p>
        )}

        <div className="grid grid-cols-[1fr_auto] gap-2">
          {canOpen && link ? (
            <a
              href={link.href}
              className="btn btn-primary min-h-[48px] min-w-0 px-3 text-base"
              onClick={(e) => {
                setError("");
                if (link.copyFirst) {
                  // Copy inside the tap (clipboard needs a user gesture), then open the app.
                  e.preventDefault();
                  void copy().finally(() => {
                    window.location.href = link.href;
                  });
                  if (timer.current) clearTimeout(timer.current);
                  timer.current = setTimeout(() => {
                    if (document.visibilityState === "visible") setSlackFallback(true);
                  }, 1500);
                }
                record();
              }}
            >
              <Icon name={CHANNEL_ICON[channel]} size={18} className="shrink-0" />
              {link.copyFirst ? `Copy & open ${label.app}` : `Open in ${label.app}`}
            </a>
          ) : (
            <button type="button" className="btn btn-primary min-h-[48px] min-w-0 px-3 text-base" disabled>
              {!enabled ? "Kill switch is on" : missing ? `Can't open ${label.app}` : `Open in ${label.app}`}
            </button>
          )}
          <button type="button" className="btn btn-ghost min-h-[48px] px-3" disabled={!body} onClick={() => void copy()} aria-label="Copy message">
            <Icon name={copied ? "check" : "copy"} size={16} />
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>

        {slackFallback && link?.fallbackHref && (
          <a href={link.fallbackHref} target="_blank" rel="noopener noreferrer" className="btn btn-ghost min-h-[44px] w-full whitespace-normal text-center">
            <Icon name="external" size={15} /> Slack didn&apos;t open? Open it in the browser
          </a>
        )}

        {body.trim() && !savingSnippet && (
          <button type="button" className="text-xs font-semibold text-brand underline-offset-2 hover:underline" onClick={() => setSavingSnippet(true)}>
            Save as {label.short} snippet
          </button>
        )}
        {savingSnippet && (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              // Store the reusable version: the contact's first name becomes {first}.
              const firstName = contact.name.split(/[ (]/)[0] || contact.name;
              const generic = firstName.length > 1 ? body.split(firstName).join("{first}") : body;
              start(async () => {
                const r = await createSnippet({
                  channel,
                  title: snippetTitle,
                  body: generic,
                });
                if (!r.ok) return setError(r.error);
                setSavingSnippet(false);
                setSnippetTitle("");
              });
            }}
          >
            <input
              className="field min-h-[44px]"
              value={snippetTitle}
              onChange={(e) => setSnippetTitle(e.target.value)}
              maxLength={60}
              placeholder="Snippet name"
              aria-label="Snippet name"
              required
              autoFocus
            />
            <button className="btn btn-ghost min-h-[44px]" disabled={pending || !snippetTitle.trim()}>
              Save
            </button>
            <button type="button" className="btn btn-ghost min-h-[44px]" onClick={() => setSavingSnippet(false)} aria-label="Cancel">
              <Icon name="x" size={14} />
            </button>
          </form>
        )}

        {justSent && (
          <div className="space-y-2 rounded-lg bg-surface p-2.5">
            <p className="text-sm font-medium text-good">
              Handed off. Marked {contact.name} as contacted.
              {queue.length > 1 && (
                <span className="font-normal text-ink-3">
                  {" "}
                  {queue.filter((q) => sent.includes(q.id)).length} of {queue.length} {sharing ? "sent" : "due done"}.
                </span>
              )}
            </p>
            {nextUp && (
              <button type="button" className="btn btn-ghost min-h-[44px] w-full whitespace-normal" onClick={() => reset(nextUp)}>
                {sharing ? "Next" : "Next due"}: {contacts.find((c) => c.id === nextUp.id)?.name} ({CHANNEL_LABEL[nextUp.via].short}) <Icon name="arrow" size={15} />
              </button>
            )}
          </div>
        )}
      </div>
      {error && <p className="text-sm text-bad">{error}</p>}
      <p className="text-xs text-ink-3">Atlas never sends on its own. You review the draft and tap Send in your own Mail, Messages or Slack.</p>
    </div>
  );
}
