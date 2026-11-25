import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStore, seedState } from "@/lib/data/memory";
import type { Store } from "@/lib/data/store";
import { board, calendarLink, CATEGORY, cleanEmail, cleanPhone, freeSlot, hasPlace, inYourLists, overdue, PHONEBOOK_MAX, planImport, remindersDue, sameContact, searchPeople, SLOTS, textReminderLink } from "@/lib/domain/people";
import { PEOPLE_CATEGORIES, type Contact } from "@/lib/domain/types";
import { remindScheduledTexts } from "@/lib/agents/peopleReminders";
import * as capture from "@/app/api/capture/route";

const TOKEN = "s".repeat(40);
const h = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("@/lib/env", () => ({ env: () => ({ NODE_ENV: "test", ATLAS_CAPTURE_TOKEN: "s".repeat(40) }), mode: () => "live" }));
vi.mock("@/lib/owner", async (orig) => ({ ...(await orig<typeof import("@/lib/owner")>()), serviceReady: () => true, ownerServiceStore: () => h.store as Store }));
vi.mock("@/lib/push", () => ({ sendToAll: vi.fn(async () => ({ sent: 1, removed: 0, failed: 0 })) }));

const NOW = new Date("2026-11-20T18:00:00Z");
const TODAY = "2026-11-20";
let n = 0;
const person = (over: Partial<Contact> = {}): Contact => ({ id: `p${++n}`, name: `Person ${n}`, circle: "friends", email: null, phone: null, cadenceDays: 0, lastContactAt: null, birthday: null, notes: "", createdAt: "2026-11-01T00:00:00Z", category: null, slot: null, ...over });

describe("Six groups of four", () => {
  it("has the six categories in your order: one place for Spouse, four for each of the rest", () => {
    expect(PEOPLE_CATEGORIES.map((c) => CATEGORY[c].label)).toEqual(["Spouse", "Family", "Friends", "Work Colleagues", "Mentors", "Church"]);
    expect(PEOPLE_CATEGORIES.map((c) => CATEGORY[c].slots)).toEqual([1, 4, 4, 4, 4, 4]);
    expect(SLOTS).toBe(4);
    expect(hasPlace("spouse", 1)).toBe(true);
    expect(hasPlace("spouse", 2)).toBe(false);
    expect(hasPlace("family", 4)).toBe(true);
    expect(hasPlace("family", 5)).toBe(false);
  });

  it("puts each placed person in their place, and finds the first free one", () => {
    const b = board([person({ name: "Ana", category: "family", slot: 2 }), person({ name: "Bo", category: "family", slot: 1 }), person({ name: "Unplaced" })]);
    expect(b.family.map((c) => c?.name ?? null)).toEqual(["Bo", "Ana", null, null]);
    expect(freeSlot(b, "family")).toBe(3);
    // Spouse has one place: a second person, or a stale place 2, is never shown there.
    const spouse = board([person({ name: "Sam", category: "spouse", slot: 1 }), person({ name: "Old", category: "spouse", slot: 2 })]);
    expect(spouse.spouse.map((c) => c?.name ?? null)).toEqual(["Sam"]);
    expect(freeSlot(spouse, "spouse")).toBeNull();
    expect(freeSlot(board([]), "spouse")).toBe(1);
  });

  it("says when it is time to reach out, from their own cadence or their category's", () => {
    expect(overdue(person({ category: "spouse", lastContactAt: "2026-11-18T12:00:00Z" }), TODAY)).toBe(true);
    expect(overdue(person({ category: "mentors", lastContactAt: "2026-11-01T12:00:00Z" }), TODAY)).toBe(false);
    expect(overdue(person({ category: "mentors", cadenceDays: 7, lastContactAt: "2026-11-01T12:00:00Z" }), TODAY)).toBe(true);
    expect(overdue(person({ category: null }), TODAY)).toBe(false);
  });

  it("finds people as you type, first names first", () => {
    const people = [person({ name: "Jordan Lee" }), person({ name: "Sam Jo" }), person({ name: "Joanna Park" }), person({ name: "Ben Majors" })];
    expect(searchPeople(people, "jo").map((p) => p.name)).toEqual(["Joanna Park", "Jordan Lee", "Sam Jo", "Ben Majors"]);
    expect(searchPeople(people, "  ")).toEqual([]);
  });
});

