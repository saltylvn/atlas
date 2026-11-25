import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { env, mode } from "@/lib/env";
import { ownerServiceStore, serviceReady } from "@/lib/owner";
import { bearerMatches } from "@/lib/security/bearer";
import { rateLimit } from "@/lib/security/rateLimit";
import type { Store } from "@/lib/data/store";
import { board, CATEGORY, cleanEmail, cleanPhone, freeSlot, PHONEBOOK_MAX, planImport, sameContact } from "@/lib/domain/people";
import { PEOPLE_CATEGORIES } from "@/lib/domain/types";
import { noteRefusedToken } from "@/lib/security/refusedToken";

// Capture from anywhere: an iPhone Shortcut ("Hey Siri, tell Atlas...") posts here with
// a bearer token. A task lands in the backlog, or an idea on the Projects page. The "Add to
// Atlas" Shortcut sends one contact you picked in your phone's own contact picker: it lands in
// People (in a category when you named one with a free place). The "Import contacts to Atlas"
// Shortcut sends your whole contact list once (kind "contacts"), which you asked for on 20 Nov
// 2026, so any empty place can find anyone by typing: names, phones and emails only, kept
// unplaced and out of your lists until you place someone.
// A refused token is counted for the audit trail (lib/security/refusedToken.ts).

const Body = z.object({
  text: z.string().trim().min(1).max(200),
  kind: z.enum(["task", "idea"]).default("task"),
});

/** One contact from the phone's picker. Shortcuts may send a list for a phone or email: the first is used. */
const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const ContactBody = z.object({
  kind: z.literal("contact"),
  name: z.preprocess(first, z.string().trim().min(1).max(120)),
  phone: z.preprocess(first, z.unknown()).optional(),
  email: z.preprocess(first, z.unknown()).optional(),
  category: z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/^work colleagues?$/, "colleagues") : v), z.enum(PEOPLE_CATEGORIES)).optional().catch(undefined),
});

/** Your whole contact list. Shortcuts may send a list for each phone or email: the first is used. */
const ContactsBody = z.object({
  kind: z.literal("contacts"),
  contacts: z
    .array(z.object({ name: z.preprocess(first, z.string().max(200)).catch(""), phone: z.preprocess(first, z.unknown()).optional(), email: z.preprocess(first, z.unknown()).optional() }))
    .min(1)
    .max(PHONEBOOK_MAX),
});
/** One contact or a thought is small; a whole contact list is not. */
const MAX_BODY = 4096;
const MAX_CONTACTS_BODY = 1_500_000;

export async function POST(request: NextRequest) {
  if (!bearerMatches(request.headers.get("authorization"), env().ATLAS_CAPTURE_TOKEN)) {
    noteRefusedToken("/api/capture", request.headers.get("authorization"));
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (mode() !== "live" || !serviceReady()) return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (!rateLimit("capture", 30, 60 * 60_000).allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });

  const raw = await request.text();
  if (raw.length > MAX_CONTACTS_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { text: raw };
  }
  const store = ownerServiceStore();
  const list = ContactsBody.safeParse(parsed);
  if (list.success) {
    // A whole-list import is rare: a few an hour at most.
    if (!rateLimit("capture-contacts", 4, 60 * 60_000).allowed) return NextResponse.json({ error: "rate limited" }, { status: 429 });
    return NextResponse.json(await importContacts(store, list.data.contacts), { status: 201 });
  }
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "too large" }, { status: 413 });
  const c = ContactBody.safeParse(parsed);
  if (c.success) return NextResponse.json(await saveContact(store, c.data), { status: 201 });

  const p = Body.safeParse(parsed);
  if (!p.success) return NextResponse.json({ error: "text is required (1-200 characters)" }, { status: 400 });

  if (p.data.kind === "idea") {
    await store.projects.create({ title: p.data.text.slice(0, 160), kind: "idea", status: "idea", why: "", nextStep: "", link: null, reviewOn: null });
  } else {
    await store.tasks.create({
      title: p.data.text,
      notes: "Captured from Shortcut",
      status: "todo",
      priority: "medium",
      area: "personal",
      day: null,
      startTime: null,
      estimateMin: 30,
      energy: "shallow",
      recurrence: "none",
      completedAt: null,
    });
  }
  await audit(store, { actor: "system", action: `capture.${p.data.kind}`, target: "shortcut", detail: "", outcome: "success" });
  return NextResponse.json({ ok: true, saved: p.data.kind }, { status: 201 });
}

/**
 * Saves the contact you picked: the same person already in Atlas is updated (a phone or email it
 * lacked), anyone else is added. With a category that has a free place, they are placed there.
 * Says what happened, for the Shortcut to show. Idempotent: sending the same person twice adds nobody.
 */
async function saveContact(store: Store, c: z.output<typeof ContactBody>) {
  const phone = cleanPhone(c.phone);
  const email = cleanEmail(c.email);
  const contacts = await store.contacts.list();
  const b = board(contacts);
  const slot = c.category ? freeSlot(b, c.category) : null;
  const place = c.category && slot ? { category: c.category, slot, circle: CATEGORY[c.category].circle } : {};
  const known = sameContact(contacts, { name: c.name, phone, email });
  if (known) {
    const placedAlready = Boolean(known.category);
    await store.contacts.update(known.id, { ...(phone && !known.phone ? { phone } : {}), ...(email && !known.email ? { email } : {}), ...(placedAlready ? {} : place) });
    await audit(store, { actor: "system", action: "capture.contact", target: "shortcut", detail: "updated", outcome: "success" });
    return { ok: true, saved: "contact", name: known.name, placed: placedAlready ? CATEGORY[known.category!].label : slot ? CATEGORY[c.category!].label : null, already: true };
  }
  await store.contacts.create({ name: c.name, circle: c.category ? CATEGORY[c.category].circle : "friends", email, phone, cadenceDays: 0, lastContactAt: null, birthday: null, notes: "", ...place });
  await audit(store, { actor: "system", action: "capture.contact", target: "shortcut", detail: slot ? `placed in ${c.category}` : "added", outcome: "success" });
  return { ok: true, saved: "contact", name: c.name, placed: slot ? CATEGORY[c.category!].label : null, already: false };
}

/**
 * Imports your contact list: new people are added unplaced and marked as from the phonebook;
 * people already in Atlas only gain a phone or email they lacked. Counts only in the reply and
 * the audit trail, never names. Idempotent: importing again adds nobody.
 */
async function importContacts(store: Store, entries: z.output<typeof ContactsBody>["contacts"]) {
  const plan = planImport(await store.contacts.list(), entries.map((e) => ({ name: e.name, phone: cleanPhone(e.phone), email: cleanEmail(e.email) })));
  const added = plan.create.length ? await store.phonebook.addMany(plan.create) : 0;
  for (const u of plan.update) await store.contacts.update(u.id, u.patch);
  await audit(store, { actor: "system", action: "capture.contacts", target: "shortcut", detail: `${added} added, ${plan.update.length} updated, ${plan.skipped} skipped`, outcome: "success" });
  return { ok: true, saved: "contacts", added, updated: plan.update.length, skipped: plan.skipped };
}

