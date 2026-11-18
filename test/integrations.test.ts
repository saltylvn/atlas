import { describe, expect, it } from "vitest";
import { parseFeed, dedupeAndSort, safeLink, interleaveBySource } from "@/lib/integrations/rss";
import { eventsBetween } from "@/lib/integrations/ical";
import { findConflicts } from "@/lib/domain/calendarAgent";
import { normalize } from "@/lib/integrations/jobBoards";
import { templateDraft, BriefRewrite } from "@/lib/ai/prompts";
import { createMemoryStore, seedState } from "@/lib/data/memory";

describe("rss", () => {
  it("parses RSS and Atom and drops unsafe links and markup", () => {
    const rss = `<?xml version="1.0"?><rss><channel>
      <item><title><![CDATA[Big <b>news</b> &amp; more]]></title><link>https://a.com/1</link><pubDate>Wed, 11 Nov 2026 10:00:00 GMT</pubDate></item>
      <item><title>Bad link</title><link>javascript:alert(1)</link></item>
    </channel></rss>`;
    const items = parseFeed(rss, "tech", "A");
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe("Big news & more");
    const atom = `<feed><entry><title>Atom one</title><link rel="alternate" href="https://b.com/x"/><updated>2026-11-11T09:00:00Z</updated></entry></feed>`;
    expect(parseFeed(atom, "ai", "B")[0]!.url).toBe("https://b.com/x");
    expect(safeLink("data:text/html,hi")).toBeNull();
  });
  it("dedupes by link and title, newest first", () => {
    const base = { topic: "ai" as const, source: "s" };
    const out = dedupeAndSort([
      { ...base, id: "1", title: "Model launch!", url: "https://a/1", publishedAt: "2026-11-10T00:00:00Z" },
      { ...base, id: "2", title: "model launch", url: "https://b/1", publishedAt: "2026-11-11T00:00:00Z" },
      { ...base, id: "3", title: "Other", url: "https://c/1", publishedAt: null },
    ]);
    expect(out.map((i) => i.id)).toEqual(["2", "3"]);
  });
});

describe("interleave", () => {
  it("alternates sources", () => {
    const mk = (id: string, source: string) => ({ id, source, topic: "tech" as const, title: id, url: id, publishedAt: null });
    expect(interleaveBySource([mk("a1", "A"), mk("a2", "A"), mk("a3", "A"), mk("b1", "B")]).map((i) => i.id)).toEqual(["a1", "b1", "a2", "a3"]);
  });
});

