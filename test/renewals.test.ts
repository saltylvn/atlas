import { describe, expect, it } from "vitest";
import { localDate } from "@/lib/domain/dates";
import { composeBrief } from "@/lib/domain/brief";
import {
  addMonths,
  isCalendarDate,
  nextDueOn,
  renewalHref,
  renewalDueLabel,
  renewalView,
  renewalWhen,
  type Renewal,
} from "@/lib/domain/renewals";
import { recordToRow, rowToRecord } from "@/lib/data/supabase";
import { createMemoryStore, seedState } from "@/lib/data/memory";

const today = "2026-11-12";

function renewal(partial: Partial<Renewal> & Pick<Renewal, "title" | "dueOn">): Renewal {
  return {
    id: partial.id ?? partial.title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    title: partial.title,
    kind: partial.kind ?? "renewal",
    dueOn: partial.dueOn,
    leadDays: partial.leadDays ?? 14,
    cadence: partial.cadence ?? "yearly",
    anchorDay: partial.anchorDay ?? Number(partial.dueOn.slice(8, 10)),
    url: partial.url ?? "",
    notes: partial.notes ?? "",
    createdAt: "2026-11-01T00:00:00Z",
  };
}

describe("renewal dates", () => {
  it("rejects dates that are not on the calendar", () => {
    expect(isCalendarDate("2026-02-28")).toBe(true);
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("11/12/2026")).toBe(false);
  });

  it("keeps the anchor day across short months", () => {
    expect(addMonths("2026-01-31", 1, 31)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1, 31)).toBe("2024-02-29");
    expect(addMonths("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(nextDueOn("2026-01-31", 31, "monthly", "2026-02-01")).toBe("2026-02-28");
    expect(nextDueOn("2026-02-28", 31, "monthly", "2026-03-01")).toBe("2026-03-31");
  });

  it("steps 29 February onto 28 February, then back onto 29 in a leap year", () => {
    expect(addMonths("2024-02-29", 12, 29)).toBe("2025-02-28");
    expect(nextDueOn("2024-02-29", 29, "yearly", "2024-03-01")).toBe("2025-02-28");
    expect(nextDueOn("2027-02-28", 29, "yearly", "2027-03-01")).toBe("2028-02-29");
  });

  it("catches a lapsed monthly item up past today, and clears a one-time item", () => {
    expect(nextDueOn("2026-08-15", 15, "monthly", today)).toBe("2026-11-15");
    expect(nextDueOn(today, 12, "yearly", today)).toBe("2027-11-12");
    expect(nextDueOn("2026-12-01", 1, "monthly", today)).toBe("2027-01-01");
    expect(nextDueOn(today, 12, "once", today)).toBeNull();
  });
});

