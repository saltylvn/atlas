"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { getContext } from "@/lib/context";
import { MINUTES_SAVED } from "@/lib/domain/agents";
import { BODY_LIMIT, handOffLink, parseSlackRef } from "@/lib/domain/comms";
import { CHANNELS, CIRCLES, PEOPLE_CATEGORIES } from "@/lib/domain/types";
import { board, CATEGORY, hasPlace, sameContact, SLOTS, textReminderLink } from "@/lib/domain/people";
import { zonedToUtc } from "@/lib/domain/dates";
import { env } from "@/lib/env";
import { structured } from "@/lib/ai/model";
import { takeAiCall } from "@/lib/ai/budget";
import { Draft, TONES, draftData, draftTask, templateDraft } from "@/lib/ai/prompts";
import { firstIssue, formObject, id, type ActionResult } from "./_shared";

const NewContact = z
  .object({
    name: z.string().trim().min(1).max(120),
    circle: z.enum(CIRCLES),
    email: z.union([z.email().max(200), z.literal("")]).default(""),
    phone: z.union([z.string().regex(/^\+?[0-9 ()-]{7,20}$/, "use digits, spaces, + ( ) -"), z.literal("")]).default(""),
    cadenceDays: z.coerce.number().int().min(0).max(365).default(0),
    birthday: z.union([z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "use MM-DD"), z.literal("")]).default(""),
    notes: z.string().max(2000).default(""),
    /** Workspace ID (T…), or blank when the member field holds a full Slack link. */
    slackTeam: z.string().trim().max(200).default(""),
    /** Member ID (U…), "T…/U…", or an app.slack.com link. */
    slackMember: z.string().trim().max(200).default(""),
  })
  .transform((c, ctx) => {
    const { slackTeam, slackMember, ...rest } = c;
    const fromMember = parseSlackRef(slackMember);
    const fromTeam = parseSlackRef(slackTeam);
    const slackTeamId = fromMember.teamId ?? fromTeam.teamId;
    const slackUserId = fromMember.userId ?? fromTeam.userId;
    if ((slackTeam || slackMember) && !(slackTeamId && slackUserId)) {
      ctx.addIssue({ code: "custom", path: ["slack"], message: "add both the workspace ID (T…) and member ID (U…), or paste a Slack link" });
      return z.NEVER;
    }
    return { ...rest, slackTeamId, slackUserId };
  });

function contactFields(c: z.output<typeof NewContact>) {
  return {
    name: c.name,
    circle: c.circle,
    email: c.email || null,
    phone: c.phone || null,
    cadenceDays: c.cadenceDays,
    birthday: c.birthday || null,
    notes: c.notes,
    slackTeamId: c.slackTeamId,
    slackUserId: c.slackUserId,
  };
}

export async function createContact(_: unknown, fd: FormData): Promise<ActionResult> {
  const p = NewContact.safeParse(formObject(fd));
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store } = await getContext();
  await store.contacts.create({ ...contactFields(p.data), lastContactAt: null });
  revalidatePath("/people");
  return { ok: true, message: "Contact added" };
}

export async function updateContact(_: unknown, fd: FormData): Promise<ActionResult> {
  const obj = formObject(fd);
  const cid = id.safeParse(obj.id);
  if (!cid.success) return { ok: false, error: "Bad id" };
  const p = NewContact.safeParse(obj);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store } = await getContext();
  const updated = await store.contacts.update(cid.data, contactFields(p.data));
  if (!updated) return { ok: false, error: "Contact not found" };
  revalidatePath("/people");
  revalidatePath("/");
  return { ok: true, message: "Saved" };
}