describe("Contacts from your phone", () => {
  it("keeps a phone number or email only when it looks like one", () => {
    expect(cleanPhone("+1 (801) 555-0101")).toBe("+1 (801) 555-0101");
    expect(cleanPhone("call me")).toBeNull();
    expect(cleanEmail(" Sam@Example.com ")).toBe("sam@example.com");
    expect(cleanEmail("not an email")).toBeNull();
  });

  it("knows a person already in Atlas by phone, then email, then name", () => {
    const known = [person({ name: "Sam Rivera", phone: "801-555-0101" }), person({ name: "Dana", email: "dana@x.com" })];
    expect(sameContact(known, { name: "Samuel", phone: "+1 (801) 555-0101", email: null })?.name).toBe("Sam Rivera");
    expect(sameContact(known, { name: "D", phone: null, email: "dana@x.com" })?.name).toBe("Dana");
    expect(sameContact(known, { name: "Someone New", phone: null, email: null })).toBeNull();
  });

  describe("the Add to Atlas Shortcut", () => {
    let store: Store;
    beforeEach(() => {
      const state = seedState(NOW);
      state.contacts = [];
      store = createMemoryStore(state);
      h.store = store;
    });
    const post = (body: unknown, token = TOKEN) => capture.POST(new NextRequest("http://x/api/capture", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));

    it("adds the one person you picked, in the category you named", async () => {
      const res = await post({ kind: "contact", name: "Kim Lee", phone: ["801 555 0100"], email: ["kim@example.com"], category: "Work Colleagues" });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true, saved: "contact", name: "Kim Lee", placed: "Work Colleagues", already: false });
      expect(await store.contacts.list()).toMatchObject([{ name: "Kim Lee", phone: "801 555 0100", email: "kim@example.com", category: "colleagues", slot: 1, circle: "team" }]);
    });

    it("never adds the same person twice, and fills in what was missing", async () => {
      await post({ kind: "contact", name: "Kim Lee" });
      const res = await post({ kind: "contact", name: "Kim Lee", phone: "801 555 0100", category: "friends" });
      expect(await res.json()).toMatchObject({ already: true, placed: "Friends" });
      const all = await store.contacts.list();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ phone: "801 555 0100", category: "friends", slot: 1 });
    });

    it("adds without a place when the category is full, or none was named", async () => {
      for (let i = 1; i <= 4; i++) await post({ kind: "contact", name: `Career Mentor ${i}`, category: "mentors" });
      const res = await post({ kind: "contact", name: "Fifth Career Mentor", category: "mentors" });
      expect(await res.json()).toMatchObject({ placed: null });
      expect((await store.contacts.list()).find((c) => c.name === "Fifth Career Mentor")?.category ?? null).toBeNull();
    });

    it("still takes tasks, and refuses a wrong token", async () => {
      expect((await post({ text: "Call the bank" })).status).toBe(201);
      expect((await post({ kind: "contact", name: "X" }, "w".repeat(40))).status).toBe(401);
    });
  });

  describe("the Import contacts Shortcut", () => {
    let store: Store;
    beforeEach(() => {
      const state = seedState(NOW);
      state.contacts = [person({ name: "Kim Lee", category: "friends", slot: 1, notes: "keep me" })];
      store = createMemoryStore(state);
      h.store = store;
    });
    const post = (body: unknown) => capture.POST(new NextRequest("http://x/api/capture", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) }));
    const list = [
      { name: "Kim Lee", phone: ["801 555 0100", "801 555 0199"], email: [] },
      { name: "Ana Diaz", phone: ["(801) 555-0111"], email: ["ana@example.com"] },
      { name: "Ana D.", phone: ["801-555-0111"] },
      { name: "Bo", email: "bo@example.com" },
      { name: "   ", phone: ["801 555 0122"] },
    ];

    it("adds new people unplaced, fills what someone already here lacked, and touches nothing else", async () => {
      const res = await post({ kind: "contacts", contacts: list });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ ok: true, saved: "contacts", added: 2, updated: 1, skipped: 2 });
      const all = await store.contacts.list();
      expect(all.find((c) => c.name === "Kim Lee")).toMatchObject({ phone: "801 555 0100", category: "friends", slot: 1, notes: "keep me" });
      expect(all.filter((c) => c.phonebook).map((c) => [c.name, c.phone, c.email, c.category, c.cadenceDays])).toEqual([
        ["Ana Diaz", "(801) 555-0111", "ana@example.com", null, 0],
        ["Bo", null, "bo@example.com", null, 0],
      ]);
      // Imports stay out of your lists until placed, but every empty place can find them.
      expect(all.filter(inYourLists).map((c) => c.name)).toEqual(["Kim Lee"]);
      expect(searchPeople(all, "ana").map((c) => c.name)).toEqual(["Ana Diaz"]);
      // Counts only in the audit trail, never names.
      expect(JSON.stringify((await store.audit.recent(5)).filter((e) => e.action === "capture.contacts"))).not.toContain("Ana");
    });

    it("adds nobody the second time", async () => {
      await post({ kind: "contacts", contacts: list });
      const again = await post({ kind: "contacts", contacts: list });
      expect(await again.json()).toMatchObject({ added: 0, updated: 0 });
      expect(await store.contacts.list()).toHaveLength(3);
    });

    it("refuses an empty or oversized list, and a single contact or a thought stays small", async () => {
      expect((await post({ kind: "contacts", contacts: [] })).status).toBe(400);
      expect((await post({ kind: "contacts", contacts: Array.from({ length: PHONEBOOK_MAX + 1 }, (_, i) => ({ name: `P${i}` })) })).status).toBe(413);
      expect((await post({ text: "x".repeat(5000) })).status).toBe(413);
      const plan = planImport([], Array.from({ length: PHONEBOOK_MAX + 50 }, (_, i) => ({ name: `P${i}`, phone: null, email: null })));
      expect(plan.create).toHaveLength(PHONEBOOK_MAX);
    });
  });
});