describe("ical", () => {
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT", "UID:one", "SUMMARY:Standup", "DTSTART;TZID=America/Denver:20261102T091500", "DTEND;TZID=America/Denver:20261102T093000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR", "EXDATE;TZID=America/Denver:20261113T091500", "END:VEVENT",
    "BEGIN:VEVENT", "UID:two", "SUMMARY:Dentist\\, cleaning", "DTSTART:20261111T200000Z", "DTEND:20261111T210000Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:three", "SUMMARY:Holiday", "DTSTART;VALUE=DATE:20261111", "DTEND;VALUE=DATE:20261112", "END:VEVENT",
    "BEGIN:VEVENT", "UID:four", "SUMMARY:Cancelled", "STATUS:CANCELLED", "DTSTART:20261111T150000Z", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  it("expands weekly rules, honors EXDATE and timezones", () => {
    const ev = eventsBetween(ics, "2026-11-09", "2026-11-15", "America/Denver");
    const standups = ev.filter((e) => e.title === "Standup");
    expect(standups.map((e) => e.start)).toEqual(["2026-11-09T16:15:00.000Z", "2026-11-11T16:15:00.000Z"]);
    expect(ev.find((e) => e.title === "Dentist, cleaning")).toBeTruthy();
    expect(ev.find((e) => e.title === "Holiday")?.allDay).toBe(true);
    expect(ev.find((e) => e.title === "Cancelled")).toBeUndefined();
  });

  // Real cases from Tyler's calendar (13 Nov 2026), America/Denver (MST, UTC-7).
  const edited = [
    "BEGIN:VCALENDAR",
    // "Work" daily, then deleted with "this and following" from Fri 13 Nov 09:30:
    // Google ends the series one second before that occurrence.
    "BEGIN:VEVENT", "UID:work", "SUMMARY:Work", "DTSTART;TZID=America/Denver:20261102T093000", "DTEND;TZID=America/Denver:20261102T163000",
    "RRULE:FREQ=DAILY;UNTIL=20261113T162959Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:start", "SUMMARY:Start Work", "DTSTART;TZID=America/Denver:20261113T093000", "DTEND;TZID=America/Denver:20261113T094500", "END:VEVENT",
    // "10X My Career" weekly Wed 08:00, moved to 08:30 from 18 Nov with "this and following".
    "BEGIN:VEVENT", "UID:tenx-old", "SUMMARY:10X My Career", "DTSTART;TZID=America/Denver:20261104T080000", "DTEND;TZID=America/Denver:20261104T090000",
    "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261118T145959Z", "END:VEVENT",
    "BEGIN:VEVENT", "UID:tenx-new", "SUMMARY:10X My Career", "DTSTART;TZID=America/Denver:20261118T083000", "DTEND;TZID=America/Denver:20261118T093000",
    "RRULE:FREQ=WEEKLY;BYDAY=WE", "END:VEVENT",
    // "Standup" daily 09:00; Tue 17 Nov moved to 11:00, Wed 18 Nov cancelled (single-instance edits).
    "BEGIN:VEVENT", "UID:standup", "SUMMARY:Standup", "DTSTART;TZID=America/Denver:20261116T090000", "DTEND;TZID=America/Denver:20261116T091500", "RRULE:FREQ=DAILY", "END:VEVENT",
    "BEGIN:VEVENT", "UID:standup", "RECURRENCE-ID;TZID=America/Denver:20261117T090000", "SUMMARY:Standup", "DTSTART;TZID=America/Denver:20261117T110000", "DTEND;TZID=America/Denver:20261117T111500", "END:VEVENT",
    "BEGIN:VEVENT", "UID:standup", "RECURRENCE-ID;TZID=America/Denver:20261118T090000", "STATUS:CANCELLED", "SUMMARY:Standup", "DTSTART;TZID=America/Denver:20261118T090000", "END:VEVENT",
    // The same event on two calendars.
    "BEGIN:VEVENT", "UID:club-a", "SUMMARY:6am Club", "DTSTART;TZID=America/Denver:20261114T060000", "DTEND;TZID=America/Denver:20261114T070000", "END:VEVENT",
    "BEGIN:VEVENT", "UID:club-b", "SUMMARY:6am Club", "DTSTART;TZID=America/Denver:20261114T060000", "DTEND;TZID=America/Denver:20261114T070000", "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  it("ends a series edited with 'this and following' before the edited occurrence", () => {
    const ev = eventsBetween(edited, "2026-11-12", "2026-11-19", "America/Denver");
    expect(ev.filter((e) => e.title === "Work").map((e) => e.start.slice(0, 10))).toEqual(["2026-11-12"]);
    expect(ev.filter((e) => e.title === "10X My Career").map((e) => e.start)).toEqual(["2026-11-18T15:30:00.000Z"]);
    expect(findConflicts(ev, "America/Denver")).toEqual([]);
  });

  it("shows a moved instance at its new time, drops a cancelled one, and shows duplicates once", () => {
    const ev = eventsBetween(edited, "2026-11-16", "2026-11-19", "America/Denver");
    expect(ev.filter((e) => e.title === "Standup").map((e) => e.start)).toEqual(["2026-11-16T16:00:00.000Z", "2026-11-17T18:00:00.000Z", "2026-11-19T16:00:00.000Z"]);
    expect(eventsBetween(edited, "2026-11-14", "2026-11-14", "America/Denver").filter((e) => e.title === "6am Club")).toHaveLength(1);
  });
});

describe("job boards", () => {
  it("normalizes each board and ignores malformed payloads", () => {
    expect(normalize("greenhouse", { jobs: [{ id: 1, title: "SE", absolute_url: "https://x", location: { name: "Remote" } }] })[0]).toMatchObject({ id: "1", location: "Remote" });
    expect(normalize("ashby", { jobs: [{ id: "a", title: "SA", jobUrl: "https://y", location: "NYC", isRemote: true }] })[0]!.location).toBe("NYC · Remote");
    expect(normalize("lever", [{ id: "l", text: "SE", hostedUrl: "https://z" }])[0]!.title).toBe("SE");
    expect(normalize("greenhouse", { nope: true })).toEqual([]);
  });
});

describe("ai helpers", () => {
  it("drafts a usable message offline", () => {
    const s = seedState(new Date("2026-11-11T15:00:00Z"));
    const mom = s.contacts.find((c) => c.name === "Mom")!;
    const sms = templateDraft(mom, "Checking in about Sunday dinner", "sms", "Tyler");
    expect(sms.subject).toBe("");
    expect(sms.body).toContain("Hey Mom");
    const email = templateDraft(s.contacts[0]!, "Can we review the onboarding doc Friday", "email", "Tyler");
    expect(email.body).toMatch(/^Hi Priya,/);
  });
  it("bounds AI output shape", () => {
    expect(BriefRewrite.safeParse({ headline: "x".repeat(200), summary: ["ok ok", "fine"] }).success).toBe(false);
  });
});

describe("memory store", () => {
  it("keeps the audit trail append-only and newest first", async () => {
    const store = createMemoryStore(seedState());
    await store.audit.append({ actor: "owner", action: "a", target: "", detail: "", outcome: "success" });
    await store.audit.append({ actor: "owner", action: "b", target: "", detail: "", outcome: "success" });
    expect((await store.audit.recent(2)).map((e) => e.action)).toEqual(["b", "a"]);
    expect("remove" in store.audit).toBe(false);
  });
});