export async function deleteContact(contactId: string): Promise<ActionResult> {
  const p = id.safeParse(contactId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  await store.contacts.remove(p.data);
  await audit(store, { actor: "owner", action: "contact.delete", target: p.data, detail: "", outcome: "success" });
  revalidatePath("/people");
  return { ok: true };
}

export async function markContacted(contactId: string): Promise<ActionResult> {
  const p = id.safeParse(contactId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  await store.contacts.update(p.data, { lastContactAt: new Date().toISOString() });
  revalidatePath("/people");
  revalidatePath("/");
  return { ok: true };
}

const DraftRequest = z.object({
  contactId: id,
  channel: z.enum(CHANNELS),
  tone: z.enum(TONES),
  purpose: z.string().trim().min(3).max(500),
});

export async function draftMessage(input: z.input<typeof DraftRequest>): Promise<
  ActionResult<{ subject: string; body: string; draftedBy: "ai" | "template"; note?: string }>
> {
  const p = DraftRequest.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, settings } = await getContext();
  const contact = await store.contacts.get(p.data.contactId);
  if (!contact) return { ok: false, error: "Contact not found" };

  const gate = await takeAiCall(store, settings, "draft");
  if (gate.allowed) {
    const res = await structured(Draft, draftTask(p.data.channel, p.data.tone), draftData(contact, p.data.purpose, settings.displayName));
    if (res.ok) {
      const body = res.value.body.slice(0, BODY_LIMIT[p.data.channel]);
      await audit(store, { actor: "ai", action: "draft.create", target: contact.id, detail: `channel=${p.data.channel}`, outcome: "success" });
      return { ok: true, data: { subject: p.data.channel === "email" ? res.value.subject : "", body, draftedBy: "ai" } };
    }
  }
  const t = templateDraft(contact, p.data.purpose, p.data.channel, settings.displayName);
  return { ok: true, data: { ...t, draftedBy: "template", note: gate.allowed ? "Claude was unavailable, so the offline drafter wrote this." : gate.why } };
}

const HandOff = z.object({
  contactId: id,
  channel: z.enum(CHANNELS),
  subject: z.string().max(200),
  body: z.string().trim().min(1).max(5000),
  draftedBy: z.enum(["ai", "template", "you"]),
});

/**
 * Records that you opened a draft in Mail, Messages or Slack. Atlas itself never sends:
 * the phone's own app does, after you look at it and tap Send.
 */
export async function recordHandOff(input: z.input<typeof HandOff>): Promise<ActionResult> {
  const p = HandOff.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, settings } = await getContext();
  if (!settings.outboundEnabled) {
    await audit(store, { actor: "owner", action: "message.handoff", target: p.data.contactId, detail: "blocked by kill switch", outcome: "denied" });
    return { ok: false, error: "The kill switch is on. Turn it off in Settings to hand off drafts." };
  }
  const contact = await store.contacts.get(p.data.contactId);
  if (!contact) return { ok: false, error: "Contact not found" };
  await store.messages.create({ ...p.data, status: "handed_off", handedOffAt: new Date().toISOString() });
  await store.contacts.update(contact.id, { lastContactAt: new Date().toISOString() });
  if (p.data.draftedBy !== "you") {
    await store.ledger.add({ agent: "email", activity: `Drafted ${p.data.channel} to ${contact.name}`, minutesSaved: MINUTES_SAVED.draftWritten });
  }
  await audit(store, { actor: "owner", action: "message.handoff", target: contact.id, detail: `channel=${p.data.channel} by=${p.data.draftedBy}`, outcome: "success" });
  revalidatePath("/people");
  revalidatePath("/");
  return { ok: true };
}

const NewSnippet = z.object({
  channel: z.enum(CHANNELS),
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(2000),
});

/** Saves a reusable message for one channel. {first}, {name} and {me} are filled in when used. */
export async function createSnippet(input: z.input<typeof NewSnippet>): Promise<ActionResult<{ id: string }>> {
  const p = NewSnippet.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store } = await getContext();
  const s = await store.snippets.create(p.data);
  revalidatePath("/people");
  return { ok: true, data: { id: s.id }, message: "Snippet saved" };
}