describe("Scheduling and invites", () => {
  it("opens an invite in your own Google Calendar, with the person as a guest", () => {
    const url = new URL(calendarLink({ title: "Lunch", day: "2026-11-21", time: "23:30", minutes: 60, place: "Cafe Rio", guests: ["kim@example.com", "nope"], timezone: "America/Denver" }));
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(Object.fromEntries(url.searchParams)).toEqual({ action: "TEMPLATE", text: "Lunch", dates: "20261121T233000/20261122T003000", ctz: "America/Denver", location: "Cafe Rio", add: "kim@example.com" });
  });

  it("puts a scheduled text's reminder in your calendar at the exact time, with the draft and a way back", () => {
    const url = new URL(textReminderLink("Kim", "Hey Kim!", { day: "2026-11-21", time: "18:00" }, "America/Denver", "https://atlas.example/people?scheduled=m1#scheduled"));
    expect(url.searchParams.get("text")).toBe("Text Kim");
    expect(url.searchParams.get("dates")).toBe("20261121T180000/20261121T181000");
    expect(url.searchParams.get("details")).toContain("Hey Kim!");
    expect(url.searchParams.get("details")).toContain("https://atlas.example/people?scheduled=m1#scheduled");
  });

  it("reminds you once, when the time has come, and never sends the text", async () => {
    const state = seedState(NOW);
    const store = createMemoryStore(state);
    const kim = await store.contacts.create({ name: "Kim", circle: "friends", email: null, phone: "8015550100", cadenceDays: 0, lastContactAt: null, birthday: null, notes: "" });
    const due = await store.messages.create({ contactId: kim.id, channel: "sms", subject: "", body: "Hey Kim", status: "draft", draftedBy: "you", handedOffAt: null, remindAt: "2026-11-20T17:00:00Z", remindedAt: null });
    await store.messages.create({ contactId: kim.id, channel: "sms", subject: "", body: "Later", status: "draft", draftedBy: "you", handedOffAt: null, remindAt: "2026-11-25T17:00:00Z", remindedAt: null });
    expect(remindersDue(await store.messages.list(), NOW).map((m) => m.id)).toEqual([due.id]);
    const ctx = { settings: { ...state.settings, outboundEnabled: true }, now: NOW };
    expect(await remindScheduledTexts(ctx, store)).toBe(1);
    expect(await remindScheduledTexts(ctx, store)).toBe(0);
    const after = await store.messages.get(due.id);
    expect(after).toMatchObject({ status: "draft", remindedAt: NOW.toISOString(), handedOffAt: null });
    const { sendToAll } = await import("@/lib/push");
    expect(vi.mocked(sendToAll).mock.calls.at(-1)![1]).toEqual({ title: "Time to text Kim", body: "Hey Kim", url: `/people?scheduled=${due.id}#scheduled` });
  });

  it("is stored with a check that one place holds one person", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/migrations/20261120080000_people_categories.sql", "utf8");
    expect(sql).toContain("create unique index if not exists contacts_one_per_place on public.contacts (owner_id, category, slot) where category is not null;");
    expect(sql).toContain("check ((slot is null) = (category is null))");
    // Spouse holds one person, in the database as in the app.
    expect(readFileSync("supabase/migrations/20261120100000_spouse_one_place.sql", "utf8")).toContain("check (category is distinct from 'spouse' or slot = 1)");
    expect(readFileSync("supabase/migrations/20261120110000_contacts_phonebook.sql", "utf8")).toContain("add column if not exists phonebook boolean not null default false");
  });
});
