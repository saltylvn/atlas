"use client";

import type { ActionResult } from "@/app/actions/_shared";
import { useActionState, useEffect, useRef, useTransition } from "react";
import { createContact, deleteContact, markContacted, updateContact } from "@/app/actions/people";
import { CIRCLES, type Contact } from "@/lib/domain/types";
import { Icon } from "../Icon";

type Result = ActionResult | null;

export function ContactForm({ contact, onDone }: { contact?: Contact; onDone?: () => void }) {
  const [state, action, pending] = useActionState(contact ? updateContact : createContact, null as Result);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state?.ok) return;
    if (contact) onDone?.();
    else ref.current?.reset();
  }, [state, contact, onDone]);
  return (
    <form ref={ref} action={action} className="grid gap-2 sm:grid-cols-2">
      {contact && <input type="hidden" name="id" value={contact.id} />}
      <label className="sm:col-span-2">
        <span className="label">Name</span>
        <input name="name" required maxLength={120} className="field" defaultValue={contact?.name} />
      </label>
      <label>
        <span className="label">Circle</span>
        <select name="circle" className="field capitalize" defaultValue={contact?.circle ?? "friends"}>
          {CIRCLES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Check in every (days)</span>
        <input name="cadenceDays" type="number" min={0} max={365} defaultValue={contact?.cadenceDays ?? 14} className="field" />
      </label>
      <label>
        <span className="label">Email</span>
        <input name="email" type="email" autoComplete="off" className="field" defaultValue={contact?.email ?? ""} />
      </label>
      <label>
        <span className="label">Phone</span>
        <input name="phone" type="tel" autoComplete="off" className="field" defaultValue={contact?.phone ?? ""} />
      </label>
      <label>
        <span className="label">Slack member ID or link</span>
        <input
          name="slackMember"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="U012AB3CD"
          className="field"
          defaultValue={contact?.slackUserId ?? ""}
        />
      </label>
      <label>
        <span className="label">Slack workspace ID</span>
        <input
          name="slackTeam"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="T012AB3CD"
          className="field"
          defaultValue={contact?.slackTeamId ?? ""}
        />
      </label>
      <p className="text-xs text-ink-3 sm:col-span-2">
        Slack: open their profile, tap ⋯ then Copy member ID. The workspace ID is the T… part of your Slack web address. Pasting an app.slack.com link fills
        both.
      </p>
      <label>
        <span className="label">Birthday (MM-DD)</span>
        <input
          name="birthday"
          placeholder="04-27"
          pattern="(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])"
          className="field"
          defaultValue={contact?.birthday ?? ""}
        />
      </label>
      <label>
        <span className="label">Notes</span>
        <input name="notes" maxLength={2000} className="field" defaultValue={contact?.notes ?? ""} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button className="btn btn-primary min-h-[44px]" disabled={pending}>
          {contact ? (
            <>
              <Icon name="check" size={16} /> Save
            </>
          ) : (
            <>
              <Icon name="plus" size={16} /> Add contact
            </>
          )}
        </button>
        {state && !state.ok && <span className="text-sm text-bad">{state.error}</span>}
        {state?.ok && !contact && <span className="text-sm text-good">{state.message}</span>}
      </div>
    </form>
  );
}

export function ContactRowActions({ contact }: { contact: Contact }) {
  const [pending, start] = useTransition();
  const dialog = useRef<HTMLDialogElement>(null);
  const { id, name } = contact;
  return (
    <div className="flex gap-1">
      <button
        type="button"
        disabled={pending}
        className="btn btn-ghost min-h-[44px] min-w-[44px] px-3"
        onClick={() => start(async () => void (await markContacted(id)))}
        title="Mark as contacted today"
        aria-label={`Mark ${name} as contacted today`}
      >
        <Icon name="check" size={15} />
      </button>
      <button type="button" className="btn btn-ghost min-h-[44px] px-3 text-sm" onClick={() => dialog.current?.showModal()} aria-label={`Edit ${name}`}>
        Edit
      </button>
      <dialog
        ref={dialog}
        className="m-auto w-[min(560px,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <div className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="h-display text-lg font-semibold">Edit {name}</h2>
            <button type="button" className="btn btn-ghost min-h-[44px] min-w-[44px] px-3" onClick={() => dialog.current?.close()} aria-label="Close">
              <Icon name="x" size={15} />
            </button>
          </div>
          <ContactForm contact={contact} onDone={() => dialog.current?.close()} />
          <div className="mt-4 border-t border-line pt-3">
            <button
              type="button"
              disabled={pending}
              className="btn btn-ghost min-h-[44px] text-bad"
              onClick={() => start(async () => void (confirm(`Delete ${name}?`) && (await deleteContact(id)) && dialog.current?.close()))}
            >
              <Icon name="x" size={14} /> Delete {name}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