export async function deleteSnippet(snippetId: string): Promise<ActionResult> {
  const p = id.safeParse(snippetId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  await store.snippets.remove(p.data);
  revalidatePath("/people");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The People tab's six categories (lib/domain/people.ts)

const Place = z.object({ contactId: id, category: z.enum(PEOPLE_CATEGORIES), slot: z.number().int().min(1).max(SLOTS) }).refine((v) => hasPlace(v.category, v.slot), { message: "That category has no such place.", path: ["slot"] });

/** Puts someone already in Atlas into a free place. A taken place is refused, never overwritten. */
export async function placePerson(input: z.input<typeof Place>): Promise<ActionResult> {
  const p = Place.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store } = await getContext();
  const contacts = await store.contacts.list();
  const person = contacts.find((c) => c.id === p.data.contactId);
  if (!person) return { ok: false, error: "That person is not in Atlas." };
  if (board(contacts)[p.data.category][p.data.slot - 1]) return { ok: false, error: "That place is taken. Remove that person first." };
  await store.contacts.update(person.id, { category: p.data.category, slot: p.data.slot, circle: CATEGORY[p.data.category].circle });
  await audit(store, { actor: "owner", action: "people.place", target: person.id, detail: p.data.category, outcome: "success" });
  revalidatePath("/people");
  return { ok: true, message: `${person.name} is in ${CATEGORY[p.data.category].label}.` };
}

const AddPlace = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z.union([z.string().regex(/^\+?[0-9 ()-]{7,20}$/, "use digits, spaces, + ( ) -"), z.literal("")]).default(""),
  email: z.union([z.email().max(200), z.literal("")]).default(""),
  category: z.enum(PEOPLE_CATEGORIES),
  slot: z.number().int().min(1).max(SLOTS),
}).refine((v) => hasPlace(v.category, v.slot), { message: "That category has no such place.", path: ["slot"] });

/** Adds someone new straight into a free place. */
export async function addAndPlace(input: z.input<typeof AddPlace>): Promise<ActionResult> {
  const p = AddPlace.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store } = await getContext();
  const contacts = await store.contacts.list();
  if (board(contacts)[p.data.category][p.data.slot - 1]) return { ok: false, error: "That place is taken. Remove that person first." };
  if (sameContact(contacts, { name: p.data.name, phone: p.data.phone || null, email: p.data.email || null })) return { ok: false, error: `${p.data.name} is already in Atlas: pick them from the list instead.` };
  const made = await store.contacts.create({ name: p.data.name, circle: CATEGORY[p.data.category].circle, email: p.data.email || null, phone: p.data.phone || null, cadenceDays: 0, lastContactAt: null, birthday: null, notes: "", category: p.data.category, slot: p.data.slot });
  await audit(store, { actor: "owner", action: "people.add", target: made.id, detail: p.data.category, outcome: "success" });
  revalidatePath("/people");
  return { ok: true, message: `${p.data.name} is in ${CATEGORY[p.data.category].label}.` };
}