describe("renewal links", () => {
  it("accepts https links and drops everything else", () => {
    expect(renewalHref("https://example.com/insurance")).toMatch(/^https:\/\//);
    expect(renewalHref("https://example.com/insurance")).toBe("https://example.com/insurance");
    expect(renewalHref("http://example.com/insurance")).toBeNull();
    expect(renewalHref("javascript:alert(1)")).toBeNull();
    expect(renewalHref("https://user:pass@example.com/insurance")).toBeNull();
    expect(renewalHref("https://example.com@evil.com/")).toBeNull();
    expect(renewalHref("")).toBeNull();
  });
});

describe("renewal view", () => {
  it("puts overdue first, includes the lead-window edge, and sorts ties by title", () => {
    const view = renewalView(
      [
        renewal({ title: "Zebra", dueOn: "2026-11-20", leadDays: 14 }),
        renewal({ title: "Alpha", dueOn: "2026-11-12" }),
        renewal({ title: "Beta", dueOn: "2026-11-12" }),
        renewal({ title: "Late", dueOn: "2026-11-08" }),
        renewal({ title: "Far", dueOn: "2026-12-20", leadDays: 14 }),
        renewal({ title: "Edge", dueOn: "2026-11-26", leadDays: 14 }),
      ],
      today,
    );
    expect(view.attention.map((row) => row.renewal.title)).toEqual(["Late", "Alpha", "Beta", "Zebra", "Edge"]);
    expect(view.attention.map((row) => row.attention)).toEqual(["overdue", "today", "today", "soon", "soon"]);
    expect(view.later.map((row) => row.renewal.title)).toEqual(["Far"]);
    expect(renewalWhen(-4)).toBe("4 days overdue");
    expect(renewalWhen(-1)).toBe("1 day overdue");
    expect(renewalWhen(0)).toBe("Due today");
    expect(renewalWhen(1)).toBe("In 1 day");
    expect(renewalDueLabel("2026-11-08", today)).toBe("Sun, Nov 8");
    expect(renewalDueLabel("2027-12-17", today)).toBe("Fri, Dec 17, 2027");
  });

  it("shows the demo insurance row as an https link and keeps the passport out of the window", () => {
    const now = new Date("2026-11-12T18:00:00Z");
    const day = localDate(now, "America/Denver");
    expect(day).toBe(today);
    const view = renewalView(seedState(now).renewals, day);
    const insurance = view.attention[0];
    expect(insurance?.renewal.title).toBe("Renters insurance");
    expect(insurance?.attention).toBe("overdue");
    expect(renewalHref(insurance?.renewal.url ?? "")).toMatch(/^https:\/\//);
    expect(view.attention.map((row) => row.renewal.title)).toEqual([
      "Renters insurance",
      "atlas.example domain",
      "Download last year's tax PDF",
      "Car registration",
    ]);
    expect(view.later.map((row) => row.renewal.title)).toEqual(["Passport"]);
    expect(view.later[0]?.renewal.anchorDay).toBe(Number(view.later[0]?.renewal.dueOn.slice(8, 10)));
  });

  it("round-trips a renewal through the memory store", async () => {
    const store = createMemoryStore(seedState(new Date("2026-11-12T18:00:00Z")));
    const created = await store.renewals.create({
      title: "Library card",
      kind: "document",
      dueOn: today,
      leadDays: 0,
      cadence: "once",
      anchorDay: 12,
      url: "",
      notes: "",
    });
    expect((await store.renewals.list()).some((row) => row.id === created.id)).toBe(true);
    const rolled = await store.renewals.update(created.id, { dueOn: "2027-11-12" });
    expect(rolled?.dueOn).toBe("2027-11-12");
    await store.renewals.remove(created.id);
    expect(await store.renewals.get(created.id)).toBeNull();
  });
});

describe("renewal brief", () => {
  it("names the first item that needs attention and stays quiet when none do", () => {
    const base = {
      today,
      tasks: [],
      events: [],
      peopleDue: [],
      pipeline: null,
      news: [],
      weather: null,
      dailyCapacityMin: 360,
      timeZone: "America/Denver",
    };
    const withOne = composeBrief({
      ...base,
      renewals: [renewal({ title: "Renters insurance", dueOn: "2026-11-08", url: "https://example.com/insurance" })],
    });
    expect(withOne.risks).toEqual(["Renters insurance is 4 days overdue."]);
    const withTwo = composeBrief({
      ...base,
      renewals: [
        renewal({ title: "Renters insurance", dueOn: "2026-11-08" }),
        renewal({ title: "Car registration", dueOn: "2026-11-20" }),
      ],
    });
    expect(withTwo.risks).toEqual(["2 bills or renewals need a look. First: Renters insurance (4 days overdue)."]);
    expect(composeBrief(base).risks).toEqual([]);
  });
});

describe("renewal row mapping", () => {
  it("maps camelCase fields to the renewals table and back", () => {
    const row = recordToRow({
      title: "Renters insurance",
      kind: "renewal",
      dueOn: "2026-11-08",
      leadDays: 14,
      cadence: "yearly",
      anchorDay: 8,
      url: "https://example.com/insurance",
      notes: "",
    });
    expect(row).toEqual({
      title: "Renters insurance",
      kind: "renewal",
      due_on: "2026-11-08",
      lead_days: 14,
      cadence: "yearly",
      anchor_day: 8,
      url: "https://example.com/insurance",
      notes: "",
    });
    expect(rowToRecord({ ...row, id: "1", owner_id: "owner", created_at: "2026-11-01T00:00:00Z" })).toMatchObject({
      id: "1",
      dueOn: "2026-11-08",
      leadDays: 14,
      anchorDay: 8,
      createdAt: "2026-11-01T00:00:00Z",
    });
  });
});