/** Takes someone out of their place. They stay in Atlas, with everything you sent them. */
export async function unplacePerson(contactId: string): Promise<ActionResult> {
  const p = id.safeParse(contactId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  await store.contacts.update(p.data, { category: null, slot: null });
  await audit(store, { actor: "owner", action: "people.unplace", target: p.data, detail: "", outcome: "success" });
  revalidatePath("/people");
  return { ok: true };
}

const Schedule = z.object({
  contactId: id,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  body: z.string().trim().min(1).max(BODY_LIMIT.sms),
  draftedBy: z.enum(["ai", "template", "you"]).default("you"),
});

/**
 * Schedules a text: keeps your draft and the time. Atlas never sends it: at that time your phone
 * gets a notification from Atlas (at its next run) and, if you add it, an event in your own
 * calendar at the exact minute. Either opens the draft for you to send in Messages.
 */
export async function scheduleText(input: z.input<typeof Schedule>): Promise<ActionResult<{ calendar: string }>> {
  const p = Schedule.safeParse(input);
  if (!p.success) return { ok: false, error: firstIssue(p.error) };
  const { store, settings, now } = await getContext();
  const contact = await store.contacts.get(p.data.contactId);
  if (!contact) return { ok: false, error: "Contact not found" };
  if (!contact.phone) return { ok: false, error: `Add ${contact.name}'s phone number first.` };
  const at = zonedToUtc(p.data.day, p.data.time, settings.timezone);
  if (at.getTime() < now.getTime() - 60_000) return { ok: false, error: "Pick a time that has not passed." };
  if (at.getTime() > now.getTime() + 366 * 86_400_000) return { ok: false, error: "Pick a time within the next year." };
  const made = await store.messages.create({ contactId: contact.id, channel: "sms", subject: "", body: p.data.body, status: "draft", draftedBy: p.data.draftedBy, handedOffAt: null, remindAt: at.toISOString(), remindedAt: null });
  await audit(store, { actor: "owner", action: "people.schedule-text", target: contact.id, detail: at.toISOString(), outcome: "success" });
  const site = (env().ATLAS_SITE_URL ?? "https://atlas-optim.vercel.app").replace(/\/$/, "");
  revalidatePath("/people");
  return { ok: true, message: `Scheduled. Atlas reminds you then; you send it.`, data: { calendar: textReminderLink(contact.name, p.data.body, { day: p.data.day, time: p.data.time }, settings.timezone, `${site}/people?scheduled=${made.id}#scheduled`) } };
}

/** Cancels a scheduled text that was not sent. */
export async function cancelScheduled(messageId: string): Promise<ActionResult> {
  const p = id.safeParse(messageId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  const m = await store.messages.get(p.data);
  if (!m || m.status !== "draft") return { ok: false, error: "That text is no longer scheduled." };
  await store.messages.update(m.id, { status: "cancelled" });
  await audit(store, { actor: "owner", action: "people.cancel-text", target: m.contactId, detail: "", outcome: "success" });
  revalidatePath("/people");
  return { ok: true };
}

/** You opened an invite in your calendar: counts as being in touch. Nothing is sent by Atlas. */
export async function noteInvite(contactId: string): Promise<ActionResult> {
  const p = id.safeParse(contactId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store } = await getContext();
  await store.contacts.update(p.data, { lastContactAt: new Date().toISOString() });
  await audit(store, { actor: "owner", action: "people.invite", target: p.data, detail: "opened in calendar", outcome: "success" });
  revalidatePath("/people");
  return { ok: true };
}

/** You are sending a scheduled text now: it opens in Messages, and Atlas records the hand-off. Atlas never sends it. */
export async function sendScheduled(messageId: string): Promise<ActionResult<{ href: string }>> {
  const p = id.safeParse(messageId);
  if (!p.success) return { ok: false, error: "Bad id" };
  const { store, settings } = await getContext();
  if (!settings.outboundEnabled) return { ok: false, error: "The kill switch is on. Turn it off in Settings to hand off drafts." };
  const m = await store.messages.get(p.data);
  if (!m || m.status !== "draft") return { ok: false, error: "That text is no longer scheduled." };
  const contact = await store.contacts.get(m.contactId);
  const link = contact ? handOffLink("sms", contact, "", m.body) : null;
  if (!contact || !link) return { ok: false, error: "Add their phone number first." };
  const at = new Date().toISOString();
  await store.messages.update(m.id, { status: "handed_off", handedOffAt: at });
  await store.contacts.update(contact.id, { lastContactAt: at });
  await audit(store, { actor: "owner", action: "message.handoff", target: contact.id, detail: "channel=sms scheduled", outcome: "success" });
  revalidatePath("/people");
  return { ok: true, data: { href: link.href } };
}
